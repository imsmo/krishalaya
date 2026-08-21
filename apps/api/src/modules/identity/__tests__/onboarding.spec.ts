// modules/identity/__tests__/onboarding.spec.ts · KV-BL-066 self-serve onboarding.
// No DB needed (all writes go through mocked repos/uow), mirroring rbac-security.spec.ts's style.
import { OnboardingService } from '../services/onboarding.service';
import { Role } from '../domain/role.entity';
import { SelfServeRoleNotEligibleError } from '../domain/identity.errors';
import { FeatureFlagGuard } from '../../../core/feature-flags/flags.guard';
import { NotFoundError } from '../../../shared/errors/app-error';

function role(code: string, opts: Partial<{ scope: 'tenant' | 'platform'; requiresApproval: boolean }> = {}) {
  return new Role({
    id: `role-${code}`, code, defaultName: code, scope: opts.scope ?? 'tenant',
    requiresKyc: true, requiresApproval: opts.requiresApproval ?? true, moduleCode: null, isActive: true,
  });
}

function svc(opts: {
  findByCode?: any; findExisting?: any; insert?: any; list?: any;
} = {}) {
  const uow: any = { run: jest.fn(async (_tenantId: string, fn: any) => fn({ query: jest.fn() })) };
  const outbox: any = { write: jest.fn() };
  const audit: any = { write: jest.fn() };
  const roleCache: any = { invalidate: jest.fn() };
  const utr: any = {
    findExisting: jest.fn().mockResolvedValue(opts.findExisting ?? null),
    insert: jest.fn(opts.insert ?? (() => Promise.resolve())),
    list: jest.fn().mockResolvedValue(opts.list ?? []),
  };
  const roles: any = { findByCode: jest.fn().mockResolvedValue(opts.findByCode ?? null) };
  const service = new OnboardingService(uow, outbox, audit, roleCache, utr, roles);
  return { service, uow, outbox, audit, roleCache, utr, roles };
}

describe('OnboardingService.grantRole', () => {
  it('grants farmer for the first time: inserts (force-active despite requires_approval), audits, emits outbox, invalidates cache', async () => {
    const farmer = role('farmer', { requiresApproval: true }); // seed has requires_approval=true — self-serve must override
    const h = svc({ findByCode: farmer, findExisting: null, list: [{ role_code: 'farmer', is_active: true }] });

    const result = await h.service.grantRole('t1', 'u1', { role: 'farmer' }, '1.2.3.4');

    expect(result).toEqual({ roleCode: 'farmer', alreadyGranted: false, roles: ['farmer'] });
    expect(h.utr.insert).toHaveBeenCalledTimes(1);
    const insertedUtr = h.utr.insert.mock.calls[0][1];
    expect(insertedUtr.toProps().isActive).toBe(true); // active immediately, NOT pending — the self-serve override
    expect(insertedUtr.toProps().kycStatus).toBe('none'); // honest: no KYC has happened via this path
    expect(h.outbox.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'identity.role_selfserve_granted',
      tenantId: 't1',
      payload: expect.objectContaining({ userId: 'u1', tenantId: 't1', roleCode: 'farmer' }),
    }));
    expect(h.audit.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'role.selfserve_granted', tenantId: 't1', actorUserId: 'u1', ip: '1.2.3.4',
    }));
    expect(h.roleCache.invalidate).toHaveBeenCalledWith('u1', 't1');
  });

  it('is idempotent: repeat call for an already-held role is a no-op that returns the same 200 state', async () => {
    const customer = role('customer', { requiresApproval: false });
    const h = svc({
      findByCode: customer,
      findExisting: {}, // already holds it
      list: [{ role_code: 'farmer', is_active: true }, { role_code: 'customer', is_active: true }],
    });

    const result = await h.service.grantRole('t1', 'u1', { role: 'customer' }, null);

    expect(result).toEqual({ roleCode: 'customer', alreadyGranted: true, roles: ['farmer', 'customer'] });
    expect(h.utr.insert).not.toHaveBeenCalled();
    expect(h.outbox.write).not.toHaveBeenCalled();
    expect(h.audit.write).not.toHaveBeenCalled();
    expect(h.roleCache.invalidate).not.toHaveBeenCalled();
  });

  it('treats a concurrent-insert race (unique-violation 23505) as already-granted, not an error', async () => {
    const farmer = role('farmer', { requiresApproval: true });
    const h = svc({
      findByCode: farmer,
      findExisting: null,
      insert: () => Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' })),
      list: [{ role_code: 'farmer', is_active: true }],
    });

    const result = await h.service.grantRole('t1', 'u1', { role: 'farmer' }, null);

    expect(result.alreadyGranted).toBe(true);
    expect(h.roleCache.invalidate).not.toHaveBeenCalled();
  });

  it('rejects an invite-only role (e.g. vet) with a 403 SelfServeRoleNotEligibleError that says so', async () => {
    const h = svc({ findByCode: role('vet') });
    await expect(h.service.grantRole('t1', 'u1', { role: 'vet' }, null))
      .rejects.toBeInstanceOf(SelfServeRoleNotEligibleError);
    await expect(h.service.grantRole('t1', 'u1', { role: 'vet' }, null))
      .rejects.toMatchObject({ httpStatus: 403, details: { role: 'vet', reason: 'invite_only' } });
  });

  it('rejects a platform role (e.g. super_admin) even though it is a known role code', async () => {
    const h = svc({ findByCode: role('super_admin', { scope: 'platform' }) });
    await expect(h.service.grantRole('t1', 'u1', { role: 'super_admin' }, null))
      .rejects.toMatchObject({ httpStatus: 403, details: { role: 'super_admin', reason: 'platform_role' } });
  });

  it('rejects a role that is self-serve-safe by design canon but not yet GA at pilot (e.g. vyapari)', async () => {
    const h = svc({ findByCode: role('vyapari') });
    await expect(h.service.grantRole('t1', 'u1', { role: 'vyapari' }, null))
      .rejects.toMatchObject({ httpStatus: 403, details: { role: 'vyapari', reason: 'not_pilot_ga' } });
  });

  it('rejects an unknown role code with 403 (never 404 — no enumeration of valid codes)', async () => {
    const h = svc({ findByCode: null });
    await expect(h.service.grantRole('t1', 'u1', { role: 'not_a_real_role' }, null))
      .rejects.toMatchObject({ httpStatus: 403, details: { role: 'not_a_real_role', reason: 'unknown_role' } });
  });
});

