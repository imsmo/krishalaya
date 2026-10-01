// modules/communication/services/broadcast.service.ts · THE BROADCAST PLANE (PRD §14) — PC-56 TENANT-8e.
//
// What a "broadcast" honestly is on this platform: an IN-APP ANNOUNCEMENT from the cooperative to its active members (or
// the members holding one registered role) — the `tenant.broadcast` event, which the notification spine delivers as an
// in-app item and, where the member has a device, a push. NOT WhatsApp: there is no provider (F-15); the channel column
// says `inapp` and 0179 refuses anything else while `whatsapp_provider_connected()` is false.
//
// THE FIVE FIXES (survey F-2, F-16, F-17, F-19, F-21):
//   • THE FORM CHAIN SAVES A DRAFT (W2841–W2844 *Save draft*): the API computes the review — the words, the role against
//     the registry, the channel, the schedule in the cooperative's zone — AND the honest maths beside it: the audience as
//     it stands, the frame's templates in en · hi · gu on every channel, and what 8b's quiet windows will do to each
//     member's push at the send instant (held until the window ends · switched off · no device), estimated over at most
//     5,000 members and said so when cut.
//   • THE MUTATE CHAIN SENDS OR CANCELS (W2845–W2847): the verdict is re-taken under the row lock; the frame must serve
//     (a broadcast with no template fails AT ENQUEUE — 0179's trigger underneath), the role must still be registered, the
//     audience not empty; `eligible_count` is written from the real audience query at that instant.
//   • THE KEY IS THE FORM'S (F-17): every write takes the Idempotency-Key the review / confirm page minted.
//   • THE VERB IS ITS OWN (F-19): `notification.broadcast.send` (tenant_admin). The read is either verb.
//   • `scheduled_at` IS HONOURED (F-21) — by `BroadcastScheduleCadenceJob`, REGISTERED in the module.
// Every write is audited in its transaction (actor · reason · before/after · ip · request id) with an outbox event.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { AUDIT_WRITER, AuditWriter } from '../../../core/audit/audit.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { looksLikeId } from '../../../shared/form-review';
import { Broadcast } from '../domain/broadcast.entity';
import { BroadcastAct, BroadcastStatus } from '../domain/broadcast.state';
import { BroadcastFormInput, BroadcastFormReview, reviewBroadcastDraft, toLocalWall } from '../domain/broadcast-review';
import { ActVerdict, actVerdict } from '../domain/broadcast-acts';
import { IMPACT_SAMPLE_MAX, QuietImpact, looksLikeRoleCode, normaliseRoleCode, quietImpact } from '../domain/broadcast-audience';
import { BroadcastCounts, countBroadcast } from '../domain/broadcast-counts';
import { parseWindowSetting } from '../domain/quiet-window';
import { BROADCAST_EVENT, BroadcastRepository, TenantRole } from '../repositories/broadcast.repository';
import { NotificationEventRepository } from '../repositories/notification-event.repository';
import { QuietHoursRepository } from '../repositories/quiet-hours.repository';
import { BroadcastActRefusedError, BroadcastFormRefusedError, BroadcastNotFoundError, CommForbiddenError } from '../domain/communication.errors';

export const BROADCAST_REQUESTED = 'communication.broadcast_requested';
export const BroadcastEvents = {
  Drafted: 'communication.broadcast_drafted', DraftEdited: 'communication.broadcast_draft_edited',
  Queued: 'communication.broadcast_queued', Scheduled: 'communication.broadcast_scheduled', Cancelled: 'communication.broadcast_cancelled',
  FannedOut: 'communication.broadcast_fanned_out', Failed: 'communication.broadcast_failed',
} as const;

export interface BroadcastActor { userId: string; canSend: boolean; canRead: boolean }
export interface WriteMeta { ip: string | null; requestId: string | null }

export interface BroadcastPreview {
  review: BroadcastFormReview;
  audience: { roleCode: string | null; size: number; everyone: number };
  templates: { required: string[]; gaps: string[]; sendable: boolean };
  channel: { value: 'inapp'; whatsappConnected: boolean };
  impact: QuietImpact | null;
  zone: string | null;
}
export interface BroadcastView {
  broadcast: ReturnType<Broadcast['toJSON']> & { scheduledLocal: string | null };
  counts: BroadcastCounts | null;
  zone: string | null;
}

/** The list's cursor is the last id (uuid v7 — see the repository); anything that is not an id is no cursor. */
export const decodeBroadcastCursor = (c?: string) => (c && looksLikeId(c) ? c.toLowerCase() : undefined);
const isCheckViolation = (e: unknown) => (e as { code?: string })?.code === '23514';

