// modules/identity/__tests__/tenant1b2-member-suspension.spec.ts · PC-56 TENANT-1b-2.
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: A TENANT SUSPENSION STOPS THE MEMBER HERE AND NOWHERE ELSE — AND NEVER STOPS
// THEIR MONEY.**
//
// W154 offers "Suspend member (user_status: suspended)". `UserService.changeStatus` already existed with no HTTP route, so
// the five-line wiring was sitting there — and `users.status` is a column on the GLOBAL `users` table. Those five lines
// would have let Anand FPO's member desk lock a farmer out of every OTHER FPO they belong to, out of the consumer
// storefront and out of the app. Two suites hold that line: this one on the act, and
// `core/__tests__/tenant1b2-suspension-enforcement.spec.ts` on the six read paths.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MemberSuspensionService } from '../services/member-suspension.service';
import {
  requireReason, assertNotSelf, suspendVerdict, liftVerdict, isLive, signInGraceSeconds,
  SUSPENSION_EFFECTS, MIN_SUSPENSION_REASON,
} from '../domain/member-suspension';

const REASON = 'Selling produce he does not have — three buyer complaints this week.';
const LIFT_REASON = 'Complaints withdrawn after the weighbridge check; produce was real.';

const LIVE = {
  id: 's1', userId: 'u1', reason: REASON, suspendedBy: 'staff-1',
  createdAt: '2026-08-01T00:00:00.000Z', liftedAt: null, liftedBy: null, liftReason: null,
};

/** The service's collaborators. `uow.run` executes the callback with a fake tx, so the ORDER of writes is observable. */
function harness(opts: { existing?: typeof LIVE | null; memberRows?: unknown[]; liftRowCount?: number } = {}) {
  const existing = opts.existing ?? null;
  const calls: string[] = [];
  const tx = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      void params;
      calls.push(sql);
      if (/SELECT .* FROM tenant_member_suspensions/s.test(sql) && /FOR UPDATE/.test(sql)) {
        return { rows: existing ? [{
          id: existing.id, user_id: existing.userId, reason: existing.reason, suspended_by: existing.suspendedBy,
          created_at: new Date(existing.createdAt), lifted_at: null, lifted_by: null, lift_reason: null,
        }] : [], rowCount: existing ? 1 : 0 };
      }
      if (/^UPDATE tenant_member_suspensions/.test(sql.trim())) return { rows: [], rowCount: opts.liftRowCount ?? 1 };
      if (/INSERT INTO tenant_member_suspensions/.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
    tenantId: 't1',
  };
  const uow = { run: jest.fn(async (tenantId: string, fn: (t: typeof tx) => Promise<unknown>) => { void tenantId; return fn(tx); }) };
  const replicaQuery = jest.fn(async (sql: string, params?: unknown[]) => {
    void sql; void params;
    return { rows: opts.memberRows ?? [{ ok: true }], rowCount: 1 };
  });
  const replica = { forTenant: jest.fn((tenantId: string) => { void tenantId; return { query: replicaQuery }; }) };
  const audit = { write: jest.fn(async (t: unknown, e: Record<string, unknown>) => { void t; void e; }) };
  const outbox = { write: jest.fn(async (t: unknown, e: Record<string, unknown>) => { void t; void e; }) };
  const roleCache = { invalidate: jest.fn(async (u: string, t: string) => { void u; void t; }) };
  const repo = new (require('../repositories/member-suspension.repository').MemberSuspensionRepository)(replica as never);
  const svc = new MemberSuspensionService(
    uow as never, outbox as never, replica as never, audit as never, repo, roleCache as never);
  return { svc, tx, audit, outbox, roleCache, replicaQuery, calls };
}

const actor = { userId: 'staff-1', ip: '10.0.0.2', requestId: 'req-9' };

describe('TENANT-1b-2 · the reason is mandatory and is a reason', () => {
  it('refuses anything under the floor, measured after trimming', () => {
    expect(MIN_SUSPENSION_REASON).toBe(20);
    expect(() => requireReason('fraud', 'suspend')).toThrow(/at least 20/);
    expect(() => requireReason(' '.repeat(40), 'suspend')).toThrow(/at least 20/);
    // And the TRIMMED text is what gets stored, so the record is not padded with pasted whitespace.
    expect(requireReason(`  ${REASON}  `, 'suspend')).toBe(REASON);
  });

  it('names the act in the refusal, because the two forms are different fields on the screen', () => {
    expect(() => requireReason('no', 'lift')).toThrow(/to lift a member/);
    expect(() => requireReason('no', 'suspend')).toThrow(/to suspend a member/);
  });
});

