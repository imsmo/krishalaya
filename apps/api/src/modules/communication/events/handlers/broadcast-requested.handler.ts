// modules/communication/events/handlers/broadcast-requested.handler.ts · consumes communication.broadcast_requested.
// PC-56 TENANT-8e — rewritten.
//
// Runs inside the relay's per-event transaction with the tenant context set. Claims the broadcast (`queued` only — a
// re-delivery finds it past `queued` and no-ops), RE-ASKS the two facts a queued broadcast can lose while it waits
// (the frame's templates — `broadcast_template_gaps()`; the audience role — the registry), then fans the audience out
// in keyset PAGES through the notification spine and writes ONE `tenant_broadcast_recipients` row per member with that
// member's delivery-instance key (`fanoutKeyOf`, 0176). Then `sent` with `fanned_out_at = now()` — the instant every
// log row of this fan-out carries.
//
// WHAT IT NO LONGER DOES (F-2): `b.markSent(total, total)`. The handler writes no count; the receipt reads the log.
// WHAT IT NOW REFUSES: a frame that stopped serving → `failed · no_template` (once, on the broadcast — never once per
// member); a role retired while queued → `failed · role_retired`; an audience that emptied → `failed · no_recipients`.
// AND ONE RULE OF ITS OWN: a broadcast is never forced to SMS. The routine policy (G0-4) proposes an SMS fallback when a
// promotional push fails — for a broadcast that would text every member without a push device, on an event with no
// SMS template (`no_template` per member again). W429: *"marketing … never forced to SMS"*. `allowRoutineFallback: false`.
//
// PC-56 HOTFIX-2 — THIS HANDLER COULD NEVER MOVE A BROADCAST. It runs on the relay transaction as `kv_relay`, which 0179 granted
// UPDATE on seven named columns of `tenant_broadcasts`; its state write (`updateState`) SET every lifecycle column, so the first
// write died 42501 and every broadcast stayed `queued` with its event quarantined. It now writes through `updateRelayState`
// (status / failed_at / failure_reason / fanned_out_at only — inside the grant). The fan-out stays on the relay transaction on
// purpose: the notification rows (kv_relay S/I/U; kv_app holds no UPDATE on notifications) and the recipient log commit with the
// event. No grant was widened.
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { OutboxWriter } from '../../../../core/outbox/outbox.writer';
import { AuditWriter } from '../../../../core/audit/audit.writer';
import { BROADCAST_EVENT, BroadcastRepository } from '../../repositories/broadcast.repository';
import { NotificationService } from '../../services/notification.service';
import { BROADCAST_REQUESTED, BroadcastEvents } from '../../services/broadcast.service';
import { fanoutKeyOf } from '../../domain/delivery-log';
import { BroadcastFailureReason } from '../../domain/broadcast.state';

export const BROADCAST_PAGE = 500;
/** The dedupe key of one broadcast's fan-out — and so, per member, of its delivery instance (`fanoutKeyOf`). */
export const broadcastDedupeKey = (broadcastId: string) => `broadcast:${broadcastId}`;

export class BroadcastRequestedHandler implements OutboxHandler {
  readonly eventType = BROADCAST_REQUESTED;
  constructor(
    private readonly broadcasts: BroadcastRepository,
    private readonly notifications: NotificationService,
    private readonly outbox: OutboxWriter,
    private readonly audit: AuditWriter,
  ) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const broadcastId = event.payload.broadcastId as string | undefined;
    if (!event.tenantId || !broadcastId) return;                       // malformed — fail closed
    const tenantId = event.tenantId;
    const b = await this.broadcasts.getForUpdate(tx, tenantId, broadcastId);
    if (!b || b.status !== 'queued') return;                           // already processed → idempotent no-op

    const fail = async (reason: BroadcastFailureReason, detail: Record<string, unknown> = {}) => {
      b.markFailed(reason, new Date());
      await this.broadcasts.updateRelayState(tx, b);
      await this.audit.write(tx, { tenantId, actorUserId: null, action: BroadcastEvents.Failed, entityType: 'tenant_broadcast', entityId: b.id, reason, newValue: { status: 'failed', failureReason: reason, ...detail } });
      await this.outbox.write(tx, { tenantId, aggregateType: 'tenant_broadcast', aggregateId: b.id, eventType: BroadcastEvents.Failed, payload: { v: 1, broadcastId: b.id, reason } });
    };
    const gaps = await this.broadcasts.templateGaps(tenantId, tx);
    if (gaps.length > 0) return fail('no_template', { gaps });
    const { audienceRoleCode, title, body } = b.toProps();
    if (audienceRoleCode !== null && !(await this.broadcasts.roleKnown(tenantId, audienceRoleCode, tx))) return fail('role_retired', { role: audienceRoleCode });

    b.markSending();
    await this.broadcasts.updateRelayState(tx, b);
    const dedupeKey = broadcastDedupeKey(broadcastId);
    const payload = { title, body, broadcastId };
    let after: string | null = null;
    let total = 0;
    for (;;) {
      const ids = await this.broadcasts.audiencePage(tx, tenantId, audienceRoleCode, after, BROADCAST_PAGE);
      if (ids.length === 0) break;
      await this.notifications.fanout(tx, { tenantId, eventCode: BROADCAST_EVENT, recipients: ids, payload, dedupeKey, allowRoutineFallback: false });
      await this.broadcasts.insertRecipients(tx, tenantId, broadcastId, ids.map((u) => ({ userId: u, fanoutKey: fanoutKeyOf(dedupeKey, u) })));
      total += ids.length;
      after = ids[ids.length - 1];
      if (ids.length < BROADCAST_PAGE) break;                          // last page
    }
    if (total === 0) return fail('no_recipients');
    b.markSent(new Date());
    await this.broadcasts.updateRelayState(tx, b, true);
    await this.audit.write(tx, { tenantId, actorUserId: null, action: BroadcastEvents.FannedOut, entityType: 'tenant_broadcast', entityId: b.id, newValue: { status: 'sent', recipients: total } });
    await this.outbox.write(tx, { tenantId, aggregateType: 'tenant_broadcast', aggregateId: b.id, eventType: BroadcastEvents.FannedOut, payload: { v: 1, broadcastId: b.id, recipients: total } });
  }
}
