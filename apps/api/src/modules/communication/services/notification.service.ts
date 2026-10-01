// modules/communication/services/notification.service.ts · the NOTIFICATION SPINE.
// fanout() is invoked by the all-domain-events handler INSIDE the relay's per-event tx. For each recipient it
//   1. resolves the catalog event (global) → its default channels + opt-out rule + priority;
//   2. applies the user's preferences + quiet hours (channel-resolution policy) — critical events bypass quiet
//      hours, mandatory events ignore opt-outs (fail-closed: an unknown event is skipped, never spammed);
//   3. resolves the effective template (tenant override → platform default; the reader's language → the emitter's →
//      THIS TENANT's languages in its order → 'en' — `fallbackChain`, PC-56 TENANT-8a / F-22),
//      renders it, and DISPATCHES via the external notifier gateway (resilience-wrapped; 'inapp' needs no send);
//   4. records ONE delivery-log row per channel in its final state (sent/failed/suppressed) + outbox events.
//      [PC-56 TENANT-8b] "suppressed" is WRITTEN now (F-4): every channel the event is sent on gets a row — the ones
//      not sent carry `suppressed_reason` (opted_out · quiet_hours · routine_collapsed), and a quiet-hours suppression
//      is a HOLD (`held_until` = the end of the member's window) that `releaseHeld` sends when the window opens.
//      The window is the member's own, else the COOPERATIVE's default in the cooperative's zone (F-5), and a zone the
//      process cannot use is sanitised to the cooperative's, logged, and never thrown (F-6). Every row of one send
//      shares `fanout_key` (W434's delivery instance).
// Idempotent on re-delivery: the notification id is DERIVED deterministically from (dedupeKey, recipient,
// channel), so the gateway (which dedups on that id) never double-sends after a relay retry.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
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
import { NotificationTemplate } from '../domain/notification-template.entity';
import { NotificationPreferenceRepository } from '../repositories/notification-preference.repository';
import { QuietHoursRepository } from '../repositories/quiet-hours.repository';
import { DeliveryReport, NotificationRepository, RecipientProfile, addressableOn } from '../repositories/notification.repository';
import { CommForbiddenError } from '../domain/communication.errors';
import { fallbackChain, LAST_RESORT_LANGUAGE } from '../domain/fallback-languages';
import { EffectiveWindow, effectiveWindow, parseWindowSetting, isWithinWindow, windowEndAfter } from '../domain/quiet-window';
import { fallbackAction, fanoutKeyOf, releaseDecision, suppressionRows, SuppressedReason } from '../domain/delivery-log';

/** The fan-out's clock. Injectable so a live suite can pin "now" to a known side of a quiet window — the default window
 *  is real (F-5), so a suite asserting a 22:00 push was SENT would otherwise depend on the hour it ran. */
export const NOTIFICATION_CLOCK = Symbol('NOTIFICATION_CLOCK');
/** 0176's kill-switch (0121 tier: ON = stop). OFF by default — the release runs. */
export const HELD_RELEASE_KILL_SWITCH = 'notification.held_release_kill_switch';
export type ReleaseOutcome = 'sent' | 'failed' | 'reheld' | 'opted_out';