describe('TENANT-1b-2 · a staff member cannot suspend themselves', () => {
  it('refuses in the domain, before any database work', () => {
    expect(() => assertNotSelf('u1', 'u1')).toThrow(/cannot suspend or reinstate themselves/);
    expect(() => assertNotSelf('staff-1', 'u1')).not.toThrow();
  });

  it('refuses at the service too, without touching the database', async () => {
    // A member desk operator suspending their own account takes their own listings off the market with an audit trail
    // pointing only at themselves — and then cannot sign in to undo it. `ck_tms_not_self` refuses it as well.
    const h = harness();
    await expect(h.svc.suspend('t1', actor, 'staff-1', REASON)).rejects.toThrow(/themselves/);
    expect(h.tx.query).not.toHaveBeenCalled();
  });
});

describe('TENANT-1b-2 · the act', () => {
  it('writes the record, the audit row and the event in ONE transaction', async () => {
    const h = harness();
    const res = await h.svc.suspend('t1', actor, 'u1', REASON);
    expect(res.outcome).toBe('suspended');
    // Law 4: the record and its audit entry commit together. A suspension nobody can trace, and an audit row for a
    // suspension that did not happen, are both worse than a failed request.
    expect(h.audit.write).toHaveBeenCalledTimes(1);
    expect(h.outbox.write).toHaveBeenCalledTimes(1);
    expect(h.calls.some((s) => /INSERT INTO tenant_member_suspensions/.test(s))).toBe(true);
  });

  it('records what the suspension DOES, including that it does not stop money', async () => {
    const h = harness();
    await h.svc.suspend('t1', actor, 'u1', REASON);
    const entry = h.audit.write.mock.calls[0][1] as { action: string; newValue: Record<string, unknown>; reason: string };
    expect(entry.action).toBe('member.suspended');
    expect(entry.reason).toBe(REASON);
    // **THE SCOPE IS ON THE RECORD.** A reviewer a year from now must be able to tell that this was a tenant act and not
    // a platform ban, without reading the code that wrote it.
    expect(entry.newValue.scope).toBe('tenant');
    expect((entry.newValue.effects as Record<string, boolean>).blocksPayouts).toBe(false);
  });

  it('emits a TENANT-scoped event, never the platform status event', async () => {
    const h = harness();
    await h.svc.suspend('t1', actor, 'u1', REASON);
    const evt = h.outbox.write.mock.calls[0][1] as { eventType: string; tenantId: string };
    expect(evt.eventType).toBe('identity.tenant_member_suspended');
    // `identity.user_status_changed` would be a lie about what happened, and any consumer treating it as global would
    // propagate the very cross-tenant effect this design refuses.
    expect(evt.eventType).not.toBe('identity.user_status_changed');
    expect(evt.tenantId).toBe('t1');
  });

  it('invalidates the RBAC cache AFTER the commit, and only on a real change', async () => {
    const h = harness();
    await h.svc.suspend('t1', actor, 'u1', REASON);
    expect(h.roleCache.invalidate).toHaveBeenCalledWith('u1', 't1');

    // A no-op must not flush a cache: nothing changed, and a needless flush costs every subsequent request a resolve.
    const already = harness({ existing: LIVE });
    const res = await already.svc.suspend('t1', actor, 'u1', REASON);
    expect(res.outcome).toBe('already_suspended');
    expect(already.roleCache.invalidate).not.toHaveBeenCalled();
  });

  it('reports an already-suspended member instead of pretending to record a new reason', async () => {
    const h = harness({ existing: LIVE });
    const res = await h.svc.suspend('t1', actor, 'u1', 'A completely different reason, at length.');
    expect(res.outcome).toBe('already_suspended');
    // The ORIGINAL reason comes back, because that is the one on the record — telling staff their new reason was stored
    // when `uq_tms_live` would have refused it is the lie this branch exists to avoid.
    expect(res.record.reason).toBe(REASON);
    expect(h.audit.write).not.toHaveBeenCalled();
  });

  it('locks the row it is about to act on', async () => {
    const h = harness();
    await h.svc.suspend('t1', actor, 'u1', REASON);
    // Two staff members clicking at once is the ordinary case. Without FOR UPDATE both read "not suspended" and one
    // loses to the unique index with a constraint error the console cannot explain.
    expect(h.calls.some((s) => /FROM tenant_member_suspensions[\s\S]*FOR UPDATE/.test(s))).toBe(true);
  });

  it('404s for somebody who is not a member of this tenant', async () => {
    const h = harness({ memberRows: [] });
    await expect(h.svc.suspend('t1', actor, 'stranger', REASON)).rejects.toThrow(/not found in this organisation/);
  });

  /** A dormant account being used for fraud is exactly the case a member desk needs to stop, so the membership check
   *  deliberately does NOT require an active role. */
  it('does not require an ACTIVE role to suspend', async () => {
    const h = harness();
    await h.svc.suspend('t1', actor, 'u1', REASON);
    const membershipSql = h.replicaQuery.mock.calls[0][0] as string;
    expect(membershipSql).toMatch(/FROM user_tenant_roles/);
    expect(membershipSql).not.toMatch(/is_active/);
  });
});

