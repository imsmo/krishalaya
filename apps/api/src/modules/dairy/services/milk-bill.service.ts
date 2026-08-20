// modules/dairy/services/milk-bill.service.ts · THE MONEY PATH — per-cycle milk settlement → wallet payout.
// generate(): aggregates a membership's UNBILLED collections in a period (FOR UPDATE), nets off deductions,
// writes a draft bill and stamps the collections (idempotent per cycle via UNIQUE(membership,period)).
// pay(): the cooperative pays the farmer the NET through the wallet boundary (tenant 'main' → farmer
// userMain, txnType 'milk_payment', a ZERO-SUM, idempotent ledger txn — Law 2). Every write: one ACID tx
// (UoW), state via the machine (Law 5), outbox in-tx (Law 4), idempotent money mutations (Law 3), authz
// THROWS (Law 6). No version column → bills lock FOR UPDATE. (Bank-disbursement payout_id is deferred.)
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { userMain, TenantAccount } from '../../../core/wallet/account-codes';
import { AccountRef } from '../../../core/wallet/account-codes';
import { uuidv7 } from '../../../core/database/uuid.util';
import { MilkBill, BillDeduction } from '../domain/milk-bill.entity';
import { DomainEvent } from '../domain/dairy.events';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { DairyBillCycleRepository } from '../repositories/dairy-bill-cycle.repository';
import { GenerateBillDto } from '../dto/create-milk-bill.dto';
import { MembershipNotFoundError, BillNotFoundError, EmptyBillError, AllPoursHeldError, BillNotPayableError, DairyForbiddenError, DeductionHasNoDestinationError } from '../domain/dairy.errors';
import { DairyActor } from './mcc-centre.service';

const tenantMain = (tenantId: string): AccountRef => ({ kind: 'tenant', tenantId, accountCode: TenantAccount.Main, currencyCode: 'INR' });

