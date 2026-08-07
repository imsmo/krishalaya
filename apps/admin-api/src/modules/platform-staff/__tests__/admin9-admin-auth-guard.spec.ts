// apps/admin-api/src/modules/platform-staff/__tests__/admin9-admin-auth-guard.spec.ts · PC-56 ADMIN-9.
//
// THE FRONT DOOR, exercised end to end with a stubbed registry. Everything else in this wave is a console; this file is
// the only place where a mistake means an unauthorised person inside the god-mode realm, or an authorised one locked out.
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { AdminConfig } from '../../../core/config/admin-config';
import { AdminAuthGuard } from '../../../core/auth/admin-auth.guard';
import { DEFAULT_ACCESS_POLICY } from '../../../core/auth/operator-access';

const SECRET = 'a-test-admin-secret-at-least-32-chars-long';
const cfg = new AdminConfig({
  NODE_ENV: 'test',
  ADMIN_JWT_SECRET: SECRET,
  ADMIN_JWT_ISSUER: 'kv-admin-idp',
  ADMIN_JWT_AUDIENCE: 'kv-admin-api',
  DATABASE_ADMIN_URL: 'postgres://x/y',
} as Record<string, unknown>);

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({
    iss: 'kv-admin-idp', aud: 'kv-admin-api', sub: 'op-1', roles: ['platform_recon_ops'],
    amr: ['pwd', 'hwk'], auth_time: now - 60, sid: 'sess-1', exp: now + 3600, ...claims,
  });
  const s = createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

const ctx = (bearer?: string) => {
  const req: any = {
    headers: bearer ? { authorization: `Bearer ${bearer}`, 'user-agent': 'jest' } : {},
    ip: '10.0.0.9', socket: { remoteAddress: '10.0.0.9' },
  };
  return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as any };
};

const DAY = 86_400_000;
function registry(over: Record<string, unknown> = {}) {
  return {
    accessPolicy: jest.fn().mockResolvedValue({ policy: DEFAULT_ACCESS_POLICY, fromDatabase: true }),
    accessInputs: jest.fn().mockResolvedValue({
      operator: {
        adminUserId: 'op-1', status: 'active', lastSeenAt: new Date(), firstSeenAt: new Date(Date.now() - 100 * DAY),
        suspendedAt: null, suspendKind: null, suspendReason: null,
      },
      session: { sessionId: 'sess-1', revokedAt: null, revokeReason: null },
      restrictions: [],
    }),
    observe: jest.fn().mockResolvedValue(undefined),
    autoSuspendDormant: jest.fn().mockResolvedValue(true),
    ...over,
  } as any;
}

