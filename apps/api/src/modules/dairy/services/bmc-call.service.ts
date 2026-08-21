// modules/dairy/services/bmc-call.service.ts · PC-56 TENANT-6d-5 · W170's *"Call MCC-AND-03 operator"*.
//
// W2521–W2523 are the shared MUTATE pattern — confirm, success, failure — and this service is the act behind them:
// **a number-masked telephone call from the dairy desk to whoever currently holds custody of a centre, recorded with
// the caller's stated reason.**
//
// WHAT THIS SERVICE DOES *NOT* OWN, AND WHY THAT MATTERS
//   • **It does not dial.** `MaskedCallService` (communication's public service — CLAUDE.md's module rule: a service or
//     an event, never another module's repositories) asks the telephony provider to bridge two user ids. The provider
//     owns the phone directory; this platform never learns or stores either number.
//   • **It does not page anybody.** The automatic path is a `device_silent` rule and the notification spine. A human
//     dialling a human is this; the machine waking a human is that. `dairy_bmc_call` switches off the button and
//     nothing else — a kill-switch on the manual call must never silence the alarm.
//
// THE ORDER OF OPERATIONS IS THE HARD PART, and it is chosen rather than inherited. `MaskedCallService.initiate`
// performs the provider bridge OUTSIDE any transaction (no network in a DB transaction — Law 12's own rule) and then
// writes its log row in its own. So the call cannot be atomic with the dairy audit entry, and something has to be
// second. It is the AUDIT, for one reason: an audit row written first would claim a call that may never be placed, and
// a trail that records calls that did not happen is worse than one missing a call that did. `notes()` names the
// residue.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { MaskedCallService } from '../../communication/services/masked-call.service';
import { BmcUnitRepository } from '../repositories/bmc-unit.repository';
import { cOfDeci, telemetryVerdict } from '../domain/bmc';
import { BmcCallObject, BmcCallRefusal, callObject, callVerdict } from '../domain/bmc-call';
import { BmcCallRefusedError } from '../domain/dairy.errors';
import { DairyActor } from './mcc-centre.service';

/** What the confirm screen is given: the object under review, and whether the act may proceed at all. */
export interface BmcCallPreview {
  object: BmcCallObject;
  allowed: boolean;
  refusals: BmcCallRefusal[];
  /** The reason as it will be recorded — trimmed, so the screen shows what the audit row will hold. */
  reason: string | null;
}

export interface BmcCallResult {
  maskedCallId: string;
  unitId: string;
  calleeUserId: string;
  reason: string;
  placedAt: string;
}

