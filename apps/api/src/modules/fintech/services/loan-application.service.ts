// modules/fintech/services/loan-application.service.ts · loan ORIGINATION use-cases.
// apply → (submitted) → review → approve (opens the anti-predatory cooling-off window) | reject; the
// applicant may withdraw any time before disbursal. DISBURSE creates the loan + credits the borrower's
// wallet (tenant 'main' → borrower userMain, txnType 'loan_disbursement', zero-sum + idempotent — the FPO/
// tenant is the on-platform lender; bank/NBFC partner-rail disbursement is the deferred RBI-gated path).
// Every write: one ACID tx (UoW), state via the machine (Law 5), outbox in-tx (Law 4), idempotent money
// mutations (Law 3), authz THROWS (Law 6). No version column → applications/loans lock FOR UPDATE.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { QUOTA_SERVICE, QuotaService } from '../../../core/quota/quota.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { userMain, TenantAccount } from '../../../core/wallet/account-codes';
import { AccountRef } from '../../../core/wallet/account-codes';
import { uuidv7 } from '../../../core/database/uuid.util';
import { LoanApplication } from '../domain/loan-application.entity';
import { Loan } from '../domain/loan.entity';
import { DomainEvent } from '../domain/fintech.events';
import { LoanApplicationRepository } from '../repositories/loan-application.repository';
import { LoanRepository } from '../repositories/loan.repository';
import { LoanProductRepository } from '../repositories/loan-product.repository';
import { ApplyLoanDto, ApproveLoanDto, RejectLoanDto } from '../dto/create-loan-application.dto';
import { LoanApplicationNotFoundError, LoanProductNotFoundError, AmountOutOfRangeError, FintechForbiddenError, LoanDecidedByPartnerError, LoanAlreadyQueuedForDisbursalError } from '../domain/fintech.errors';
import { decisionVerdict } from '../domain/loan-decision.rules';

const QUOTA_METRIC = 'loan_applications';
const tenantMain = (tenantId: string): AccountRef => ({ kind: 'tenant', tenantId, accountCode: TenantAccount.Main, currencyCode: 'INR' });
/**
 * `partnerId` set ⇔ the actor is a PARTNER-console person (PC-56 PARTNER-0): the service decides inside the APPLICATION's tenant (derived from
 * the row by the caller, never from a token), the product-owner rule (domain/loan-decision.rules) admits only that partner's products, and the
 * audit row records the partner person as the actor (`actorRole` = `partner:<partnerId>:<roles>`).
 */
export interface FintechActor { userId: string; canBorrow: boolean; canManage: boolean; partnerId?: string; roles?: string[] }
export type PartnerDecision = 'review' | 'approve' | 'reject';