describe('TENANT-1b-2 · the lift', () => {
  it('closes the episode with its own reason', async () => {
    const h = harness({ existing: LIVE });
    const res = await h.svc.lift('t1', actor, 'u1', LIFT_REASON);
    expect(res.outcome).toBe('lifted');
    expect(res.record.liftReason).toBe(LIFT_REASON);
    const entry = h.audit.write.mock.calls[0][1] as { action: string; oldValue: Record<string, unknown> };
    expect(entry.action).toBe('member.suspension_lifted');
    // The audit row carries WHO suspended and WHEN, because the person lifting is frequently not the person who applied.
    expect(entry.oldValue.suspendedBy).toBe('staff-1');
  });

  it('refuses to lift nothing', async () => {
    // An error, not a no-op: the staff member believes this member is suspended and they are not. Quietly agreeing would
    // leave them thinking they had fixed something.
    const h = harness({ existing: null });
    await expect(h.svc.lift('t1', actor, 'u1', LIFT_REASON)).rejects.toThrow(/not currently suspended/);
    expect(h.audit.write).not.toHaveBeenCalled();
  });

  it('refuses when the UPDATE touches no row, even though the read found one', async () => {
    // Belt and braces: the row was locked, so zero rows here means the WHERE and the read disagree — and writing an
    // audit row for a lift that did not land would be the worst of both.
    const h = harness({ existing: LIVE, liftRowCount: 0 });
    await expect(h.svc.lift('t1', actor, 'u1', LIFT_REASON)).rejects.toThrow(/not currently suspended/);
    expect(h.audit.write).not.toHaveBeenCalled();
  });

  it('never deletes the episode', async () => {
    const h = harness({ existing: LIVE });
    await h.svc.lift('t1', actor, 'u1', LIFT_REASON);
    // A suspension episode is evidence the member may dispute. The table has no DELETE grant either (0127).
    for (const sql of h.calls) expect(sql).not.toMatch(/DELETE FROM tenant_member_suspensions/i);
    const update = h.calls.find((s) => /^UPDATE tenant_member_suspensions/.test(s.trim()))!;
    expect(update).toMatch(/lifted_at = now\(\)/);
    // **AND THE WHERE MUST STILL CARRY `lifted_at IS NULL`, WHICH A MUTATION CAUGHT MISSING FROM THIS SUITE.** Without it
    // this UPDATE can reopen and overwrite an episode somebody already closed — rewriting the lift reason on a record a
    // member may be disputing. The row is locked, so this is belt-and-braces; the belt is the part that matters.
    expect(update).toMatch(/WHERE id = \$1 AND tenant_id = \$2 AND lifted_at IS NULL AND deleted_at IS NULL/);
  });

  it('invalidates the cache immediately, so a reinstated member is not waiting on a TTL', async () => {
    const h = harness({ existing: LIVE });
    await h.svc.lift('t1', actor, 'u1', LIFT_REASON);
    expect(h.roleCache.invalidate).toHaveBeenCalledWith('u1', 't1');
  });
});

