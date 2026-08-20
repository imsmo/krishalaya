// modules/dairy/services/dairy-bill-cycle.service.ts · PC-56 TENANT-6c-1 · the cycle's three acts, per tenant.
//
//   ensureCycles → the window that just ended and the one running now exist as ROWS (with a close instant resolved
//                  from the cooperative's own timezone and a payday from its own setting)
//   closeDue     → any open cycle past its close instant becomes `closed`, with the instant recorded
//   buildBills   → every closed cycle without bills gets one DRAFT bill per member who poured into it
//
// IT MOVES NO MONEY. A draft bill is an arithmetic statement; preview, approve and pay stay human acts. That is why
// this can run on a clock at all, and why the flag it sits behind gates the CADENCE rather than the settlement.
//
// TRANSACTION SHAPE, deliberately not one big transaction: each cycle closes in its own unit of work, and each
// membership's bill is generated in its own (`MilkBillService.generate` opens one). 312 bills inside a single
// transaction means one member's arithmetic error discards the other 311 and holds locks on a partitioned money table
// for the duration. Per-item isolation is the same guarantee the D2C cadence job gives between tenants, extended
// between members — and it is what makes a partially-failed run resumable rather than a thing an operator must
// untangle.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { DairyBillCycleRepository } from '../repositories/dairy-bill-cycle.repository';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { MilkBillService } from './milk-bill.service';
import { BillCycleNotFoundError, DairyForbiddenError } from '../domain/dairy.errors';
import { DairyActor } from './mcc-centre.service';
import { DairyBillCycle } from '../domain/dairy-bill-cycle.entity';
import { windowsToEnsure } from '../domain/dairy-cycle';
import { DomainEvent } from '../domain/dairy.events';

/** Error codes that mean "nothing to bill here", not "something went wrong". */
const SKIP_CODES = new Set([
  'EMPTY_BILL',        // the member did not pour into this window
  'BILL_NOT_PAYABLE',  // a bill for this (membership, period) already exists — the UNIQUE index doing its job
  // [PC-56 TENANT-6c-1] The orphaned job's skip list was `EMPTY_BILL` / `BILL_NOT_PAYABLE` only, so every member
  // whose pours were ALL under a quality hold — the state TENANT-6b-1 built on purpose — would have been counted as a
  // FAILURE and paged somebody. A held pour is the system working.
  'ALL_POURS_HELD',
]);

export interface CycleTickResult { ensured: number; closed: number; cyclesBilled: number; generated: number; skipped: number; stranded: number; failed: number }

@Injectable()
export class DairyBillCycleService {
  private readonly log = new Logger(DairyBillCycleService.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly cycles: DairyBillCycleRepository,
    private readonly collections: MilkCollectionRepository,
    private readonly bills: MilkBillService,
    // [PC-56 TENANT-6c-2] The preview pass reads the cycle's own DRAFT bills and writes each one's window.
    private readonly billRepo: MilkBillRepository,
    private readonly memberships: DairyMembershipRepository,
  ) {}

