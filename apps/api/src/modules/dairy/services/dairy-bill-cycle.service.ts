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
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { DairyBillCycleRepository } from '../repositories/dairy-bill-cycle.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { MilkBillService } from './milk-bill.service';
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
    private readonly cycles: DairyBillCycleRepository,
    private readonly collections: MilkCollectionRepository,
    private readonly bills: MilkBillService,
  ) {}

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

    let generated = 0, skipped = 0, failed = 0;
    const failedIds = new Set<string>();
    for (const membershipId of members) {
      try {
        await this.bills.generate(tenantId, { userId: 'system', canManage: true },
          // Keyed on the CYCLE, not on the window strings: a re-run of the same cycle replays, and a cycle that was
          // deleted and recreated for the same window is a different run rather than a silent no-op.
          `dairycycle:${props.id}:${membershipId}`,
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
