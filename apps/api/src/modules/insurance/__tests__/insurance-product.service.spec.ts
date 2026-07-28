// modules/insurance/__tests__/insurance-product.service.spec.ts · IRDAI-partner gating (Law 12: render-only,
// never a fabricated compliance claim) — pins that this service ALWAYS narrows to partnerKind='insurer' and
// rejects a mis-tagged partner (defence in depth at both browse-time and enrolment-time).
import { InsuranceProductService } from '../services/insurance-product.service';
import { InsuranceProduct } from '../domain/insurance-product.entity';
import { PartnerNotAnInsurerError, InsurancePartnerNotFoundError, InsuranceProductNotFoundError } from '../domain/insurance.errors';

const insurer = { id: 'partner-1', code: 'icici_lombard', name: 'ICICI Lombard', partnerKind: 'insurer', regulatorRef: 'IRDAI/123', isActive: true };
const bank = { id: 'partner-2', code: 'sbi', name: 'State Bank of India', partnerKind: 'bank', regulatorRef: 'RBI/456', isActive: true };

function harness() {
  const partners = { listPartners: jest.fn(async () => [insurer]), getPartner: jest.fn(async (_t: string, id: string) => (id === 'partner-1' ? insurer : id === 'partner-2' ? bank : null)) };
  const productRepo = { getById: jest.fn(), list: jest.fn() };
  const svc = new InsuranceProductService(partners as any, productRepo as any);
  return { svc, partners, productRepo };
}

describe('listPartners — always filtered to insurer-kind (Law 11: reuse fintech FinancialPartnerService)', () => {
  it('passes partnerKind:"insurer" through to the shared service, never the raw financial_partners panel', async () => {
    const { svc, partners } = harness();
    await svc.listPartners('t1', { activeOnly: true });
    expect(partners.listPartners).toHaveBeenCalledWith('t1', { partnerKind: 'insurer', activeOnly: true });
  });
});

describe('getPartner — IRDAI gate (Law 12: render-only, never invented)', () => {
  it('returns an insurer partner as-is, including its real regulatorRef', async () => {
    const { svc } = harness();
    const p = await svc.getPartner('t1', 'partner-1');
    expect(p.regulatorRef).toBe('IRDAI/123');
  });
  it('rejects a bank/NBFC id with PartnerNotAnInsurerError (never silently render it as an insurer)', async () => {
    const { svc } = harness();
    await expect(svc.getPartner('t1', 'partner-2')).rejects.toBeInstanceOf(PartnerNotAnInsurerError);
  });
  it('a nonexistent id → InsurancePartnerNotFoundError (404, not a fabricated result)', async () => {
    const { svc } = harness();
    await expect(svc.getPartner('t1', 'nope')).rejects.toBeInstanceOf(InsurancePartnerNotFoundError);
  });
});

describe('getActiveProductForEnrolment — defence in depth at enrolment time', () => {
  it('rejects an inactive product', async () => {
    const { svc, productRepo } = harness();
    (productRepo.getById as jest.Mock).mockResolvedValue(InsuranceProduct.rehydrate({ id: 'pr1', partnerId: 'partner-1', productKindId: 'k', defaultName: 'X', premiumCalcRaw: {}, sumInsuredRules: {}, govtSubsidyBps: 0, ourCommissionBps: 0, isParametric: false, isActive: false }));
    await expect(svc.getActiveProductForEnrolment('t1', 'pr1')).rejects.toBeInstanceOf(InsuranceProductNotFoundError);
  });
  it('rejects a product whose partner is not actually an insurer, even if the product itself is active', async () => {
    const { svc, productRepo } = harness();
    (productRepo.getById as jest.Mock).mockResolvedValue(InsuranceProduct.rehydrate({ id: 'pr2', partnerId: 'partner-2', productKindId: 'k', defaultName: 'X', premiumCalcRaw: {}, sumInsuredRules: {}, govtSubsidyBps: 0, ourCommissionBps: 0, isParametric: false, isActive: true }));
    await expect(svc.getActiveProductForEnrolment('t1', 'pr2')).rejects.toBeInstanceOf(PartnerNotAnInsurerError);
  });
});