  /**
   * W169's HEADER BUTTON: *"Preview cycle 01–15 Jul (Wed close)"*.
   *
   * ONE ACT, 312 BILLS, AND DELIBERATELY NOT ONE TRANSACTION. Each bill is previewed in its own unit of work, for the
   * reason 0157's header gives for generation and which is stronger here: the per-bill work QUEUES AN SMS to a
   * different family each time, so a failure on member 280 must not roll back 279 messages that are already in the
   * outbox — and must not send them twice on the retry either, which is why the claim query asks for `draft` bills and
   * a previewed bill is therefore no longer claimed.
   *
   * The CYCLE moves to `previewed` FIRST, in its own transaction. That ordering is the honest one: the cycle's status
   * is the operator's answer to "did I press the button?", and a cycle left `closed` after 200 members had already been
   * texted would invite a second press. `bills_previewed` is how far the pass got; calling it again finishes the job.
   */
  async previewCycle(tenantId: string, actor: DairyActor, cycleId: string, limit = 500, now = new Date()): Promise<{ previewed: number; failed: number; remaining: number }> {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    // [PC-56 TENANT-6c-3] W169 names `settlement.close` on PREVIEW as well as approve, and 6c-2 shipped this act behind
    // `dairy.manage` alone. Telling 312 families what they are about to be paid is the act that fixes the figures.
    if (!actor.canCloseSettlement) throw new DairyForbiddenError('requires settlement.close — previewing a cycle takes the second key, not just the dairy desk');
    return timed(this.metrics, 'dairy.cycle_preview', { tenant: tenantId }, async () => {
      // 1. The cycle-level decision, recorded once. Re-pressing the button on an already-previewed cycle is NOT an
      //    error — it is how a partial pass is finished — so the transition is skipped rather than refused.
      const before = await this.uow.run(tenantId, async (tx) => {
        const cycle = await this.cycles.getForUpdate(tx, tenantId, cycleId);
        if (!cycle) throw new BillCycleNotFoundError(cycleId);
        if (cycle.status === 'closed') {
          cycle.preview(now, actor.userId);
          await this.cycles.updateState(tx, cycle);
          await this.flush(tx, tenantId, cycle);
        }
        return cycle;
      }, { userId: actor.userId });

      // 2. The per-bill pass. Bounded, resumable, one transaction each.
      const drafts = await this.uow.run(tenantId, (tx) => this.billRepo.draftsForCycle(tx, tenantId, cycleId, limit), { userId: actor.userId });
      let previewed = 0, failed = 0;
      for (const draft of drafts) {
        try {
          await this.bills.preview(tenantId, actor, draft.id, now);
          previewed += 1;
        } catch (e) {
          failed += 1;
          this.log.error(`dairy cycle preview failed for bill ${draft.id} (tenant ${tenantId}, cycle ${cycleId}): ${(e as Error).message}`);
        }
      }

      // 3. What the pass achieved, and what is LEFT — measured from the bills, not from this loop's own arithmetic,
      //    because a bill somebody previewed by hand between step 2 and here is still previewed.
      const counts = await this.billRepo.statusCountsForCycle(tenantId, cycleId);
      const remaining = Number(counts.draft ?? 0);
      await this.uow.run(tenantId, async (tx) => {
        const fresh = await this.cycles.getForUpdate(tx, tenantId, cycleId);
        if (!fresh) return;
        fresh.recordPreviewPass((before.toProps().billsPreviewed ?? 0) + previewed);
        await this.cycles.updateState(tx, fresh);
      }, { userId: actor.userId });

      return { previewed, failed, remaining };
    });
  }

  /**
   * The route's entry point: W169's button, wrapped in the platform's idempotency record (Law 3). A retried press on a
   * 2G connection replays the first response instead of running a second pass — and the pass itself is resumable
   * anyway, so neither path can double-send.
   */
  async previewCycleIdempotent(tenantId: string, actor: DairyActor, cycleId: string, idemKey: string) {
    return this.idem.remember(idemKey, actor.userId, 'dairy.cycle.preview', () => this.previewCycle(tenantId, actor, cycleId));
  }

