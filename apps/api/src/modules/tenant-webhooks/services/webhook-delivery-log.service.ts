// modules/tenant-webhooks/services/webhook-delivery-log.service.ts · THE DELIVERY LOG (W189 + W2829–W2831) — PC-56 TENANT-13a §B.
//   • GET deliveries: tenant endpoints only (RLS admits `endpoint_kind = 'tenant'`, and every query joins this tenant's
//     webhook_endpoints — a partner delivery never surfaces, F-19), filters endpoint / status / since, µs keyset, page size ≤ 100;
//     each row names its ATTEMPTS (count of attempt rows), its last HTTP code, and its next retry with the ladder step that set it;
//   • the window's counts and the DIAGNOSIS computed from the failed attempt rows (domain/webhook-log.diagnose);
//   • GET one delivery: the payload MASKED (maskPayload — the v1 projection carries no PII; the mask is the second line) and every
//     attempt row;
//   • replay one: original payload, fresh cycle, signed afresh by the worker at send time; keyed, reasoned, audited.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { KeysetCursor, encodeKeyset } from '../../../shared/pagination/us-keyset';
import { DeliveryFilter, DeliveryRow, WebhookRepository } from '../repositories/webhook.repository';
import { diagnose, hostOf, maskPayload } from '../domain/webhook-log';
import { ladderLabel, RETENTION_DAYS } from '../domain/webhook-rail.state';
import { replayVerdict } from '../domain/webhook-rules';
import { WebhookDeliveryNotFoundError, WebhookRefusedError, WebhooksForbiddenError } from '../domain/tenant-webhooks.errors';
import { WebhooksActor, canManageApi } from './tenant-webhook.service';

function wire(d: DeliveryRow) {
  return {
    id: d.id, createdAt: d.createdAt, endpointId: d.endpointId, endpointHost: hostOf(d.endpointUrl), endpointStatus: d.endpointStatus,
    eventType: d.eventType, eventRef: d.eventRef, payloadVersion: d.payloadVersion, state: d.state, attempts: d.attempts,
    statusCode: d.statusCode, lastError: d.lastError, lastAttemptAt: d.lastAttemptAt, deliveredAt: d.deliveredAt, replayCount: d.replayCount,
    nextRetryAt: d.nextRetryAt,
    // the ladder step whose delay set next_retry_at ("15:22 (30m backoff)"); a pending first attempt has no step
    nextRetryStep: d.state === 'retrying' ? ladderLabel(d.retryStep) : null,
  };
}

@Injectable()
export class WebhookDeliveryLogService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly audit: AuditWriter,
    private readonly repo: WebhookRepository,
  ) {}

  private assert(a: WebhooksActor) { if (!canManageApi(a)) throw new WebhooksForbiddenError('Payload viewing needs api.manage — payloads can contain member data'); }

  async list(tenantId: string, actor: WebhooksActor, q: { filter: DeliveryFilter; cursor?: KeysetCursor; limit: number }) {
    this.assert(actor);
    const [rows, counts, groups] = await Promise.all([
      this.repo.listDeliveries(tenantId, q.filter, q.cursor, q.limit),
      this.repo.deliveryCounts(tenantId, q.filter),
      this.repo.failureGroups(tenantId, { endpointId: q.filter.endpointId, since: q.filter.since }),
    ]);
    const last = rows[rows.length - 1];
    const d = diagnose(groups.map((g) => ({ ...g, endpointHost: hostOf(g.endpointHost) })));
    return {
      items: rows.map(wire),
      nextCursor: rows.length === q.limit && last ? encodeKeyset(last.createdUs, last.id) : null,
      total: counts.total, failed: counts.failed, diagnosis: d, retentionDays: RETENTION_DAYS,
    };
  }

  async get(tenantId: string, actor: WebhooksActor, id: string) {
    this.assert(actor);
    const d = await this.repo.getDelivery(tenantId, id);
    if (!d) throw new WebhookDeliveryNotFoundError(id);
    return { ...wire(d), payload: maskPayload(d.payload), masked: true as const, attemptsList: d.attemptsList };
  }

  async previewReplay(tenantId: string, actor: WebhooksActor, id: string, reason: string | undefined) {
    this.assert(actor);
    const d = await this.repo.getDelivery(tenantId, id);
    if (!d) throw new WebhookDeliveryNotFoundError(id);
    const v = replayVerdict({ state: d.state, endpointStatus: d.endpointStatus, endpointDeleted: false }, reason, reason !== undefined);
    return { delivery: wire(d), ...v };
  }

  async replay(tenantId: string, actor: WebhooksActor, id: string, key: string, reason: string | undefined) {
    this.assert(actor);
    return this.idem.remember(key, actor.userId, 'webhooks.delivery_replay', () => this.uow.run(tenantId, async (tx) => {
      const d = await this.repo.getDeliveryForUpdate(tx, tenantId, id);
      if (!d) throw new WebhookDeliveryNotFoundError(id);
      const v = replayVerdict(d, reason);
      if (!v.allowed) throw new WebhookRefusedError(v.refusals.map((code) => ({ field: code.startsWith('REASON_') ? 'reason' : null, code })));
      const n = await this.repo.replayOne(tx, tenantId, id, d.createdRaw, actor.userId);
      if (n !== 1) throw new Error(`webhook replay: expected to re-queue exactly 1 delivery (${id}), matched ${n}`);
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: 'webhook.delivery_replayed', entityType: 'webhook_delivery', entityId: id,
        oldValue: { state: d.state }, newValue: { state: 'pending', endpointId: d.endpointId, eventType: d.eventType }, reason: reason!.trim(), ip: actor.ip, requestId: actor.requestId,
      });
      return { id, state: 'pending' as const };
    }, { userId: actor.userId }));
  }
}
