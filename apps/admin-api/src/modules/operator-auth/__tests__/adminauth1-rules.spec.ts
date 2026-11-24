// PC-56 ADMIN-AUTH-1 · the pure rules: operator bindings (config, validated against owner-roles.ts), production config
// refusals, enrollment-code decisions (bootstrap only while zero credentials; single use; expiry; never for oneself), ticket
// verdicts (single use + expiry), key-revocation rules, token minting claims, the rate limiter and the redirect guard.
import { AdminConfig } from '../../../core/config/admin-config';
import { bindingFor, parseOperatorBindings } from '../../../core/auth/operator-bindings';
import { signAdminToken } from '../../../core/auth/admin-token.signer';
import { verifyAdminToken } from '../../../core/auth/admin-jwt.strategy';
import {
  CODE_ALPHABET, FixedWindowLimiter, TICKET_MAX_FAILED_ATTEMPTS, canIssueCode, canonicalCode, decideEnrollment, formatEnrollmentCode,
  revokeKeyVerdict, safeRelativePath, ticketVerdict,
} from '../domain/operator-auth.rules';
import { randomBytes } from 'node:crypto';

const fresh = () => randomBytes(32).toString('hex');
const PROD = {
  NODE_ENV: 'production', ADMIN_JWT_SECRET: fresh(), DATABASE_ADMIN_URL: `postgres://kv_admin:${fresh()}@db.example.com/k`,
  ADMIN_IP_ALLOWLIST: '203.0.113.7', ADMIN_REQUIRE_HARDWARE_KEY: 'true', ADMIN_OPERATOR_REGISTRY_ENABLED: 'true',
  ADMIN_OIDC_CLIENT_ID: 'client.apps.googleusercontent.com', ADMIN_OIDC_CLIENT_SECRET: fresh(),
  ADMIN_OIDC_REDIRECT_URI: 'https://admin-api.krishalaya.com/v1/auth/sso/callback', ADMIN_OIDC_ALLOWED_DOMAINS: 'krishalaya.com',
  ADMIN_CONSOLE_URL: 'https://admin.krishalaya.com', ADMIN_WEBAUTHN_RP_ID: 'krishalaya.com', ADMIN_WEBAUTHN_ORIGIN: 'https://admin.krishalaya.com',
  ADMIN_OPERATOR_BINDINGS: JSON.stringify([{ email: 'founder@krishalaya.com', roles: ['super_admin'] }]),
};
const errorOf = (fn: () => unknown): string => { try { fn(); return ''; } catch (e) { return (e as Error).message; } };

describe('ADMIN-AUTH-1 · operator bindings are config, validated against owner-roles.ts', () => {
  it('parses, lower-cases and de-duplicates roles', () => {
    const r = parseOperatorBindings(JSON.stringify([{ email: ' Founder@Krishalaya.COM ', roles: ['super_admin', 'super_admin'] }, { email: 'ops@krishalaya.com', roles: ['platform_staff_ops', 'platform_recon_viewer'] }]), true);
    expect(r.errors).toEqual([]);
    expect(r.bindings).toEqual([{ email: 'founder@krishalaya.com', roles: ['super_admin'] }, { email: 'ops@krishalaya.com', roles: ['platform_staff_ops', 'platform_recon_viewer'] }]);
    expect(bindingFor(r.bindings, 'OPS@krishalaya.com')?.roles).toEqual(['platform_staff_ops', 'platform_recon_viewer']);
    expect(bindingFor(r.bindings, 'nobody@krishalaya.com')).toBeNull();
  });
  it('an unknown role is a production refusal and a development warning (role dropped)', () => {
    const raw = JSON.stringify([{ email: 'a@x.com', roles: ['super_admin', 'god_emperor'] }]);
    expect(parseOperatorBindings(raw, true).errors.join()).toMatch(/god_emperor.*does not exist in owner-roles\.ts/);
    const dev = parseOperatorBindings(raw, false);
    expect(dev.errors).toEqual([]);
    expect(dev.warnings.join()).toMatch(/god_emperor/);
    expect(dev.bindings[0].roles).toEqual(['super_admin']);
  });
  it('duplicates and malformed JSON are refused in every environment; zero bindings refused in production', () => {
    const dup = JSON.stringify([{ email: 'a@x.com', roles: ['super_admin'] }, { email: 'A@X.com', roles: ['platform_auditor'] }]);
    expect(parseOperatorBindings(dup, false).errors.join()).toMatch(/duplicate binding for a@x\.com/);
    expect(parseOperatorBindings('{not json', false).errors.join()).toMatch(/not valid JSON/);
    expect(parseOperatorBindings('{"email":"a@x.com"}', false).errors.join()).toMatch(/JSON array/);
    expect(parseOperatorBindings('[{"email":"bad","roles":["super_admin"]}]', false).errors.join()).toMatch(/invalid email/);
    expect(parseOperatorBindings('', true).errors.join()).toMatch(/at least one operator binding/);
    expect(parseOperatorBindings('[]', true).errors.join()).toMatch(/zero bindings/);
    expect(parseOperatorBindings('', false).errors).toEqual([]);
    expect(errorOf(() => new AdminConfig({ NODE_ENV: 'development', ADMIN_OPERATOR_BINDINGS: dup }))).toMatch(/duplicate/);
  });
});