interface DeliverCtx {
  tenantId: string | null; userId: string; event: string; channel: NotifChannel; lang: string; payload: Record<string, unknown>; dedupeKey: string;
  profile: RecipientProfile | null; templateCache: Map<string, NotificationTemplate | null>; inputLang?: string; tenantLangs?: readonly string[]; fanoutKey: string;
}
export interface FanoutInput { tenantId: string | null; eventCode: string; recipients: string[]; payload: Record<string, unknown>; dedupeKey: string; languageCode?: string; }

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
    @Optional() @Inject(NOTIFICATION_CLOCK) private readonly clock?: () => Date,
  ) {}
  private now(): Date { return this.clock ? this.clock() : new Date(); }

  /** Fan a single domain event out to its recipients' channels. Runs inside the relay tx (tenant context set). */
  async fanout(tx: TxContext, input: FanoutInput): Promise<void> {
    const event = await this.events.getByCode(input.eventCode, tx);
    if (!event) { this.metrics.inc('comm.fanout.unknown_event', { event: input.eventCode }); return; }   // fail-closed: never spam an uncatalogued event
    const recipients = [...new Set(input.recipients.filter(Boolean))];
    if (recipients.length === 0) return;
    // --------------------------------------------------------------------------------------------------------
    // [PC-56 TENANT-6d-7] **THE LANGUAGE WAS NEVER READ, AND EVERY VERNACULAR PROMISE IN THE CANON WAS ENGLISH.**
    //
    // This line used to be `const lang = input.languageCode ?? FALLBACK_LANGS[0]` — ONE language for the whole
    // fan-out, defaulting to `'en'` — and NO domain event in this repository has ever put `languageCode` in its
    // payload (grep-confirmed across every emitter). `users.language_code` has been NOT NULL with a default since
    // migration 0003 and nothing in the send path had ever read it. So:
    //
    //   • W168's *"member notified in Gujarati"* (TENANT-6b-1) sent English.
    //   • W169's *"Preview goes to every member in Gujarati BEFORE money moves"* (TENANT-6c-2) sent English.
    //   • W063's *"celebratory Gujarati message"* (ADMIN-6b) sent English.
    //   • W156's *"the invite SMS says who added them and why, in their language"* (TENANT-1b-4) sent English.
    //
    // The Gujarati and Hindi rows were seeded, versioned, DLT-noted and never selected. Four waves each did their
    // half correctly and the half nobody owned was the join between a person and their own language.
    //
    // THE RECIPIENT'S OWN LANGUAGE WINS over `input.languageCode`, and that ordering is the point: an emitter fanning
    // out to 87 families cannot know 87 languages, and the only per-person truth on this platform is the column the
    // person's own onboarding wrote. `input.languageCode` survives as the fallback for a recipient with no live user
    // row and for callers that genuinely do speak for one reader.
    // --------------------------------------------------------------------------------------------------------
    const profiles = await this.notifications.profilesFor(tx, recipients);
    const prefsByUser = await this.prefs.mapForUsers(recipients, event.code, tx);
    const quietByUser = await this.quiet.mapForUsers(recipients, tx);
    // [PC-56 TENANT-8b · F-5] What a member with no window inherits: the cooperative's default, in its zone. Read once.
    const quietCtx = await this.quiet.tenantContext(input.tenantId, tx);
    const tenantDefault = parseWindowSetting(quietCtx.defaultWindow);
    const now = this.now();
    // Template resolution is per (language, channel), NOT per (recipient, channel): a village on one language asks
    // once instead of 87 times, and a village on three asks three times.
    const templateCache = new Map<string, NotificationTemplate | null>();
    // [PC-56 TENANT-8a · F-22] The fallback rungs were `['en', 'hi']` for every tenant — a Gujarati cooperative's member
    // fell back to Hindi before Gujarati. They are THIS tenant's own languages now (read once per fan-out), then English.
    const tenantLangs = await this.templates.tenantLanguageOrder(input.tenantId, tx);
    // Q24/DELTA-059: per-recipient flag check (rollout can stage by tenant/user — Law 8), read once per fanout
    // call (not per-recipient-and-channel) since the flag targets tenant/event scope, not a per-channel choice.
    const routineFlagOn = await this.flags.isEnabled(ROUTINE_FANOUT_FLAG, { tenantId: input.tenantId ?? undefined });
    for (const userId of recipients) {
      const profile = profiles.get(userId) ?? null;
      const lang = profile?.languageCode ?? input.languageCode ?? LAST_RESORT_LANGUAGE;
      const prefMap = prefsByUser.get(userId) ?? new Map<NotifChannel, boolean>();
      // F-6: `effectiveWindow` SANITISES the zone — a member's `Asia/Kolkatta` degrades to the cooperative's zone and is
      // reported here, instead of throwing a RangeError that rolled back the whole village's notice.
      const window = effectiveWindow(quietByUser.get(userId) ?? null, tenantDefault, quietCtx.zone);
      if (window?.sanitised) {
        this.metrics.inc('comm.quiet_hours.timezone_sanitised', { event: event.code });
        this.log.warn(`quiet hours: user ${userId} names zone "${window.requestedZone}", which this process cannot use; read in ${window.timezone} instead (the fan-out continues)`);
      }
      const decision = resolveChannels(event.toCatalog(), prefMap, window, now);
      const fanoutKey = fanoutKeyOf(input.dedupeKey, userId);
      const ctx = { tenantId: input.tenantId, userId, event: event.code, lang, payload: input.payload, dedupeKey: input.dedupeKey, profile, templateCache, inputLang: input.languageCode, tenantLangs, fanoutKey };

      // Flag OFF (default) → old behavior, unchanged: every resolved channel is dispatched (multi-channel).
      // Flag ON → routine tiers (informational/promotional) collapse to ONE primary + passive channels
      // (inapp); critical/important pass through unaffected (applyRoutinePolicy() is a no-op for them).
      const policy = routineFlagOn
        ? applyRoutinePolicy(event.priority, decision.channels, prefMap)
        : { toSendNow: decision.channels, primary: null, fallback: null };
      this.metrics.inc('comm.routine_policy', { event: event.code, applied: String(routineFlagOn && policy.primary !== null) });

      let primaryStatus: NotifStatus | null = null;
      for (const channel of policy.toSendNow) {
        const status = await this.deliver(tx, { ...ctx, channel });
        if (channel === policy.primary) primaryStatus = status;
      }
      // SMS fallback: only when the routine policy proposed one AND the primary genuinely failed to deliver
      // (never on a mere suppression — there was nothing to "fall back" from). Idempotent: the fallback
      // notification id is derived the SAME way as any other channel — deterministic per (dedupeKey, userId,
      // 'sms') — so a relay retry of this exact fanout re-derives the identical id (gateway-level dedup, same
      // guarantee the module already documents for every other channel; see deriveId() below).
      // [PC-56 TENANT-8b] …and the fallback respects quiet hours and opt-outs like any other SMS: it is HELD at night,
      // skipped when the member's SMS row already exists (held or opted out), never a second row for one channel.
      let fallbackUsed: NotifChannel | null = null;
      if (policy.fallback && primaryStatus === 'failed') {
        const action = fallbackAction({ fallback: policy.fallback, resolved: decision, priority: event.priority, inQuiet: window ? isWithinWindow(now, window) : false });
        if (action === 'send') {
          this.metrics.inc('comm.routine_fallback_sms', { event: event.code });
          await this.deliver(tx, { ...ctx, channel: policy.fallback });
          fallbackUsed = policy.fallback;
        } else if (action === 'hold') {
          await this.recordSuppressed(tx, { ...ctx, channel: policy.fallback }, 'quiet_hours', (window ? windowEndAfter(now, window) : null) ?? now);
          fallbackUsed = policy.fallback;
        }
      }
      // F-4 · EVERY CHANNEL NOT SENT IS A ROW, WITH ITS REASON. Before this wave this was `metrics.inc` and nothing else.
      for (const sup of suppressionRows({ resolved: decision, sentNow: policy.toSendNow, fallbackUsed, window, now })) {
        await this.recordSuppressed(tx, { ...ctx, channel: sup.channel }, sup.reason, sup.heldUntil);
      }
    }
  }

  /** F-4 · write the channel the fan-out did NOT send, with its reason (and, for quiet hours, when it will be). */
  private async recordSuppressed(tx: TxContext, a: { tenantId: string | null; userId: string; event: string; channel: NotifChannel; lang: string; payload: Record<string, unknown>; dedupeKey: string; fanoutKey: string },
    reason: SuppressedReason, heldUntil: Date | null): Promise<void> {
    const n = Notification.queue({ id: deriveId(a.dedupeKey, a.userId, a.channel), tenantId: a.tenantId, userId: a.userId, eventCode: a.event, channel: a.channel,
      templateId: null, templateVersionId: null, languageCode: a.lang, payload: a.payload, fanoutKey: a.fanoutKey });
    n.markSuppressed(reason, heldUntil);
    await this.notifications.insert(tx, n);
    await this.flush(tx, a.tenantId, n.id, n.pullEvents());
    this.metrics.inc('comm.suppressed', { event: a.event, channel: a.channel, reason });
  }

  private async deliver(tx: TxContext, a: DeliverCtx): Promise<NotifStatus> {
    const template = await this.resolveTemplate(tx, a);
    const n = Notification.queue({ id: deriveId(a.dedupeKey, a.userId, a.channel), tenantId: a.tenantId, userId: a.userId, eventCode: a.event, channel: a.channel,
      templateId: template?.id ?? null,
      // **THE VERSION, NOT ONLY THE TEMPLATE (0122).** `template_id` points at a row whose body used to be replaced in
      // place, so the log recorded WHICH template was used and could not say WHAT WAS SENT — and `payload` holds the
      // variables, not the rendered text. The version is immutable, so this is the column that answers a farmer's "the
      // OTP message never arrived" and a regulator's "what wording went out under this DLT header".
      templateVersionId: template?.versionId ?? null,
      languageCode: template?.languageCode ?? a.lang, payload: a.payload, fanoutKey: a.fanoutKey });
    await this.dispatchInto(tx, n, a, template);
    await this.notifications.insert(tx, n);
    await this.flush(tx, a.tenantId, n.id, n.pullEvents());
    this.metrics.inc('comm.delivered', { event: a.event, channel: a.channel, status: n.status });
    return n.status;
  }

  // TEMPLATE RESOLUTION: the RECIPIENT'S OWN language first, then the emitter's if it named one, then this tenant's
  // own languages in its order, then English (`fallbackChain`). Cached per (language, channel) for the whole fan-out — the words for a language do not differ by
  // reader, and 87 identical lookups on one connection was most of what a village notice cost.
  private async resolveTemplate(tx: TxContext, a: Pick<DeliverCtx, 'tenantId' | 'event' | 'channel' | 'lang' | 'inputLang' | 'tenantLangs' | 'templateCache'>): Promise<NotificationTemplate | null> {
    const chain = fallbackChain(a.lang, a.inputLang, a.tenantLangs ?? []);
    let template: NotificationTemplate | null = null;
    for (const l of chain) {
      const key = `${l}|${a.channel}`;
      if (!a.templateCache.has(key)) a.templateCache.set(key, await this.templates.resolve(a.tenantId, a.event, a.channel, l, tx));
      template = a.templateCache.get(key) ?? null;
      if (template) break;
    }
    // A REACHED READER IN THE WRONG LANGUAGE IS STILL A DEFECT, and it is now countable: the recipient asked for `gu`
    // and the copy that existed was `en`. Nothing is suppressed for it — a notice a farmer can half-read beats
    // silence — but a cooperative's missing Gujarati row stops being invisible.
    if (template && template.languageCode !== a.lang) {
      this.metrics.inc('comm.language_fallback', { event: a.event, channel: a.channel, wanted: a.lang, used: template.languageCode });
    }
    return template;
  }

  /** Send a queued row on its channel (or record why not). Shared by the fan-out and the release of a held row, so a
   *  morning release obeys exactly the rules a daytime send does (template, address, device, notifier). */
  private async dispatchInto(tx: TxContext, n: Notification, a: Pick<DeliverCtx, 'tenantId' | 'userId' | 'event' | 'channel' | 'lang' | 'payload' | 'profile'>, template: NotificationTemplate | null): Promise<void> {
    const rendered = template ? template.render(a.payload) : { subject: null, body: '' };
    if (a.channel === 'inapp') {
      n.markSent(null, null);   // the inbox row IS the in-app item; nothing to send externally
    } else if (!template) {
      n.markFailed('no_template');   // can't send an empty external message — record + skip (fail-closed)
      this.metrics.inc('comm.no_template', { event: a.event, channel: a.channel });
    } else if (!addressableOn(a.channel, a.profile)) {
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
      const res = await this.gateway.dispatch({ idempotencyKey: n.id, tenantId: a.tenantId, userId: a.userId, channel: a.channel as NotifyChannel,
        eventCode: a.event, languageCode: n.toProps().languageCode ?? a.lang, subject: rendered.subject, body: rendered.body, providerTemplateRef: template.providerTemplateRef, payload: a.payload });
      if (res.status === 'accepted') n.markSent(res.providerMsgRef ?? null, res.costMinor ?? null);
      else n.markFailed(res.failureReason ?? 'dispatch_failed');
    }
  }

  /**
   * **THE MORNING HALF OF A HOLD (F-4, W432's promise).** A held row whose window has ended, claimed by the release job
   * on its own transaction (`app.tenant_id` set). Re-asked, because a night is long (`releaseDecision`): opted out since →
   * never sent; the window widened → held again; otherwise `suppressed → queued` and sent on exactly the daytime path
   * (`dispatchInto`) — template in the reader's language, address, device, notifier. The row keeps
   * `suppressed_reason = quiet_hours` and gains `released_at`, so W434 can draw "held → released → sent".
   */
  async releaseHeld(tx: TxContext, n: Notification): Promise<ReleaseOutcome> {
    const p = n.toProps();
    const now = this.now();
    const event = await this.events.getByCode(p.eventCode, tx);
    const prefs = await this.prefs.mapForUsers([p.userId], p.eventCode, tx);
    const own = (await this.quiet.mapForUsers([p.userId], tx)).get(p.userId) ?? null;
    const qctx = await this.quiet.tenantContext(p.tenantId, tx);
    const window: EffectiveWindow | null = effectiveWindow(own, parseWindowSetting(qctx.defaultWindow), qctx.zone);
    const d = releaseDecision({
      priority: event?.priority ?? 'informational', userCanOptOut: event?.userCanOptOut ?? true, channel: p.channel,
      prefEnabled: prefs.get(p.userId)?.get(p.channel), window, now,
    });
    if (d.kind === 'opted_out') { n.dropHoldAsOptedOut(); await this.notifications.updateReleased(tx, n); return 'opted_out'; }
    if (d.kind === 'rehold') { n.rehold(d.until); await this.notifications.updateReleased(tx, n); return 'reheld'; }
    n.release(now);
    const profile = (await this.notifications.profilesFor(tx, [p.userId])).get(p.userId) ?? null;
    const lang = p.languageCode ?? profile?.languageCode ?? LAST_RESORT_LANGUAGE;
    const tenantLangs = await this.templates.tenantLanguageOrder(p.tenantId, tx);
    const a = { tenantId: p.tenantId, userId: p.userId, event: p.eventCode, channel: p.channel, lang, payload: p.payload, profile, templateCache: new Map<string, NotificationTemplate | null>(), tenantLangs };
    const template = await this.resolveTemplate(tx, a);
    n.attachTemplate(template?.id ?? null, template?.versionId ?? null, template?.languageCode ?? lang);
    await this.dispatchInto(tx, n, a, template);
    await this.notifications.updateReleased(tx, n);
    await this.flush(tx, p.tenantId, n.id, n.pullEvents());
    this.metrics.inc('comm.held_released', { event: p.eventCode, channel: p.channel, status: n.status });
    return n.status === 'failed' ? 'failed' : 'sent';
  }

  /** Is the release switched off (the kill-switch fired)? Read by the job and printed by the bell / ladder. */
  async releaseStopped(tenantId?: string | null): Promise<boolean> {
    return this.flags.isEnabled(HELD_RELEASE_KILL_SWITCH, { tenantId: tenantId ?? undefined }).catch(() => false);
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

  // ---- the recipient's own inbox moved to `InboxService` (PC-56 TENANT-8b): the bell, the center, mark-read and
  // mark-all-read as audited, keyed acts, and W434's ladder. This service keeps the SEND side.

  /**
   * **THE MODULE'S PUBLIC ANSWER TO *"DID THEY GET IT?"* (PC-56 TENANT-6d-8.)**
   *
   * Another module asks THIS service — never the repository (CLAUDE.md's rule) — for the delivery log's account of one
   * thing it announced. The window is REQUIRED and comes from the caller's own receipt, because `notifications` is
   * partitioned by `created_at` and an unbounded read of it is the shape Law 8 forbids; the caller knows the instant it
   * queued the notice, so the caller supplies the bound.
   *
   * Read on the REPLICA: a delivery report is a screen, and a screen tolerates replica lag (Law 12's `@ReadOnly`
   * reasoning). What it must not do is claim more than the log says — see `DeliveryReport.people` versus `.rows`.
   */
  async deliveryReportFor(tenantId: string, i: {
    eventCodes: readonly string[]; from: Date; to: Date; payloadKey: string; payloadValue: string;
  }, x?: TxContext): Promise<DeliveryReport> {
    return this.notifications.deliveryReport(tenantId, i, x);
  }

  /**
   * **THE DELIVERY RECEIPT, BOTH WAYS (F-10).** The webhook used to answer `applied: true` to a `failed` receipt and
   * leave the row `sent` — the provider told the platform a farmer never got the message and the log kept saying it
   * went. Now: `sent → delivered` with `delivered_at`, `sent → failed` with `failed_at` and a failure CODE (the
   * provider's own words are normalised — `provider_rejected` when unknown — and ride the outbox event). A receipt for a
   * row already past `sent` (a duplicate, or a late `delivered` after `read`) is `unchanged`, idempotently.
   */
  async applyDeliveryStatus(tenantId: string | null, providerMsgRef: string, status: 'delivered' | 'failed', reason?: string | null): Promise<'delivered' | 'failed' | 'unchanged' | 'not_found'> {
    return this.uow.run(tenantId ?? '', async (tx) => {
      const n = await this.notifications.getByProviderRef(tx, providerMsgRef);
      if (!n) return 'not_found' as const;
      if (n.status !== 'sent') return 'unchanged' as const;
      if (status === 'delivered') n.markDelivered(this.now()); else n.markFailedByProvider(reason);
      await this.notifications.update(tx, n);
      await this.flush(tx, n.tenantId, n.id, n.pullEvents());
      this.metrics.inc('comm.delivery_receipt', { channel: n.channel, status });
      return status;
    });
  }

  private async flush(tx: TxContext, tenantId: string | null, id: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'notification', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
export { CommForbiddenError };
