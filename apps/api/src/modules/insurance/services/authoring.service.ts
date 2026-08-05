// modules/insurance/services/authoring.service.ts · PC-54 W54-9 `insurance-authoring` (insurance.manage).
// PRODUCT authoring: premium_calc is the pricing CONTRACT ({pct_of_sum_insured}|{flat_minor}|parametric
// terms) — shape-validated here, executed by the enrolment path (one pricing truth). ISSUANCE: an insurer
// activates a PROPOSED policy only after the premium payment is linked (no premium, no cover) and stamps
// the policy number; parametric triggers may be set at issue. Book + loss-ratio insights are ledgered reads.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuthoringRepository } from '../repositories/authoring.repository';

export interface InsActor { userId: string; canManage: boolean }
const validCalc = (c: Record<string, unknown>) =>
  (typeof c.pct_of_sum_insured === 'number' && (c.pct_of_sum_insured as number) > 0) ||
  (typeof c.flat_minor === 'string' && /^\d{1,15}$/.test(c.flat_minor as string)) ||
  (typeof c.parametric === 'object' && c.parametric !== null);

@Injectable()
export class AuthoringService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService, private readonly repo: AuthoringRepository) {}
  private assert(a: InsActor) { if (!a.canManage) throw new ForbiddenError('requires insurance.manage'); }

  async createProduct(tenantId: string, a: InsActor, key: string, dto: { partnerId: string; productKindId: string; defaultName: string; premiumCalc: Record<string, unknown>; sumInsuredRules?: Record<string, unknown>; govtSubsidyBps?: number; ourCommissionBps?: number; isParametric?: boolean }) {
    this.assert(a);
    if (!validCalc(dto.premiumCalc)) throw new BadRequestError('premiumCalc must be {pct_of_sum_insured} | {flat_minor} | {parametric:{...}}');
    return this.idem.remember(key, a.userId, 'insurance.product.create', async () => {
      const id = uuidv7();
      await this.uow.run(tenantId, (tx) => this.repo.insertProduct(tx, { id, ...dto }), { userId: a.userId });
      return { id };
    });
  }
  async updateProduct(tenantId: string, a: InsActor, id: string, patch: { defaultName?: string; premiumCalc?: Record<string, unknown>; sumInsuredRules?: Record<string, unknown>; isActive?: boolean }) {
    this.assert(a);
    if (patch.premiumCalc && !validCalc(patch.premiumCalc)) throw new BadRequestError('invalid premiumCalc shape');
    const ok = await this.uow.run(tenantId, (tx) => this.repo.updateProduct(tx, id, patch), { userId: a.userId });
    if (!ok) throw new NotFoundError('product not found');
    return { id };
  }

  async issue(tenantId: string, a: InsActor, policyId: string, dto: { policyNo: string; parametricTriggers?: Record<string, unknown> }) {
    this.assert(a);
    return this.uow.run(tenantId, async (tx) => {
      const p = await this.repo.lockPolicy(tx, tenantId, policyId);
      if (!p) throw new NotFoundError('policy not found');
      if (p.status !== 'proposed') throw new ConflictError('only a proposed policy can be issued');
      if (!p.premiumPaymentId) throw new ConflictError('no premium payment linked — no premium, no cover');
      await this.repo.issuePolicy(tx, tenantId, policyId, dto.policyNo, dto.parametricTriggers);
      return { id: policyId, status: 'active' as const, policyNo: dto.policyNo };
    }, { userId: a.userId });
  }

  book(tenantId: string, a: InsActor, status?: string, limit = 100) { this.assert(a); return this.repo.book(tenantId, status, Math.min(limit, 200)); }
  insights(tenantId: string, a: InsActor) { this.assert(a); return this.repo.insights(tenantId); }
}
