// modules/dairy/services/dairy-diversion.service.ts · PC-56 TENANT-6d-6 · W170's playbook step 2.
//
// *"If ≥ 7.5°C by 16:00 → divert evening shift to Bhesan (route notice to 87 pourers, Gujarati voice)"*, and
// *"playbook overrides are operator + dairy lead together."*
//
// THREE ACTS AND A COUNT. An operator REQUESTS a diversion with a reason; a dairy lead with `dairy.override` SIGNS it —
// a different person, enforced here and by `ck_dairy_diversion_maker_ne_checker`; either may CANCEL it while no milk
// has been recorded under it. And every step reports how many members are actually affected, counted from the route
// history as of the diverted day, because *"87 pourers"* is a number a cooperative acts on.
//
// WHAT THIS SERVICE REFUSES TO DO
//   • **It does not move a membership.** A diversion is not a transfer: the route, the card and the history are
//     untouched (TENANT-6d-3's table is never written here). The member belongs to Vanthali and pours there tomorrow.
//   • **It does not backdate.** A diversion for a day whose pours are in would retro-authorise an attribution nobody
//     agreed to at the time — and the pours it would cover were already refused at the counter, correctly.
//   • **It does not tell the members.** The count is real and the screens say plainly that nobody is notified by this
//     act. TENANT-6d-7 sends W170's *"Gujarati voice"* notice.
//   • **It does not fire itself.** The playbook SUGGESTS; two humans decide. An automatic diversion would move 87
//     families' evening on one sensor reading.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { DairyEventType, MilkShift } from '../domain/dairy.events';
import { DairyDiversionRepository, DiversionRow } from '../repositories/dairy-diversion.repository';
import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { DiversionRefusedError } from '../domain/dairy.errors';
import {
  DiversionRefusal, NoticeState, approveVerdict, cancelVerdict, chunkRecipients, diversionState, noticeState,
  requestVerdict,
} from '../domain/dairy-diversion';
import { NOTICE_FLAG } from '../domain/dairy-diversion.flags';
import { diversionNoticeVars } from '../domain/dairy-notice-vars';
import { DairyNoticeVarsService } from './dairy-notice-vars.service';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { NotificationService } from '../../communication/services/notification.service';

/**
 * HOW LONG AFTER QUEUEING A NOTICE'S DELIVERY ROWS MAY APPEAR.
 *
 * Two days, and the number is a decision about the relay rather than about the milk: an outbox row is normally fanned
 * out within seconds, but a relay that was down over a night has to catch up, and a report whose window closed an hour
 * after the signature would show a village as unreached because the platform, not the members, was late. Two days is
 * also inside one `notifications` partition for any sane partition size, which is what keeps this read bounded.
 */
export const NOTICE_REPORT_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
import { DairyActor } from './mcc-centre.service';

/** The actor for this act — dairy's TWO verbs, because W170's override needs both hands. */
export interface DiversionActor extends DairyActor {
  /** `dairy.override` (0166): the dairy lead's verb, and deliberately not `settlement.close`. */
  canOverride: boolean;
}

export interface DiversionView extends DiversionRow {
  state: 'requested' | 'live' | 'cancelled';
  /** Members routed to the sending centre on that day — the *"87 pourers"* of W170's own sentence. */
  affectedMembers: number;
  /**
   * [PC-56 TENANT-6d-8] WHAT THIS PLATFORM MAY HONESTLY SAY ABOUT TELLING THEM.
   *
   * 6d-6 had `membersNotified: false as const` here and every screen printed *"not told"*, which was true and is no
   * longer. `queued` is the strongest claim this field can carry: the outbox row is written in the same transaction as
   * the signature, and delivery — a phone that is off, a voice leg the provider refused — is `notifications`' business
   * and the delivery report's answer.
   */
  notice: NoticeState;
}

