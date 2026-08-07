// apps/admin-api/src/modules/cells-ops/services/residency-migration.service.ts · W033/W034/W037/W038 (PC-56 ADMIN-8b).
//
// The four objects the canon deferred by name. `DataResidencyRulesService` is left in place and untouched — its posture
// report and its lock toggle are correct — and this service adds what was missing: the EVIDENCE the lock never produced,
// the pipeline W034 describes, the plan W037 could not store, and the checklist W038 enforces.
import { Injectable, Logger } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import type { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { ResidencyMigrationRepository } from '../repositories/residency-migration.repository';
import {
  attest, attestationClaim, canProvisionForCountry, crossBorderPosture, draftViolation,
  type RefusalReason,
} from '../domain/residency-evidence';
import {
  assertStartable, assertTransition, cleanupVerdict, dataHasMoved, freezeVerdict, inWindow, preflight,
  safetyHoldUntil, sourceStillHeld, verifyCopy, verifyPermitsCutover,
  DEFAULT_FREEZE_BUDGET_SECONDS, PIPELINE_EXECUTOR_EXISTS, PIPELINE_EXECUTOR_OWNER, SAFETY_HOLD_DAYS,
} from '../domain/migration-pipeline';
import { assertReason } from '../domain/map-approval';
import { CellNotFoundError, InvalidCellsInputError, PlacementNotFoundError } from '../domain/cells-ops.errors';

/** The attestation's default window. 90 days matches the DPDP reporting rhythm and is short enough that the coverage
 *  check has a real chance of being satisfied by a log that only started when 0117 landed. */
export const ATTESTATION_WINDOW_DAYS = 90;

@Injectable()
export class ResidencyMigrationService {
  private readonly log = new Logger(ResidencyMigrationService.name);

  constructor(
    private readonly pool: AdminPool,
    private readonly repo: ResidencyMigrationRepository,
    private readonly audit: AdminAuditWriter,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* W033 · RESIDENCY                                                        */
  /* ---------------------------------------------------------------------- */

  /** The residency board: country profiles, the cross-border posture, and the evidence log. */
  async residency(q: { days?: number; country?: string; cursor?: string; limit: number }) {
    const days = Math.min(Math.max(q.days ?? ATTESTATION_WINDOW_DAYS, 1), 400);
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);

    const [profiles, violations, since] = await Promise.all([
      this.repo.countryProfiles(),
      this.repo.listViolations({ from: from.toISOString(), to: to.toISOString(), country: q.country, cursor: decodeCursor(q.cursor), limit: q.limit }),
      this.repo.loggingSince(),
    ]);
    const last = violations[violations.length - 1];

    return {
      countries: profiles.map((p) => ({
        ...p,
        crossBorder: crossBorderPosture(p),
        // W038's market-entry gate, surfaced on the residency screen too — because the reason a country has no cell is a
        // residency fact before it is an infrastructure one.
        canProvision: canProvisionForCountry(p),
      })),
      violations,
      nextCursor: violations.length === q.limit && last
        ? Buffer.from(`${last.createdAt}|${last.id}`).toString('base64') : null,
      window: { from: from.toISOString(), to: to.toISOString(), days },
      // **WHEN THE LOG STARTED, ALWAYS RETURNED.** An empty list means one of two opposite things — nothing was attempted,
      // or nothing was recorded — and until 0117 it always meant the second. `since === null` is the console's signal that
      // the screen's own "no violations logged" copy would be an assurance from silence.
      loggingSince: since,
    };
  }

  /** The attestation W033 offers as an export.
   *
   *  **IT ASSERTS A NEGATIVE, WHICH IS WHY THE COVERAGE CHECK COMES FIRST.** Under DPDP the claim is "no personal data left
   *  the country", and a negative is evidenced by a complete record of attempts — never by the absence of a record. A
   *  window reaching back before the log existed returns `no_evidence` rather than a clean verdict, which is the honest
   *  answer and was the platform's true state for its entire life until this wave.
   */
  async attestation(actor: AdminRequestContext, q: { days?: number }) {
    const days = Math.min(Math.max(q.days ?? ATTESTATION_WINDOW_DAYS, 1), 400);
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const [{ rows, truncated }, since] = await Promise.all([
      this.repo.violationsForAttestation(from.toISOString(), to.toISOString()),
      this.repo.loggingSince(),
    ]);

    if (truncated) {
      // An attestation computed over a prefix would assert a negative about attempts it never saw — the one failure this
      // document cannot survive.
      throw new InvalidCellsInputError(
        'there are more recorded attempts in this window than one attestation can examine. Narrow the window: an '
        + 'attestation computed over part of the record would assert a negative about attempts it never read.');
    }

    const result = attest(rows, from.toISOString(), to.toISOString(), since);
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'cells.residency.attested', entityType: 'residency_violations', entityId: null,
      newValue: { kind: result.kind, from: from.toISOString(), to: to.toISOString(), attempts: rows.length },
      ip: actor.ip, requestId: actor.requestId || null,
    });

    return {
      attestation: result,
      claim: attestationClaim(result),
      // **NOT SIGNED.** W033 calls this an attestation and there is still no signing key on this platform — the same gap
      // W018, W039, W064 and W084 name. ADMIN-5c's content digest is available and is not a signature, and a document
      // labelled "signed attestation" without one would be worse than an unsigned honest record.
      signed: false,
      signingGap: 'no signing key exists on this platform; this is an unsigned record of the evidence',
    };
  }

  /** Record a refused cross-border attempt.
   *
   *  **CALLED OUTSIDE THE CALLER'S TRANSACTION, ON PURPOSE.** The caller is about to throw, and recording evidence inside
   *  the transaction that aborts writes evidence that rolls back with it — the single easiest way to build this table and
   *  have it stay empty. The repository takes no `PoolClient` for exactly this reason.
   */
  async recordRefusal(actor: AdminRequestContext | null, v: {
    attemptKind: 'move' | 'place' | 'read' | 'export';
    subjectType: string; subjectId: string;
    fromCountry: string | null; toCountry: string | null;
    fromCellId: string | null; toCellId: string | null;
    refusedBy: RefusalReason;
    detail?: Record<string, unknown>;
  }) {
    const draft = draftViolation({
      ...v, outcome: 'blocked',
      actorAdminId: actor?.userId ?? null,
      detail: v.detail ?? {},
    });
    const id = await this.repo.recordViolation(draft);
    this.log.warn(`residency boundary held: ${v.attemptKind} ${v.subjectType}/${v.subjectId} ${v.fromCountry}→${v.toCountry} refused by ${v.refusedBy}`);
    return { id };
  }

  async setCountryProfile(actor: AdminRequestContext, code: string, body: { profile: string; status: string; note?: string }) {
    if (body.status === 'ratified' && !body.profile.trim()) {
      throw new InvalidCellsInputError('a ratified profile must be named — `ck_countries_regulation_named` refuses it otherwise');
    }
    return this.pool.withTx(async (c) => {
      const moved = await this.repo.setCountryProfile(c, code.toUpperCase(), {
        profile: body.profile.trim(), status: body.status, note: body.note?.trim() ?? null,
      });
      if (!moved) throw new InvalidCellsInputError('no such country');
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'cells.residency.profile_set', entityType: 'country', entityId: code.toUpperCase(),
        newValue: { profile: body.profile.trim(), status: body.status },
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return { code: code.toUpperCase(), profile: body.profile.trim(), status: body.status };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* W034 · THE MIGRATION PIPELINE                                          */
  /* ---------------------------------------------------------------------- */

  async listJobs(q: { status?: string; cursor?: string; limit: number }) {
    const rows = await this.repo.listJobs({ status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit });
    const last = rows[rows.length - 1];
    const now = Date.now();
    return {
      items: rows.map((j) => ({
        ...j,
        dataHasMoved: dataHasMoved(j.status),
        sourceStillHeld: sourceStillHeld(j.status, j.sourceCleanedAt),
        inWindow: inWindow(now, j.windowStart, j.windowEnd),
        cleanup: cleanupVerdict(j.status, j.safetyHoldUntil, j.sourceCleanedAt, now),
      })),
      nextCursor: rows.length === q.limit && last
        ? Buffer.from(`${last.createdAt}|${last.id}`).toString('base64') : null,
      // **THE PIPELINE IS DESIGNED AND NOT RUNNING**, returned on every list so no surface can render `queued` as though
      // something were about to pick it up. Five status columns on this platform have already recorded acts nobody
      // performs; a seven-state pipeline would be the sixth and largest.
      executor: { exists: PIPELINE_EXECUTOR_EXISTS, owner: PIPELINE_EXECUTOR_OWNER },
    };
  }

  async getJob(id: string) {
    const j = await this.repo.getJob(id);
    if (!j) return null;
    const steps = await this.repo.jobSteps(id);
    const now = Date.now();
    return {
      ...j,
      steps,
      dataHasMoved: dataHasMoved(j.status),
      sourceStillHeld: sourceStillHeld(j.status, j.sourceCleanedAt),
      inWindow: inWindow(now, j.windowStart, j.windowEnd),
      freeze: freezeVerdict(j.freezeStartedAt, j.freezeEndedAt, j.freezeBudgetSeconds, now),
      cleanup: cleanupVerdict(j.status, j.safetyHoldUntil, j.sourceCleanedAt, now),
      safetyHoldDays: SAFETY_HOLD_DAYS,
      executor: { exists: PIPELINE_EXECUTOR_EXISTS, owner: PIPELINE_EXECUTOR_OWNER },
    };
  }

  /** Draft a move. **THE RESIDENCY CHECK RECORDS THE ATTEMPT BEFORE IT REFUSES.** */
  async draftJob(actor: AdminRequestContext, body: {
    tenantId: string; toCellId: string; toShardId: string;
    windowStart?: string; windowEnd?: string; reason: string;
  }) {
    assertReason(body.reason, 'a tenant move');
    const placement = await this.repo.placementOf(body.tenantId);
    if (!placement) throw new PlacementNotFoundError(body.tenantId);
    const target = await this.repo.cellCountry(body.toCellId);
    if (!target) throw new CellNotFoundError(body.toCellId);

    if (target.countryCode !== placement.countryCode) {
      // RECORDED FIRST, IN ITS OWN TRANSACTION, THEN REFUSED. W033's "This log fills automatically if the fail-closed
      // boundary is ever tested" is true from here on — and it was true of nothing before.
      await this.recordRefusal(actor, {
        attemptKind: 'move', subjectType: 'tenant', subjectId: body.tenantId,
        fromCountry: placement.countryCode, toCountry: target.countryCode,
        fromCellId: placement.cellId, toCellId: body.toCellId,
        refusedBy: target.residencyLocked ? 'residency_lock' : 'country_mismatch',
        detail: { reason: body.reason.trim() },
      });
      throw new InvalidCellsInputError(
        `this move crosses a residency border (${placement.countryCode} → ${target.countryCode}). There is no override in `
        + 'this console: a cross-border move needs a signed legal basis and a schema-level policy change. The attempt has '
        + 'been recorded in the residency log.');
    }

    return this.pool.withTx(async (c) => {
      let id: string;
      try {
        id = await this.repo.insertJob(c, {
          tenantId: body.tenantId,
          fromCellId: placement.cellId, fromShardId: placement.shardId,
          toCellId: body.toCellId, toShardId: body.toShardId,
          windowStart: body.windowStart ?? null, windowEnd: body.windowEnd ?? null,
          createdByAdminId: actor.userId,
        });
      } catch (e) {
        // `uq_mj_one_active_per_tenant`. Two concurrent migrations of one tenant would each believe they own the placement
        // row, and the second cutover would flip a placement the first had already moved.
        if (String((e as { code?: string }).code) === '23505') {
          throw new InvalidCellsInputError('this tenant already has a migration in progress');
        }
        throw e;
      }
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'cells.migration.drafted', entityType: 'migration_job', entityId: id,
        newValue: { tenantId: body.tenantId, from: placement.cellId, to: body.toCellId },
        reason: body.reason.trim(), ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, status: 'queued' as const };
    });
  }

  /** Run and record the preflight. Inputs come from cross-plane reads that may fail — and a check that could not run is
   *  reported as UNKNOWN rather than as a pass. */
  async runPreflight(actor: AdminRequestContext, id: string, observed: {
    openPayouts: number | null; liveAuctions: number | null; outboxPending: number | null;
    estimatedBytes: number | null; windowBudgetBytes: number | null;
  }) {
    const job = await this.repo.getJob(id);
    if (!job) throw new InvalidCellsInputError('no such migration job');
    const result = preflight(observed);
    return this.pool.withTx(async (c) => {
      await this.repo.recordPreflight(c, id, result as unknown as Record<string, unknown>);
      await this.repo.addStep(c, {
        jobId: id, step: 'preflight', outcome: result.pass ? 'passed' : 'failed',
        evidence: observed as unknown as Record<string, unknown>,
        detail: result.pass ? null : `blocking: ${result.blocking.join(', ') || 'none'}; unknown: ${result.unknown.join(', ') || 'none'}`,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'cells.migration.preflight', entityType: 'migration_job', entityId: id,
        newValue: { pass: result.pass, blocking: result.blocking, unknown: result.unknown },
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return result;
    });
  }

  /** The checker's approval. Separate from `cells.approve`'s map proposals because this authorises WORK rather than a
   *  configuration change — but the same rule applies and the constraint enforces it. */
  async approveJob(actor: AdminRequestContext, id: string) {
    return this.pool.withTx(async (c) => {
      const job = await this.repo.getJobForUpdate(c, id);
      if (!job) throw new InvalidCellsInputError('no such migration job');
      if (job.createdByAdminId && job.createdByAdminId === actor.userId) {
        throw new InvalidCellsInputError(
          'you drafted this migration, so you cannot approve it. Moving a tenant\'s live data between physical stacks '
          + 'needs a second operator.');
      }
      const moved = await this.repo.approveJob(c, id, actor.userId);
      if (!moved) throw new InvalidCellsInputError('this job is not queued, or was already approved');
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'cells.migration.approved', entityType: 'migration_job', entityId: id,
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, approved: true };
    });
  }

  /** Advance the pipeline by one state — the API an executor WOULD call, exposed so the state machine is exercised and
   *  auditable before the executor exists. Every transition is checked, and `cutover` additionally requires a verify. */
  async advance(actor: AdminRequestContext, id: string, to: string, evidence: Record<string, unknown> = {}) {
    return this.pool.withTx(async (c) => {
      const job = await this.repo.getJobForUpdate(c, id);
      if (!job) throw new InvalidCellsInputError('no such migration job');
      assertTransition(job.status, to);

      if (to === 'copying') {
        assertStartable({
          status: job.status,
          preflight: (job.preflight ?? { pass: false, checks: [], blocking: [], unknown: ['within_window_budget'] }) as never,
          waived: (evidence.waived as { check: string; reason: string }[] | undefined) ?? [],
          approvedByAdminId: job.approvedByAdminId,
        });
      }

      if (to === 'cutover') {
        const v = verifyCopy({
          sourceRows: numOrNull(evidence.sourceRows), targetRows: numOrNull(evidence.targetRows),
          sourceLedgerMinor: strOrNull(evidence.sourceLedgerMinor), targetLedgerMinor: strOrNull(evidence.targetLedgerMinor),
        });
        if (!verifyPermitsCutover(v)) {
          // The verify is what stands between a copy and a cutover, and an `incomplete` is a refusal rather than a shrug:
          // cutting over on an unread ledger sum would be moving a farmer's money on the strength of a row count.
          throw new InvalidCellsInputError(
            `the verify did not match (${v.kind}), so the cutover is refused. W034's rule is that the source stays `
            + 'authoritative until cutover commits — and it only commits over a copy that matched on rows AND on the '
            + 'ledger sum.');
        }
        await this.repo.addStep(c, { jobId: id, step: 'verify', outcome: 'passed', evidence, detail: null });
      }

      const extra: { rollbackReason?: string; safetyHoldUntil?: string; failureDetail?: string } = {};
      if (to === 'rolled_back') {
        const reason = String(evidence.rollbackReason ?? '').trim();
        if (reason.length < 10) throw new InvalidCellsInputError('a rollback needs a reason of at least 10 characters');
        extra.rollbackReason = reason;
      }
      if (to === 'failed') extra.failureDetail = String(evidence.failureDetail ?? '').trim() || 'no detail recorded';
      // The safety hold starts when the cutover commits, which is the moment the target became authoritative.
      if (to === 'done') extra.safetyHoldUntil = safetyHoldUntil(Date.now());

      const moved = await this.repo.setJobStatus(c, id, job.status, to, extra);
      if (!moved) throw new InvalidCellsInputError('this job changed state while you were acting on it');

      await this.repo.addStep(c, {
        jobId: id, step: stepFor(to), outcome: to === 'rolled_back' || to === 'failed' ? 'failed' : 'passed',
        evidence, detail: extra.rollbackReason ?? extra.failureDetail ?? null,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'cells.migration.advanced', entityType: 'migration_job', entityId: id,
        oldValue: { status: job.status }, newValue: { status: to },
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, status: to };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* W037 · THE PLAN                                                         */
  /* ---------------------------------------------------------------------- */

  async plan() {
    return {
      steps: await this.repo.listPlanSteps(),
      // The forecast is NOT here and says so. ADMIN-8 computes the observed rate and the 70% trigger; predicting WHEN a
      // trigger fires is DELTA-013 proper.
      forecast: { available: false, delta: 'DELTA-013', owner: 'ADMIN-8b-Q2' },
      note: 'these are PLANS whose triggers are conditions, not dates — a plan survives a slow quarter; a calendar entry goes stale',
    };
  }

  async addPlanStep(actor: AdminRequestContext, body: {
    cellId?: string; targetCode?: string; action: string; addsCapacity?: number;
    triggerSpec: Record<string, unknown>; status: string; gateReason?: string; notes?: string;
  }) {
    if (!body.cellId && !body.targetCode) {
      throw new InvalidCellsInputError('a plan step either extends an existing cell or names a new one');
    }
    if (body.status === 'gated' && (body.gateReason ?? '').trim().length < 10) {
      throw new InvalidCellsInputError('a gated step must name what gates it — "gated" with no reason is a decision nobody wrote down');
    }
    if (!body.triggerSpec || typeof body.triggerSpec !== 'object' || !('kind' in body.triggerSpec)) {
      throw new InvalidCellsInputError('a plan step needs a trigger with a kind — a step with no condition is a calendar entry');
    }
    return this.pool.withTx(async (c) => {
      const id = await this.repo.insertPlanStep(c, {
        cellId: body.cellId ?? null, targetCode: body.targetCode ?? null,
        action: body.action, addsCapacity: body.addsCapacity ?? null,
        triggerSpec: body.triggerSpec, status: body.status,
        gateReason: body.gateReason?.trim() ?? null, notes: body.notes?.trim() ?? null,
        createdByAdminId: actor.userId,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'cells.plan.step_added', entityType: 'scale_plan_step', entityId: id,
        newValue: { action: body.action, status: body.status }, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* W038 · PROVISIONING                                                     */
  /* ---------------------------------------------------------------------- */

  async provisioning() {
    const [runs, profiles] = await Promise.all([
      this.repo.listProvisioningRuns(),
      this.repo.countryProfiles(),
    ]);
    return {
      runs,
      countries: profiles.map((p) => ({ code: p.code, name: p.name, canProvision: canProvisionForCountry(p) })),
      // W038: "Terraform plan runs in CI; apply is a founder-approved pipeline step — this console never holds cloud
      // credentials." Stated in the response so no surface renders an Apply button.
      infra: { appliedByConsole: false, note: 'infrastructure is applied by a founder-approved pipeline; this console records the checklist' },
    };
  }

  async startProvisioning(actor: AdminRequestContext, body: { targetCode: string; countryCode: string }) {
    const profiles = await this.repo.countryProfiles();
    const p = profiles.find((x) => x.code === body.countryCode.toUpperCase());
    if (!p) throw new InvalidCellsInputError('no such country');
    const gate = canProvisionForCountry(p);
    if (!gate.ok) {
      // W038's market-entry gate, enforced. A draft profile is not a profile — provisioning under one would mean the
      // residency lock enforcing a rule nobody has ratified.
      await this.recordRefusal(actor, {
        attemptKind: 'place', subjectType: 'cell', subjectId: body.targetCode,
        fromCountry: null, toCountry: body.countryCode.toUpperCase(),
        fromCellId: null, toCellId: null,
        refusedBy: 'profile_not_ratified',
        detail: { reason: gate.reason },
      }).catch(() => undefined);   // the refusal record must never mask the refusal itself
      throw new InvalidCellsInputError(gate.reason);
    }
    return this.pool.withTx(async (c) => {
      const id = await this.repo.insertProvisioningRun(c, {
        targetCode: body.targetCode, countryCode: body.countryCode.toUpperCase(), createdByAdminId: actor.userId,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'cells.provisioning.started', entityType: 'cell_provisioning_run', entityId: id,
        newValue: { targetCode: body.targetCode, countryCode: body.countryCode.toUpperCase() },
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, status: 'drafting' as const };
    });
  }

  async recordSmoke(actor: AdminRequestContext, id: string, outcome: 'passed' | 'failed', detail: Record<string, unknown>) {
    return this.pool.withTx(async (c) => {
      const moved = await this.repo.recordSmoke(c, id, outcome, detail);
      if (!moved) throw new InvalidCellsInputError('no such provisioning run, or it is already open');
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'cells.provisioning.smoke', entityType: 'cell_provisioning_run', entityId: id,
        newValue: { outcome }, ip: actor.ip, requestId: actor.requestId || null,
      });
      // W038: "Synthetic order could not complete payout leg — cell stays closed." `ck_cpr_open_needs_smoke` makes that a
      // database fact rather than a screen's promise.
      return { id, smokeOutcome: outcome, canOpen: outcome === 'passed' };
    });
  }
}

function decodeCursor(c?: string): { c: string; id: string } | undefined {
  if (!c) return undefined;
  const [ts, id] = Buffer.from(c, 'base64').toString('utf8').split('|');
  return ts && id ? { c: ts, id } : undefined;
}
function numOrNull(v: unknown): number | null { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
function strOrNull(v: unknown): string | null { return typeof v === 'string' && v !== '' ? v : null; }
function stepFor(status: string): string {
  switch (status) {
    case 'copying': return 'copy';
    case 'verifying': return 'verify';
    case 'cutover': return 'cutover';
    case 'done': return 'cleanup';
    case 'rolled_back': return 'rollback';
    default: return 'preflight';
  }
}

export { DEFAULT_FREEZE_BUDGET_SECONDS };