  /**
   * [PC-56 TENANT-6c-3] THE SECOND SIGNATURE, over a whole cycle. W169: *"approved Thu evening (maker-checker)"*.
   *
   * Requires BOTH keys — `dairy.manage` (the desk) and `settlement.close` (0144's, granted to `tenant_admin`) — and the
   * approver must not be whoever previewed it. That last rule lives on the aggregate AND in a database constraint, and
   * it is unconditional: 0144's ruling was *"a cycle close is not an amount… Every one of them gets two humans"*, and a
   * milk cycle is a fortnight of 312 families' income.
   *
   * NOT gated on the dispute windows being shut. W169 approves on Thursday evening while the windows run to Friday
   * morning, and that is the right order: approval is the cooperative agreeing its own figures; it is the PAYMENT that
   * waits for the member (6c-2 put that guard on `markPaid`). `disputed` bills are simply not claimed by the pass —
   * *"disputed pauses one bill, never the cycle."*
   */
  async approveCycle(tenantId: string, actor: DairyActor, cycleId: string, limit = 500, now = new Date()): Promise<{ approved: number; failed: number; remaining: number; skippedDisputed: number }> {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    if (!actor.canCloseSettlement) throw new DairyForbiddenError('requires settlement.close — approving a cycle takes the second key, not just the dairy desk');
    return timed(this.metrics, 'dairy.cycle_approve', { tenant: tenantId }, async () => {
      // 1. The cycle-level decision. A re-press on an already-approved cycle finishes the per-bill pass rather than
      //    refusing, the same shape as the preview — but the CHECKER rule is evaluated on the first press only, because
      //    that is where the signature is recorded.
      const before = await this.uow.run(tenantId, async (tx) => {
        const cycle = await this.cycles.getForUpdate(tx, tenantId, cycleId);
        if (!cycle) throw new BillCycleNotFoundError(cycleId);
        if (cycle.status === 'previewed') {
          cycle.approve(now, actor.userId);
          await this.cycles.updateState(tx, cycle);
          await this.flush(tx, tenantId, cycle);
        }
        return cycle;
      }, { userId: actor.userId });

      // 2. The per-bill pass: one transaction each, bounded, resumable.
      const pending = await this.uow.run(tenantId, (tx) => this.billRepo.previewedForCycle(tx, tenantId, cycleId, limit), { userId: actor.userId });
      let approved = 0, failed = 0;
      for (const bill of pending) {
        try {
          await this.bills.approve(tenantId, actor, bill.id);
          approved += 1;
        } catch (e) {
          failed += 1;
          this.log.error(`dairy cycle approve failed for bill ${bill.id} (tenant ${tenantId}, cycle ${cycleId}): ${(e as Error).message}`);
        }
      }

      // 3. Measured from the bills, not from the loop. `remaining` is what still awaits a signature; `skippedDisputed`
      //    is the number W169's tile is about — bills held out because a member objected, which an operator must see
      //    rather than infer from a total that does not add up.
      const counts = await this.billRepo.statusCountsForCycle(tenantId, cycleId);
      const remaining = Number(counts.previewed ?? 0);
      const skippedDisputed = Number(counts.disputed ?? 0);
      await this.uow.run(tenantId, async (tx) => {
        const fresh = await this.cycles.getForUpdate(tx, tenantId, cycleId);
        if (!fresh) return;
        fresh.recordApprovalPass((before.toProps().billsApproved ?? 0) + approved);
        await this.cycles.updateState(tx, fresh);
      }, { userId: actor.userId });

      return { approved, failed, remaining, skippedDisputed };
    });
  }

  /** The route's entry point, wrapped in the platform's idempotency record (Law 3). */
  async approveCycleIdempotent(tenantId: string, actor: DairyActor, cycleId: string, idemKey: string) {
    return this.idem.remember(idemKey, actor.userId, 'dairy.cycle.approve', () => this.approveCycle(tenantId, actor, cycleId));
  }

