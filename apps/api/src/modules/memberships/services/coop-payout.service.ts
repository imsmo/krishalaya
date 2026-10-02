// modules/memberships/services/coop-payout.service.ts · PC-55 A8, PC-56 TENANT-9b. A PASSED dividend vote becomes money owed.
// THE GUARDS (this is a co-op's own money being split between its members):
//  1. ONLY A CLOSED dividend-class resolution whose RECORDED outcome is `passed` pays (9b — it was "closed or activated":
//     a FAILED vote paid, and `activated` is a status nothing writes). 0182's trigger holds the same rule underneath.
//  2. MAKER ≠ CHECKER, AS TWO ACTS (9b). The maker PREPARES (a `prepared` run — the formula, the total, the members — no
//     batch, no payout row); a DIFFERENT person CONFIRMS, and the confirming caller IS the checker. Before 9b the "checker"
//     was a uuid in the maker's own request body and never acted. 0182: `ck_cpr_checker_is_not_maker`.
//  3. ONE RUN PER RESOLUTION — the 0088 unique index, so one vote can never pay twice.
//  4. A POT must be met EXACTLY (largest-remainder split); a RATE pays floor(basis × rate) per member (the total IS the
//     sum). The confirm re-computes and refuses if the run DRIFTED from what was prepared.
//  5. NOTHING EXECUTES. The confirm writes a `payout_batches` row `open` and `payouts` rows `queued` (0088's `dividend` /
//     `patronage_bonus` purposes) — behind TENANT-4b's two-person batch gate (0143) and 0125's per-role KYC preflight
//     (dividend → farmer, dairy_farmer, pashupalak; there is no `member` role). No new money path (Law 2).
// Members with no penny-verified bank account are SKIPPED BY NAME, never silently dropped, so the co-op can chase them.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { CoopPayoutRepository, PayableMember } from '../repositories/coop-payout.repository';
import { parseFormula, allocate, allocationsSumTo, allocationsTotal, canConfirmRun, hasPot, resolutionPayable, CoopFormula } from '../domain/coop-payout.rules';
import { fiscalYearWindow } from '../domain/resolution-rules';
import { PayoutRunDriftedError, PayoutRunMakerCheckerError, ResolutionNotPayableError } from '../domain/memberships.errors';

export interface CoopPayoutActor { userId: string; canManage: boolean }

/** The basis the formula reads, named on the run's snapshot so a member can be told what their figure was a share OF. */
function basisOf(f: CoopFormula, fyMonth: number | null): { kind: 'rolling_365' } | { kind: 'share_register' } | { kind: 'fiscal_year'; from: string; toExclusive: string } {
  if (f.mode === 'per_share_rate') return { kind: 'share_register' };
  if (f.mode === 'patronage_pct') {
    if (fyMonth === null) throw new ResolutionNotPayableError('fy_not_declared', 'this formula pays a share of the fiscal year\'s business, and the cooperative has no declared fiscal year (finance.fiscal_year_start_month)');
    return { kind: 'fiscal_year', ...fiscalYearWindow(f.fiscalYear, fyMonth) };
  }
  return { kind: 'rolling_365' };
}
const basisLabel = (b: ReturnType<typeof basisOf>) => b.kind === 'share_register' ? 'share_register_holding_value'
  : b.kind === 'fiscal_year' ? `paid_milk_bills_fy[${b.from},${b.toExclusive})` : 'paid_milk_bills_365d';

