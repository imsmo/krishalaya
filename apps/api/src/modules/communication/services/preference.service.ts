// modules/communication/services/preference.service.ts · a user's notification preferences + quiet hours — PC-56
// TENANT-8b · W433 (the matrix) and the notification FORM chain (W2683–W2686: Change window · Save preferences · Change
// language).
//
// A user may DISABLE a channel only for an opt-out-able event — disabling a mandatory event (OTP, dispute, payment)
// THROWS CannotOptOutError (Law 6, fail-closed). Ownership is always the caller's own userId (no IDOR).
//
// [PC-56 TENANT-8b]
//   • F-13 · THE MATRIX IS THE MEMBER'S OWN READ. The catalogue read that fills it was `notification.manage`-gated
//     (`GET /notifications/events`) and `list` returned only explicit overrides, so a clerk without the verb saw an empty
//     page. `matrix` needs authentication only: every catalogued event with its tier, its channels, whether you may turn
//     it off (and why not), your overrides merged over the catalogue's defaults, the window that applies to you tonight
//     (yours, or the cooperative's default in its zone — F-5), your language, and the routine rule as DECIDED (F-18).
//   • THE FORM CHAIN'S REVIEWS (`previewWindow` · `previewPreferences` · `previewLanguage`) are computed from the facts
//     the writers use (`domain/inbox-review.ts`).
//   • THE WRITES ARE ACTS: an Idempotency-Key when the form sends one (it does — the review page mints it), an audit row
//     in the transaction (W2685: *"the audit trail has the entry (actor · time · reason · before/after)"* — preference
//     writes emitted an outbox event and wrote no audit row; quiet hours wrote neither), and an outbox event.
//   • F-6 / F-22 · the zone: blank → the cooperative's (`countries.timezone`), never `'Asia/Kolkata'`; an unknown zone is
//     refused by the review AND by 0176's trigger, which this service turns into the review's sentence (a 422), not a 500.
import { Inject, Injectable, Optional } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { AUDIT_WRITER, AuditWriter } from '../../../core/audit/audit.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { writerIssuesOf, submittedValues } from '../../../shared/form-review';
import { CommEventType, NOTIF_CHANNELS, NOTIF_PRIORITIES } from '../domain/communication.events';
import { NotificationEventRepository } from '../repositories/notification-event.repository';
import { NotificationPreferenceRepository } from '../repositories/notification-preference.repository';
import { NotificationTemplateRepository } from '../repositories/notification-template.repository';
import { QuietHoursRepository, QuietHoursRow } from '../repositories/quiet-hours.repository';
import { NotificationEventNotFoundError, CannotOptOutError, InboxFormRefusedError } from '../domain/communication.errors';
import { EffectiveWindow, effectiveWindow, parseWindowSetting } from '../domain/quiet-window';
import {
  CatalogFacts, HELD_CHANNELS, LanguageReview, NEVER_HELD_CHANNELS, PreferenceChange, PreferenceReview, WindowReview, cellName, reviewLanguage, reviewPreferences, reviewWindow,
} from '../domain/inbox-review';
import { ROUTINE_FANOUT_FLAG } from './notification.service';
import { SetQuietHoursWriterSchema } from '../dto/set-quiet-hours.dto';
// PC-56 STORE-4c · B3 / B4: the buyer audience filter and the promotional row's consent half (identity's record, read through its service).
import { MatrixAudience, inAudience } from '../domain/buyer-audience';
import { ConsentService } from '../../identity/services/consent.service';
import { PROMOTIONAL_CONSENT_PURPOSE } from './notification.service';

export interface PrefInput { eventCode: string; channel: string; isEnabled: boolean; }

export interface MatrixCell { channel: string; sentOn: boolean; enabled: boolean | null; explicit: boolean }
/** `consent` is present on a PROMOTIONAL event only (STORE-4c D2): the purpose it needs and whether the person's latest decision is a grant —
 *  the page prints both halves (the opt-in AND the consent). */
export interface MatrixEvent { code: string; defaultName: string; priority: string; locked: boolean; cells: MatrixCell[]; consent?: { purpose: string; granted: boolean } }
export interface MatrixView {
  channels: readonly string[];
  tiers: Array<{ tier: string; events: MatrixEvent[] }>;
  counts: { events: number; locked: number; critical: number; explicit: number };
  /** F-18 · "One channel is enough" — DECIDED (G0-4, 2026-07-22); `on` is the flag's live value. */
  routineRule: { decided: true; on: boolean; flag: string };
  quietHours: { effective: EffectiveWindow | null; own: QuietHoursRow | null; tenantDefault: { starts: string; ends: string } | null; tenantZone: string | null; held: readonly string[]; neverHeld: readonly string[] };
  language: { current: string | null; active: Array<{ code: string; nameEnglish: string; nameNative: string }>; tenantLanguages: string[] };
}

interface Act { idemKey?: string | null; ip?: string | null }

