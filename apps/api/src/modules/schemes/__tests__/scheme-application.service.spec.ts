// modules/schemes/__tests__/scheme-application.service.spec.ts · submit money-path unit test (fakes).
// Pins: submit collects the scheme processing fee (applicant → tenant 'main', txnType service_fee, ZERO-SUM)
// only when the scheme has a fee; a zero-fee scheme moves NO money. Appends an audit-trail event either way.
import { SchemeApplicationService } from '../services/scheme-application.service';
import { SchemeApplication } from '../domain/scheme-application.entity';
import { Scheme } from '../domain/scheme.entity';

const draft = () => SchemeApplication.draft({ id: 'a1', tenantId: 't1', schemeId: 's1', schemeVersion: 1, schemeVersionId: null, applicantUserId: 'u1', assistedBy: null, formData: {}, eligibilityCheck: null });
const scheme = (feeMinor: bigint) => Scheme.rehydrate({ id: 's1', code: 'smam', defaultName: 'SMAM', authorityId: 'au1', categoryId: 'c1', benefitSummary: {}, eligibilityRules: {}, requiredDocTypeIds: [], applicationWindow: null, applicableRegionIds: [], processingFeeMinor: feeMinor, version: 1, isActive: true });

function harness(feeMinor: bigint) {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() }; const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const quota = { assertWithinLimit: jest.fn(), increment: jest.fn() }; const metrics = { inc: jest.fn(), observe: jest.fn() }; const audit = { write: jest.fn() };
  const wallet = { post: jest.fn(async () => ({ txnId: 't', alreadyApplied: false })), balanceMinor: jest.fn() };
  const repo = { getForUpdate: jest.fn(async () => draft()), update: jest.fn(), appendEvent: jest.fn() };
  const schemes = { getById: jest.fn(async () => scheme(feeMinor)) };
  const svc = new SchemeApplicationService(uow as any, outbox as any, idem as any, quota as any, metrics as any, audit as any, wallet as any, repo as any, schemes as any,
    // ADMIN-4: the version reader. `currentPublished` returning null keeps these existing cases on the pre-0105
    // fallback path, which is exactly the behaviour they were written to assert.
    { currentPublished: async () => null, byId: async () => null } as any);
  return { svc, wallet, repo };
}
const applicant = { userId: 'u1', canApply: true, canProcess: false };

describe('submit — processing-fee money path', () => {
  it('collects the fee applicant→tenant (zero-sum, service_fee) + appends an event', async () => {
    const { svc, wallet, repo } = harness(5000n);
    const out: any = await svc.submit('t1', applicant, 'a1', 'idem-s');
    expect(out.status).toBe('submitted'); expect(out.processingFeeMinor).toBe('5000');
    expect(repo.appendEvent).toHaveBeenCalledTimes(1);
    const arg: any = (wallet.post.mock.calls as any[])[0][1];
    expect(arg.txnType).toBe('service_fee'); expect(arg.idempotencyKey).toBe('schemefee:a1');
    expect(arg.legs.reduce((a: bigint, l: any) => a + l.amountMinor, 0n)).toBe(0n);   // ZERO-SUM
    expect(arg.legs.find((l: any) => l.amountMinor < 0n).account.userId).toBe('u1');   // applicant debited
    expect(arg.legs.find((l: any) => l.amountMinor > 0n).account.kind).toBe('tenant'); // tenant pool credited
  });
  it('a zero-fee scheme moves NO money but still submits + audits', async () => {
    const { svc, wallet, repo } = harness(0n);
    const out: any = await svc.submit('t1', applicant, 'a1', 'idem-s2');
    expect(out.status).toBe('submitted'); expect(out.processingFeeMinor).toBe('0');
    expect(wallet.post).not.toHaveBeenCalled(); expect(repo.appendEvent).toHaveBeenCalledTimes(1);
  });
});