describe('selfserve_onboarding feature flag gate (Law 10 kill-switch)', () => {
  // [PC-56 TENANT-6d-2] The guard reads `getAll` and requires EVERY declared flag, because it used to read
  // `getAllAndOverride` — so a flag on a route silently CANCELLED the flag on its controller, and a module's
  // kill-switch did not switch the module off (`dairy` vs `dairy_cycle_preview` was the live example: the two acts
  // that decide what 312 families are paid stayed callable with the dairy module off).
  function guard(flagIsEnabled: boolean | boolean[], declared: Array<string | string[] | undefined> = [['selfserve_onboarding']]) {
    const reflector: any = { getAll: () => declared };
    const answers = Array.isArray(flagIsEnabled) ? [...flagIsEnabled] : null;
    const flags: any = { isEnabled: jest.fn().mockImplementation(async () => (answers ? answers.shift() : flagIsEnabled)) };
    return { g: new FeatureFlagGuard(reflector, flags), flags };
  }
  const ctx: any = { getHandler: () => ({}), getClass: () => ({}) };

  it('flag OFF → the route is invisible (404 NotFoundError, not 403)', async () => {
    await expect(guard(false).g.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundError);
  });
  it('flag ON → request proceeds', async () => {
    await expect(guard(true).g.canActivate(ctx)).resolves.toBe(true);
  });
  it('no flag declared → the route is open', async () => {
    const h = guard(false, [undefined, undefined]);
    await expect(h.g.canActivate(ctx)).resolves.toBe(true);
    expect(h.flags.isEnabled).not.toHaveBeenCalled();
  });
  it('a STRING from an older decorator still gates the route', async () => {
    await expect(guard(false, ['selfserve_onboarding']).g.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundError);
  });
  it('EVERY declared flag must be on — a route flag cannot cancel its module flag', async () => {
    // controller says `dairy` (ON), handler says `dairy_cycle_preview` (OFF) → invisible.
    await expect(guard([true, false], [['dairy'], ['dairy_cycle_preview']]).g.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundError);
    // and the reverse: the module is off, so the screen's own flag being on changes nothing.
    const off = guard([false, true], [['dairy'], ['dairy_cycle_preview']]);
    await expect(off.g.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundError);
    // SHORT-CIRCUITS: the module's flag is checked first and the second flag is never read.
    expect(off.flags.isEnabled).toHaveBeenCalledTimes(1);
    // both on → through, and both were actually consulted.
    const on = guard([true, true], [['dairy'], ['dairy_cycle_preview']]);
    await expect(on.g.canActivate(ctx)).resolves.toBe(true);
    expect(on.flags.isEnabled).toHaveBeenCalledTimes(2);
  });
  it('one place naming several flags requires all of them', async () => {
    await expect(guard([true, false], [['dairy', 'dairy_centres_console']]).g.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundError);
  });
  it('a flag named on BOTH levels is asked about once, not twice', async () => {
    const h = guard(true, [['dairy'], ['dairy']]);
    await expect(h.g.canActivate(ctx)).resolves.toBe(true);
    expect(h.flags.isEnabled).toHaveBeenCalledTimes(1);
  });
});
