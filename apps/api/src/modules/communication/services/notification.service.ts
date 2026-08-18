// modules/communication/services/notification.service.ts · the NOTIFICATION SPINE.
// fanout() is invoked by the all-domain-events handler INSIDE the relay's per-event tx. For each recipient it
//   1. resolves the catalog event (global) → its default channels + opt-out rule + priority;
//   2. applies the user's preferences + quiet hours (channel-resolution policy) — critical events bypass quiet
//      hours, mandatory events ignore opt-outs (fail-closed: an unknown event is skipped, never spammed);
//   3. resolves the effective template (tenant override → platform default; requested language → 'en'/'hi'),
//      renders it, and DISPATCHES via the external notifier gateway (resilience-wrapped; 'inapp' needs no send);
//   4. records ONE delivery-log row per channel in its final state (sent/failed/suppressed) + outbox events.
// Idempotent on re-delivery: the notification id is DERIVED deterministically from (dedupeKey, recipient,
// channel), so the gateway (which dedups on that id) never double-sends after a relay retry.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { NOTIFICATION_GATEWAY, NotificationGateway, NotifyChannel } from '../gateway/notification-gateway.port';
import { PUSH_SENDER, PushSender } from '../gateway/push-sender.port';
import { PushDeviceRepository } from '../repositories/push-device.repository';
import { Notification } from '../domain/notification.entity';
import { DomainEvent, NotifChannel } from '../domain/communication.events';
import { resolveChannels, applyRoutinePolicy } from '../domain/channel-resolution';
import { NotifStatus } from '../domain/notification.state';
import { NotificationEventRepository } from '../repositories/notification-event.repository';
import { NotificationTemplateRepository } from '../repositories/notification-template.repository';
import { NotificationPreferenceRepository } from '../repositories/notification-preference.repository';
import { QuietHoursRepository } from '../repositories/quiet-hours.repository';
import { NotificationRepository } from '../repositories/notification.repository';
import { NotificationNotFoundError, CommForbiddenError } from '../domain/communication.errors';

export interface FanoutInput { tenantId: string | null; eventCode: string; recipients: string[]; payload: Record<string, unknown>; dedupeKey: string; languageCode?: string; }
const FALLBACK_LANGS = ['en', 'hi'];

/** Q24/DELTA-059 (decided G0-4 2026-07-22, see channel-resolution.ts's own header for the full ruling + tier
 *  mapping). Law 8: OFF by default — the founder flips this per Design_Program/12_G0-2_DECISION_REGISTER.md's own
 *  standing "feature-flagged by default" rule. Flip OFF at any time is the kill-switch back to the pre-existing
 *  multi-channel-for-everything behavior (zero code branch needed — same flag, same rows, same tests). */
export const ROUTINE_FANOUT_FLAG = 'notification_routine_single_channel';