@Injectable()
export class LoanApplicationService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(QUOTA_SERVICE) private readonly quota: QuotaService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly repo: LoanApplicationRepository,
    private readonly loans: LoanRepository,
    private readonly products: LoanProductRepository,
  ) {}

  async apply(tenantId: string, actor: FintechActor, idemKey: string, dto: ApplyLoanDto) {
    if (!actor.canBorrow) throw new FintechForbiddenError('requires loan.borrow');
    return this.idem.remember(idemKey, actor.userId, 'fintech.loan.apply', () =>
      timed(this.metrics, 'fintech.loan.apply', { tenant: tenantId }, async () => {
        await this.quota.assertWithinLimit(tenantId, QUOTA_METRIC);
        return this.uow.run(tenantId, async (tx) => {
          const product = await this.products.getById(tenantId, dto.productId, tx);
          if (!product || !product.isActive) throw new LoanProductNotFoundError(dto.productId);
          const amount = BigInt(dto.amountRequestedMinor);
          if (amount < product.minAmountMinor || amount > product.maxAmountMinor) throw new AmountOutOfRangeError(product.minAmountMinor, product.maxAmountMinor);
          const app = LoanApplication.apply({ id: uuidv7(), tenantId, applicantUserId: actor.userId, productId: product.id, partnerId: product.partnerId, amountRequestedMinor: amount, purposeText: dto.purposeText ?? null, nwrId: dto.nwrId ?? null });
          await this.repo.insert(tx, app);
          await this.quota.increment(tx, tenantId, QUOTA_METRIC, 1);
          await this.flush(tx, tenantId, app.id, app.pullEvents());
          return app.toJSON();
        }, { userId: actor.userId });
      }));
  }

  async review(tenantId: string, actor: FintechActor, id: string) {
    return this.lenderMutate(tenantId, actor, id, (a) => a.startReview(), actor.partnerId ? { action: 'fintech.loan.review_started', ip: null, value: {} } : null);
  }

  /**
   * PC-56 PARTNER-0 · D3 — a PARTNER person's decision (review / approve / reject), idempotent on the caller's key. `tenantId` is the
   * application's own tenant, read by the partner-console service through the consent-gated axis; the state machine, the cooling-off and
   * amount ≤ requested are the SAME rules (lenderMutate). There is deliberately no partner path to `disburse` (Law 2).
   */
  async partnerDecide(tenantId: string, actor: FintechActor & { partnerId: string }, id: string, kind: PartnerDecision, body: { amountApprovedMinor?: string; coolingOffHours?: number; note?: string | null }, idemKey: string, ip: string | null) {
    return this.idem.remember(idemKey, actor.userId, `partner.loan.${kind}`, () => {
      if (kind === 'review') return this.review(tenantId, actor, id);
      if (kind === 'approve') return this.approve(tenantId, actor, id, { amountApprovedMinor: String(body.amountApprovedMinor ?? ''), coolingOffHours: Number(body.coolingOffHours ?? 24) } as ApproveLoanDto, ip);
      return this.reject(tenantId, actor, id, { note: body.note ?? undefined } as RejectLoanDto, ip);
    });
  }
  async approve(tenantId: string, actor: FintechActor, id: string, dto: ApproveLoanDto, ip: string | null) {
    return this.lenderMutate(tenantId, actor, id, (a) => a.approve(BigInt(dto.amountApprovedMinor), new Date(Date.now() + dto.coolingOffHours * 3600_000), new Date()), { action: 'fintech.loan.approved', ip, value: { amountApprovedMinor: dto.amountApprovedMinor, coolingOffHours: dto.coolingOffHours } });
  }
  async reject(tenantId: string, actor: FintechActor, id: string, dto: RejectLoanDto, ip: string | null) {
    return this.lenderMutate(tenantId, actor, id, (a) => a.reject(dto.note ?? null, new Date()), { action: 'fintech.loan.rejected', ip, value: { note: dto.note ?? null } });
  }

  /** Applicant withdraws (any time before disbursal — incl. during the cooling-off window). */
  async withdraw(tenantId: string, actor: FintechActor, id: string) {
    return this.uow.run(tenantId, async (tx) => {
      const app = await this.repo.getForUpdate(tx, tenantId, id);
      if (!app) throw new LoanApplicationNotFoundError(id);
      if (app.applicantUserId !== actor.userId && !actor.canManage) throw new FintechForbiddenError('only the applicant may withdraw');
      app.withdraw();
      await this.repo.update(tx, app);
      await this.flush(tx, tenantId, app.id, app.pullEvents());
      return app.toJSON();
    }, { userId: actor.userId });
  }

  /** Lender disburses an approved application: creates the loan + credits the borrower's wallet.
   *  PC-56 PARTNER-4b · founder 4b-2: REFUSED BY NAME if a bank-payout run already claims this application
   *  (`LOAN_ALREADY_QUEUED_FOR_DISBURSAL`, 409) — the two rails now know about each other in both directions. */
  async disburse(tenantId: string, actor: FintechActor, id: string, idemKey: string, ip: string | null) {
    if (!actor.canManage) throw new FintechForbiddenError('requires loan.manage');
    return this.idem.remember(idemKey, actor.userId, 'fintech.loan.disburse', () =>
      timed(this.metrics, 'fintech.loan.disburse', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const app = await this.repo.getForUpdate(tx, tenantId, id);
          if (!app) throw new LoanApplicationNotFoundError(id);
          // PC-56 PARTNER-4b · founder 4b-2 (survey F-3) — THE OTHER RAIL FIRST, BY NAME. Checked before the state
          // machine, exactly as the run rail checks `already_disbursed` before everything else
          // (domain/loan-disbursement.rules.ts:29): an application a bank payout already claims is not a
          // cooling-off question or a status question, it is simply spoken for.
          if (await this.repo.queuedForDisbursal(tx, tenantId, id)) throw new LoanAlreadyQueuedForDisbursalError(id);
          const principal = app.markDisbursed(new Date());   // throws if not approved / cooling-off still open
          const product = await this.products.getById(tenantId, app.productId, tx);
          if (!product) throw new LoanProductNotFoundError(app.productId);
          const loanId = uuidv7();
          const loan = Loan.open({ id: loanId, applicationId: app.id, tenantId, borrowerUserId: app.applicantUserId, partnerId: app.partnerId,
            principalMinor: principal, interestAprBps: product.interestAprBps, disbursedAt: new Date().toISOString().slice(0, 10), maturityDate: null, nextDueDate: null });
          await this.loans.insert(tx, loan);
          await this.repo.update(tx, app);
          // The FPO/tenant funds the borrower's wallet — a balanced, idempotent transfer (Law 2).
          await this.wallet.post(tx, { tenantId, txnType: 'loan_disbursement', idempotencyKey: `loan-disburse:${loanId}`, referenceType: 'loan', referenceId: loanId, initiatedBy: actor.userId,
            legs: [{ account: tenantMain(tenantId), amountMinor: -principal }, { account: userMain(app.applicantUserId), amountMinor: principal }] });
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'fintech.loan.disbursed', entityType: 'loan', entityId: loanId, newValue: { applicationId: app.id, principalMinor: principal.toString() }, ip });
          await this.flush(tx, tenantId, app.id, app.pullEvents());
          return { application: app.toJSON(), loan: loan.toJSON() };
        }, { userId: actor.userId })));
  }

  async getById(tenantId: string, actor: FintechActor, id: string) {
    const a = await this.repo.getById(tenantId, id);
    if (!a) throw new LoanApplicationNotFoundError(id);
    if (a.applicantUserId !== actor.userId && !actor.canManage) throw new LoanApplicationNotFoundError(id); // 404, no IDOR
    return a.toJSON();
  }
  async list(tenantId: string, actor: FintechActor, q: { box: 'mine' | 'review' | 'all'; status?: string; cursor?: { c: string; id: string }; limit: number }) {
    if ((q.box === 'review' || q.box === 'all') && !actor.canManage) throw new FintechForbiddenError('requires loan.manage');
    const rows = await this.repo.listFor(tenantId, { applicantUserId: q.box === 'mine' ? actor.userId : undefined, reviewQueue: q.box === 'review', status: q.status, cursor: q.cursor, limit: q.limit });
    const items = rows.map((a) => a.toJSON());
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  private async lenderMutate(tenantId: string, actor: FintechActor, id: string, fn: (a: LoanApplication) => void, audit: { action: string; ip: string | null; value: Record<string, unknown> } | null) {
    if (!actor.canManage) throw new FintechForbiddenError('requires loan.manage');
    return this.uow.run(tenantId, async (tx) => {
      const app = await this.repo.getForUpdate(tx, tenantId, id);
      if (!app) throw new LoanApplicationNotFoundError(id);
      // PC-56 PARTNER-0 · D3 — THE PRODUCT-OWNER RULE (domain/loan-decision.rules.ts): a partner decides only its own products; tenant staff
      // only products whose partner has no console members.
      const verdict = decisionVerdict({ actorPartnerId: actor.partnerId ?? null, productPartnerId: app.partnerId,
        partnerHasConsole: actor.partnerId ? false : await this.repo.partnerHasConsoleMembers(tx, app.partnerId) });
      if (verdict === 'not_found') throw new LoanApplicationNotFoundError(id);
      if (verdict === 'decided_by_partner') throw new LoanDecidedByPartnerError(app.partnerId);
      fn(app);
      await this.repo.update(tx, app);
      if (audit) await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: audit.action, entityType: 'loan_application', entityId: app.id,
        newValue: actor.partnerId ? { ...audit.value, realm: 'partner', partnerId: actor.partnerId } : audit.value, ip: audit.ip,
        ...(actor.partnerId ? { actorRole: `partner:${actor.partnerId}:${[...(actor.roles ?? [])].sort().join('+') || 'no_role'}` } : {}) });
      await this.flush(tx, tenantId, app.id, app.pullEvents());
      return app.toJSON();
    }, { userId: actor.userId });
  }
  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'loan_application', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
