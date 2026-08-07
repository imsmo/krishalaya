// apps/admin-api/src/modules/platform-staff/__tests__/admin9-operator-identity.spec.ts · PC-56 ADMIN-9.
//
// The realm's front door. Four properties are asserted harder than anything else here, because each of them is the
// difference between a control and the appearance of one:
//
//   1. THE REGISTRY CAN REFUSE AND CAN NEVER GRANT — no input produces a permission the token's roles did not carry.
//   2. A RESTRICTION BITES A SUPER_ADMIN — subtracting a named code from `{'*'}` must not silently remove nothing.
//   3. REINSTATEMENT NEEDS A SECOND PERSON — including, especially, when the suspended operator asks themselves.
//   4. A DORMANT OPERATOR IS REFUSED AND SUSPENDED, and the roster does NOT claim the suspension before it happens.
import {
  ACCESS_DENIED_REASONS, DEFAULT_ACCESS_POLICY, accessVerdict, dormancyOf, daysSince, effectivePermissions,
  liveRestrictions, restrictionInForce, shouldTouch,
} from '../../../core/auth/operator-access';
import {
  DENY_ONLY_RATIONALE, GRANT_SIDE_OVERRIDES_ARE_REFUSED, REASON_MIN, RESTRICT_ALL, REVOCATION_TAKES_EFFECT,
  assertReason, assertReinstatable, assertRestrictable, assertRevocable, assertSuspendable, isCurrentSession,
  liveSessionCount, restrictionIsInert,
} from '../domain/operator-lifecycle';
import { InvalidStaffInputError, OperatorStateError, SelfActionError } from '../domain/platform-staff.errors';
import {
  MATRIX_SOURCE, NO_WRITE_PATH_REASON, buildMatrix, godModeOnlyPermissions, holdersOf, matrixRoles, permissionGroup,
  permissionGroups,
} from '../domain/role-matrix';
import { ownerPermissionCodes, ownerRoleCatalogue, resolveOwnerPermissions } from '../../../core/rbac/owner-roles';

const NOW = new Date('2026-08-07T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const op = (o: Partial<Parameters<typeof accessVerdict>[0] & object> = {}) => ({
  adminUserId: 'a1', status: 'active', lastSeenAt: daysAgo(0), firstSeenAt: daysAgo(100),
  suspendedAt: null, suspendKind: null, suspendReason: null, ...o,
} as NonNullable<Parameters<typeof accessVerdict>[0]>);

const restriction = (code: string, expiresAt: Date | null = null) => ({
  permissionCode: code, reason: 'read-only enforced pending review', expiresAt,
});