@Injectable()
export class PreferenceService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly events: NotificationEventRepository,
    private readonly prefs: NotificationPreferenceRepository,
    private readonly quiet: QuietHoursRepository,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly templates: NotificationTemplateRepository,
    private readonly flags: FlagsService,
    // STORE-4c · B3. Optional only so hand-built services in older specs compile; ABSENT reads as "not granted" (fail closed).
    @Optional() private readonly consents?: ConsentService,
  ) {}

  async list(userId: string) { return (await this.prefs.listForUser(userId)).map((p) => p.toJSON()); }

  private async keyed<T>(opts: Act, userId: string, endpoint: string, fn: () => Promise<T>): Promise<T> {
    return opts.idemKey ? this.idem.remember(opts.idemKey, userId, endpoint, fn) : fn();
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* W433 · THE MATRIX                                                                                          */
  /* ---------------------------------------------------------------------------------------------------------- */

  /**
   * W433 / W302 · the person's own matrix. `audience = 'buyer'` (STORE-4c B4) lists only the events a buyer can ever receive
   * (`domain/buyer-audience.ts`); no audience → every catalogued event (web-tenant's W433, unchanged).
   * STORE-4c D2: a PROMOTIONAL event is OFF unless an explicit opt-in row exists (`explicit ?? false`), and carries its consent half.
   */
  async matrix(tenantId: string, userId: string, audience?: MatrixAudience): Promise<MatrixView> {
    const [allEvents, explicitRows, own, qctx, active, tenantLangs, current, routineOn] = await Promise.all([
      this.events.list(), this.prefs.listForUser(userId), this.quiet.getForUser(userId), this.quiet.tenantContext(tenantId),
      this.templates.activeLanguages(), this.templates.tenantLanguageOrder(tenantId), this.prefs.languageOf(userId),
      this.flags.isEnabled(ROUTINE_FANOUT_FLAG, { tenantId }).catch(() => false),
    ]);
    const events = allEvents.filter((e) => inAudience(e.code, audience));
    const hasPromotional = events.some((e) => e.priority === 'promotional');
    const marketingGranted = hasPromotional ? await this.marketingGranted(tenantId, userId) : false;
    const explicit = new Map(explicitRows.map((p) => { const j = p.toJSON(); return [cellName(j.eventCode, j.channel), j.isEnabled] as const; }));
    const tiers = NOTIF_PRIORITIES.map((tier) => ({
      tier,
      events: events.filter((e) => e.priority === tier).map((e) => {
        const j = e.toJSON();
        const promotional = j.priority === 'promotional';
        const ev: MatrixEvent = {
          code: j.code, defaultName: j.defaultName, priority: j.priority, locked: !j.userCanOptOut,
          cells: NOTIF_CHANNELS.map((ch) => {
            const sentOn = j.defaultChannels.includes(ch);
            const key = cellName(j.code, ch);
            // A locked event's channels are ON whatever a row says — the fan-out ignores opt-outs for it. A PROMOTIONAL event's channels are OFF
            // until the person opts in (STORE-4c D2 — `resolveChannels` sends a promotional channel only on an explicit opt-in row).
            return { channel: ch, sentOn, enabled: sentOn ? (!j.userCanOptOut ? true : explicit.get(key) ?? (promotional ? false : true)) : null, explicit: sentOn && explicit.has(key) };
          }),
        };
        if (promotional) ev.consent = { purpose: PROMOTIONAL_CONSENT_PURPOSE, granted: marketingGranted };
        return ev;
      }),
    }));
    const tenantDefault = parseWindowSetting(qctx.defaultWindow);
    const shownExplicit = [...explicit.keys()].filter((k) => events.some((e) => k.startsWith(`${e.code}::`))).length;
    return {
      channels: NOTIF_CHANNELS,
      tiers,
      counts: { events: events.length, locked: events.filter((e) => !e.userCanOptOut).length, critical: events.filter((e) => e.priority === 'critical').length, explicit: audience ? shownExplicit : explicit.size },
      routineRule: { decided: true, on: routineOn, flag: ROUTINE_FANOUT_FLAG },
      quietHours: { effective: effectiveWindow(own, tenantDefault, qctx.zone), own, tenantDefault, tenantZone: qctx.zone, held: HELD_CHANNELS, neverHeld: NEVER_HELD_CHANNELS },
      language: { current, active, tenantLanguages: tenantLangs },
    };
  }

  /** STORE-4c · B3 — the person's latest `marketing` decision is a grant (absent reader → false: fail closed). */
  private async marketingGranted(tenantId: string, userId: string): Promise<boolean> {
    if (!this.consents) return false;
    return this.consents.latestGranted(tenantId, userId, PROMOTIONAL_CONSENT_PURPOSE).catch(() => false);
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE REVIEWS                                                                                                */
  /* ---------------------------------------------------------------------------------------------------------- */

  async previewWindow(tenantId: string, userId: string, dto: { starts?: string; ends?: string; timezone?: string }, now = new Date()): Promise<WindowReview> {
    const [own, qctx] = await Promise.all([this.quiet.getForUser(userId), this.quiet.tenantContext(tenantId)]);
    const zone = (dto.timezone ?? '').trim();
    const zoneKnown = zone.length > 0 ? await this.quiet.knownTimezone(zone) : null;
    return reviewWindow({
      entered: dto, zoneKnown, tenantZone: qctx.zone, current: effectiveWindow(own, parseWindowSetting(qctx.defaultWindow), qctx.zone), now,
      writerIssues: writerIssuesOf(SetQuietHoursWriterSchema, submittedValues(dto)),
    });
  }

  private async catalogMap(): Promise<Map<string, CatalogFacts>> {
    return new Map((await this.events.list()).map((e) => { const j = e.toJSON(); return [j.code, { code: j.code, priority: j.priority, userCanOptOut: j.userCanOptOut, defaultChannels: j.defaultChannels }] as const; }));
  }

  async previewPreferences(userId: string, changes: readonly PreferenceChange[]): Promise<PreferenceReview> {
    const explicit = new Map((await this.prefs.listForUser(userId)).map((p) => { const j = p.toJSON(); return [cellName(j.eventCode, j.channel), j.isEnabled] as const; }));
    return reviewPreferences({ changes, catalog: await this.catalogMap(), explicit });
  }

  async previewLanguage(tenantId: string, userId: string, languageCode: string | undefined): Promise<LanguageReview> {
    const [active, tenantLangs, current] = await Promise.all([this.templates.activeLanguages(), this.templates.tenantLanguageOrder(tenantId), this.prefs.languageOf(userId)]);
    return reviewLanguage({ entered: languageCode, active: active.map((l) => l.code), tenantLanguages: tenantLangs, current });
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE WRITES                                                                                                 */
  /* ---------------------------------------------------------------------------------------------------------- */

  async setPreferences(tenantId: string, userId: string, items: PrefInput[], opts: Act = {}) {
    // validate against the catalog BEFORE any write (fail-closed)
    for (const it of items) {
      if (it.isEnabled) continue;                          // enabling is always allowed
      const event = await this.events.getByCode(it.eventCode);
      if (!event) throw new NotificationEventNotFoundError(it.eventCode);
      if (!event.userCanOptOut) throw new CannotOptOutError(it.eventCode);   // mandatory event — cannot disable
    }
    return this.keyed(opts, userId, 'communication.preferences.set', () => this.uow.run(tenantId, async (tx) => {
      const before = await this.prefs.listForUser(userId, undefined, tx);
      await this.prefs.upsertMany(tx, userId, items);
      await this.outbox.write(tx, { tenantId, aggregateType: 'notification_preference', aggregateId: userId, eventType: CommEventType.PreferenceUpdated, payload: { v: 1, userId, count: items.length } });
      const was = new Map(before.map((p) => { const j = p.toJSON(); return [cellName(j.eventCode, j.channel), j.isEnabled] as const; }));
      await this.audit.write(tx, {
        tenantId, actorUserId: userId, action: 'communication.preferences.set', entityType: 'notification_preference', entityId: userId,
        oldValue: Object.fromEntries(items.map((i) => [cellName(i.eventCode, i.channel), was.get(cellName(i.eventCode, i.channel)) ?? null])),
        newValue: Object.fromEntries(items.map((i) => [cellName(i.eventCode, i.channel), i.isEnabled])), ip: opts.ip ?? null,
      });
      return { updated: items.length };
    }, { userId }));
  }

  async getQuietHours(userId: string) { return this.quiet.getForUser(userId); }

  /**
   * Change window. A blank zone becomes the COOPERATIVE's (F-22); the review's refusals are re-taken inside the write
   * (the writer refuses what the review refused, with the same codes); 0176's trigger is the last word on the zone.
   */
  async setQuietHours(tenantId: string, userId: string, q: { starts: string; ends: string; timezone?: string }, opts: Act = {}) {
    return this.keyed(opts, userId, 'communication.quiet_hours.set', async () => {
      const review = await this.previewWindow(tenantId, userId, q);
      const blocking = review.refusals.filter((r) => r.code !== 'WINDOW_UNCHANGED');
      if (blocking.length > 0) throw new InboxFormRefusedError('quiet_hours', blocking);
      const row: QuietHoursRow = { starts: review.stored.starts!, ends: review.stored.ends!, timezone: review.stored.timezone! };
      try {
        return await this.uow.run(tenantId, async (tx) => {
          const before = await this.quiet.getForUser(userId, tx);
          await this.quiet.upsert(tx, userId, row);
          await this.outbox.write(tx, { tenantId, aggregateType: 'user_quiet_hours', aggregateId: userId, eventType: CommEventType.QuietHoursUpdated, payload: { v: 1, userId, ...row } });
          await this.audit.write(tx, { tenantId, actorUserId: userId, action: 'communication.quiet_hours.set', entityType: 'user_quiet_hours', entityId: userId, oldValue: before, newValue: row, ip: opts.ip ?? null });
          return row;
        }, { userId });
      } catch (e) {
        if ((e as { code?: string }).code === '23514') throw new InboxFormRefusedError('quiet_hours', [{ field: 'timezone', code: 'TIMEZONE_UNKNOWN' }]);
        throw e;
      }
    });
  }
}
