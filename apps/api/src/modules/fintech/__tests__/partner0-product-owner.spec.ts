// modules/fintech/__tests__/partner0-product-owner.spec.ts · PC-56 PARTNER-0 · founder D3 — THE PRODUCT-OWNER RULE (fakes, no database).
// Pins: a partner decides only its own products (another partner's → the 404 shape); tenant staff decide only products whose partner has NO
// console members (else 403 LOAN_DECIDED_BY_PARTNER, nothing written); disburse is untouched by the rule (the FPO's money, Law 2); a partner
// decision is idempotent on its key and audited with the partner person as the actor.
import { LoanApplicationService } from '../services/loan-application.service';
import { LoanApplication } from '../domain/loan-application.entity';
import { decisionVerdict } from '../domain/loan-decision.rules';

const PA = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const PB = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
function underReview(partnerId = PA) {
  const a = LoanApplication.apply({ id: 'a1', tenantId: 't1', applicantUserId: 'u1', productId: 'pr1', partnerId, amountRequestedMinor: 5000000n, purposeText: 'seed', nwrId: null });
  a.startReview(); a.pullEvents();
  return a;
}
function harness(app: LoanApplication, partnerHasConsole: boolean) {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() }; const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const audit = { write: jest.fn() };
  const repo = { getForUpdate: jest.fn(async () => app), update: jest.fn(), partnerHasConsoleMembers: jest.fn(async () => partnerHasConsole) };
  const svc = new LoanApplicationService(uow as any, outbox as any, idem as any, {} as any, { inc: jest.fn(), observe: jest.fn() } as any, audit as any, {} as any, repo as any, {} as any, {} as any);
  return { svc, repo, audit, idem };
}
const banker = { userId: 'banker1', canBorrow: false, canManage: true };
const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? String(e));

describe('PC-56 PARTNER-0 · decisionVerdict (pure)', () => {
  it('partner actor: own product → allowed; another partner\'s → not_found (the console is not an existence oracle)', () => {
    expect(decisionVerdict({ actorPartnerId: PA, productPartnerId: PA, partnerHasConsole: true })).toBe('allowed');
    expect(decisionVerdict({ actorPartnerId: PA, productPartnerId: PB, partnerHasConsole: true })).toBe('not_found');
  });
  it('tenant actor: allowed only while the product\'s partner has no console members', () => {
    expect(decisionVerdict({ actorPartnerId: null, productPartnerId: PA, partnerHasConsole: false })).toBe('allowed');
    expect(decisionVerdict({ actorPartnerId: null, productPartnerId: PA, partnerHasConsole: true })).toBe('decided_by_partner');
  });
});

describe('PC-56 PARTNER-0 · lenderMutate applies the rule', () => {
  it('a TENANT banker approving a product whose partner runs its console → 403 LOAN_DECIDED_BY_PARTNER, nothing written', async () => {
    const { svc, repo, audit } = harness(underReview(PA), true);
    expect(await codeOf(svc.approve('t1', banker, 'a1', { amountApprovedMinor: '5000000', coolingOffHours: 24 }, null))).toBe('LOAN_DECIDED_BY_PARTNER');
    expect(await codeOf(svc.reject('t1', banker, 'a1', {}, null))).toBe('LOAN_DECIDED_BY_PARTNER');
    expect(repo.partnerHasConsoleMembers).toHaveBeenCalledWith(expect.anything(), PA);
    expect(repo.update).not.toHaveBeenCalled(); expect(audit.write).not.toHaveBeenCalled();
  });
  it('a TENANT banker on a partner with NO console members decides as before', async () => {
    const { svc, repo } = harness(underReview(PA), false);
    const out: any = await svc.approve('t1', banker, 'a1', { amountApprovedMinor: '4000000', coolingOffHours: 24 }, null);
    expect(out.status).toBe('approved'); expect(repo.update).toHaveBeenCalledTimes(1);
  });
  it('a PARTNER person decides its own product (keyed, audited as the partner person); another partner\'s → 404 LOAN_APPLICATION_NOT_FOUND', async () => {
    const own = harness(underReview(PA), true);
    const out: any = await own.svc.partnerDecide('t1', { ...banker, userId: 'p-person', partnerId: PA, roles: ['partner_checker'] }, 'a1', 'approve', { amountApprovedMinor: '5000000', coolingOffHours: 24 }, 'k1', null);
    expect(out.status).toBe('approved');
    expect(own.idem.remember).toHaveBeenCalledWith('k1', 'p-person', 'partner.loan.approve', expect.any(Function));
    expect(own.repo.partnerHasConsoleMembers).not.toHaveBeenCalled();
    const row = own.audit.write.mock.calls[0][1];
    expect(row).toMatchObject({ actorUserId: 'p-person', action: 'fintech.loan.approved', actorRole: `partner:${PA}:partner_checker`, newValue: { realm: 'partner', partnerId: PA } });
    const other = harness(underReview(PB), true);
    expect(await codeOf(other.svc.partnerDecide('t1', { ...banker, userId: 'p-person', partnerId: PA }, 'a1', 'reject', {}, 'k2', null))).toBe('LOAN_APPLICATION_NOT_FOUND');
    expect(other.repo.update).not.toHaveBeenCalled();
  });
  it('approved ≤ requested still binds the partner (the same state machine)', async () => {
    const { svc } = harness(underReview(PA), true);
    expect(await codeOf(svc.partnerDecide('t1', { ...banker, partnerId: PA }, 'a1', 'approve', { amountApprovedMinor: '9000000', coolingOffHours: 24 }, 'k3', null))).toBe('APPROVED_EXCEEDS_REQUESTED');
  });
});