@Injectable()
export class CoopPayoutService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly repo: CoopPayoutRepository,
    private readonly audit: AuditWriter,
  ) {}
  private assert(a: CoopPayoutActor) { if (!a.canManage) throw new ForbiddenError('requires tenant.settings'); }

  /** DRY RUN: what would each member get? Same arithmetic, zero writes — a board should always be able to look before it pays. */
  async preview(tenantId: string, a: CoopPayoutActor, resolutionId: string) {
    this.assert(a);
    const c = await this.compute(tenantId, resolutionId);
    return {
      resolution: { id: resolutionId, title: c.title, purpose: c.purpose },
      formula: c.formula, basis: basisLabel(c.basis), currencyCode: c.currency,
      totalMinor: c.total,
      payable: c.allocations.filter((x) => BigInt(x.amountMinor) > 0n).length,
      zeroShare: c.allocations.filter((x) => BigInt(x.amountMinor) === 0n).length,
      memberCount: c.members.length,
      skipped: c.skipped,
      lines: c.allocations.slice(0, 500),
      note: 'Preview only — nothing has been queued or paid.',
    };
  }

  /** THE MAKER'S ACT: a prepared run. No batch, no payout row — a different person confirms it. */
  async prepare(tenantId: string, a: CoopPayoutActor, resolutionId: string, key: string, ip: string | null) {
    this.assert(a);
    const c = await this.compute(tenantId, resolutionId);
    const runId = uuidv7();
    return this.uow.run(tenantId, async (tx) => {
      const res = await this.repo.lockResolution(tx, tenantId, resolutionId);
      if (!res) throw new NotFoundError('resolution not found');
      const payable = resolutionPayable(res.status, res.resolution_type, res.outcome);
      if (!payable.ok) throw new ResolutionNotPayableError(payable.reason, payable.error);
      let ins: Awaited<ReturnType<CoopPayoutRepository['insertPreparedRun']>>;
      try {
        ins = await this.repo.insertPreparedRun(tx, {
          id: runId, tenantId, resolutionId, purposeCode: payable.purpose,
          formulaSnapshot: { ...c.formula, basis: basisLabel(c.basis) },
          totalMinor: c.queuedTotal, memberCount: c.queued.length, skippedCount: c.skipped.length, skippedDetail: c.skipped,
          currencyCode: c.currency, preparedBy: a.userId, idempotencyKey: key,
        });
      } catch (e) {
        if ((e as { code?: string }).code === '23514') throw new ResolutionNotPayableError('database_refused', 'the database refused a run on this resolution (0182: closed, dividend-class, passed)');
        throw e;
      }
      if (!ins.ok) {
        throw new ConflictError(ins.conflict === 'replay'
          ? 'this payout run was already recorded (idempotency-key replay)'
          : 'this resolution already has a payout run — one vote pays once');
      }
      await this.audit.write(tx, {
        tenantId, actorUserId: a.userId, action: 'governance.coop_payout_run_prepared', entityType: 'coop_payout_run', entityId: runId,
        oldValue: null,
        newValue: { resolutionId, purpose: payable.purpose, formula: c.formula, basis: basisLabel(c.basis), queuedTotalMinor: c.queuedTotal, queuedCount: c.queued.length, skippedCount: c.skipped.length },
        reason: `${payable.purpose} run prepared from resolution '${res.title}'`, ip,
      });
      return { id: runId, status: 'prepared' as const, purpose: payable.purpose, totalMinor: c.queuedTotal, queuedCount: c.queued.length, skipped: c.skipped,
        note: 'Prepared. A second person confirms it; until then no batch exists and nobody is owed anything.' };
    }, { userId: a.userId });
  }

  /** THE CHECKER'S ACT: a different person re-computes, and — only if nothing moved — the batch and the queued payouts exist. */
  async confirm(tenantId: string, a: CoopPayoutActor, runId: string, ip: string | null) {
    this.assert(a);
    const batchId = uuidv7();
    // Read the run outside to compute (a whole-roll read must not hold the run's lock), then re-check under it.
    const head = await this.uow.run(tenantId, (tx) => this.repo.lockRun(tx, tenantId, runId), { userId: a.userId });
    if (!head) throw new NotFoundError('payout run not found');
    if (!canConfirmRun(head.prepared_by ?? null, a.userId)) throw new PayoutRunMakerCheckerError();
    const c = await this.compute(tenantId, head.resolution_id);
    return this.uow.run(tenantId, async (tx) => {
      const run = await this.repo.lockRun(tx, tenantId, runId);
      if (!run) throw new NotFoundError('payout run not found');
      if (run.status !== 'prepared') throw new ConflictError(`this run is ${run.status}, not prepared`);
      if (!canConfirmRun(run.prepared_by ?? null, a.userId)) throw new PayoutRunMakerCheckerError();
      if (String(run.total_minor) !== c.queuedTotal || Number(run.member_count) !== c.queued.length) {
        throw new PayoutRunDriftedError({ preparedTotalMinor: String(run.total_minor), nowTotalMinor: c.queuedTotal, preparedCount: Number(run.member_count), nowCount: c.queued.length });
      }
      await this.repo.insertBatch(tx, { id: batchId, tenantId, batchType: `coop_${run.purpose_code}`, totalMinor: c.queuedTotal, count: c.queued.length });
      for (const q of c.queued) {
        await this.repo.insertPayout(tx, {
          id: uuidv7(), tenantId, userId: q.userId, bankAccountId: q.bankAccountId, purposeCode: run.purpose_code,
          runId, amountMinor: q.amountMinor, currencyCode: c.currency, batchId,
        });
      }
      if (!(await this.repo.confirmRun(tx, tenantId, runId, a.userId, batchId))) throw new PayoutRunMakerCheckerError();
      await this.audit.write(tx, {
        tenantId, actorUserId: a.userId, action: 'governance.coop_payout_run_confirmed', entityType: 'coop_payout_run', entityId: runId,
        oldValue: { status: 'prepared', preparedBy: run.prepared_by },
        newValue: { status: 'queued', batchId, confirmedBy: a.userId, queuedTotalMinor: c.queuedTotal, queuedCount: c.queued.length },
        reason: 'checker confirmed the prepared run', ip,
      });
      return {
        id: runId, batchId, status: 'queued' as const, purpose: run.purpose_code, queuedTotalMinor: c.queuedTotal, queuedCount: c.queued.length, skipped: c.skipped,
        execution: {
          executed: false,
          note: 'Payouts are QUEUED in an open batch. The batch is approved by two people on the payout desk and moves only when '
              + 'the platform payout pipeline runs with live RazorpayX credentials; until then no money has left the co-op.',
        },
      };
    }, { userId: a.userId });
  }

  async cancel(tenantId: string, a: CoopPayoutActor, runId: string, reason: string, ip: string | null) {
    this.assert(a);
    const r = reason.trim();
    if (r.length < 3 || r.length > 300) throw new BadRequestError('a reason (3–300 characters) is required to cancel a prepared run');
    return this.uow.run(tenantId, async (tx) => {
      if (!(await this.repo.cancelPreparedRun(tx, tenantId, runId, a.userId, r))) throw new ConflictError('only a prepared run can be cancelled — a queued one is the payout desk\'s');
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'governance.coop_payout_run_cancelled', entityType: 'coop_payout_run', entityId: runId,
        oldValue: { status: 'prepared' }, newValue: { status: 'cancelled' }, reason: r, ip });
      return { id: runId, status: 'cancelled' as const };
    }, { userId: a.userId });
  }

  runs(tenantId: string, a: CoopPayoutActor, limit = 50) { this.assert(a); return this.repo.listRuns(tenantId, limit); }
  async getRun(tenantId: string, a: CoopPayoutActor, id: string) {
    this.assert(a);
    const r = await this.repo.getRun(tenantId, id);
    if (!r) throw new NotFoundError('payout run not found');
    return r;
  }

  /** Shared arithmetic for preview, prepare and confirm (one code path, so a preview can never differ from the real split). */
  private async compute(tenantId: string, resolutionId: string) {
    const res = await this.uow.run(tenantId, async (tx) => {
      const r = await this.repo.lockResolution(tx, tenantId, resolutionId);
      if (!r) throw new NotFoundError('resolution not found');
      return r;
    }, { userId: 'system' });
    const payable = resolutionPayable(res.status, res.resolution_type, res.outcome);
    if (!payable.ok) throw new ResolutionNotPayableError(payable.reason, payable.error);
    const parsed = parseFormula(res.payload ?? {});
    if (!parsed.ok) throw new BadRequestError(parsed.error);
    const formula = parsed.value;
    const clock = await this.repo.moneyClock(tenantId);
    if (!clock.currency) throw new ResolutionNotPayableError('currency_unknown', 'the cooperative\'s country declares no currency — a payout with no currency cannot be written');
    const basis = basisOf(formula, clock.fyMonth);
    const members: PayableMember[] = await this.repo.payableMembers(tenantId, basis);
    if (members.length === 0) throw new ConflictError('this co-op has no members on this formula\'s basis to pay');
    const allocations = allocate(formula, members.map((m) => ({ userId: m.userId, basisMinor: m.basisMinor })));
    // GUARD 4 — a pot is met exactly or nothing is written.
    if (hasPot(formula) && !allocationsSumTo(allocations, formula.potMinor)) {
      throw new ConflictError('allocation did not sum to the resolution pot — refusing to write a partial run');
    }
    const bankByUser = new Map(members.map((m) => [m.userId, m.bankAccountId]));
    const skipped: Array<{ userId: string; reason: string }> = [];
    const queued: Array<{ userId: string; amountMinor: string; bankAccountId: string }> = [];
    for (const alloc of allocations) {
      if (BigInt(alloc.amountMinor) === 0n) { skipped.push({ userId: alloc.userId, reason: 'zero_share' }); continue; }
      const bank = bankByUser.get(alloc.userId) ?? null;
      if (!bank) { skipped.push({ userId: alloc.userId, reason: 'skipped_no_bank_account' }); continue; }
      queued.push({ userId: alloc.userId, amountMinor: alloc.amountMinor, bankAccountId: bank });
    }
    if (queued.length === 0) throw new ConflictError('no member could be queued (no verified bank accounts, or every share was zero) — nothing was written');
    const queuedTotal = queued.reduce((s, q) => s + BigInt(q.amountMinor), 0n).toString();
    return { formula, members, allocations, skipped, queued, queuedTotal, total: allocationsTotal(allocations), purpose: payable.purpose, title: res.title, basis, currency: clock.currency };
  }
}