describe('AdminAuthGuard · token verification is unchanged', () => {
  it('refuses a missing, malformed or badly-signed token with 401', async () => {
    const g = new AdminAuthGuard(cfg, registry());
    await expect(g.canActivate(ctx().ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(g.canActivate(ctx('not.a.token').ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    const bad = `${token().split('.').slice(0, 2).join('.')}.tampered`;
    await expect(g.canActivate(ctx(bad).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('admits a valid token and resolves permissions from the catalogue', async () => {
    const { req, ctx: c } = ctx(token());
    expect(await new AdminAuthGuard(cfg, registry()).canActivate(c)).toBe(true);
    expect(req.admin.userId).toBe('op-1');
    expect(req.admin.permissions.has('recon.manage')).toBe(true);
    expect(req.admin.sessionId).toBe('sess-1');
  });
});

describe('AdminAuthGuard · the registry checks that did not exist before 0118', () => {
  it('REFUSES A SUSPENDED OPERATOR — the deactivation W104 promised and never had', async () => {
    const reg = registry({
      accessInputs: jest.fn().mockResolvedValue({
        operator: {
          adminUserId: 'op-1', status: 'suspended', lastSeenAt: new Date(), firstSeenAt: new Date(),
          suspendedAt: new Date(), suspendKind: 'manual', suspendReason: 'left the company on 7 Aug',
        },
        session: null, restrictions: [],
      }),
    });
    const g = new AdminAuthGuard(cfg, reg);
    // **403 AND NOT 401, AND THE STATUS IS ASSERTED RATHER THAN THE CLASS.** The credential is valid and the realm is
    // refusing it; a 401 would send the console into a re-authentication loop against an IdP that would happily mint
    // another perfectly good token. The refusal also carries a machine-readable `reason`, because it is audited and an
    // audited reason has to be countable.
    await expect(g.canActivate(ctx(token()).ctx)).rejects.toMatchObject({ status: 403 });
    const err = await g.canActivate(ctx(token()).ctx).catch((e: HttpException) => e);
    expect((err as HttpException).getResponse()).toMatchObject({ code: 'ADMIN_ACCESS_REFUSED', reason: 'suspended' });
    expect(reg.observe).not.toHaveBeenCalled();   // a refused request does not refresh the operator's last-seen
  });

  it('REFUSES A REVOKED SESSION — `sid` was minted and read by nothing', async () => {
    const reg = registry({
      accessInputs: jest.fn().mockResolvedValue({
        operator: {
          adminUserId: 'op-1', status: 'active', lastSeenAt: new Date(), firstSeenAt: new Date(),
          suspendedAt: null, suspendKind: null, suspendReason: null,
        },
        session: { sessionId: 'sess-1', revokedAt: new Date(), revokeReason: 'lost device' },
        restrictions: [],
      }),
    });
    await expect(new AdminAuthGuard(cfg, reg).canActivate(ctx(token()).ctx)).rejects.toThrow(/revoked/);
  });

  it('REFUSES AND SUSPENDS a dormant operator, in that order', async () => {
    const reg = registry({
      accessInputs: jest.fn().mockResolvedValue({
        operator: {
          adminUserId: 'op-1', status: 'active', lastSeenAt: new Date(Date.now() - 46 * DAY),
          firstSeenAt: new Date(Date.now() - 400 * DAY), suspendedAt: null, suspendKind: null, suspendReason: null,
        },
        session: null, restrictions: [],
      }),
    });
    await expect(new AdminAuthGuard(cfg, reg).canActivate(ctx(token()).ctx))
      .rejects.toMatchObject({ status: 403 });
    // The suspension is written BEFORE the throw, so the refusal and the record are one event rather than a refusal
    // that depended on somebody later noticing. Enforced at the door because a scheduled sweep is one more job that can
    // silently stop — this platform has found exactly that twice (0113, 0114).
    expect(reg.autoSuspendDormant).toHaveBeenCalledWith('op-1', 45);
  });

  it('SUBTRACTS a restriction, and reports both sets so a 403 can explain itself', async () => {
    const reg = registry({
      accessInputs: jest.fn().mockResolvedValue({
        operator: {
          adminUserId: 'op-1', status: 'active', lastSeenAt: new Date(), firstSeenAt: new Date(),
          suspendedAt: null, suspendKind: null, suspendReason: null,
        },
        session: { sessionId: 'sess-1', revokedAt: null, revokeReason: null },
        restrictions: [{ permissionCode: 'recon.manage', reason: 'read-only pending review', expiresAt: null }],
      }),
    });
    const { req, ctx: c } = ctx(token());
    expect(await new AdminAuthGuard(cfg, reg).canActivate(c)).toBe(true);
    expect(req.admin.permissions.has('recon.manage')).toBe(false);
    expect(req.admin.permissions.has('recon.read')).toBe(true);
    // "Your roles hold this and a restriction removes it" is a different answer from "your roles do not hold this".
    expect(req.admin.grantedBeforeRestrictions.has('recon.manage')).toBe(true);
    expect(req.admin.restrictedCodes).toEqual(['recon.manage']);
  });

  it('admits an operator the realm has never seen, and records the first sighting', async () => {
    const reg = registry({
      accessInputs: jest.fn().mockResolvedValue({ operator: null, session: null, restrictions: [] }),
    });
    const { req, ctx: c } = ctx(token());
    expect(await new AdminAuthGuard(cfg, reg).canActivate(c)).toBe(true);
    // Refusing first sightings would mean nobody could ever sign in, and the table would have to be populated by the
    // directory sync this design exists to avoid.
    expect(reg.observe).toHaveBeenCalledTimes(1);
    expect(reg.observe.mock.calls[0][0]).toMatchObject({ adminUserId: 'op-1', sessionId: 'sess-1', roles: ['platform_recon_ops'] });
    expect(req.admin.dormancy).toMatchObject({ kind: 'active', daysSinceSeen: 0 });
  });

  it('does not spend a write on every request', async () => {
    const reg = registry();   // last seen just now, 60s touch interval
    await new AdminAuthGuard(cfg, reg).canActivate(ctx(token()).ctx);
    expect(reg.observe).not.toHaveBeenCalled();
  });

  // **FAIL-CLOSED, and this is the deliberate exception to Law 12.** "We could not check whether this operator was
  // dismissed, so we let them in" is not a degraded service — it is the absence of the control.
  it('FAILS CLOSED when the registry read throws', async () => {
    const reg = registry({ accessInputs: jest.fn().mockRejectedValue(new Error('db down')) });
    await expect(new AdminAuthGuard(cfg, reg).canActivate(ctx(token()).ctx)).rejects.toThrow(/db down/);
  });

  // The touch is bookkeeping and must never do the opposite: a write failure refusing a request would turn a logging
  // outage into an outage of the whole realm.
  it('still admits when the last-seen WRITE fails', async () => {
    const reg = registry({
      accessInputs: jest.fn().mockResolvedValue({ operator: null, session: null, restrictions: [] }),
      observe: jest.fn().mockRejectedValue(new Error('write failed')),
    });
    expect(await new AdminAuthGuard(cfg, reg).canActivate(ctx(token()).ctx)).toBe(true);
  });

  it('falls back to the shipped thresholds when the policy row cannot be read, and says so', async () => {
    const reg = registry({ accessPolicy: jest.fn().mockRejectedValue(new Error('no policy row')) });
    const { req, ctx: c } = ctx(token());
    expect(await new AdminAuthGuard(cfg, reg).canActivate(c)).toBe(true);
    expect(req.admin.policyFallback).toBe(true);
  });

  it('behaves exactly as it did before 0118 when the registry is switched off', async () => {
    const off = new AdminConfig({
      NODE_ENV: 'test', ADMIN_JWT_SECRET: SECRET, ADMIN_JWT_ISSUER: 'kv-admin-idp',
      ADMIN_JWT_AUDIENCE: 'kv-admin-api', DATABASE_ADMIN_URL: 'postgres://x/y',
      ADMIN_OPERATOR_REGISTRY_ENABLED: 'false',
    } as Record<string, unknown>);
    const reg = registry();
    const { req, ctx: c } = ctx(token());
    expect(await new AdminAuthGuard(off, reg).canActivate(c)).toBe(true);
    expect(reg.accessInputs).not.toHaveBeenCalled();
    expect(req.admin.dormancy).toBeNull();
  });

  // **AND PRODUCTION REFUSES TO BOOT IN THAT STATE**, which is what makes the switch a recovery lever rather than a way
  // to run the old realm indefinitely. `assertProductionSecurity` runs in the constructor, so a misconfigured god-mode
  // realm crashes at boot and never ships.
  it('names the registry switch as a production requirement', () => {
    expect(() => new AdminConfig({
      NODE_ENV: 'production',
      ADMIN_JWT_SECRET: 'a-production-looking-secret-of-sufficient-length',
      ADMIN_JWT_ISSUER: 'i', ADMIN_JWT_AUDIENCE: 'a', ADMIN_IP_ALLOWLIST: '10.0.0.0/8',
      ADMIN_REQUIRE_HARDWARE_KEY: 'true', DATABASE_ADMIN_URL: 'postgres://x/y',
      ADMIN_OPERATOR_REGISTRY_ENABLED: 'false',
    } as Record<string, unknown>)).toThrow(/ADMIN_OPERATOR_REGISTRY_ENABLED/);
  });
});
