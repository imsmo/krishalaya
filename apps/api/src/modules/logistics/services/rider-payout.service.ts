// modules/logistics/services/rider-payout.service.ts · PC-55 A7. Terms CRUD + the rider's own statement.
// TWO LAWS, both visible to the rider:
//  1. FAIR ACROSS TIME — every delivery is priced with the terms in force on ITS OWN date, so an operator
//     editing terms today cannot change what last week's riding earned. Terms are appended, never edited;
//     only a FUTURE-dated row may be retired.
//  2. LEDGERED ONLY — this computes what is OWED. It executes no payout, touches no wallet, writes no ledger
//     entry. The response says so explicitly, so a rider is never left thinking money has moved.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ConflictError, ForbiddenError } from '../../../shared/errors/app-error';
import { RiderPayoutRepository } from '../repositories/rider-payout.repository';
import { buildStatement, termsForDate } from '../domain/rider-payout.rules';

export interface PayoutActor { userId: string; canManage: boolean }

@Injectable()
export class RiderPayoutService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly repo: RiderPayoutRepository,
  ) {}
  private assert(a: PayoutActor) { if (!a.canManage) throw new ForbiddenError('requires logistics.manage'); }

  async createTerms(tenantId: string, a: PayoutActor, dto: { riderUserId?: string; termsName: string; perDropMinor?: string; pctOfChargeBps?: number; codHandlingMinor?: string; failedAttemptMinor?: string; currencyCode?: string; effectiveFrom: string; notes?: string }) {
    this.assert(a);
    const perDrop = dto.perDropMinor ?? '0';
    const cod = dto.codHandlingMinor ?? '0';
    const failed = dto.failedAttemptMinor ?? '0';
    const bps = dto.pctOfChargeBps ?? 0;
    if (BigInt(perDrop) === 0n && bps === 0 && BigInt(cod) === 0n && BigInt(failed) === 0n) {
      throw new BadRequestError('terms that pay nothing are not terms — set a per-drop amount, a charge share, or a fee');
    }
    // Back-dating would silently rewrite what past work earned — the one thing these terms exist to prevent.
    if (dto.effectiveFrom < new Date().toISOString().slice(0, 10)) {
      throw new BadRequestError('effectiveFrom cannot be in the past: past deliveries keep the terms that were in force on their own date');
    }
    const id = uuidv7();
    const res = await this.uow.run(tenantId, (tx) => this.repo.insertTerms(tx, {
      id, tenantId, riderUserId: dto.riderUserId, termsName: dto.termsName, perDropMinor: perDrop,
      pctOfChargeBps: bps, codHandlingMinor: cod, failedAttemptMinor: failed,
      currencyCode: dto.currencyCode ?? 'INR', effectiveFrom: dto.effectiveFrom, notes: dto.notes, createdBy: a.userId,
    }), { userId: a.userId });
    if (!res.ok) throw new ConflictError('terms already exist for that scope and effective date — pick another date');
    return { id, effectiveFrom: dto.effectiveFrom, scope: dto.riderUserId ? 'rider' : 'tenant_default' };
  }

  /** Only a FUTURE-dated row can be retired; anything already in force is history. */
  async retireTerms(tenantId: string, a: PayoutActor, id: string) {
    this.assert(a);
    const ok = await this.uow.run(tenantId, (tx) => this.repo.retireTerms(tx, tenantId, id), { userId: a.userId });
    if (!ok) throw new ConflictError('only future-dated terms can be retired — terms already in force are history');
    return { id, retired: true };
  }

  terms(tenantId: string, a: PayoutActor, riderUserId?: string) { this.assert(a); return this.repo.listTerms(tenantId, riderUserId); }

  /** THE STATEMENT. A rider reads their OWN (no Manage needed); an operator may read any rider's with Manage. */
  async statement(tenantId: string, a: PayoutActor, q: { riderUserId?: string; from: string; to: string }) {
    const target = q.riderUserId ?? a.userId;
    if (target !== a.userId) this.assert(a);                    // reading someone else's pay needs the power to
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.from) || !/^\d{4}-\d{2}-\d{2}$/.test(q.to) || q.from > q.to) {
      throw new BadRequestError('from/to must be YYYY-MM-DD with from <= to');
    }
    const [ships, terms] = await Promise.all([
      this.repo.riderShipments(tenantId, target, q.from, q.to),
      this.repo.termsFor(tenantId, target),
    ]);
    const st = buildStatement(ships, terms, target);
    const active = termsForDate(terms, target, new Date().toISOString().slice(0, 10));
    return {
      riderUserId: target,
      period: { from: q.from, to: q.to },
      currencyCode: active?.currencyCode ?? 'INR',
      activeTerms: active ? { id: active.id, termsName: active.termsName, effectiveFrom: active.effectiveFrom, perDropMinor: active.perDropMinor, pctOfChargeBps: active.pctOfChargeBps, codHandlingMinor: active.codHandlingMinor, failedAttemptMinor: active.failedAttemptMinor, scope: active.riderUserId ? 'rider' : 'tenant_default' } : null,
      ...st,
      settlement: {
        paid: false,
        note: st.unpriced.length > 0
          ? 'Some deliveries could not be priced because no payout terms were in force on their date — ask your operator to set terms. Nothing here has been paid yet; payouts run through the platform payout batches once your operator enables them.'
          : 'This is a statement of what your completed deliveries earn under your terms. Nothing here has been paid yet; payouts run through the platform payout batches once your operator enables them.',
      },
    };
  }
}
