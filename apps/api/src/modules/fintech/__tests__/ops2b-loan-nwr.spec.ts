// modules/fintech/__tests__/ops2b-loan-nwr.spec.ts · PC-56 OPS-2b · OPS2-B8 (founder Q7-A, 2026-11-06; survey F-8) — a loan application carrying
// `nwrId` is refused BY NAME after the permission check and BEFORE the idempotency record, the quota and any read or write (an ORDERING SPY: the
// list of calls stays empty); without `nwrId` the application goes through as before (the control).
import { LoanApplicationService } from '../services/loan-application.service';
import { LoanProduct } from '../domain/loan-product.entity';
import { LoanEnwrPledgeNotOnPlatformError, LOAN_ENWR_PLEDGE_NOT_ON_PLATFORM_SENTENCE } from '../domain/fintech.errors';

const product = LoanProduct.rehydrate({ id: 'pr1', partnerId: 'pn1', productKindId: 'k1', defaultName: 'Crop', currencyCode: 'INR', minAmountMinor: 100000n, maxAmountMinor: 50000000n, interestAprBps: 1100, tenureMonthsMin: 3, tenureMonthsMax: 12, collateralKind: 'none', repaymentStyle: 'harvest_aligned', isActive: true });
function harness() {
  const calls: string[] = [];
  const rec = (name: string, out?: () => unknown) => jest.fn(async (..._a: any[]) => { calls.push(name); return out ? out() : undefined; });
  const tx = { query: rec('tx.query', () => ({ rows: [], rowCount: 0 })) };
  const uow = { run: jest.fn(async (_t: string, fn: any) => { calls.push('uow.run'); return fn(tx); }) };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => { calls.push('idem.remember'); return fn(); }) };
  const quota = { assertWithinLimit: rec('quota.assert'), increment: rec('quota.increment') };
  const outbox = { write: rec('outbox.write') }; const audit = { write: rec('audit.write') }; const metrics = { inc: jest.fn(), observe: jest.fn() };
  const wallet = { post: rec('wallet.post'), balanceMinor: jest.fn() };
  const repo = { insert: rec('repo.insert') }; const loans = { insert: rec('loans.insert') };
  const products = { getById: rec('products.getById', () => product) };
  const svc = new LoanApplicationService(uow as any, outbox as any, idem as any, quota as any, metrics as any, audit as any, wallet as any, repo as any, loans as any, products as any);
  return { svc, calls };
}
const borrower = { userId: 'u1', canBorrow: true, canManage: false };
const dto = (over: object = {}) => ({ productId: 'pr1', amountRequestedMinor: '5000000', ...over }) as any;

describe('PC-56 OPS-2b · B8 — a loan application cannot name a warehouse receipt', () => {
  it('nwrId present → 422 LOAN_ENWR_PLEDGE_NOT_ON_PLATFORM with the sentence; NOTHING was called (ordering spy empty)', async () => {
    const h = harness();
    const e: any = await h.svc.apply('t1', borrower, 'idem-1', dto({ nwrId: '0192d2c4-c0de-7000-8000-00000000beef' })).catch((x) => x);
    expect(e).toBeInstanceOf(LoanEnwrPledgeNotOnPlatformError);
    expect([e.code, e.httpStatus, e.message]).toEqual(['LOAN_ENWR_PLEDGE_NOT_ON_PLATFORM', 422, LOAN_ENWR_PLEDGE_NOT_ON_PLATFORM_SENTENCE]);
    expect(e.message).toBe('A loan application cannot name a warehouse receipt: pledging a warehouse receipt is not on this platform. Nothing was applied for.');
    expect(h.calls).toEqual([]);
  });
  it('the permission check still comes first: no loan.borrow → 403 FINTECH_FORBIDDEN', async () => {
    const h = harness();
    const e: any = await h.svc.apply('t1', { ...borrower, canBorrow: false }, 'idem-2', dto({ nwrId: '0192d2c4-c0de-7000-8000-00000000beef' })).catch((x) => x);
    expect([e.code, e.httpStatus]).toEqual(['FINTECH_FORBIDDEN', 403]);
    expect(h.calls).toEqual([]);
  });
  it('CONTROL: without nwrId the application goes through, in order, and is stored with no receipt', async () => {
    const h = harness();
    const out: any = await h.svc.apply('t1', borrower, 'idem-3', dto());
    expect(out.status).toBe('submitted');
    expect(out.nwrId ?? null).toBeNull();
    expect(h.calls).toEqual(['idem.remember', 'quota.assert', 'uow.run', 'products.getById', 'repo.insert', 'quota.increment', 'outbox.write']);
  });
});