@Injectable()
export class BmcCallService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly units: BmcUnitRepository,
    private readonly calls: MaskedCallService,
  ) {}

  /**
   * W2521's confirm step. **Writes nothing, dials nothing, takes no idempotency key.**
   *
   * The refusals it returns are the refusals `place` raises, from the same facts by the same function — the ruling
   * TENANT-6d-4 made for the form chain, applied to the mutate chain: a confirm screen that offers a button the act
   * will refuse has spent somebody's trust for nothing.
   */
  async preview(tenantId: string, actor: DairyActor, unitId: string, reason: string): Promise<BmcCallPreview> {
    return this.uow.run(tenantId, async (tx) => {
      const ctx = await this.units.callContext(tx, tenantId, unitId);
      const now = new Date();
      const thresholds = await this.units.thresholds(tx, tenantId);
      const props = ctx?.unit.toProps();
      const verdict = callVerdict({
        canManage: actor.canManage,
        actorUserId: actor.userId,
        unit: ctx && props ? { id: props.id, mccId: props.mccId, mccCode: ctx.mccCode, mccName: ctx.mccName, isActive: props.isActive } : null,
        custody: ctx?.custody
          ? { operatorUserId: ctx.custody.operatorUserId, operatorName: ctx.custody.operatorName, assignedAt: ctx.custody.assignedAt.toISOString() }
          : null,
        reason,
      });
      const trimmed = (reason ?? '').trim();
      return {
        object: callObject(
          { id: unitId, mccCode: ctx?.mccCode ?? '', mccName: ctx?.mccName ?? '' },
          {
            tempC: ctx?.lastTempDeci === null || ctx?.lastTempDeci === undefined ? null : cOfDeci(ctx.lastTempDeci),
            telemetry: telemetryVerdict(ctx?.lastAt ?? null, now, thresholds.silenceMinutes),
          },
          ctx?.custody
            ? { operatorUserId: ctx.custody.operatorUserId, operatorName: ctx.custody.operatorName, assignedAt: ctx.custody.assignedAt.toISOString() }
            : null,
        ),
        allowed: verdict.allowed,
        refusals: verdict.refusals,
        reason: trimmed.length > 0 ? trimmed : null,
      };
    }, { userId: actor.userId });
  }

  /**
   * Place the call.
   *
   * The client's Idempotency-Key is passed STRAIGHT THROUGH to the masked-call service, so a village tablet retrying on
   * a dropped connection cannot ring an operator twice. (`IdempotencyService` scopes every key by caller AND endpoint,
   * so one key used by two operations claims two independent slots — which is what makes reuse safe here rather than a
   * collision.)
   */
  async place(tenantId: string, actor: DairyActor, idemKey: string, unitId: string, reason: string, ip: string | null): Promise<BmcCallResult> {
    return timed(this.metrics, 'dairy.bmc_call', { tenant: tenantId }, async () => {
      // THE VERDICT IS RE-TAKEN HERE, against rows read now. The confirm screen's answer is minutes old, and custody can
      // change hands in those minutes — 6d-2 made that a first-class act. A confirm step is not an authorisation token.
      const gathered = await this.uow.run(tenantId, async (tx) => {
        const ctx = await this.units.callContext(tx, tenantId, unitId);
        const props = ctx?.unit.toProps();
        const verdict = callVerdict({
          canManage: actor.canManage,
          actorUserId: actor.userId,
          unit: ctx && props ? { id: props.id, mccId: props.mccId, mccCode: ctx.mccCode, mccName: ctx.mccName, isActive: props.isActive } : null,
          custody: ctx?.custody
            ? { operatorUserId: ctx.custody.operatorUserId, operatorName: ctx.custody.operatorName, assignedAt: ctx.custody.assignedAt.toISOString() }
            : null,
          reason,
        });
        return { ctx, verdict, mccId: props?.mccId ?? null, tempDeci: ctx?.lastTempDeci ?? null, lastAt: ctx?.lastAt ?? null };
      }, { userId: actor.userId });

      if (!gathered.verdict.allowed) throw new BmcCallRefusedError(gathered.verdict.refusals);
      const callee = gathered.verdict.calleeUserId as string;
      const trimmed = reason.trim();

      // The bridge. A provider that is down or unconfigured throws `MASKED_CALL_UNAVAILABLE` (a typed 503) and records
      // NOTHING — which lands the chain on W2523 with a reason, and leaves no audit row claiming a call was made.
      const call = await this.calls.initiate(tenantId, { userId: actor.userId, canManage: actor.canManage } as never, idemKey, {
        calleeUserId: callee,
        // 0165 §165.6: `bmc_unit` is in communication's own CONTEXT_TYPES, so this call is filed against the cooler it
        // was about instead of against nothing.
        contextType: 'bmc_unit',
        contextId: unitId,
      } as never) as { id: string };

      const placedAt = new Date();
      await this.uow.run(tenantId, async (tx) => {
        // W2521: *"confirming writes an audit-trail entry with actor, time and reason"* — and W2522's success screen
        // deep-links to exactly this row, by `entityType`/`entityId`, the way TENANT-6d-4's chains do.
        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action: 'dairy.bmc.operator_called',
          entityType: 'bmc_unit', entityId: unitId, reason: trimmed,
          newValue: {
            maskedCallId: call.id, calleeUserId: callee, mccId: gathered.mccId,
            tempC: gathered.tempDeci === null ? null : cOfDeci(gathered.tempDeci),
            lastReadingAt: gathered.lastAt === null ? null : gathered.lastAt.toISOString(),
          },
          ip,
        });
        await this.outbox.write(tx, {
          tenantId, aggregateType: 'bmc_unit', aggregateId: unitId, eventType: 'dairy.bmc_operator_called',
          payload: { v: 1, unitId, mccId: gathered.mccId, maskedCallId: call.id, calleeUserId: callee, reason: trimmed },
        });
      }, { userId: actor.userId });

      this.metrics.inc('dairy.bmc_call.placed', { tenant: tenantId });
      return { maskedCallId: call.id, unitId, calleeUserId: callee, reason: trimmed, placedAt: placedAt.toISOString() };
    });
  }

  /**
   * WHAT THIS ACT STILL CANNOT DO, named rather than implied.
   *
   *   • **A call that fails leaves no record.** `MaskedCallService` degrades and records nothing when the provider
   *     refuses, so *"repeated failures page the on-call"* (W2523) has nothing to count — the same gap TENANT-6d-4
   *     named on the form chain, with the same cause: the record is written inside the act that failed.
   *   • **A call whose audit row fails to write still happened.** The bridge is a network act and cannot join the
   *     transaction that audits it. The masked-call log row is written by its own service in its own transaction, so
   *     the call is never invisible — but a crash between the two leaves a `masked_calls` row with no `audit_log` entry
   *     and no outbox event. Closing that needs the audit row to be reconciled FROM the call log (a job reading
   *     `masked_calls` for dairy contexts without a matching audit entry), which is a real thing to build and is not
   *     this wave.
   *   • **Nobody is called back.** There is no record of whether the operator answered: `masked_calls.duration_secs` is
   *     filled by the provider's status webhook, and until that webhook is wired for this provider the log says a call
   *     was requested, not that it connected.
   */
  static notes(): readonly string[] {
    return ['failed_call_unrecorded', 'audit_after_bridge', 'answer_unknown'] as const;
  }
}
