// modules/tenancy/__tests__/store1c-signup-flag.spec.ts · PC-56 STORE-1c · B1 (founder D1) — the platform switch `org_self_signup`, mocked
// half (the live half — the code really survives a refusal — is src/__tests__/store1c-signup.integration.spec.ts (2)).
//   • OFF → 403 SIGNUP_DISABLED, and NOTHING ran before it: no phone read, no code verified (so the code is not burned), no transaction;
//   • a flag-store failure counts as OFF (fail closed);
//   • ON → the code is verified with the DETAILED check (wrong → OTP_INVALID {reason: 'wrong', attemptsLeft}; locked → retryAfterSec);
//   • the gate is evaluated platform-wide (`{}` — there is no tenant before signup) under the name migration 0205 seeds;
//   • [found on the way] a created organisation is reported under the NAME it typed, not its slug.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TenantSignupService } from '../services/tenant-signup.service';
import { ORG_SELF_SIGNUP_FLAG, SignupDisabledError } from '../domain/signup';

const ORG_TYPE = '01c1c000-0000-7000-8000-0000000000f0';
const INPUT = { phone: '+919876543210', code: '123456', fullName: 'Kavita Ben', orgName: 'Bhavnagar Kisan FPC', orgTypeId: ORG_TYPE, lang: 'gu' };

function build(opts: { flag: boolean | 'throws'; verify?: unknown }) {
  const flags = { isEnabled: jest.fn(async () => { if (opts.flag === 'throws') throw new Error('flag store down'); return opts.flag; }) };
  const otp = { verify: jest.fn(), verifyDetailed: jest.fn(async () => opts.verify ?? { ok: true }) };
  const tx = {};
  const uow = { run: jest.fn(async (_t: unknown, fn: (tx: unknown) => unknown) => fn(tx)) };
  const users = { getByPhoneForUpdate: jest.fn(async () => null), insert: jest.fn() };
  const repo = {
    findAdministeredTenant: jest.fn(async () => null), enterTenantContext: jest.fn(),
    signupSettings: jest.fn(async () => ({ 'signup.trial_days': 14, 'signup.trial_plan_code': 'starter' })),
    tenantTypeExists: jest.fn(async () => true), publicPlanCodes: jest.fn(),
    trialPlan: jest.fn(async () => ({ id: 'plan-1', currencyCode: 'INR', monthlyPriceMinor: '499900' })),
    insertTenant: jest.fn(async () => ({ id: 'tenant-1', slug: 'bhavnagar-kisan-fpc' })),
    roleIdByCode: jest.fn(async () => 'role-1'), grantOwnerRole: jest.fn(), insertTrialSubscription: jest.fn(),
  };
  const audit = { write: jest.fn() };
  const outbox = { write: jest.fn() };
  const auth = { openSessionFor: jest.fn(async () => ({ accessToken: 'a', refreshToken: 'r', expiresInSec: 900 })) };
  const svc = new TenantSignupService(uow as never, otp as never, outbox as never, audit as never, users as never, auth as never, repo as never, flags as never);
  return { svc, flags, otp, uow, repo, audit };
}

describe('STORE-1c · B1 — the org_self_signup switch', () => {
  it('is the name migration 0205 seeds, seeded ON (the named Law 10 exception)', () => {
    expect(ORG_SELF_SIGNUP_FLAG).toBe('org_self_signup');
    const sql = readFileSync(join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations', '0205_org_signup_flag_plans.sql'), 'utf8');
    expect(sql).toMatch(/SELECT 'org_self_signup',[\s\S]*?\btrue, 100, '\{\}'::jsonb/);
    expect(sql).toContain('THE LAW 10 EXCEPTION, NAMED');
  });

  it('OFF → 403 SIGNUP_DISABLED, and the code is NOT verified (not burned), no transaction opened', async () => {
    const { svc, flags, otp, uow } = build({ flag: false });
    const e = await svc.signUp(INPUT, '203.0.113.9').then(() => null, (x) => x);
    expect(e).toBeInstanceOf(SignupDisabledError);
    expect(e).toMatchObject({ code: 'SIGNUP_DISABLED', httpStatus: 403 });
    expect(flags.isEnabled).toHaveBeenCalledWith('org_self_signup', {});
    expect(otp.verifyDetailed).not.toHaveBeenCalled();
    expect(otp.verify).not.toHaveBeenCalled();
    expect(uow.run).not.toHaveBeenCalled();
  });

  it('OFF is checked BEFORE input validation — even a malformed phone gets SIGNUP_DISABLED (one answer, nothing probed)', async () => {
    const { svc } = build({ flag: false });
    await expect(svc.signUp({ ...INPUT, phone: 'not-a-phone' }, null)).rejects.toMatchObject({ code: 'SIGNUP_DISABLED' });
  });

  it('a flag-store failure counts as OFF (fail closed)', async () => {
    const { svc, otp } = build({ flag: 'throws' });
    await expect(svc.signUp(INPUT, null)).rejects.toMatchObject({ code: 'SIGNUP_DISABLED', httpStatus: 403 });
    expect(otp.verifyDetailed).not.toHaveBeenCalled();
  });

  it('ON → the DETAILED code check: wrong says the tries left; locked says the wait — 401 OTP_INVALID, nothing written', async () => {
    let b = build({ flag: true, verify: { ok: false, reason: 'wrong', attemptsLeft: 3 } });
    await expect(b.svc.signUp(INPUT, null)).rejects.toMatchObject({ code: 'OTP_INVALID', httpStatus: 401, details: { reason: 'wrong', attemptsLeft: 3 } });
    expect(b.otp.verifyDetailed).toHaveBeenCalledWith('+919876543210', '123456');
    expect(b.uow.run).not.toHaveBeenCalled();
    b = build({ flag: true, verify: { ok: false, reason: 'locked', attemptsLeft: 0, retryAfterSec: 300 } });
    await expect(b.svc.signUp(INPUT, null)).rejects.toMatchObject({ code: 'OTP_INVALID', details: { reason: 'locked', retryAfterSec: 300 } });
    b = build({ flag: true, verify: { ok: false, reason: 'expired', attemptsLeft: 0 } });
    await expect(b.svc.signUp(INPUT, null)).rejects.toMatchObject({ details: { reason: 'expired' } });
  });

  it('ON + a good code → created, reported under the NAME the organisation typed (not its slug), trial dated, audited', async () => {
    const { svc, audit } = build({ flag: true });
    const r = await svc.signUp(INPUT, null);
    expect(r).toMatchObject({ tenantId: 'tenant-1', slug: 'bhavnagar-kisan-fpc', displayName: 'Bhavnagar Kisan FPC', resumed: false });
    expect(r.trialEndsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(audit.write.mock.calls.map((c) => c[1].action)).toEqual(['tenancy.self_serve_signup']);
  });
});