describe('TENANT-1b-2 · the verdicts and the effect list', () => {
  it('reads a live episode as live and a lifted one as not', () => {
    expect(isLive(LIVE)).toBe(true);
    expect(isLive({ ...LIVE, liftedAt: '2026-08-05T00:00:00Z' })).toBe(false);
    expect(isLive(null)).toBe(false);
    expect(suspendVerdict(null)).toBe('create');
    expect(suspendVerdict(LIVE)).toBe('already_suspended');
    expect(liftVerdict(LIVE)).toBe('lift');
    expect(liftVerdict(null)).toBe('not_suspended');
  });

  /**
   * **THE LIST THE CONSOLE PRINTS, AND THE TWO ENTRIES THAT ARE FALSE.**
   *
   * `blocksPayouts: false` is the promise the whole feature is judged by — W154: "money owed still pays out — suspension
   * never confiscates." Pinned here so that flipping it becomes a deliberate, visible act rather than a plausible tidy-up.
   */
  it('pins what a suspension does and does not do', () => {
    expect(SUSPENSION_EFFECTS.blocksTenantSignIn).toBe(true);
    expect(SUSPENSION_EFFECTS.blocksTenantPermissions).toBe(true);
    expect(SUSPENSION_EFFECTS.blocksListingWrites).toBe(true);
    expect(SUSPENSION_EFFECTS.hidesListingsFromBuyers).toBe(true);
    expect(SUSPENSION_EFFECTS.ownerStillSeesOwnListings).toBe(true);
    expect(SUSPENSION_EFFECTS.blocksPayouts).toBe(false);
    expect(SUSPENSION_EFFECTS.cancelsInFlightOrders).toBe(false);
    expect(SUSPENSION_EFFECTS.notifiesMember).toBe(false);
  });

  it('reports the sign-in grace honestly rather than implying an instant cut-off', () => {
    // This platform carries RBAC in the access token, so EVERY revocation is bounded by JWT_ACCESS_TTL_SEC for somebody
    // already signed in. Pre-existing, and printed on the screen rather than hidden.
    expect(signInGraceSeconds(900)).toBe(900);
    expect(signInGraceSeconds(-5)).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------------------------------ */
/* THE ABSENCE                                                                                                   */
/* ------------------------------------------------------------------------------------------------------------ */

describe('TENANT-1b-2 · what the suspension must NOT reach', () => {
  const src = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', p), 'utf8');

  /**
   * **A TEST THAT ASSERTS AN ABSENCE, BECAUSE THE PROMISE IS AN ABSENCE.**
   *
   * W154: "money owed still pays out — suspension never confiscates." The way to keep that promise is for the payout path
   * to know nothing about this table. A later reader "tidying up" by adding a status check to the money-out path would
   * turn a suspension into a confiscation of a farmer's earned income — and it would look like a reasonable change in a
   * diff. This test is the thing that stops it.
   */
  it('never appears on the money-out path', () => {
    for (const f of [
      'modules/payments/services/payout.service.ts',
      'modules/payments/repositories/payout.repository.ts',
      'modules/payments/domain/payout-kyc.ts',
    ]) {
      const text = src(f);
      expect(text).not.toMatch(/tenant_member_suspensions/);
      expect(text).not.toMatch(/memberSuspendedSql|sellerNotSuspendedSql/);
    }
  });

  /**
   * And it must never write the GLOBAL column. That is the entire reason 0127 exists.
   *
   * **THE PATTERNS MATCH CODE AND NOT PROSE**, which is a correction: the first version of this test failed on the
   * service's own doc comment, where `UserService.changeStatus` is named as the thing this file deliberately does NOT do.
   * A test that cannot tell an explanation from a call would have to be silenced by deleting the explanation.
   */
  it('never writes users.status', () => {
    const svc = src('modules/identity/services/member-suspension.service.ts');
    expect(svc).not.toMatch(/UPDATE\s+users\b/i);
    expect(svc).not.toMatch(/\.changeStatus\s*\(/);
    expect(svc).not.toMatch(/users\.update\s*\(/);
    // Nor may it import the platform status vocabulary — a file that has `UserStatus` in scope is one edit from using it.
    expect(svc).not.toMatch(/import[^;]*UserStatus[^;]*;/);
  });
});