describe('ADMIN-AUTH-1 · production refuses to boot without a complete sign-in', () => {
  it('boots with everything set', () => {
    expect(errorOf(() => new AdminConfig(PROD))).toBe('');
  });
  it.each([
    ['ADMIN_OIDC_CLIENT_ID', '', /ADMIN_OIDC_CLIENT_ID/],
    ['ADMIN_OIDC_CLIENT_SECRET', '', /ADMIN_OIDC_CLIENT_SECRET/],
    ['ADMIN_OIDC_REDIRECT_URI', 'http://admin-api.krishalaya.com/v1/auth/sso/callback', /ADMIN_OIDC_REDIRECT_URI/],
    ['ADMIN_OIDC_ALLOWED_DOMAINS', '', /ADMIN_OIDC_ALLOWED_DOMAINS/],
    ['ADMIN_OIDC_ISSUER', 'http://accounts.google.com', /ADMIN_OIDC_ISSUER/],
    ['ADMIN_CONSOLE_URL', '', /ADMIN_CONSOLE_URL/],
    ['ADMIN_WEBAUTHN_RP_ID', '', /ADMIN_WEBAUTHN_RP_ID/],
    ['ADMIN_WEBAUTHN_ORIGIN', 'https://admin.evil.com', /subdomain of it/],
    ['ADMIN_OPERATOR_BINDINGS', '[]', /zero bindings/],
    ['ADMIN_OPERATOR_BINDINGS', JSON.stringify([{ email: 'a@krishalaya.com', roles: ['nope'] }]), /does not exist in owner-roles/],
    ['ADMIN_BOOTSTRAP_ENROLLMENT_CODE_SHA256', 'not-hex', /64 hex/],
    ['ADMIN_DEV_LOGIN_ENABLED', 'true', /ADMIN_DEV_LOGIN_ENABLED must be false/],
  ])('%s=%p is refused', (k, v, re) => {
    expect(errorOf(() => new AdminConfig({ ...PROD, [k]: v }))).toMatch(re);
  });
  it('defaults: Google as issuer, 8 h sessions clamped to [5 min, 12 h]', () => {
    const c = new AdminConfig({ NODE_ENV: 'test' });
    expect(c.oidc.issuer).toBe('https://accounts.google.com');
    expect(c.env.ADMIN_SESSION_TTL_SEC).toBe(28_800);
    expect(new AdminConfig({ NODE_ENV: 'test', ADMIN_SESSION_TTL_SEC: '999999' }).env.ADMIN_SESSION_TTL_SEC).toBe(43_200);
  });
});

