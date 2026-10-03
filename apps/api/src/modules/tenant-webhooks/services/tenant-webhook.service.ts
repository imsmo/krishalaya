// modules/tenant-webhooks/services/tenant-webhook.service.ts · the tenant's webhook ENDPOINTS — PC-56 TENANT-13a (W188 + W2832–W2838).
//   • every read and write needs `api.manage` (F-12 — the controller guards it, and the service re-checks: a refusal is a sentence);
//   • register: the review's rules (domain/webhook-rules) + the guard with a LIVE DNS resolution (domain/webhook-ssrf — the same function
//     the worker runs at send time); the secret is `whsec_` + 32 random bytes, shown ONCE, envelope-encrypted at rest bound to the row
//     (core/secrets/secret-envelope; KEK from the environment — production without one refuses to start), its last 3 characters stored
//     apart as the hint. Idempotency-Key required (F-21). The idempotency store remembers the response WITHOUT the secret — a replayed
//     key answers `secretShown: false` rather than persisting a plaintext secret in idempotency_keys;
//   • acts — pause / resume / rotate / delete / replay-failed — each judged by `endpointActVerdict` (the confirm page asks the same
//     question first), keyed, reasoned, audited with actor · reason · before / after · ip;
//     pause holds the queue; resume re-queues every held and exhausted delivery in creation order (a disabled endpoint resumes only when
//     the guard passes again); rotate keeps the old secret signing for 24 h (both signatures in the window); delete is SOFT (F-6) and
//     cancels the open deliveries; replay-failed re-queues the failed ones with a fresh cycle.
import { Inject, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { AppConfig } from '../../../core/config/app-config';
import { resolveKek, sealEnvelope } from '../../../core/secrets/secret-envelope';
import { uuidv7 } from '../../../core/database/uuid.util';
import { WebhookRepository } from '../repositories/webhook.repository';
import { WebhookEndpoint } from '../domain/webhook-endpoint.entity';
import { Resolver, vetWebhookTarget } from '../domain/webhook-ssrf';
import { WEBHOOK_CATALOGUE } from '../domain/webhook-catalog';
import {
  EndpointAct, endpointActVerdict, generateSecret, reasonRefusal, reviewRegistration, secretHint,
} from '../domain/webhook-rules';
import {
  MAX_ATTEMPTS, PAYLOAD_VERSION, RESPONSE_BODY_CAP_BYTES, RESUMABLE_STATES, RETENTION_DAYS, RETRY_LADDER_LABELS, ROTATION_OVERLAP_HOURS, SEND_TIMEOUT_MS,
} from '../domain/webhook-rail.state';
import { SIGNATURE_HEADER } from '../domain/webhook-signature';
import { WebhookNotFoundError, WebhookRefusedError, WebhooksForbiddenError } from '../domain/tenant-webhooks.errors';
import { CreateWebhookDto, PreviewWebhookDto, UpdateWebhookDto } from '../dto/create-webhook.dto';

export interface WebhooksActor { userId: string; permissions: ReadonlySet<string>; ip: string | null; requestId: string | null }
export const canManageApi = (a: Pick<WebhooksActor, 'permissions'>) => a.permissions.has('api.manage') || a.permissions.has('*');

/** DI token for the resolver the registration guard uses (tests inject a fake; production resolves every address). */
export const WEBHOOK_RESOLVER = Symbol('WEBHOOK_RESOLVER');
export const systemResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));

/** The delivery contract exactly as built — the console prints these values (W188 "Retry policy (what we promise)"). */
export const DELIVERY_CONTRACT = Object.freeze({
  ladder: [...RETRY_LADDER_LABELS], attemptsPerCycle: MAX_ATTEMPTS, pausesEndpointAfterExhaustion: true, holdsWhilePaused: true,
  rotationOverlapHours: ROTATION_OVERLAP_HOURS, retentionDays: RETENTION_DAYS, timeoutSeconds: SEND_TIMEOUT_MS / 1000,
  responseCapKiB: RESPONSE_BODY_CAP_BYTES / 1024, payloadVersion: PAYLOAD_VERSION, signatureHeader: SIGNATURE_HEADER,
  secretStorage: 'encrypted_at_rest_shown_once' as const, redirects: 'refused' as const, ports: [443],
});

const aad = (endpointId: string) => `webhook_endpoint:${endpointId}`;