  /** W169's list: this tenant's cycles with each one's bill counts MEASURED from its bills, not stored beside them. */
  async list(tenantId: string, actor: DairyActor, limit: number) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    const rows = await this.cycles.listFor(tenantId, { limit });
    return Promise.all(rows.map(async (c) => ({ ...c.toJSON(), bills: await this.billRepo.statusCountsForCycle(tenantId, c.id) })));
  }

  async getById(tenantId: string, actor: DairyActor, cycleId: string) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    const c = await this.uow.run(tenantId, (tx) => this.cycles.getForUpdate(tx, tenantId, cycleId), { userId: actor.userId });
    if (!c) throw new BillCycleNotFoundError(cycleId);
    return { ...c.toJSON(), bills: await this.billRepo.statusCountsForCycle(tenantId, cycleId) };
  }

  /**
   * One tenant's whole tick. Ordered so that a cycle can be created, closed and billed within a single pass — a
   * cooperative switched on the morning after a fortnight ended should not wait two ticks for its bills.
   */
  async tickForTenant(tenantId: string, now: Date, limit = 500): Promise<CycleTickResult> {
    return timed(this.metrics, 'dairy.cycle_tick', { tenant: tenantId }, async () => {
      const ensured = await this.ensureCycles(tenantId);
      const closed = await this.closeDue(tenantId, now);
      const built = await this.buildBills(tenantId, limit);
      return { ensured, closed, ...built };
    });
  }

  /**
   * Make sure the previous and current windows exist for every payment cycle this tenant's members actually use.
   *
   * Driven off `dairy_memberships.payment_cycle` rather than off a per-tenant setting, because that column is where
   * the answer already lives and a cooperative can genuinely run two cadences at once (a fortnightly village route
   * and a monthly bulk supplier). TENANT-6a had to take the MODE of this column to guess one window for a whole
   * screen; here every distinct value gets its own cycle, which is what the column always meant.
   */
  async ensureCycles(tenantId: string): Promise<number> {
    return this.uow.run(tenantId, async (tx) => {
      const today = await this.cycles.today(tx);
      const kinds = await this.cycles.activePaymentCycles(tx, tenantId);
      let n = 0;
      for (const cycle of kinds) {
        for (const w of windowsToEnsure(today, cycle)) {
          await this.cycles.ensure(tx, tenantId, w);
          n += 1;
        }
      }
      return n;
    }, { userId: 'system' });
  }

  /** Close every open cycle whose window has shut. One unit of work per cycle, so one bad row cannot hold the rest. */
  async closeDue(tenantId: string, now: Date, limit = 50): Promise<number> {
    const due = await this.uow.run(tenantId, (tx) => this.cycles.dueToClose(tx, tenantId, now, limit), { userId: 'system' });
    let closed = 0;
    for (const d of due) {
      try {
        await this.uow.run(tenantId, async (tx) => {
          // Re-read FOR UPDATE inside the writing transaction: the claim above was a plain read, and two pods (or a
          // pod and an operator) must not both close the same fortnight and both publish `dairy.cycle_closed`.
          const cycle = await this.cycles.getForUpdate(tx, tenantId, d.id);
          if (!cycle || cycle.status !== 'open') return;
          cycle.close(now);
          await this.cycles.updateState(tx, cycle);
          await this.flush(tx, tenantId, cycle);
          closed += 1;
        }, { userId: 'system' });
      } catch (e) {
        this.log.error(`dairy cycle close failed for ${d.id} (tenant ${tenantId}): ${(e as Error).message}`);
      }
    }
    return closed;
  }

  /** Build the draft bills for every closed cycle that still needs them. */
  async buildBills(tenantId: string, limit = 500): Promise<{ cyclesBilled: number; generated: number; skipped: number; stranded: number; failed: number }> {
    const pending = await this.uow.run(tenantId, (tx) => this.cycles.needingBills(tx, tenantId, 20), { userId: 'system' });
    let cyclesBilled = 0, generated = 0, skipped = 0, stranded = 0, failed = 0;
    for (const cycle of pending) {
      const counts = await this.generateFor(tenantId, cycle, limit);
      generated += counts.generated; skipped += counts.skipped; stranded += counts.stranded; failed += counts.failed;
      cyclesBilled += 1;
    }
    return { cyclesBilled, generated, skipped, stranded, failed };
  }

  /**
   * One closed cycle's bills.
   *
   * Every member is generated through `MilkBillService.generate` — the SAME path a human calling
   * POST /dairy/milk-bills takes. No second aggregation, no SQL copy of "which pours are billable": the hold-state
   * rule TENANT-6b-1 wrote lives in one place, and a cadence job with its own version of it is how a held pour ends
   * up paid on a Tuesday and withheld on a Wednesday.
   */
  async generateFor(tenantId: string, cycle: DairyBillCycle, limit = 500): Promise<{ generated: number; skipped: number; stranded: number; failed: number }> {
    const props = cycle.toProps();
    const members = await this.uow.run(tenantId, (tx) =>
      this.collections.membershipsToBillForCycle(tx, tenantId, props.paymentCycle, props.periodStart, props.periodEnd, limit),
      { userId: 'system' });

    // How many bills have EVER existed for each member in this window (voided included). The idempotency key below
    // carries it, because without it a rebuild after a VOID presents the same key as the original generation and
    // `remember` replays it — reporting "generated 1" while creating nothing, and leaving the member with a voided
    // fortnight and no replacement. Found by a live test; one query per cycle, not per member.
    const attempts = await this.uow.run(tenantId, (tx) =>
      this.billRepo.billAttemptsByMembership(tx, tenantId, props.periodStart, props.periodEnd, members), { userId: 'system' });

    let generated = 0, skipped = 0, failed = 0;
    const failedIds = new Set<string>();
    for (const membershipId of members) {
      try {
        await this.bills.generate(tenantId, { userId: 'system', canManage: true },
          // Keyed on the CYCLE (not the window strings, so a cycle deleted and recreated for the same window is a
          // different run) AND on the ATTEMPT — the number of bills this member has already had for this window. A plain
          // retry presents the same key and replays, which is Law 3; a rebuild after a void presents a new one, which is
          // what makes a void a correction rather than a deletion.
          `dairycycle:${props.id}:${membershipId}:${attempts.get(membershipId) ?? 0}`,
          { membershipId, periodStart: props.periodStart, periodEnd: props.periodEnd, deductions: [] },
          props.id);
        generated += 1;
      } catch (e: any) {
        if (SKIP_CODES.has(String(e?.code))) skipped += 1;
        else {
          failed += 1;
          failedIds.add(membershipId);
          this.log.error(`dairy bill generate failed (tenant ${tenantId}, cycle ${props.id}, membership ${membershipId}): ${e?.code ?? ''} ${(e as Error).message}`);
        }
      }
    }

    // STRANDED MILK, MEASURED FROM THE FACT RATHER THAN FROM AN ERROR CODE.
    //
    // Re-ask the claim query. Anybody STILL in it has unbilled pours in this window after a full generation pass, and
    // that has exactly one cause: a pour entered AFTER the window was billed — a counter operator catching up on paper
    // slips, a handheld that synced late. This platform has nowhere to put it. The window's bill exists,
    // `UNIQUE (membership_id, period_start, period_end)` forbids a supplementary one, and the NEXT cycle's window does
    // not contain the pour's `collected_on`. That milk is currently payable to nobody.
    //
    // Measured this way and NOT by catching `BILL_NOT_PAYABLE`, because the error never fires on the common path: the
    // idempotency key is per (cycle, membership), so a second pass REPLAYS the first bill's stored response and reports
    // a cheerful "generated 1" while the late pour sits there. An error-code check would have made the most likely
    // version of this defect invisible — which is exactly what it did until a live test caught it.
    //
    // 6c-1 cannot fix it: a supplementary bill or a carry-forward line is a schema decision that belongs with the
    // preview/approve acts (TENANT-6c-2). What it refuses to do is be silent.
    const remaining = await this.uow.run(tenantId, (tx) =>
      this.collections.membershipsToBillForCycle(tx, tenantId, props.paymentCycle, props.periodStart, props.periodEnd, limit),
      { userId: 'system' });
    const strandedIds = remaining.filter((id) => !failedIds.has(id));
    for (const id of strandedIds) {
      this.log.error(`dairy STRANDED POURS: membership ${id} has unbilled pours in ${props.periodStart}..${props.periodEnd} (tenant ${tenantId}, cycle ${props.id}) and that window is already billed — this milk is currently payable to nobody (TENANT-6c-2)`);
    }
    const stranded = strandedIds.length;

    // The run's own outcome, recorded whatever it was. A run that generated nothing and failed nothing is still a run
    // that happened, and `bills_generated_at` is how the next tick knows not to sweep this cycle again.
    await this.uow.run(tenantId, async (tx) => {
      const fresh = await this.cycles.getForUpdate(tx, tenantId, props.id);
      if (!fresh) return;
      fresh.recordGeneration(new Date(), { generated, skipped, failed });
      await this.cycles.updateState(tx, fresh);
      await this.flush(tx, tenantId, fresh);
    }, { userId: 'system' });

    return { generated, skipped, stranded, failed };
  }

  private async flush(tx: TxContext, tenantId: string, cycle: DairyBillCycle): Promise<void> {
    const events: DomainEvent[] = cycle.pullEvents();
    for (const e of events) {
      await this.outbox.write(tx, { tenantId, aggregateType: 'dairy_bill_cycle', aggregateId: cycle.id, eventType: e.type, payload: { v: 1, ...e.payload } });
    }
  }
}