@Injectable()
export class MilkBillService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly audit: AuditWriter,
    private readonly bills: MilkBillRepository,
    private readonly collections: MilkCollectionRepository,
    private readonly memberships: DairyMembershipRepository,
    // [PC-56 TENANT-6c-2] The dispute window's LENGTH is a tenant setting, and this repository is where this module
    // reads tenant settings (0157 put the payday there for the same reason). A bill cannot be previewed without
    // knowing how long its member has, so the dependency is real rather than convenient.
    private readonly cycles: DairyBillCycleRepository,
  ) {}

  /** `now + the tenant's dispute-window hours`, as an instant. Computed from a DB-sourced length, never a literal 24. */
  private async windowEnd(tx: TxContext, tenantId: string, now: Date): Promise<Date> {
    const hours = await this.cycles.disputeWindowHours(tx, tenantId);
    return new Date(now.getTime() + hours * 3_600_000);
  }

  /**
   * Generate a draft bill from a membership's unbilled collections in [periodStart, periodEnd].
   *
   * `cycleId` is passed by the CYCLE path (TENANT-6c-1) and is deliberately not a DTO field: a caller who could name
   * a cycle id independently of the period could file a fortnight's bill under a different fortnight's cycle, and
   * nothing downstream would ever notice. The cycle service reads both from the same row.
   */
  async generate(tenantId: string, actor: DairyActor, idemKey: string, dto: GenerateBillDto, cycleId: string | null = null) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(idemKey, actor.userId, 'dairy.bill.generate', () =>
      timed(this.metrics, 'dairy.bill.generate', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          if (!(await this.memberships.getById(tenantId, dto.membershipId, tx))) throw new MembershipNotFoundError(dto.membershipId);
          const agg = await this.collections.aggregateUnbilledForUpdate(tx, tenantId, dto.membershipId, dto.periodStart, dto.periodEnd);
          // [PC-56 TENANT-6b-1] A bill that comes back empty because every pour is under a quality hold is a
          // DIFFERENT fact from a member who did not pour, and W168's whole promise ("holds this pour's payment only")
          // depends on somebody being able to tell them apart.
          if (agg.count === 0 && agg.heldCount > 0) throw new AllPoursHeldError(agg.heldCount, agg.heldMinor.toString());
          if (agg.count === 0) throw new EmptyBillError();
          const deductions: BillDeduction[] = dto.deductions.map((d) => ({ type: d.type, amountMinor: BigInt(d.amountMinor) }));
          const bill = MilkBill.generate({ id: uuidv7(), tenantId, membershipId: dto.membershipId, cycleId, periodStart: dto.periodStart, periodEnd: dto.periodEnd,
            totalLitresMilli: agg.totalWeightMilliKg, grossMinor: agg.grossMinor, deductions });
          try { await this.bills.insert(tx, bill); } catch (e: any) { if (e?.code === '23505') throw new BillNotPayableError('a bill already exists for this period'); throw e; }
          await this.collections.attachToBill(tx, tenantId, agg.ids, bill.id);
          await this.flush(tx, tenantId, bill.id, bill.pullEvents());
          return bill.toJSON();
        }, { userId: actor.userId })));
  }

  /**
   * Show ONE bill to its member and start their window.
   *
   * W169's own act is the CYCLE-level one (`DairyBillCycleService.previewCycle`); this route stays because a bill
   * generated by hand for an arbitrary period has no cycle to be previewed with, and a member holding such a bill is
   * owed the same window as everybody else. Both paths go through the same aggregate method, so the window they set
   * and the event they publish cannot diverge.
   */
  async preview(tenantId: string, actor: DairyActor, id: string, now = new Date()) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.uow.run(tenantId, async (tx) => {
      const bill = await this.bills.getForUpdate(tx, tenantId, id);
      if (!bill) throw new BillNotFoundError(id);
      const membership = await this.memberships.getById(tenantId, bill.membershipIdRef, tx);
      if (!membership) throw new MembershipNotFoundError(bill.membershipIdRef);
      bill.preview(now, await this.windowEnd(tx, tenantId, now), membership.farmerUserId);
      await this.bills.update(tx, bill);
      await this.flush(tx, tenantId, bill.id, bill.pullEvents());
      return bill.toJSON();
    }, { userId: actor.userId });
  }

  /**
   * Approve ONE bill. W169: *"Preview/approve needs dairy-desk + `settlement.close` + checker."* The CHECKER rule lives
   * on the CYCLE (a per-bill checker would mean 312 signatures, which is not what the canon's button is), so this route
   * carries the two keys and the cycle-level act carries the second human.
   */
  async approve(tenantId: string, actor: DairyActor, id: string) {
    if (!actor.canCloseSettlement) throw new DairyForbiddenError('requires settlement.close — approving a bill takes the second key, not just the dairy desk');
    return this.transition(tenantId, actor, id, (b) => b.approve());
  }

  /**
   * [PC-56 TENANT-6c-2] VOID a bill and RELEASE ITS POURS, so a correct one can be built.
   *
   * The only correction this platform can make to a milk bill's arithmetic. There is no adjustment line and no credit
   * note on `milk_bills`, so a bill an upheld dispute proved wrong is soft-deleted, `milk_bill_id` is cleared on every
   * collection it settled, and the cycle's next generation pass rebuilds it from whatever the pours now say — which is
   * what 6b-1's quality path can already correct.
   *
   * The detach FAILS CLOSED (`CollectionStampLostError`): a void that soft-deleted the bill but left its pours stamped
   * would strand a fortnight of a family's milk exactly as 6c-1's stranded-pour finding describes, except worse,
   * because the bill they could have pointed at is gone too.
   */
  async voidBill(tenantId: string, actor: DairyActor, id: string, reason: string, ip: string | null, now = new Date()) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.uow.run(tenantId, async (tx) => {
      const bill = await this.bills.getForUpdate(tx, tenantId, id);
      if (!bill) throw new BillNotFoundError(id);
      return this.voidLoaded(tx, tenantId, actor, bill, reason, ip, now);
    }, { userId: actor.userId });
  }

  /**
   * The void itself, for a caller that ALREADY HOLDS THE BILL LOCKED in its own transaction.
   *
   * **THIS SPLIT EXISTS BECAUSE THE FIRST VERSION SELF-DEADLOCKED AND A LIVE TEST FOUND IT.** The dispute service
   * resolves an upheld query inside a transaction that has the bill under `FOR UPDATE`, and then called `voidBill`,
   * which opened a SECOND transaction on a SECOND connection and asked for the same row lock — so it waited on itself
   * until the test timed out. In production that is a request that hangs until the statement timeout while holding a
   * lock on a money row.
   *
   * Exposing the tx-taking form is the honest fix rather than the convenient one: the alternative (voiding after the
   * resolution commits) would make "the query was upheld" and "the bill was voided" two separate facts that can
   * disagree, and the alternative to THAT (a second copy of this body in the dispute service) is two mechanisms for one
   * act. One body, one transaction, one outcome.
   */
  async voidLoaded(tx: TxContext, tenantId: string, actor: DairyActor, bill: MilkBill, reason: string, ip: string | null, now = new Date()) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    bill.void(now, actor.userId, reason);
    const released = await this.collections.detachFromBill(tx, tenantId, bill.id);
    await this.bills.void(tx, bill);
    await this.audit.write(tx, {
      tenantId, actorUserId: actor.userId, action: 'dairy.bill.voided', entityType: 'milk_bill', entityId: bill.id,
      oldValue: { status: 'live', netMinor: bill.netMinor.toString() },
      newValue: { status: 'voided', reason: reason.trim(), poursReleased: released }, ip,
    });
    await this.flush(tx, tenantId, bill.id, bill.pullEvents());
    return { ...bill.toJSON(), poursReleased: released };
  }

  /** Pay the farmer the NET amount (tenant 'main' → farmer userMain, zero-sum + idempotent). */
  async pay(tenantId: string, actor: DairyActor, id: string, idemKey: string, ip: string | null, now = new Date()) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(idemKey, actor.userId, 'dairy.bill.pay', () =>
      timed(this.metrics, 'dairy.bill.pay', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const bill = await this.bills.getForUpdate(tx, tenantId, id);
          if (!bill) throw new BillNotFoundError(id);
          if (bill.status !== 'approved') throw new BillNotPayableError(bill.status);
          // [PC-56 TENANT-6c-1] A DEDUCTION WITH NO DESTINATION IS NOT PAID — IT IS KEPT.
          //
          // Below, exactly one movement is posted: the NET, cooperative → farmer. The deducted amount is never paid to
          // the member and never posted anywhere else, so a `loan_emi` line takes Rs 300 out of a family's milk money
          // and reduces no loan by anything — the farmer pays that instalment twice, and the difference sits in the
          // cooperative's wallet with no ledger row to reconcile it by. `deductions.type` is a free-typed 40-character
          // string (Law 6) with no reference to the loan, advance or policy it names, so there is nothing here to post
          // TO even if a second leg were added.
          //
          // So it fails CLOSED, the ruling COLLECTION_STAMP_LOST made for the same shape. Law 2 forbids inventing a
          // ledger destination; paying the gross would hand back money the cooperative is genuinely owed; and paying
          // the net silently is the defect. A refusal an operator can read is the only honest third option, and it is
          // removed the moment the destination exists (TENANT-6c-2 builds it, with W169's >25% consent gate).
          if (bill.deductionsMinor > 0n) throw new DeductionHasNoDestinationError(bill.id, bill.deductionsMinor.toString(), bill.deductionTypes);
          const membership = await this.memberships.getById(tenantId, bill.membershipId, tx);
          if (!membership) throw new MembershipNotFoundError(bill.membershipId);
          const net = bill.netMinor;
          if (net > 0n) {
            await this.wallet.post(tx, {
              tenantId, txnType: 'milk_payment', idempotencyKey: `milkbill:${bill.id}`, referenceType: 'milk_bill', referenceId: bill.id, initiatedBy: actor.userId,
              legs: [{ account: tenantMain(tenantId), amountMinor: -net }, { account: userMain(membership.farmerUserId), amountMinor: net }],
            });
          }
          // [PC-56 TENANT-6c-2] The member's window is checked HERE, at the money movement, because that is what W169
          // promises: "member sees every pour + every deduction, 24h dispute window" and then "paid Fri". The refusal
          // lives on the aggregate (`markPaid`) so no route can forget it.
          bill.markPaid(now);
          await this.bills.update(tx, bill);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'dairy.bill.paid', entityType: 'milk_bill', entityId: bill.id, newValue: { netMinor: net.toString() }, ip });
          await this.flush(tx, tenantId, bill.id, bill.pullEvents());
          return bill.toJSON();
        }, { userId: actor.userId })));
  }

  async getById(tenantId: string, actor: DairyActor & { userId: string }, id: string) {
    const bill = await this.bills.getById(tenantId, id);
    if (!bill) throw new BillNotFoundError(id);
    if (!actor.canManage) {
      const membership = await this.memberships.getById(tenantId, bill.membershipId);
      if (!membership || membership.farmerUserId !== actor.userId) throw new BillNotFoundError(id); // 404, no IDOR
    }
    return bill.toJSON();
  }
  async list(tenantId: string, actor: DairyActor & { userId: string }, q: { box: 'mine' | 'all'; membershipId?: string; status?: string; cursor?: { c: string; id: string }; limit: number }) {
    let membershipIds: string[] | undefined;
    if (q.box === 'mine') {
      const mine = await this.memberships.listFor(tenantId, { farmerUserId: actor.userId, limit: 100 });
      membershipIds = mine.map((m) => m.id);
      if (membershipIds.length === 0) return { items: [], nextCursor: null };
    } else if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    const rows = await this.bills.listFor(tenantId, { membershipIds, membershipId: q.membershipId, status: q.status, cursor: q.cursor, limit: q.limit });
    const items = rows.map((b) => b.toJSON());
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  private async transition(tenantId: string, actor: DairyActor, id: string, mutate: (b: MilkBill) => void) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.uow.run(tenantId, async (tx) => {
      const bill = await this.bills.getForUpdate(tx, tenantId, id);
      if (!bill) throw new BillNotFoundError(id);
      mutate(bill);
      await this.bills.update(tx, bill);
      await this.flush(tx, tenantId, bill.id, bill.pullEvents());
      return bill.toJSON();
    }, { userId: actor.userId });
  }
  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'milk_bill', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