@Injectable()
export class BroadcastService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: BroadcastRepository,
    private readonly events: NotificationEventRepository,
    private readonly quiet: QuietHoursRepository,
  ) {}

  private assertRead(a: BroadcastActor) { if (!a.canRead) throw new CommForbiddenError('the broadcast plane needs notification.broadcast.send or notification.manage'); }

  /** The form's audience choices: the registry's active tenant roles with this cooperative's member counts, and "everyone". */
  async roles(tenantId: string, actor: BroadcastActor): Promise<{ roles: TenantRole[]; everyone: number }> {
    this.assertRead(actor);
    const [roles, everyone] = await Promise.all([this.repo.tenantRoles(tenantId), this.repo.audienceSize(tenantId, null)]);
    return { roles, everyone };
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE FORM CHAIN                                                                                              */
  /* ---------------------------------------------------------------------------------------------------------- */

  /** The review, and the honest maths beside it. Writes nothing. `id` = the draft being edited. */
  async preview(tenantId: string, actor: BroadcastActor, dto: BroadcastFormInput, id?: string): Promise<BroadcastPreview> {
    this.assertRead(actor);
    const existing = id ? await this.load(tenantId, id) : null;
    return this.previewOf(tenantId, actor, dto, existing, new Date());
  }

  private async previewOf(tenantId: string, actor: BroadcastActor, dto: BroadcastFormInput, existing: Broadcast | null, now: Date): Promise<BroadcastPreview> {
    const role = normaliseRoleCode(dto.audienceRoleCode);
    const roleKnown = role === null ? null : looksLikeRoleCode(role) ? await this.repo.roleKnown(tenantId, role) : false;
    const [size, everyone, gaps, connected, qctx, event, languages] = await Promise.all([
      roleKnown === false ? Promise.resolve(0) : this.repo.audienceSize(tenantId, role),
      this.repo.audienceSize(tenantId, null),
      this.repo.templateGaps(tenantId), this.repo.whatsappConnected(tenantId), this.quiet.tenantContext(tenantId), this.events.getByCode(BROADCAST_EVENT),
      this.repo.requiredLanguages(tenantId),
    ]);
    const e = existing?.toProps() ?? null;
    const review = reviewBroadcastDraft(dto, {
      canSend: actor.canSend, roleKnown, audienceSize: size, whatsappConnected: connected, zone: qctx.zone, now,
      existing: e ? { status: e.status, title: e.title, body: e.body, audienceRoleCode: e.audienceRoleCode, scheduledAt: e.scheduledAt, channel: e.channel } : null,
    });
    let impact: QuietImpact | null = null;
    if (event && roleKnown !== false && size > 0) {
      const members = await this.repo.impactMembers(tenantId, role, IMPACT_SAMPLE_MAX);
      impact = quietImpact({ event: event.toCatalog(), members, audience: size, tenantDefault: parseWindowSetting(qctx.defaultWindow), tenantZone: qctx.zone, at: review.stored.scheduledAt ?? now });
    }
    const required = (event?.toCatalog().defaultChannels ?? []).flatMap((ch) => languages.map((l) => `${ch}:${l}`)).sort();
    return {
      review, audience: { roleCode: role, size, everyone },
      templates: { required, gaps, sendable: gaps.length === 0 },
      channel: { value: 'inapp', whatsappConnected: connected }, impact, zone: qctx.zone,
    };
  }

  /** *Save draft* — a new draft, or an edit of a draft (`id`). Keyed; the review is re-taken inside the transaction. */
  async saveDraft(tenantId: string, actor: BroadcastActor, key: string, dto: BroadcastFormInput, meta: WriteMeta, id?: string): Promise<BroadcastView> {
    this.assertRead(actor);
    return this.idem.remember(key, actor.userId, id ? 'communication.broadcast.edit' : 'communication.broadcast.draft', () =>
      timed(this.metrics, 'communication.broadcast.draft', { tenant: tenantId }, async () => {
        const out = await this.uow.run(tenantId, async (tx) => {
          const existing = id ? await this.repo.getForUpdate(tx, tenantId, id) : null;
          if (id && !existing) throw new BroadcastNotFoundError(id);
          const p = await this.previewOf(tenantId, actor, dto, existing, new Date());
          if (!p.review.ready) throw new BroadcastFormRefusedError(p.review.refusals);
          const s = p.review.stored;
          try {
            if (existing) {
              const before = existing.toJSON();
              existing.edit({ title: s.title!, body: s.body!, audienceRoleCode: s.audienceRoleCode, scheduledAt: s.scheduledAt });
              await this.repo.updateDraft(tx, existing, actor.userId);
              await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: BroadcastEvents.DraftEdited, entityType: 'tenant_broadcast', entityId: existing.id,
                oldValue: pick(before), newValue: pick(existing.toJSON()), ip: meta.ip, requestId: meta.requestId });
              await this.emit(tx, tenantId, existing.id, BroadcastEvents.DraftEdited, { diff: (p.review.diff ?? []).map((d) => d.field) });
              return existing;
            }
            const b = Broadcast.draft({ id: uuidv7(), tenantId, createdByUserId: actor.userId, audienceRoleCode: s.audienceRoleCode, title: s.title!, body: s.body!, scheduledAt: s.scheduledAt });
            await this.repo.insert(tx, b, actor.userId);
            await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: BroadcastEvents.Drafted, entityType: 'tenant_broadcast', entityId: b.id,
              newValue: pick(b.toJSON()), ip: meta.ip, requestId: meta.requestId });
            await this.emit(tx, tenantId, b.id, BroadcastEvents.Drafted, {});
            return b;
          } catch (e) {
            if (isCheckViolation(e)) throw new BroadcastFormRefusedError([{ field: null, code: 'VALUE_REJECTED' }]);
            throw e;
          }
        }, { userId: actor.userId });
        return this.viewOf(tenantId, out);
      }));
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE MUTATE CHAIN                                                                                            */
  /* ---------------------------------------------------------------------------------------------------------- */

  /** The confirm step: the broadcast, both verdicts (the reason judged when given), and — for a draft — the send maths. */
  async acts(tenantId: string, actor: BroadcastActor, id: string, reason?: string): Promise<{ view: BroadcastView; verdicts: ActVerdict[]; preview: BroadcastPreview | null }> {
    this.assertRead(actor);
    const b = await this.load(tenantId, id);
    const facts = await this.factsFor(tenantId, actor, b);
    const verdicts = (['send', 'cancel'] as const).map((a) => actVerdict(a, facts, reason, reason === undefined));
    const p = b.toProps();
    const preview = p.status === 'draft'
      ? await this.previewOf(tenantId, actor, { title: p.title, body: p.body, audienceRoleCode: p.audienceRoleCode ?? undefined, scheduledAt: undefined }, null, new Date())
      : null;
    if (preview && p.scheduledAt && preview.impact) {
      // the impact at the SCHEDULED instant, not now (the draft's own time)
      const event = await this.events.getByCode(BROADCAST_EVENT); const qctx = await this.quiet.tenantContext(tenantId);
      if (event) preview.impact = quietImpact({ event: event.toCatalog(), members: await this.repo.impactMembers(tenantId, p.audienceRoleCode, IMPACT_SAMPLE_MAX), audience: preview.audience.size, tenantDefault: parseWindowSetting(qctx.defaultWindow), tenantZone: qctx.zone, at: p.scheduledAt });
    }
    return { view: await this.viewOf(tenantId, b), verdicts, preview };
  }

  private async factsFor(tenantId: string, actor: BroadcastActor, b: Broadcast, tx?: import('../../../core/database/unit-of-work').TxContext) {
    const p = b.toProps();
    const roleKnown = p.audienceRoleCode === null ? true : await this.repo.roleKnown(tenantId, p.audienceRoleCode, tx);
    const [gaps, size, connected] = await Promise.all([
      this.repo.templateGaps(tenantId, tx), roleKnown ? this.repo.audienceSize(tenantId, p.audienceRoleCode, tx) : Promise.resolve(0), this.repo.whatsappConnected(tenantId, tx),
    ]);
    return { status: p.status, canSend: actor.canSend, templateGaps: gaps, roleCode: p.audienceRoleCode, roleKnown, audienceSize: size, scheduledAt: p.scheduledAt, channel: p.channel, whatsappConnected: connected, now: new Date() };
  }

  async act(tenantId: string, actor: BroadcastActor, id: string, act: BroadcastAct, key: string, reasonRaw: string, meta: WriteMeta): Promise<BroadcastView> {
    this.assertRead(actor);
    const reason = (reasonRaw ?? '').trim();
    return this.idem.remember(key, actor.userId, `communication.broadcast.${act}`, () =>
      timed(this.metrics, `communication.broadcast.${act}`, { tenant: tenantId }, async () => {
        const out = await this.uow.run(tenantId, async (tx) => {
          const b = await this.repo.getForUpdate(tx, tenantId, id);
          if (!b) throw new BroadcastNotFoundError(id);
          const facts = await this.factsFor(tenantId, actor, b, tx);
          const v = actVerdict(act, facts, reason);
          if (!v.allowed) throw new BroadcastActRefusedError(act, v.refusals, v.gaps);
          const before = b.toJSON(); const now = new Date();
          if (act === 'send') b.requestSend(actor.userId, now, facts.audienceSize); else b.cancel(actor.userId, now, reason);
          try { await this.repo.updateState(tx, b, actor.userId); }
          catch (e) { if (isCheckViolation(e)) throw new BroadcastActRefusedError(act, ['REFUSED_BY_DATABASE']); throw e; }
          const action = act === 'cancel' ? BroadcastEvents.Cancelled : b.status === 'scheduled' ? BroadcastEvents.Scheduled : BroadcastEvents.Queued;
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action, entityType: 'tenant_broadcast', entityId: b.id, reason,
            oldValue: { status: before.status }, newValue: { status: b.status, eligibleCount: b.toProps().eligibleCount, scheduledAt: b.toProps().scheduledAt }, ip: meta.ip, requestId: meta.requestId });
          await this.emit(tx, tenantId, b.id, action, { status: b.status });
          // hand off to the async fan-out NOW only when queued; a scheduled broadcast is queued by the registered job.
          if (b.status === 'queued') await this.outbox.write(tx, { tenantId, aggregateType: 'tenant_broadcast', aggregateId: b.id, eventType: BROADCAST_REQUESTED, payload: { v: 1, broadcastId: b.id } });
          return b;
        }, { userId: actor.userId });
        return this.viewOf(tenantId, out);
      }));
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* READS                                                                                                       */
  /* ---------------------------------------------------------------------------------------------------------- */

  async list(tenantId: string, actor: BroadcastActor, q: { status?: BroadcastStatus; cursor?: string; limit: number }) {
    this.assertRead(actor);
    const rows = await this.repo.list(tenantId, q);
    const sent = rows.filter((b) => b.status === 'sent').map((b) => b.id);
    const [logs, byStatus, qctx] = await Promise.all([this.repo.logGroups(tenantId, sent), this.repo.statusCounts(tenantId), this.quiet.tenantContext(tenantId)]);
    const items = rows.map((b) => {
      const j = b.toJSON(); const l = logs.get(b.id);
      return { ...j, scheduledLocal: j.scheduledAt && qctx.zone ? toLocalWall(j.scheduledAt, qctx.zone) : null, counts: l ? countBroadcast(l.recipients, l.groups) : null };
    });
    const last = rows[rows.length - 1];
    return { items, nextCursor: rows.length === q.limit && last ? last.id : null, byStatus, zone: qctx.zone, canSend: actor.canSend };
  }

  /** The receipt: the broadcast and what the delivery log says it did. */
  async view(tenantId: string, actor: BroadcastActor, id: string): Promise<BroadcastView & { canSend: boolean }> {
    this.assertRead(actor);
    return { ...(await this.viewOf(tenantId, await this.load(tenantId, id))), canSend: actor.canSend };
  }

  private async viewOf(tenantId: string, b: Broadcast): Promise<BroadcastView> {
    const j = b.toJSON();
    const qctx = await this.quiet.tenantContext(tenantId);
    let counts: BroadcastCounts | null = null;
    if (b.status === 'sent') { const l = (await this.repo.logGroups(tenantId, [b.id])).get(b.id); counts = l ? countBroadcast(l.recipients, l.groups) : null; }
    return { broadcast: { ...j, scheduledLocal: j.scheduledAt && qctx.zone ? toLocalWall(j.scheduledAt, qctx.zone) : null }, counts, zone: qctx.zone };
  }

  private async load(tenantId: string, id: string): Promise<Broadcast> {
    if (!looksLikeId(id)) throw new BroadcastNotFoundError(id);
    const b = await this.repo.get(tenantId, id);
    if (!b) throw new BroadcastNotFoundError(id);
    return b;
  }

  private async emit(tx: import('../../../core/database/unit-of-work').TxContext, tenantId: string, id: string, type: string, payload: Record<string, unknown>) {
    await this.outbox.write(tx, { tenantId, aggregateType: 'tenant_broadcast', aggregateId: id, eventType: type, payload: { v: 1, broadcastId: id, ...payload } });
  }
}

/** What an audit row records of a broadcast: its words, audience, time and state — and hashes nothing (the words are short). */
function pick(j: ReturnType<Broadcast['toJSON']>) {
  return { title: j.title, body: j.body, audienceRoleCode: j.audienceRoleCode, scheduledAt: j.scheduledAt, channel: j.channel, status: j.status };
}
