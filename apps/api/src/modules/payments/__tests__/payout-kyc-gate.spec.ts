// modules/payments/__tests__/payout-kyc-gate.spec.ts
//
// ORIGINAL FINDING (S3 review): `requestPayout` had no kyc_status check at all — an unapproved self-serve farmer
// (kyc_status='none' straight off POST /v1/onboarding/roles) could reach the wallet debit. Fixed then by asserting a
// verified status on ANY active role.
//
// **PC-56 TENANT-1 FOUND THAT FIX WRONG IN THE PERMISSIVE DIRECTION, AND THIS FILE NOW PINS THE CORRECTED RULE.**
// W153 states the platform's own rule twice — "KYC is per role, not per person" and "worst-status view — multi-role
// members count at their lowest role" — and its example row is the exploit: Kanji Bhai R. is `worker: verified` /
// `farmer: pending`, and under "any role" he could draw a SETTLEMENT payout. Crop sale proceeds on the strength of a
// wage-receipt check. `user_tenant_roles.kyc_status` has been per person × tenant × role since 0003; only this gate
// collapsed it.
//
// Every property the S3 spec pinned is kept below (each unverified status fails closed, nothing moves before the gate,
// the error is user-safe). What is ADDED is the per-role behaviour, and the first test is the canon's own member.
import { PayoutService } from '../services/payout.service';
import { RoleKycRequiredError } from '../domain/payments.errors';
import type { RoleKyc } from '../domain/payout-kyc';

type Kyc = 'none' | 'pending' | 'verified' | 'rejected' | 'expired';

/** Roles as the repository returns them, so the harness exercises the real domain rather than a boolean. */
function harness(roles: RoleKyc[], purposeRoles: string[] = ['farmer', 'dairy_farmer', 'pashupalak', 'vyapari', 'organic_store']) {
  const tx = { query: jest.fn(), tenantId: 't1', userId: 'u1' };
  const uow = { run: jest.fn((_tenantId: string, fn: (tx: any) => any) => fn(tx)) };
  const outbox = { write: jest.fn(async () => undefined) };
  const idem = { remember: jest.fn((_key: string, _userId: string, _name: string, fn: () => any) => fn()) };
  const metrics = { observe: jest.fn(), inc: jest.fn() };
  const wallet = { post: jest.fn(async () => ({ txnId: 'txn1' })) };
  const gateway = {};
  const audit = { write: jest.fn(async () => undefined) };
  const repo = {
    callerRoleKyc: jest.fn(async () => roles),
    rolesForPurpose: jest.fn(async () => purposeRoles),
    bankAccountBelongsTo: jest.fn(async () => true),
    resolvePurposeId: jest.fn(async () => 'purpose1'),
    insertIdempotent: jest.fn(async () => ({ id: 'po1', replayed: false })),
  };
  const svc = new PayoutService(uow as any, outbox as any, idem as any, metrics as any, wallet as any, gateway as any, audit as any, repo as any);
  return { svc, repo, wallet, outbox, audit, metrics };
}

const role = (roleCode: string, kycStatus: Kyc, isActive = true): RoleKyc => ({ roleCode, kycStatus, isActive });
const dto = { amountMinor: '10000', bankAccountId: 'b1', purpose: 'settlement' as const, currencyCode: 'INR' };

describe('TENANT-1 · the canon’s own member cannot draw a farmer settlement on a worker verification', () => {
  it('refuses Kanji Bhai R. — worker: verified, farmer: pending — and moves no money', async () => {
    // W153's third row, exactly. Under the old gate this returned a queued payout.
    const h = harness([role('worker', 'verified'), role('farmer', 'pending')]);
    await expect(h.svc.requestPayout('t1', 'u1', 'idem-kanji', dto)).rejects.toThrow(RoleKycRequiredError);
    // Nothing before the gate, nothing after it: no bank check, no debit, no outbox, no audit.
    expect(h.repo.bankAccountBelongsTo).not.toHaveBeenCalled();
    expect(h.wallet.post).not.toHaveBeenCalled();
    expect(h.outbox.write).not.toHaveBeenCalled();
    expect(h.audit.write).not.toHaveBeenCalled();
  });

  it('names the role and its status, because a bare refusal is one nobody can act on', async () => {
    const h = harness([role('worker', 'verified'), role('farmer', 'pending')]);
    try {
      await h.svc.requestPayout('t1', 'u1', 'idem-name', dto);
      throw new Error('expected requestPayout to throw');
    } catch (e) {
      const err = e as RoleKycRequiredError;
      expect(err.code).toBe('ROLE_KYC_REQUIRED');
      expect(err.httpStatus).toBe(403);
      // "settlement money is claimed as farmer or … ; your farmer verification is pending" — a field officer can act on
      // that today, and the member knows which verification to finish.
      expect(err.message).toMatch(/farmer/);
      expect(err.message).toMatch(/pending/);
      expect(err.details).toMatchObject({ decidingRole: 'farmer', decidingStatus: 'pending', reason: 'eligible_role_unverified' });
    }
  });

  it('lets the same member draw a WAGE payout, because that is the role they are verified in', async () => {
    // The fix must not become "verified everywhere or nothing": Kanji Bhai is a verified worker and his wages are his.
    const h = harness([role('worker', 'verified'), role('farmer', 'pending')], ['worker', 'sardar']);
    const out = await h.svc.requestPayout('t1', 'u1', 'idem-wage', { ...dto, purpose: 'wage' as any });
    expect(out).toMatchObject({ status: 'queued' });
    expect(h.wallet.post).toHaveBeenCalled();
  });

  it('refuses a member who holds no eligible role at all', async () => {
    // An ambassador drawing a settlement: not a KYC problem, a capacity problem, and the reason says which.
    const h = harness([role('ambassador', 'verified')]);
    try {
      await h.svc.requestPayout('t1', 'u1', 'idem-amb', dto);
      throw new Error('expected requestPayout to throw');
    } catch (e) {
      expect((e as RoleKycRequiredError).details).toMatchObject({ reason: 'no_eligible_role_held', decidingRole: null });
    }
  });
});