@Injectable()
export class DairyDiversionService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: DairyDiversionRepository,
    private readonly centres: MccCentreRepository,
    // [PC-56 TENANT-6d-8] The notice: its own flag (Law 10 — a cooperative with no telephony contract still diverts
    // shifts and still tells its members by loudspeaker), and the words, in each member's own language.
    private readonly flags: FlagsService,
    private readonly noticeVars: DairyNoticeVarsService,
    // Communication's PUBLIC service, for the delivery report — the same seam TENANT-6d-5 used to place a masked call.
    private readonly notifications: NotificationService,
  ) {}

  /**
   * **THE NOTICE, W170's own sentence: *"route notice to 87 pourers, Gujarati voice"*.**
   *
   * Called from `approve` (the diversion) and from `cancel` (its retraction), inside the act's OWN transaction, so a
   * signature that commits cannot leave the announcement uncommitted and an announcement cannot exist for a signature
   * that rolled back — Law 4, and the reason this is one function rather than a job that reads the table later.
   *
   * IT DOES NOT SEND. It writes outbox events; the relay fans them out through the notification spine, which since
   * TENANT-6d-7 resolves each recipient's own language. What this returns is the RECEIPT: how many members the notice
   * was queued for, or null when the flag is off.
   *
   * CHUNKED at `NOTICE_CHUNK`, because the fan-out of one event runs in one relay transaction and a district union's
   * centre is not W170's 87 families (see `chunkRecipients` for the whole argument).
   */
  private async queueNotice(tx: TxContext, tenantId: string, row: DiversionRow, kind: 'diverted' | 'retracted'): Promise<number | null> {
    const enabled = await this.flags.isEnabled(NOTICE_FLAG, { tenantId });
    if (!enabled) { this.metrics.inc('dairy.diversion.notice_disabled', { tenant: tenantId }); return null; }

    const recipients = await this.repo.affectedMemberUserIds(tx, tenantId, row.fromMccId, row.divertedOn);
    const [from, to] = await Promise.all([
      this.centres.getById(tenantId, row.fromMccId, tx).catch(() => null),
      this.centres.getById(tenantId, row.toMccId, tx).catch(() => null),
    ]);
    const vars = diversionNoticeVars({
      // NAMES, never ids: a member does not know their centre's UUID and should not have to recognise its code.
      fromName: from?.toProps().defaultName ?? '', toName: to?.toProps().defaultName ?? '',
      day: row.divertedOn, shift: row.shift, labels: await this.noticeVars.labels(tx),
    });
    const eventType = kind === 'diverted' ? DairyEventType.ShiftDiverted : DairyEventType.ShiftDiversionCancelled;
    for (const chunk of chunkRecipients(recipients)) {
      await this.outbox.write(tx, {
        tenantId, aggregateType: 'dairy_shift_diversion', aggregateId: row.id, eventType,
        payload: {
          v: 1, diversionId: row.id, fromMccId: row.fromMccId, toMccId: row.toMccId,
          divertedOn: row.divertedOn, shiftCode: row.shift,
          // The spine's own recipient key (`NOTIFICATION_EVENT_MAP`), and the copy's four variables beside it. A map
          // row over a payload with no recipient sends nothing — ADMIN-6b's finding, and 6d-7 found the dairy module
          // repeating it on `dairy.quality_flag_decided`.
          recipientUserIds: chunk,
          ...vars,
        },
      });
    }
    this.metrics.inc('dairy.diversion.notice_queued', { tenant: tenantId, kind, chunks: String(chunkRecipients(recipients).length) });
    return recipients.length;
  }

  /** Today in the cooperative's own calendar. The DATABASE's day, never the process clock (TENANT-6c-1's ruling). */
  private async today(tx: TxContext): Promise<string> {
    const r = await tx.query(`SELECT current_date::text AS d`);
    return String((r.rows[0] as { d: string }).d);
  }

  private refuse(refusals: DiversionRefusal[]): never { throw new DiversionRefusedError(refusals); }

  /**
   * The confirm step's question, and the request's own verdict — one function, so a screen that says *"ready"* cannot
   * be followed by a refusal (TENANT-6d-4's ruling, carried into the mutate chain).
   *
   * Writes nothing. Takes no idempotency key.
   */
  async preview(tenantId: string, actor: DiversionActor, dto: {
    fromMccId: string; toMccId: string; divertedOn?: string; shift: MilkShift; reason?: string;
  }): Promise<{
    allowed: boolean; refusals: DiversionRefusal[]; affectedMembers: number; divertedOn: string;
    fromCode: string | null; fromName: string | null; toCode: string | null; toName: string | null;
    /**
     * [PC-56 TENANT-6d-8] WILL THESE MEMBERS BE TOLD, IF THIS IS SIGNED?
     *
     * A BOOLEAN and not a `NoticeState`, on purpose. Every state in that vocabulary is a fact about what HAPPENED
     * (`queued`, `retracted`, `not_signed`); a preview is asking a hypothetical, and squeezing "what will happen" into
     * an enum of "what did happen" is how a screen ends up printing *"nobody to tell"* about eighty-seven families.
     * The screen composes its sentence from this and `affectedMembers` — which is also why a dairy lead sees, BEFORE
     * the second signature, whether those families will hear it from the platform or from a loudspeaker.
     */
    noticeEnabled: boolean;
  }> {
    return this.uow.run(tenantId, async (tx) => {
      const today = await this.today(tx);
      const on = dto.divertedOn ?? today;
      const [from, to] = await Promise.all([
        this.centres.getById(tenantId, dto.fromMccId, tx).catch(() => null),
        this.centres.getById(tenantId, dto.toMccId, tx).catch(() => null),
      ]);
      const fromProps = from?.toProps() ?? null;
      const toProps = to?.toProps() ?? null;
      const existing = fromProps ? await this.repo.pendingOrLive(tx, tenantId, fromProps.id, on, dto.shift) : null;
      const v = requestVerdict({
        canManage: actor.canManage,
        from: fromProps ? { id: fromProps.id, isActive: fromProps.isActive } : null,
        to: toProps ? { id: toProps.id, isActive: toProps.isActive } : null,
        divertedOn: on, today, alreadyDiverted: existing !== null, reason: dto.reason ?? '',
      });
      return {
        allowed: v.allowed, refusals: v.refusals, divertedOn: on,
        // The count is real even when the request is refused: *"87 pourers"* is what a dairy lead is deciding about,
        // and hiding it until the form is perfect would hide the size of the decision.
        affectedMembers: fromProps ? await this.repo.affectedMembers(tx, tenantId, fromProps.id, on) : 0,
        fromCode: fromProps?.code ?? null, fromName: fromProps?.defaultName ?? null,
        toCode: toProps?.code ?? null, toName: toProps?.defaultName ?? null,
        noticeEnabled: await this.flags.isEnabled(NOTICE_FLAG, { tenantId }),
      };
    }, { userId: actor.userId });
  }

  /** An operator asks for the diversion. It moves no milk until somebody else signs it. */
  async request(tenantId: string, actor: DiversionActor, idemKey: string, dto: {
    fromMccId: string; toMccId: string; divertedOn?: string; shift: MilkShift; reason: string;
  }, ip: string | null): Promise<DiversionView> {
    return this.idem.remember(idemKey, actor.userId, 'dairy.diversion.request', () =>
      timed(this.metrics, 'dairy.diversion.request', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const today = await this.today(tx);
          const on = dto.divertedOn ?? today;
          const [from, to] = await Promise.all([
            this.centres.getById(tenantId, dto.fromMccId, tx).catch(() => null),
            this.centres.getById(tenantId, dto.toMccId, tx).catch(() => null),
          ]);
          const fromProps = from?.toProps() ?? null;
          const toProps = to?.toProps() ?? null;
          const existing = fromProps ? await this.repo.pendingOrLive(tx, tenantId, fromProps.id, on, dto.shift) : null;
          const v = requestVerdict({
            canManage: actor.canManage,
            from: fromProps ? { id: fromProps.id, isActive: fromProps.isActive } : null,
            to: toProps ? { id: toProps.id, isActive: toProps.isActive } : null,
            divertedOn: on, today, alreadyDiverted: existing !== null, reason: dto.reason,
          });
          if (!v.allowed) this.refuse(v.refusals);

          const row = await this.repo.insert(tx, {
            id: uuidv7(), tenantId, fromMccId: (fromProps as { id: string }).id, toMccId: (toProps as { id: string }).id,
            divertedOn: on, shift: dto.shift, reason: dto.reason.trim(), requestedBy: actor.userId,
          });
          const affected = await this.repo.affectedMembers(tx, tenantId, row.fromMccId, on);
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'dairy.diversion.requested',
            entityType: 'dairy_shift_diversion', entityId: row.id, reason: row.reason,
            newValue: { fromMccId: row.fromMccId, toMccId: row.toMccId, divertedOn: on, shift: row.shift, affectedMembers: affected },
            ip,
          });
          // The event carries the count so a consumer never has to re-derive it — TENANT-6d-7's notice will fan out
          // over exactly these members, resolved the same way.
          await this.outbox.write(tx, {
            tenantId, aggregateType: 'dairy_shift_diversion', aggregateId: row.id,
            eventType: 'dairy.diversion_requested',
            payload: { v: 1, diversionId: row.id, fromMccId: row.fromMccId, toMccId: row.toMccId, divertedOn: on, shift: row.shift, affectedMembers: affected },
          });
          // A REQUEST TELLS NOBODY. Nothing has been authorised yet, and announcing it would move 87 families on one
          // person's word — the whole reason this act has two signatures.
          return {
            ...row, state: diversionState(row), affectedMembers: affected,
            notice: noticeState({ enabled: true, signed: false, recipients: affected, queuedAt: null, retractionQueuedAt: null }),
          };
        }, { userId: actor.userId })));
  }

  /**
   * The dairy lead signs it, and only then does the counter accept a pour at the other village.
   *
   * The verdict is re-taken against rows read NOW: the request may have been cancelled, signed by somebody faster, or
   * overtaken by the shift it was about. TENANT-6d-5's ruling — a confirm step is not an authorisation token.
   */
  async approve(tenantId: string, actor: DiversionActor, idemKey: string, id: string, ip: string | null): Promise<DiversionView> {
    return this.idem.remember(idemKey, actor.userId, 'dairy.diversion.approve', () =>
      timed(this.metrics, 'dairy.diversion.approve', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const today = await this.today(tx);
          const row = await this.repo.forUpdate(tx, tenantId, id);
          const poursIn = row === null ? 0 : await this.repo.poursAt(tx, tenantId, row.fromMccId, row.divertedOn, row.shift);
          const v = approveVerdict({
            canOverride: actor.canOverride, row, actorUserId: actor.userId, today, poursAlreadyIn: poursIn,
          });
          if (!v.allowed) this.refuse(v.refusals);
          const at = new Date();
          const r = row as DiversionRow;
          await this.repo.approve(tx, tenantId, id, actor.userId, at);
          const affected = await this.repo.affectedMembers(tx, tenantId, r.fromMccId, r.divertedOn);
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'dairy.diversion.approved',
            entityType: 'dairy_shift_diversion', entityId: id, reason: r.reason,
            oldValue: { approvedBy: null },
            newValue: { approvedBy: actor.userId, requestedBy: r.requestedBy, affectedMembers: affected },
            ip,
          });
          await this.outbox.write(tx, {
            tenantId, aggregateType: 'dairy_shift_diversion', aggregateId: id,
            eventType: 'dairy.diversion_approved',
            payload: {
              v: 1, diversionId: id, fromMccId: r.fromMccId, toMccId: r.toMccId, divertedOn: r.divertedOn,
              shift: r.shift, requestedBy: r.requestedBy, approvedBy: actor.userId, affectedMembers: affected,
            },
          });
          // THE MEMBERS ARE TOLD HERE, in this transaction. W170's own sentence, and the last mile of 6d-6.
          const queuedFor = await this.queueNotice(tx, tenantId, r, 'diverted');
          if (queuedFor !== null) await this.repo.noticeQueued(tx, tenantId, id, at, queuedFor);
          const signed: DiversionRow = {
            ...r, approvedBy: actor.userId, approvedAt: at.toISOString(),
            noticeQueuedAt: queuedFor === null ? r.noticeQueuedAt : at.toISOString(),
            noticeRecipients: queuedFor === null ? r.noticeRecipients : queuedFor,
          };
          return {
            ...signed, state: diversionState(signed), affectedMembers: affected,
            notice: noticeState({
              enabled: queuedFor !== null, signed: true, recipients: affected,
              queuedAt: signed.noticeQueuedAt, retractionQueuedAt: signed.retractionQueuedAt,
            }),
          };
        }, { userId: actor.userId })));
  }

  /** Called off — while no milk has been taken under it. After that the honest answer is that it is too late. */
  async cancel(tenantId: string, actor: DiversionActor, idemKey: string, id: string, reason: string, ip: string | null): Promise<DiversionView> {
    return this.idem.remember(idemKey, actor.userId, 'dairy.diversion.cancel', () =>
      timed(this.metrics, 'dairy.diversion.cancel', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const row = await this.repo.forUpdate(tx, tenantId, id);
          const under = row === null ? 0 : await this.repo.poursUnder(tx, tenantId, id);
          const v = cancelVerdict({ canManage: actor.canManage, row, poursUnderIt: under, reason });
          if (!v.allowed) this.refuse(v.refusals);
          const at = new Date();
          const r = row as DiversionRow;
          await this.repo.cancel(tx, tenantId, id, actor.userId, at, reason.trim());
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'dairy.diversion.cancelled',
            entityType: 'dairy_shift_diversion', entityId: id, reason: reason.trim(),
            newValue: { cancelledBy: actor.userId, wasApproved: r.approvedAt !== null },
            ip,
          });
          await this.outbox.write(tx, {
            tenantId, aggregateType: 'dairy_shift_diversion', aggregateId: id,
            eventType: 'dairy.diversion_cancelled',
            payload: { v: 1, diversionId: id, fromMccId: r.fromMccId, toMccId: r.toMccId, divertedOn: r.divertedOn, shift: r.shift, cancelledBy: actor.userId },
          });
          // **THE RETRACTION, AND ONLY IF THE FIRST NOTICE WENT OUT.** Telling 87 families to carry their evening milk
          // to Bhesan and then not telling them it is back at Vanthali is the same promise broken twice: the first
          // message caused the walk and the silence causes the wasted one. A cancelled REQUEST announced nothing, so
          // there is nothing to take back — and 0167 puts that rule in a CHECK as well as here.
          const retractedFor = r.noticeQueuedAt === null ? null : await this.queueNotice(tx, tenantId, r, 'retracted');
          if (retractedFor !== null) await this.repo.retractionQueued(tx, tenantId, id, at, retractedFor);
          const done: DiversionRow = {
            ...r, cancelledBy: actor.userId, cancelledAt: at.toISOString(), cancelReason: reason.trim(),
            retractionQueuedAt: retractedFor === null ? r.retractionQueuedAt : at.toISOString(),
            retractionRecipients: retractedFor === null ? r.retractionRecipients : retractedFor,
          };
          const affectedNow = await this.repo.affectedMembers(tx, tenantId, r.fromMccId, r.divertedOn);
          return {
            ...done, state: diversionState(done), affectedMembers: affectedNow,
            notice: noticeState({
              enabled: true, signed: r.approvedAt !== null, recipients: affectedNow,
              queuedAt: done.noticeQueuedAt, retractionQueuedAt: done.retractionQueuedAt,
            }),
          };
        }, { userId: actor.userId })));
  }

  /**
   * **DID THE FAMILIES GET THE MESSAGE? (W170's own first question, once a diversion is announced.)**
   *
   * The diversion's own receipt (`notice_queued_at`) is the WINDOW this read is bounded by, which is the whole reason
   * the receipt is a column rather than something re-derived: `notifications` is partitioned by `created_at`, and a
   * report that did not know when the notice went out would have to scan the table (Law 8). From the receipt it is an
   * index range over a handful of rows — see `idx_notif_event_created` (0167).
   *
   * THROUGH COMMUNICATION'S PUBLIC SERVICE, never its repository (CLAUDE.md's module rule; the same seam TENANT-6d-5
   * used for the masked call).
   *
   * AND IT REPORTS WHAT THE LOG SAYS, NOT WHAT THE ACT INTENDED. `queuedFor` is how many members were handed over;
   * `people` is how many at least one channel reached. A cooperative reading *"87 queued · 84 reached · 3 with no
   * address"* knows to walk round to three houses, which is the entire point of showing it.
   */
  async noticeReport(tenantId: string, actor: DiversionActor, id: string) {
    if (!actor.canManage) this.refuse(['NO_MANAGE']);
    const row = await this.uow.run(tenantId, (tx) => this.repo.byId(tx, tenantId, id), { userId: actor.userId });
    if (row === null) this.refuse(['NOT_FOUND']);
    const r = row as DiversionRow;
    const state = noticeState({
      enabled: await this.flags.isEnabled(NOTICE_FLAG, { tenantId }),
      signed: r.approvedAt !== null, recipients: r.noticeRecipients ?? 0,
      queuedAt: r.noticeQueuedAt, retractionQueuedAt: r.retractionQueuedAt,
    });
    if (r.noticeQueuedAt === null) {
      // NOTHING WAS ANNOUNCED, so there is nothing to report and the screen is told why rather than shown zeroes.
      // Zeroes and "never sent" look identical on a screen and mean opposite things to whoever reads it.
      return { diversionId: id, state, queuedFor: null, queuedAt: null, delivery: null };
    }
    const from = new Date(r.noticeQueuedAt);
    const to = new Date(from.getTime() + NOTICE_REPORT_WINDOW_MS);
    const delivery = await this.notifications.deliveryReportFor(tenantId, {
      eventCodes: [DairyEventType.ShiftDiverted, DairyEventType.ShiftDiversionCancelled],
      from: new Date(from.getTime() - 60_000),   // one minute of slack: the outbox row and its fan-out are not the same instant
      to, payloadKey: 'diversionId', payloadValue: id,
    });
    return {
      diversionId: id, state,
      queuedFor: r.noticeRecipients, queuedAt: r.noticeQueuedAt,
      retractionQueuedFor: r.retractionRecipients, retractionQueuedAt: r.retractionQueuedAt,
      delivery,
    };
  }

  /** The register. Read-only, and it names both villages rather than two ids. */
  async list(tenantId: string, actor: DiversionActor, q: { from?: string; to?: string; limit: number }) {
    if (!actor.canManage) this.refuse(['NO_MANAGE']);
    const [rows, enabled] = await Promise.all([
      this.repo.list(tenantId, q),
      this.flags.isEnabled(NOTICE_FLAG, { tenantId }),
    ]);
    // THE REGISTER READS THE RECEIPT, not the flag: a cooperative that switched the notice off this morning did not
    // un-tell last night's 87 families, and a register that claimed otherwise would be rewriting history to match a
    // toggle. The flag only decides what an UNANNOUNCED signed diversion says about itself.
    return rows.map((r) => ({
      ...r, state: diversionState(r),
      notice: noticeState({
        enabled, signed: r.approvedAt !== null, recipients: r.noticeRecipients ?? 0,
        queuedAt: r.noticeQueuedAt, retractionQueuedAt: r.retractionQueuedAt,
      }),
    }));
  }
}