/* ------------------------------------------------------------------------------------------------ */
describe('daysSince + dormancy', () => {
  // FLOORED, never rounded: "day 45 of 45" must mean 45 complete days. Rounding up would lock somebody out on day 44
  // and a half, and the person it happens to has no way to see why.
  it('floors, and never returns a negative for a clock that went backwards', () => {
    expect(daysSince(daysAgo(44.9), NOW)).toBe(44);
    expect(daysSince(daysAgo(45), NOW)).toBe(45);
    expect(daysSince(new Date(NOW.getTime() + 60_000), NOW)).toBe(0);
    expect(daysSince(new Date(NaN), NOW)).toBe(0);
  });

  it('names the three states at their exact boundaries', () => {
    const p = DEFAULT_ACCESS_POLICY;
    expect(dormancyOf(daysAgo(29), p, NOW).kind).toBe('active');
    expect(dormancyOf(daysAgo(30), p, NOW).kind).toBe('dormant');   // >= the line, not >
    expect(dormancyOf(daysAgo(44), p, NOW).kind).toBe('dormant');
    expect(dormancyOf(daysAgo(45), p, NOW).kind).toBe('past_line');
  });

  it('counts down to both lines while still active, so a surface can warn BEFORE the lockout', () => {
    const d = dormancyOf(daysAgo(20), DEFAULT_ACCESS_POLICY, NOW);
    expect(d).toMatchObject({ kind: 'active', daysSinceSeen: 20, daysToDormant: 10, daysToSuspend: 25 });
  });

  // **`past_line` IS NOT `suspended`, AND THE DISTINCTION IS THE WHOLE REASON THIS STATE EXISTS.** Nothing sweeps, so a
  // dormant operator's row still reads `active` until they try to come back. A console that rendered them as suspended
  // would be the seventh status-recording-an-act-nobody-performs on this platform, in an access-control wave.
  it('has a state for "past the line and not yet suspended", distinct from suspended', () => {
    const d = dormancyOf(daysAgo(60), DEFAULT_ACCESS_POLICY, NOW);
    expect(d.kind).toBe('past_line');
    expect(d.kind).not.toBe('suspended');
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('accessVerdict', () => {
  const p = DEFAULT_ACCESS_POLICY;

  // The one permissive branch, and it is not a loophole: refusing first sightings would mean nobody could ever sign in
  // and the table would have to be filled by the directory sync this design exists to avoid.
  it('admits an operator the realm has never seen, and records them', () => {
    const v = accessVerdict(null, null, p, NOW);
    expect(v.allow).toBe(true);
    if (v.allow) expect(v.dormancy).toMatchObject({ kind: 'active', daysSinceSeen: 0 });
  });

  it('refuses a suspended operator, and says which kind of suspension', () => {
    const manual = accessVerdict(op({ status: 'suspended', suspendKind: 'manual' }), null, p, NOW);
    expect(manual).toMatchObject({ allow: false, reason: 'suspended', autoSuspend: false });
    if (!manual.allow) expect(manual.detail).toMatch(/platform administrator/);
    const auto = accessVerdict(op({ status: 'suspended', suspendKind: 'dormant' }), null, p, NOW);
    if (!auto.allow) expect(auto.detail).toMatch(/dormancy/);
  });

  it('refuses a revoked session — the `sid` claim was minted and read by nothing before this wave', () => {
    const v = accessVerdict(op(), { sessionId: 's1', revokedAt: NOW, revokeReason: 'lost device' }, p, NOW);
    expect(v).toMatchObject({ allow: false, reason: 'session_revoked' });
  });

  it('admits a live session', () => {
    expect(accessVerdict(op(), { sessionId: 's1', revokedAt: null, revokeReason: null }, p, NOW).allow).toBe(true);
  });

  // Order matters: a suspended operator's every session is void whether or not anybody revoked them individually, and
  // reporting "session revoked" to a dismissed operator would understate what happened in the audit trail.
  it('reports SUSPENSION rather than session revocation when both are true', () => {
    const v = accessVerdict(
      op({ status: 'suspended', suspendKind: 'manual' }),
      { sessionId: 's1', revokedAt: NOW, revokeReason: 'operator suspended' }, p, NOW,
    );
    expect(v).toMatchObject({ allow: false, reason: 'suspended' });
  });

  it('refuses a dormant operator AND asks for the auto-suspension in the same verdict', () => {
    const v = accessVerdict(op({ lastSeenAt: daysAgo(46) }), null, p, NOW);
    expect(v).toMatchObject({ allow: false, reason: 'dormant', autoSuspend: true });
    if (!v.allow) expect(v.detail).toMatch(/46 days/);
  });

  // A manual suspension must never be overwritten by a housekeeping one: the record of a dismissal would become the
  // record of an absence.
  it('does not raise a dormancy auto-suspension for an operator who is already suspended', () => {
    const v = accessVerdict(op({ status: 'suspended', suspendKind: 'manual', lastSeenAt: daysAgo(90) }), null, p, NOW);
    expect(v).toMatchObject({ allow: false, reason: 'suspended', autoSuspend: false });
  });

  it('keeps its refusal reasons countable', () => {
    expect([...ACCESS_DENIED_REASONS]).toEqual(['suspended', 'session_revoked', 'dormant']);
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('effectivePermissions — the table can refuse and can never grant', () => {
  const codes = ownerPermissionCodes();

  it('returns the granted set untouched when nothing is restricted', () => {
    const granted = resolveOwnerPermissions(['platform_recon_viewer']);
    expect(effectivePermissions(granted, [], codes, NOW)).toBe(granted);
  });

  it('removes a named permission', () => {
    const granted = resolveOwnerPermissions(['platform_recon_ops']);
    const eff = effectivePermissions(granted, [restriction('recon.manage')], codes, NOW);
    expect(eff.has('recon.manage')).toBe(false);
    expect(eff.has('recon.read')).toBe(true);
  });

  // **THE ASSERTION THIS WHOLE FILE EXISTS FOR.** `resolveOwnerPermissions(['super_admin'])` is `{'*'}`, and
  // `hasOwnerPermission` treats the star as "holds everything" — so a naive `delete(code)` would remove nothing and the
  // console would report a restriction that does not restrict. On the most powerful account on the platform.
  it('BITES A SUPER_ADMIN: restricting one code strips the god-mode star', () => {
    const granted = resolveOwnerPermissions(['super_admin']);
    expect(granted.has('*')).toBe(true);
    const eff = effectivePermissions(granted, [restriction('payouts.approve')], codes, NOW);
    expect(eff.has('*')).toBe(false);
    expect(eff.has('payouts.approve')).toBe(false);
    // Everything else survives — a restriction is a scalpel, not a deactivation.
    expect(eff.has('tenant.read')).toBe(true);
    expect(eff.size).toBe(codes.length - 1);
  });

  it("'*' as a restriction is the read-only measure W104 shows on its own auditor row", () => {
    for (const roles of [['super_admin'], ['platform_recon_ops'], []]) {
      const eff = effectivePermissions(resolveOwnerPermissions(roles), [restriction(RESTRICT_ALL)], codes, NOW);
      expect(eff.size).toBe(0);
    }
  });

  it('ignores an EXPIRED restriction — a time-boxed measure ends by itself', () => {
    const granted = resolveOwnerPermissions(['platform_recon_ops']);
    const past = restriction('recon.manage', new Date(NOW.getTime() - 1000));
    expect(restrictionInForce(past, NOW)).toBe(false);
    expect(effectivePermissions(granted, [past], codes, NOW).has('recon.manage')).toBe(true);
    const future = restriction('recon.manage', new Date(NOW.getTime() + 86_400_000));
    expect(effectivePermissions(granted, [future], codes, NOW).has('recon.manage')).toBe(false);
  });

  it('lists what is biting with the same rule the guard uses', () => {
    const rs = [restriction('a.b', new Date(NOW.getTime() - 1)), restriction('c.d')];
    expect(liveRestrictions(rs, NOW).map((r) => r.permissionCode)).toEqual(['c.d']);
  });

  // The property, asserted as a property rather than as an example: no restriction, on any role, ever adds anything.
  it('never produces a permission the roles did not grant — for every role in the catalogue', () => {
    for (const { role } of ownerRoleCatalogue()) {
      const granted = resolveOwnerPermissions([role]);
      const eff = effectivePermissions(granted, [restriction('tenant.manage')], codes, NOW);
      for (const p of eff) {
        expect(granted.has(p) || granted.has('*')).toBe(true);
      }
    }
  });

  it('states the deny-only rule once, where the console and the migration both quote it', () => {
    expect(GRANT_SIDE_OVERRIDES_ARE_REFUSED).toBe(true);
    expect(DENY_ONLY_RATIONALE).toMatch(/can only ever remove/i);
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('shouldTouch', () => {
  it('writes at most once per interval, and always when the interval is zero', () => {
    const p = { ...DEFAULT_ACCESS_POLICY, touchIntervalSec: 60 };
    expect(shouldTouch(new Date(NOW.getTime() - 59_000), p, NOW)).toBe(false);
    expect(shouldTouch(new Date(NOW.getTime() - 60_000), p, NOW)).toBe(true);
    expect(shouldTouch(NOW, { ...p, touchIntervalSec: 0 }, NOW)).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('suspension and reinstatement', () => {
  it('requires a reason of real length, and says why', () => {
    expect(() => assertReason('exit', 'suspending an operator')).toThrow(InvalidStaffInputError);
    expect(() => assertReason('exit', 'x')).toThrow(/at least 10/);
    expect(assertReason('  left on 7 Aug; access removed per policy  ', 'x')).toBe('left on 7 Aug; access removed per policy');
    expect(REASON_MIN).toBe(10);
  });

  // Deliberate: an operator who believes their own credential is compromised must be able to shut it without finding
  // anybody. The lock is on the way back in.
  it('allows self-suspension', () => {
    expect(() => assertSuspendable({ status: 'active' })).not.toThrow();
  });

  it('refuses to suspend an already-suspended operator', () => {
    expect(() => assertSuspendable({ status: 'suspended' })).toThrow(OperatorStateError);
  });

  it('refuses a reinstatement nobody requested', () => {
    expect(() => assertReinstatable({ status: 'suspended', suspendKind: 'manual' }, null, 'a2'))
      .toThrow(/two-person act/);
  });

  it('refuses to reinstate an operator who is not suspended', () => {
    expect(() => assertReinstatable({ status: 'active', suspendKind: null }, 'a1', 'a2')).toThrow(OperatorStateError);
  });

  // **THE FOURTEENTH MAKER-CHECKER SITE, AND THE CASE IT EXISTS FOR.**
  it('refuses the requester as their own checker', () => {
    expect(() => assertReinstatable({ status: 'suspended', suspendKind: 'manual' }, 'a1', 'a1'))
      .toThrow(SelfActionError);
    expect(() => assertReinstatable({ status: 'suspended', suspendKind: 'manual' }, 'a1', 'a1'))
      .toThrow(/removing access takes one person, giving it back takes two/);
  });

  it('admits a genuine second person', () => {
    expect(() => assertReinstatable({ status: 'suspended', suspendKind: 'dormant' }, 'a1', 'a2')).not.toThrow();
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('restrictions', () => {
  const codes = ownerPermissionCodes();

  it('accepts a real code and the star', () => {
    expect(assertRestrictable('tenant.manage', codes)).toBe('tenant.manage');
    expect(assertRestrictable(RESTRICT_ALL, codes)).toBe(RESTRICT_ALL);
  });

  // A typo in a control is indistinguishable from the control being off. `payout.approve` is singular and wrong; the
  // real code is `payouts.approve`, and a restriction on the former would sit in the table and deny nothing.
  it('REFUSES a code the catalogue does not contain', () => {
    expect(() => assertRestrictable('payout.approve', codes)).toThrow(InvalidStaffInputError);
    expect(() => assertRestrictable('payout.approve', codes)).toThrow(/would deny nothing while looking like a control/);
    expect(codes).toContain('payouts.approve');
  });

  it('flags a restriction that currently removes nothing rather than hiding it', () => {
    const granted = resolveOwnerPermissions(['platform_recon_viewer']);
    expect(restrictionIsInert('ledger.correct', granted)).toBe(true);
    expect(restrictionIsInert('recon.read', granted)).toBe(false);
    // Against god mode nothing is inert, including the star.
    const god = resolveOwnerPermissions(['super_admin']);
    expect(restrictionIsInert('ledger.correct', god)).toBe(false);
    expect(restrictionIsInert(RESTRICT_ALL, god)).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('sessions', () => {
  it('refuses a second revoke, because "already ended" is a different fact from "I just ended it"', () => {
    expect(() => assertRevocable(null)).toThrow(OperatorStateError);
    expect(() => assertRevocable({ revokedAt: NOW })).toThrow(/already revoked/);
    expect(() => assertRevocable({ revokedAt: null })).not.toThrow();
  });

  it('identifies the caller\'s own session, and never matches an empty sid', () => {
    expect(isCurrentSession('s1', 's1')).toBe(true);
    expect(isCurrentSession('s1', 's2')).toBe(false);
    // A token with no `sid` must not make every session look like "this device".
    expect(isCurrentSession('', '')).toBe(false);
  });

  it('counts only sessions that are neither revoked nor expired', () => {
    const sessions = [
      { revokedAt: null, tokenExpiresAt: new Date(NOW.getTime() + 3_600_000) },
      { revokedAt: NOW, tokenExpiresAt: new Date(NOW.getTime() + 3_600_000) },
      { revokedAt: null, tokenExpiresAt: new Date(NOW.getTime() - 1) },
      { revokedAt: null, tokenExpiresAt: null },
    ];
    expect(liveSessionCount(sessions, NOW)).toBe(2);
  });

  it('states the honest limit on revocation rather than W104\'s 60 seconds', () => {
    expect(REVOCATION_TAKES_EFFECT).toBe('next request to admin-api');
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('W105 · the role matrix is a READ of the thing that enforces', () => {
  it('projects every role and every permission from the compiled catalogue', () => {
    const rows = buildMatrix();
    expect(rows.length).toBe(ownerPermissionCodes().length);
    expect(matrixRoles().length).toBe(ownerRoleCatalogue().length);
    expect(MATRIX_SOURCE).toBe('apps/admin-api/src/core/rbac/owner-roles.ts');
  });

  it('puts god mode last and reports its reach as the whole catalogue', () => {
    const roles = matrixRoles();
    expect(roles[roles.length - 1]).toMatchObject({ role: 'super_admin', isGodMode: true });
    // "super_admin holds 1 permission" is arithmetically true of `['*']` and a lie about what it can do.
    expect(roles[roles.length - 1].permissionCount).toBe(ownerPermissionCodes().length);
  });

  it('draws god mode as its own state rather than as 57 ticks', () => {
    const row = buildMatrix().find((r) => r.permission === 'tenant.manage');
    const god = row?.cells.find((c) => c.role === 'super_admin');
    expect(god?.state).toBe('god_mode');
    expect(row?.cells.find((c) => c.role === 'platform_tenant_ops')?.state).toBe('granted');
    expect(row?.cells.find((c) => c.role === 'platform_staff_auditor')?.state).toBe('none');
  });

  it('groups by the code\'s own prefix, not by an invented module number', () => {
    expect(permissionGroup('payouts.approve')).toBe('payouts');
    expect(permissionGroup('compliance.consent.read')).toBe('compliance');
    expect(permissionGroup('nodots')).toBe('nodots');
    expect(permissionGroups()).toContain('staff');
    expect(buildMatrix('staff').every((r) => r.group === 'staff')).toBe(true);
  });

  it('answers the reverse question an auditor actually arrives with', () => {
    const h = holdersOf('staff.reinstate');
    expect(h.direct).toContain('platform_staff_checker');
    // The separation that makes the two-person rule structural rather than procedural.
    expect(h.direct).not.toContain('platform_staff_ops');
    expect(h.godMode).toEqual(['super_admin']);
  });

  it('lists the permissions only a god-mode account can use', () => {
    const only = godModeOnlyPermissions();
    // A least-privilege catalogue with unreachable entries has a hole in it; this is the list of holes, and it must be
    // computed rather than asserted empty — an empty expectation here would break the day somebody adds a permission
    // and forgets to grant it to a role.
    expect(Array.isArray(only)).toBe(true);
    for (const code of only) {
      expect(holdersOf(code).direct).toEqual([]);
    }
  });

  it('says why there is no write path', () => {
    expect(NO_WRITE_PATH_REASON).toMatch(/compiled catalogue/);
    expect(NO_WRITE_PATH_REASON).toMatch(/deploy/);
  });

  // The new permissions exist AND are reachable — a permission with no role behind it is a promise nothing keeps.
  it('grants the three new staff permissions to real roles', () => {
    expect(holdersOf('staff.manage').direct).toContain('platform_staff_ops');
    expect(holdersOf('staff.read').direct).toEqual(
      expect.arrayContaining(['platform_staff_ops', 'platform_staff_checker', 'platform_staff_auditor']));
    expect(holdersOf('rbac.read').direct).toContain('platform_staff_auditor');
    // The auditor can read and can change nothing.
    const auditor = resolveOwnerPermissions(['platform_staff_auditor']);
    expect(auditor.has('staff.manage')).toBe(false);
    expect(auditor.has('staff.reinstate')).toBe(false);
  });
});