describe('PayoutService.requestPayout — every unverified status still fails closed (the S3 properties)', () => {
  it.each(['none', 'pending', 'rejected', 'expired'] as Kyc[])(
    'farmer kyc_status=%s → 403, no money moves',
    async (kyc) => {
      const h = harness([role('farmer', kyc)]);
      await expect(h.svc.requestPayout('t1', 'u1', `idem-${kyc}`, dto)).rejects.toThrow(RoleKycRequiredError);
      expect(h.repo.bankAccountBelongsTo).not.toHaveBeenCalled();
      expect(h.wallet.post).not.toHaveBeenCalled();
      expect(h.outbox.write).not.toHaveBeenCalled();
      expect(h.audit.write).not.toHaveBeenCalled();
    },
  );

  it('farmer kyc_status=verified → proceeds to reserve funds and queue the payout', async () => {
    const h = harness([role('farmer', 'verified')]);
    const out = await h.svc.requestPayout('t1', 'u1', 'idem-ok', dto);
    expect(out).toMatchObject({ payoutId: expect.any(String), status: 'queued', amountMinor: '10000' });
    expect(h.repo.bankAccountBelongsTo).toHaveBeenCalled();
    expect(h.wallet.post).toHaveBeenCalled();
    expect(h.outbox.write).toHaveBeenCalled();
    expect(h.audit.write).toHaveBeenCalled();
  });

  it('an INACTIVE verified role does not open the gate', async () => {
    // A revoked farmer role that was once verified is not a capacity to receive money in.
    const h = harness([role('farmer', 'verified', false)]);
    await expect(h.svc.requestPayout('t1', 'u1', 'idem-inactive', dto)).rejects.toThrow(RoleKycRequiredError);
    expect(h.wallet.post).not.toHaveBeenCalled();
  });

  it('a member with no roles at all is refused', async () => {
    const h = harness([]);
    try {
      await h.svc.requestPayout('t1', 'u1', 'idem-noroles', dto);
      throw new Error('expected requestPayout to throw');
    } catch (e) {
      expect((e as RoleKycRequiredError).details).toMatchObject({ reason: 'no_active_roles' });
    }
  });

  it('records the refusal on a metric so a spike is visible', async () => {
    const h = harness([role('farmer', 'pending')]);
    await expect(h.svc.requestPayout('t1', 'u1', 'idem-metric', dto)).rejects.toThrow(RoleKycRequiredError);
    expect(h.metrics.inc).toHaveBeenCalledWith('payments.payout.role_kyc_refused',
      expect.objectContaining({ purpose: 'settlement', reason: 'eligible_role_unverified' }));
  });
});

describe('TENANT-1 · an UNMAPPED purpose fails to the strictest reading', () => {
  // A purpose with no rows in 0125's map is a payout kind nobody has thought about yet. The moment to discover that is
  // before the money moves — sixth time this programme has made unknown mean refuse, and the first on a money gate.
  it('requires EVERY active role verified when the purpose is unmapped', async () => {
    const h = harness([role('farmer', 'verified'), role('worker', 'pending')], []);
    try {
      await h.svc.requestPayout('t1', 'u1', 'idem-unmapped', { ...dto, purpose: 'brand_new_thing' as any });
      throw new Error('expected requestPayout to throw');
    } catch (e) {
      expect((e as RoleKycRequiredError).details).toMatchObject({
        reason: 'unmapped_purpose_some_role_unverified', decidingRole: 'worker',
      });
    }
    expect(h.wallet.post).not.toHaveBeenCalled();
  });

  it('allows an unmapped purpose only when every active role is verified', async () => {
    const h = harness([role('farmer', 'verified'), role('worker', 'verified')], []);
    const out = await h.svc.requestPayout('t1', 'u1', 'idem-unmapped-ok', { ...dto, purpose: 'brand_new_thing' as any });
    expect(out).toMatchObject({ status: 'queued' });
  });

  it('resolves the purpose BEFORE the gate, so an unknown purpose is a 400 rather than a KYC refusal', async () => {
    // Telling a member "complete your KYC" when the real fault is an unknown purpose code sends them to fix something
    // that is not broken.
    const h = harness([role('farmer', 'verified')]);
    h.repo.resolvePurposeId.mockResolvedValueOnce(null as any);
    await expect(h.svc.requestPayout('t1', 'u1', 'idem-badpurpose', dto)).rejects.toThrow(/unknown payout purpose/i);
    expect(h.repo.callerRoleKyc).not.toHaveBeenCalled();
    expect(h.wallet.post).not.toHaveBeenCalled();
  });
});