/** Deterministic notification id (stable across relay retries → gateway dedups). */
function deriveId(dedupeKey: string, userId: string, channel: string): string {
  const h = createHash('sha256').update(`${dedupeKey}|${userId}|${channel}`).digest('hex');
  // RFC-4122-shaped (version 8, variant 8) so it's a valid uuid column value.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

@Injectable()
export class NotificationService {
  private readonly log = new Logger('NotificationService');
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(NOTIFICATION_GATEWAY) private readonly gateway: NotificationGateway,
    @Inject(PUSH_SENDER) private readonly pushSender: PushSender,
    private readonly devices: PushDeviceRepository,
    private readonly events: NotificationEventRepository,
    private readonly templates: NotificationTemplateRepository,
    private readonly prefs: NotificationPreferenceRepository,
    private readonly quiet: QuietHoursRepository,
    private readonly notifications: NotificationRepository,
    private readonly flags: FlagsService,
  ) {}

  /** Fan a single domain event out to its recipients' channels. Runs inside the relay tx (tenant context set). */
  async fanout(tx: TxContext, input: FanoutInput): Promise<void> {
    const event = await this.events.getByCode(input.eventCode, tx);
    if (!event) { this.metrics.inc('comm.fanout.unknown_event', { event: input.eventCode }); return; }   // fail-closed: never spam an uncatalogued event
    const lang = input.languageCode ?? FALLBACK_LANGS[0];
    const recipients = [...new Set(input.recipients.filter(Boolean))];
    // Q24/DELTA-059: per-recipient flag check (rollout can stage by tenant/user — Law 8), read once per fanout
    // call (not per-recipient-and-channel) since the flag targets tenant/event scope, not a per-channel choice.
    const routineFlagOn = await this.flags.isEnabled(ROUTINE_FANOUT_FLAG, { tenantId: input.tenantId ?? undefined });
    for (const userId of recipients) {
      const prefRows = await this.prefs.listForUser(userId, event.code, tx);
      const prefMap = new Map<NotifChannel, boolean>(prefRows.map((p) => [p.channel, p.isEnabled]));
      const quiet = await this.quiet.getForUser(userId, tx);
      const decision = resolveChannels(event.toCatalog(), prefMap, quiet, new Date());
      for (const { channel } of decision.suppressed) this.metrics.inc('comm.suppressed', { event: event.code, channel });

      // Flag OFF (default) → old behavior, unchanged: every resolved channel is dispatched (multi-channel).
      // Flag ON → routine tiers (informational/promotional) collapse to ONE primary + passive channels
      // (inapp); critical/important pass through unaffected (applyRoutinePolicy() is a no-op for them).
      const policy = routineFlagOn
        ? applyRoutinePolicy(event.priority, decision.channels, prefMap)
        : { toSendNow: decision.channels, primary: null, fallback: null };
      this.metrics.inc('comm.routine_policy', { event: event.code, applied: String(routineFlagOn && policy.primary !== null) });

      let primaryStatus: NotifStatus | null = null;
      for (const channel of policy.toSendNow) {
        const status = await this.deliver(tx, { tenantId: input.tenantId, userId, event: event.code, channel, lang, payload: input.payload, dedupeKey: input.dedupeKey });
        if (channel === policy.primary) primaryStatus = status;
      }
      // SMS fallback: only when the routine policy proposed one AND the primary genuinely failed to deliver
      // (never on a mere suppression — there was nothing to "fall back" from). Idempotent: the fallback
      // notification id is derived the SAME way as any other channel — deterministic per (dedupeKey, userId,
      // 'sms') — so a relay retry of this exact fanout re-derives the identical id (gateway-level dedup, same
      // guarantee the module already documents for every other channel; see deriveId() below).
      if (policy.fallback && primaryStatus === 'failed') {
        this.metrics.inc('comm.routine_fallback_sms', { event: event.code });
        await this.deliver(tx, { tenantId: input.tenantId, userId, event: event.code, channel: policy.fallback, lang, payload: input.payload, dedupeKey: input.dedupeKey });
      }
    }
  }

  private async deliver(tx: TxContext, a: { tenantId: string | null; userId: string; event: string; channel: NotifChannel; lang: string; payload: Record<string, unknown>; dedupeKey: string }): Promise<NotifStatus> {
    const id = deriveId(a.dedupeKey, a.userId, a.channel);
    // template resolution: requested language, then platform fallbacks
    let template = await this.templates.resolve(a.tenantId, a.event, a.channel, a.lang, tx);
    for (const fb of FALLBACK_LANGS) { if (template) break; template = await this.templates.resolve(a.tenantId, a.event, a.channel, fb, tx); }
    const rendered = template ? template.render(a.payload) : { subject: null, body: '' };
    const n = Notification.queue({ id, tenantId: a.tenantId, userId: a.userId, eventCode: a.event, channel: a.channel,
      templateId: template?.id ?? null,
      // **THE VERSION, NOT ONLY THE TEMPLATE (0122).** `template_id` points at a row whose body used to be replaced in
      // place, so the log recorded WHICH template was used and could not say WHAT WAS SENT — and `payload` holds the
      // variables, not the rendered text. The version is immutable, so this is the column that answers a farmer's "the
      // OTP message never arrived" and a regulator's "what wording went out under this DLT header".
      templateVersionId: template?.versionId ?? null,
      languageCode: template?.languageCode ?? a.lang, payload: a.payload });

    if (a.channel === 'inapp') {
      n.markSent(null, null);   // the inbox row IS the in-app item; nothing to send externally
    } else if (!template) {
      n.markFailed('no_template');   // can't send an empty external message — record + skip (fail-closed)
      this.metrics.inc('comm.no_template', { event: a.event, channel: a.channel });
    } else if (!(await this.notifications.contactableOn(tx, a.userId, a.channel))) {
      // PC-56 TENANT-4d-5 · the recipient has no address on this channel. Recorded, never dispatched: the
      // gateway resolves contact details from a bare user id and would have returned 'accepted' for a request
      // it could not deliver, writing `sent` into the log. See `contactableOn` for the full argument.
      n.markFailed('no_address');
      this.metrics.inc('comm.no_address', { event: a.event, channel: a.channel });
    } else if (a.channel === 'push') {
      // FIRST-PARTY push (P0-10): resolve the recipient's own registered device tokens (push_devices) and
      // send via the resilient PUSH_SENDER. Dead tokens (DeviceNotRegistered) are deactivated in-tx (hygiene).
      await this.deliverPush(tx, a, n, { subject: rendered.subject, body: rendered.body });
    } else {
      const res = await this.gateway.dispatch({ idempotencyKey: id, tenantId: a.tenantId, userId: a.userId, channel: a.channel as NotifyChannel,
        eventCode: a.event, languageCode: n.toProps().languageCode ?? a.lang, subject: rendered.subject, body: rendered.body, providerTemplateRef: template.providerTemplateRef, payload: a.payload });
      if (res.status === 'accepted') n.markSent(res.providerMsgRef ?? null, res.costMinor ?? null);
      else n.markFailed(res.failureReason ?? 'dispatch_failed');
    }
    await this.notifications.insert(tx, n);
    await this.flush(tx, a.tenantId, n.id, n.pullEvents());
    this.metrics.inc('comm.delivered', { event: a.event, channel: a.channel, status: n.status });
    return n.status;
  }

  /** Send a rendered notification to the recipient's registered push devices (P0-10). The token is the
   *  recipient's OWN (push_devices is user-scoped). No device on file → 'no_device' (recorded, not an error).
   *  The send is resilience-wrapped (degrade, never die); tokens the provider rejects as permanently dead are
   *  deactivated in the SAME tx so we stop targeting them. The deep-link payload rides in `data`. */
  private async deliverPush(tx: TxContext, a: { tenantId: string | null; userId: string; event: string; payload: Record<string, unknown> }, n: Notification, rendered: { subject: string | null; body: string }): Promise<void> {
    const tokens = await this.devices.activeTokensForUser(a.userId);
    if (tokens.length === 0) { n.markFailed('no_device'); this.metrics.inc('comm.push.no_device', { event: a.event }); return; }
    const res = await this.pushSender.send({
      idempotencyKey: n.id, tokens: tokens.map((t) => t.token),
      title: rendered.subject, body: rendered.body, data: { ...a.payload, eventCode: a.event },
    });
    for (const dead of res.invalidTokens) { await this.devices.deactivate(tx, a.userId, dead); this.metrics.inc('comm.push.token_pruned', {}); }
    if (res.sent > 0) n.markSent(null, null);
    else n.markFailed(res.failureReason ?? 'push_failed');
  }

  // ---- the recipient's own inbox (controller-facing) -------------------------------------------------
  async listInbox(tenantId: string, userId: string, q: { status?: string; unreadOnly?: boolean; cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.notifications.listForUser(userId, tenantId, q);
    const items = rows.map((n) => n.toJSON());
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
  async markRead(tenantId: string, userId: string, id: string) {
    return this.uow.run(tenantId, async (tx) => {
      const n = await this.notifications.getForUserUpdate(tx, userId, id);
      if (!n) throw new NotificationNotFoundError(id);   // 404 for a non-owner (no cross-user IDOR)
      n.markRead();
      await this.notifications.update(tx, n);
      await this.flush(tx, tenantId, n.id, n.pullEvents());
      return n.toJSON();
    }, { userId });
  }

  /** Delivery-status webhook from the external notifier (provider_msg_ref → delivered). Idempotent. */
  async applyDeliveryStatus(tenantId: string | null, providerMsgRef: string, status: 'delivered' | 'failed'): Promise<boolean> {
    return this.uow.run(tenantId ?? '', async (tx) => {
      const n = await this.notifications.getByProviderRef(tx, providerMsgRef);
      if (!n) return false;
      if (status === 'delivered' && n.status === 'sent') { n.markDelivered(); await this.notifications.update(tx, n); }
      return true;
    });
  }

  private async flush(tx: TxContext, tenantId: string | null, id: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'notification', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
export { CommForbiddenError };
