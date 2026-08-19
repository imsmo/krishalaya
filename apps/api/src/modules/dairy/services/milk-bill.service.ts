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
import { GenerateBillDto } from '../dto/create-milk-bill.dto';
import { MembershipNotFoundError, BillNotFoundError, EmptyBillError, BillNotPayableError, DairyForbiddenError } from '../domain/dairy.errors';
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
  ) {}

  /** Generate a draft bill from a membership's unbilled collections in [periodStart, periodEnd]. */
  async generate(tenantId: string, actor: DairyActor, idemKey: string, dto: GenerateBillDto) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(idemKey, actor.userId, 'dairy.bill.generate', () =>
      timed(this.metrics, 'dairy.bill.generate', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          if (!(await this.memberships.getById(tenantId, dto.membershipId, tx))) throw new MembershipNotFoundError(dto.membershipId);
          const agg = await this.collections.aggregateUnbilledForUpdate(tx, tenantId, dto.membershipId, dto.periodStart, dto.periodEnd);
          if (agg.count === 0) throw new EmptyBillError();
          const deductions: BillDeduction[] = dto.deductions.map((d) => ({ type: d.type, amountMinor: BigInt(d.amountMinor) }));
          const bill = MilkBill.generate({ id: uuidv7(), tenantId, membershipId: dto.membershipId, periodStart: dto.periodStart, periodEnd: dto.periodEnd,
            totalLitresMilli: agg.totalWeightMilliKg, grossMinor: agg.grossMinor, deductions });
          try { await this.bills.insert(tx, bill); } catch (e: any) { if (e?.code === '23505') throw new BillNotPayableError('a bill already exists for this period'); throw e; }
          await this.collections.attachToBill(tx, tenantId, agg.ids, bill.id);
          await this.flush(tx, tenantId, bill.id, bill.pullEvents());
          return bill.toJSON();
        }, { userId: actor.userId })));
  }

  async preview(tenantId: string, actor: DairyActor, id: string) { return this.transition(tenantId, actor, id, (b) => b.preview()); }
  async approve(tenantId: string, actor: DairyActor, id: string) { return this.transition(tenantId, actor, id, (b) => b.approve()); }

  /** Pay the farmer the NET amount (tenant 'main' → farmer userMain, zero-sum + idempotent). */
  async pay(tenantId: string, actor: DairyActor, id: string, idemKey: string, ip: string | null) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(idemKey, actor.userId, 'dairy.bill.pay', () =>
      timed(this.metrics, 'dairy.bill.pay', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const bill = await this.bills.getForUpdate(tx, tenantId, id);
          if (!bill) throw new BillNotFoundError(id);
          if (bill.status !== 'approved') throw new BillNotPayableError(bill.status);
          const membership = await this.memberships.getById(tenantId, bill.membershipId, tx);
          if (!membership) throw new MembershipNotFoundError(bill.membershipId);
          const net = bill.netMinor;
          if (net > 0n) {
            await this.wallet.post(tx, {
              tenantId, txnType: 'milk_payment', idempotencyKey: `milkbill:${bill.id}`, referenceType: 'milk_bill', referenceId: bill.id, initiatedBy: actor.userId,
              legs: [{ account: tenantMain(tenantId), amountMinor: -net }, { account: userMain(membership.farmerUserId), amountMinor: net }],
            });
          }
          bill.markPaid();
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