@Injectable()
export class TenantWebhookService {
  private readonly kek: Buffer;
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: WebhookRepository,
    config: AppConfig,
    @Inject(WEBHOOK_RESOLVER) private readonly resolve: Resolver,
  ) {
    this.kek = resolveKek(config.webhookSigningKek, config.isProd);   // production without a KEK: refuse to start
  }

  private assert(a: WebhooksActor) { if (!canManageApi(a)) throw new WebhooksForbiddenError(); }

  /** The catalogue the form offers: name, payload version, the fields a v1 payload carries. */
  catalogue(actor: WebhooksActor) {
    this.assert(actor);
    return WEBHOOK_CATALOGUE.map((c) => ({ name: c.name, payloadVersion: c.version, fields: c.fields }));
  }

  async list(tenantId: string, actor: WebhooksActor) {
    this.assert(actor);
    return timed(this.metrics, 'tenant_webhooks.list', { tenant: tenantId }, async () => {
      const { rows, total } = await this.repo.listEndpoints(tenantId);
      return { items: rows.map((r) => new WebhookEndpoint(r).serialize()), total, contract: DELIVERY_CONTRACT };
    });
  }

  /** W2833 — the registration review, guard verdict computed live (DNS). Writes nothing. */
  async preview(tenantId: string, actor: WebhooksActor, dto: PreviewWebhookDto) {
    this.assert(actor);
    const guard = (dto.url ?? '').trim() ? await vetWebhookTarget(dto.url!.trim(), this.resolve) : null;
    return reviewRegistration(dto, guard);
  }

  /** W2834 — register. Returns the secret ONCE (never stored in clear, never in the idempotency record). */
  async register(tenantId: string, actor: WebhooksActor, key: string, dto: CreateWebhookDto) {
    this.assert(actor);
    let shown: { secret: string } | null = null;
    const stored = await this.idem.remember(key, actor.userId, 'webhooks.register', async () => {
      const url = dto.url.trim();
      const guard = await vetWebhookTarget(url, this.resolve);
      const review = reviewRegistration(dto, guard);
      if (!review.ready) throw new WebhookRefusedError(review.refusals);
      const id = uuidv7();
      const secret = generateSecret();
      const hint = secretHint(secret);
      const events = review.events.map((e) => e.name);
      await this.uow.run(tenantId, async (tx) => {
        await this.repo.insertEndpoint(tx, { id, tenantId, url, secretEnc: sealEnvelope(this.kek, secret, aad(id)), secretHint: hint, eventTypes: events, developerEmail: review.developerEmail, userId: actor.userId });
        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action: 'webhook.registered', entityType: 'webhook_endpoint', entityId: id, oldValue: null,
          newValue: { url, eventTypes: events, developerEmail: review.developerEmail, status: 'active', secretHint: hint, guard: { verdict: 'public', addresses: review.url.addresses } },
          reason: null, ip: actor.ip, requestId: actor.requestId,
        });
      }, { userId: actor.userId });
      shown = { secret };
      this.metrics.inc('tenant_webhooks.registered', { tenant: tenantId });
      return { id, url, eventTypes: events, status: 'active' as const, secretHint: hint, developerEmail: review.developerEmail };
    });
    const once = shown as { secret: string } | null;
    return once ? { ...stored, secret: once.secret, secretShown: true as const } : { ...stored, secret: null, secretShown: false as const };
  }

  /** Change the event subscriptions (audited before → after, reason). */
  async updateEvents(tenantId: string, actor: WebhooksActor, id: string, key: string, dto: UpdateWebhookDto) {
    this.assert(actor);
    return this.idem.remember(key, actor.userId, 'webhooks.update', () => this.uow.run(tenantId, async (tx) => {
      const e = await this.repo.getForUpdate(tx, tenantId, id);
      if (!e || e.deleted) throw new WebhookNotFoundError(id);
      const review = reviewRegistration({ url: e.url, eventTypes: dto.eventTypes, developerEmail: e.developerEmail ?? '' }, null);
      const refusals = review.refusals.filter((r) => r.field === 'eventTypes');
      const rr = reasonRefusal(dto.reason);
      if (rr) refusals.push({ field: 'reason', code: rr });
      if (refusals.length) throw new WebhookRefusedError(refusals);
      const events = review.events.map((x) => x.name);
      await this.repo.updateEvents(tx, tenantId, id, events, actor.userId);
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: 'webhook.events_changed', entityType: 'webhook_endpoint', entityId: id,
        oldValue: { eventTypes: e.eventTypes }, newValue: { eventTypes: events }, reason: dto.reason!.trim(), ip: actor.ip, requestId: actor.requestId,
      });
      return { id, eventTypes: events };
    }, { userId: actor.userId }));
  }

  /** The confirm step's verdict (read-only): what the act would do, refused by name if it cannot. */
  async previewAct(tenantId: string, actor: WebhooksActor, id: string, act: EndpointAct, reason: string | undefined) {
    this.assert(actor);
    const e = await this.repo.getEndpoint(tenantId, id);
    if (!e) throw new WebhookNotFoundError(id);
    const counts = await this.repo.endpointStateCounts(tenantId, id);
    const guard = act === 'resume' && e.status === 'disabled' ? await vetWebhookTarget(e.url, this.resolve) : null;
    const v = endpointActVerdict(act, { status: e.status, deleted: false, prevExpiresAt: e.prevExpiresAt }, counts, reason, new Date(), guard, reason !== undefined);
    return { endpoint: new WebhookEndpoint(e).serialize(), act, ...v };
  }

  /** pause | resume | delete | replay-failed. */
  async act(tenantId: string, actor: WebhooksActor, id: string, act: Exclude<EndpointAct, 'rotate'>, key: string, reason: string | undefined) {
    this.assert(actor);
    return this.idem.remember(key, actor.userId, `webhooks.${act}`, async () => {
      // a disabled endpoint's resume needs the guard's answer NOW — resolved before the transaction (no DNS inside a row lock)
      const pre = await this.repo.getEndpoint(tenantId, id);
      const guard = act === 'resume' && pre?.status === 'disabled' ? await vetWebhookTarget(pre.url, this.resolve) : null;
      return this.uow.run(tenantId, async (tx) => {
        const e = await this.repo.getForUpdate(tx, tenantId, id);
        if (!e) throw new WebhookNotFoundError(id);
        const counts = await this.repo.deliveryStateCounts(tx, tenantId, id);
        const v = endpointActVerdict(act, { status: e.status, deleted: e.deleted, prevExpiresAt: e.prevExpiresAt }, counts, reason, new Date(), guard);
        if (!v.allowed) throw new WebhookRefusedError(v.refusals.map((code) => ({ field: code.startsWith('REASON_') ? 'reason' : null, code })));
        const why = reason!.trim();
        const before = { status: e.status, pausedReason: e.pausedReason, counts };
        let after: Record<string, unknown>; let moved = 0;
        if (act === 'pause') {
          await this.repo.setStatus(tx, tenantId, id, 'paused', 'manual', actor.userId);
          moved = await this.repo.holdQueued(tx, tenantId, id);
          after = { status: 'paused', pausedReason: 'manual', held: moved };
        } else if (act === 'resume') {
          await this.repo.setStatus(tx, tenantId, id, 'active', null, actor.userId);
          moved = await this.repo.requeue(tx, tenantId, id, RESUMABLE_STATES);
          after = { status: 'active', pausedReason: null, requeued: moved, ...(guard ? { guard: guard.ok ? 'public' : guard.reason } : {}) };
        } else if (act === 'delete') {
          moved = await this.repo.cancelOpen(tx, tenantId, id);
          await this.repo.softDelete(tx, tenantId, id, actor.userId, why);
          after = { deleted: true, cancelled: moved };
        } else {
          moved = await this.repo.replayFailed(tx, tenantId, id, actor.userId);
          after = { requeued: moved };
        }
        const action = act === 'replay-failed' ? 'webhook.replay_failed' : act === 'delete' ? 'webhook.deleted' : `webhook.${act}d`;
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action, entityType: 'webhook_endpoint', entityId: id, oldValue: before, newValue: after, reason: why, ip: actor.ip, requestId: actor.requestId });
        this.metrics.inc(`tenant_webhooks.${act}`, { tenant: tenantId });
        return { id, act, moved, status: act === 'pause' ? 'paused' : act === 'resume' ? 'active' : act === 'delete' ? 'deleted' : e.status };
      }, { userId: actor.userId });
    });
  }

  /** Rotate: a new secret signs at once; the previous one keeps signing for 24 h. The new secret is returned ONCE. */
  async rotate(tenantId: string, actor: WebhooksActor, id: string, key: string, reason: string | undefined) {
    this.assert(actor);
    let shown: { secret: string } | null = null;
    const stored = await this.idem.remember(key, actor.userId, 'webhooks.rotate', () => this.uow.run(tenantId, async (tx) => {
      const e = await this.repo.getForUpdate(tx, tenantId, id);
      if (!e) throw new WebhookNotFoundError(id);
      const now = new Date();
      const counts = await this.repo.deliveryStateCounts(tx, tenantId, id);
      const v = endpointActVerdict('rotate', { status: e.status, deleted: e.deleted, prevExpiresAt: e.prevExpiresAt }, counts, reason, now);
      if (!v.allowed) throw new WebhookRefusedError(v.refusals.map((code) => ({ field: code.startsWith('REASON_') ? 'reason' : null, code })));
      const secret = generateSecret();
      const hint = secretHint(secret);
      const prevExpiresAt = new Date(now.getTime() + ROTATION_OVERLAP_HOURS * 3600_000);
      await this.repo.rotate(tx, tenantId, id, { secretEnc: sealEnvelope(this.kek, secret, aad(id)), secretHint: hint, prevEnc: e.secretEnc, prevExpiresAt, userId: actor.userId });
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: 'webhook.secret_rotated', entityType: 'webhook_endpoint', entityId: id,
        oldValue: { secretHint: e.secretHint }, newValue: { secretHint: hint, previousSignsUntil: prevExpiresAt.toISOString() }, reason: reason!.trim(), ip: actor.ip, requestId: actor.requestId,
      });
      shown = { secret };
      return { id, secretHint: hint, previousSecretSignsUntil: prevExpiresAt.toISOString() };
    }, { userId: actor.userId }));
    const once = shown as { secret: string } | null;
    return once ? { ...stored, secret: once.secret, secretShown: true as const } : { ...stored, secret: null, secretShown: false as const };
  }
}