describe('ADMIN-AUTH-1 · enrollment codes', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  const BOOT = 'a'.repeat(64);
  const code = (over: Partial<Parameters<typeof decideEnrollment>[0]['codeRow'] & object> = {}) => ({
    id: 'c1', email: 'new@krishalaya.com', issuedByEmail: 'founder@krishalaya.com',
    expiresAt: new Date(now.getTime() + 3600_000), consumedAt: null, revokedAt: null, ...over,
  });
  const base = { codeSha256: 'b'.repeat(64), operatorEmail: 'new@krishalaya.com', activeCredentialsPlatformWide: 1, bootstrapSha256: BOOT, bootstrapAlreadyUsed: false, codeRow: code(), now };

  it('BOOTSTRAP is accepted only while ZERO active credentials exist platform-wide, and only once', () => {
    expect(decideEnrollment({ ...base, codeSha256: BOOT, codeRow: null, activeCredentialsPlatformWide: 0 })).toEqual({ ok: true, via: 'bootstrap' });
    expect(decideEnrollment({ ...base, codeSha256: BOOT, codeRow: null, activeCredentialsPlatformWide: 1 })).toEqual({ ok: false, reason: 'bootstrap_closed' });
    expect(decideEnrollment({ ...base, codeSha256: BOOT, codeRow: null, activeCredentialsPlatformWide: 0, bootstrapAlreadyUsed: true })).toEqual({ ok: false, reason: 'bootstrap_used' });
    // No bootstrap configured: the same hash is just an unknown code.
    expect(decideEnrollment({ ...base, codeSha256: BOOT, codeRow: null, activeCredentialsPlatformWide: 0, bootstrapSha256: '' })).toEqual({ ok: false, reason: 'no_such_code' });
  });
  it('an issued code: for exactly this email, single use, unrevoked, unexpired, never self-issued', () => {
    expect(decideEnrollment(base)).toEqual({ ok: true, via: 'enrollment_code', codeId: 'c1' });
    expect(decideEnrollment({ ...base, codeRow: null })).toEqual({ ok: false, reason: 'no_such_code' });
    expect(decideEnrollment({ ...base, operatorEmail: 'other@krishalaya.com' })).toEqual({ ok: false, reason: 'code_for_other_email' });
    expect(decideEnrollment({ ...base, codeRow: code({ consumedAt: now }) })).toEqual({ ok: false, reason: 'code_consumed' });
    expect(decideEnrollment({ ...base, codeRow: code({ revokedAt: now }) })).toEqual({ ok: false, reason: 'code_revoked' });
    expect(decideEnrollment({ ...base, codeRow: code({ expiresAt: now }) })).toEqual({ ok: false, reason: 'code_expired' });
    expect(decideEnrollment({ ...base, codeRow: code({ issuedByEmail: 'new@krishalaya.com' }) })).toEqual({ ok: false, reason: 'code_self_issued' });
  });
  it('issuing: never for oneself, never for an unbound email', () => {
    expect(canIssueCode('a@k.com', 'A@k.com', true)).toEqual({ ok: false, reason: 'self' });
    expect(canIssueCode('a@k.com', 'b@k.com', false)).toEqual({ ok: false, reason: 'not_bound' });
    expect(canIssueCode('a@k.com', 'b@k.com', true)).toEqual({ ok: true });
  });
  it('codes are typable (unambiguous alphabet, grouped) and canonicalise for hashing', () => {
    const c = formatEnrollmentCode(randomBytes(20));
    expect(c).toMatch(new RegExp(`^([${CODE_ALPHABET}]{5}-){3}[${CODE_ALPHABET}]{5}$`));
    expect(canonicalCode(` ${c.toLowerCase()} `)).toBe(c.replace(/-/g, ''));
  });
});

describe('ADMIN-AUTH-1 · pending login tickets', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  const t = { adminUserId: 'u', email: 'e@k.com', expiresAt: new Date(now.getTime() + 60_000), consumedAt: null, failedAttempts: 0 };
  it('single use, ≤ 5 min, burnt after too many failed ceremonies', () => {
    expect(ticketVerdict(t, now)).toEqual({ ok: true });
    expect(ticketVerdict(null, now)).toEqual({ ok: false, reason: 'unknown' });
    expect(ticketVerdict({ ...t, consumedAt: now }, now)).toEqual({ ok: false, reason: 'consumed' });
    expect(ticketVerdict({ ...t, expiresAt: now }, now)).toEqual({ ok: false, reason: 'expired' });
    expect(ticketVerdict({ ...t, failedAttempts: TICKET_MAX_FAILED_ATTEMPTS }, now)).toEqual({ ok: false, reason: 'too_many_failures' });
  });
});

describe('ADMIN-AUTH-1 · revoking keys', () => {
  const key = (adminUserId: string) => ({ adminUserId, revokedAt: null });
  it('own key only while another remains; another operator\'s (even their last) needs staff.manage', () => {
    expect(revokeKeyVerdict({ key: key('me'), actorId: 'me', actorHasStaffManage: false, ownActiveKeys: 2 })).toEqual({ ok: true });
    expect(revokeKeyVerdict({ key: key('me'), actorId: 'me', actorHasStaffManage: true, ownActiveKeys: 1 })).toEqual({ ok: false, reason: 'last_own_key' });
    expect(revokeKeyVerdict({ key: key('them'), actorId: 'me', actorHasStaffManage: false, ownActiveKeys: 1 })).toEqual({ ok: false, reason: 'needs_staff_manage' });
    expect(revokeKeyVerdict({ key: key('them'), actorId: 'me', actorHasStaffManage: true, ownActiveKeys: 1 })).toEqual({ ok: true });
    expect(revokeKeyVerdict({ key: { adminUserId: 'me', revokedAt: new Date() }, actorId: 'me', actorHasStaffManage: true, ownActiveKeys: 3 })).toEqual({ ok: false, reason: 'already_revoked' });
    expect(revokeKeyVerdict({ key: null, actorId: 'me', actorHasStaffManage: true, ownActiveKeys: 3 })).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('ADMIN-AUTH-1 · the minted admin token', () => {
  it('carries sub, binding roles, amr [oidc,hwk], auth_time, sid, exp — and verifies with the realm\'s own strategy', () => {
    const cfg = new AdminConfig({ NODE_ENV: 'test', ADMIN_JWT_SECRET: 'x'.repeat(40) });
    const now = Math.floor(Date.now() / 1000);
    const tok = signAdminToken({ sub: '0190a0b0-0000-7000-8000-000000000001', roles: ['platform_recon_ops'], amr: ['oidc', 'hwk'], authTimeSec: now, sid: 's-1', expSec: now + 600 }, cfg, now);
    const p = verifyAdminToken(tok, cfg);
    expect(p).toEqual({ userId: '0190a0b0-0000-7000-8000-000000000001', roles: ['platform_recon_ops'], amr: ['oidc', 'hwk'], authTimeSec: now, sessionId: 's-1', expSec: now + 600 });
    const payload = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString());
    expect(payload).toMatchObject({ iss: cfg.jwt.issuer, aud: cfg.jwt.audience, iat: now });
    expect(() => verifyAdminToken(tok, new AdminConfig({ NODE_ENV: 'test', ADMIN_JWT_SECRET: 'y'.repeat(40) }))).toThrow(/bad signature/);
  });
});

describe('ADMIN-AUTH-1 · rate limiter and redirect guard', () => {
  it('fixed window per key', () => {
    const l = new FixedWindowLimiter();
    expect([1, 2, 3].map(() => l.take('k', 2, 60_000, 0))).toEqual([true, true, false]);
    expect(l.take('other', 2, 60_000, 0)).toBe(true);
    expect(l.take('k', 2, 60_000, 60_000)).toBe(true);
  });
  it('is memory-bounded', () => {
    const l = new FixedWindowLimiter(3);
    for (let i = 0; i < 10; i++) l.take(`k${i}`, 1, 60_000, 0);
    expect((l as unknown as { hits: Map<string, unknown> }).hits.size).toBeLessThanOrEqual(3);
  });
  it('only same-console relative paths', () => {
    expect(safeRelativePath('/tenants/1?x=2')).toBe('/tenants/1?x=2');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '/a\r\nSet-Cookie: x', 7]) expect(safeRelativePath(bad)).toBe('/dashboard');
  });
});
