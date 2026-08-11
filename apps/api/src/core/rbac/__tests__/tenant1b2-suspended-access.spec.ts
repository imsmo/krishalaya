// core/rbac/__tests__/tenant1b2-suspended-access.spec.ts · PC-56 TENANT-1b-2.
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: A MEMBER SUSPENDED BY ONE TENANT RESOLVES TO NOTHING IN THAT TENANT AND
// NORMALLY IN EVERY OTHER.**
//
// `RoleCacheService` is the single authority for what somebody may do inside a tenant — every token mint, every refresh,
// every impersonation resolution comes through it. So this is the one place the suspension has to be right, and the one
// place a mistake would be invisible: a suspension that leaked across tenants would look exactly like a working feature
// until a farmer belonging to two FPOs was locked out of both.
//
// **AND THIS SUITE EXISTS BECAUSE A MUTATION SURVIVED A TEXT ASSERTION.** The enforcement suite greps the resolver for the
// shared predicate and for its early return; replacing the guard with `if (false)` kept both strings and passed. A grep
// proves a line is PRESENT, never that it RUNS — so behaviour needs a behavioural test, and the fake pool below is what
// makes that possible without a database.
import { RoleCacheService } from '../role-cache.service';

const ROLES = [{ code: 'farmer' }, { code: 'dairy_farmer' }];
const PERMS = [{ code: 'listing.create' }, { code: 'payout.request' }];

/**
 * A fake pool that answers the resolver's four queries by shape.
 *
 * `suspendedIn` is the set of tenant ids that have suspended this member — so the test can assert the ASYMMETRY, which is
 * the entire design and cannot be checked with a boolean.
 */
function harness(suspendedIn: string[] = []) {
  const seen: { sql: string; params?: unknown[] }[] = [];
  const client = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      seen.push({ sql, params });
      if (/tenant_member_suspensions/.test(sql)) {
        // The resolver binds [userId, tenantId]; the tenant is what decides the answer.
        const tenantId = String((params as string[])?.[1] ?? '');
        return { rows: [{ suspended: suspendedIn.includes(tenantId) }] };
      }
      if (/FROM user_tenant_roles utr JOIN roles r/.test(sql)) return { rows: ROLES };
      if (/role_permissions/.test(sql)) return { rows: PERMS };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  const pools = { replica: jest.fn((shard: number) => { void shard; return { connect: async () => client }; }) };
  const shards = { shardFor: jest.fn((tenantId: string) => { void tenantId; return 0; }) };
  // A pass-through cache: caching is not what this suite is about, and a real cache would hide the second resolve.
  const cache = {
    wrap: jest.fn(async (key: string, ttl: number, load: () => Promise<unknown>) => { void key; void ttl; return load(); }),
    del: jest.fn(async (key: string) => { void key; }),
  };
  const svc = new RoleCacheService(pools as never, shards as never, cache as never);
  return { svc, client, seen, cache };
}

describe('TENANT-1b-2 · a suspended member resolves to nothing HERE', () => {
  it('returns no roles and no permissions in the suspending tenant', async () => {
    const h = harness(['t-anand']);
    await expect(h.svc.effectiveAccess('u-kanji', 't-anand')).resolves.toEqual({ roles: [], permissions: [] });
  });

  /**
   * **THE ASYMMETRY, WHICH IS THE WHOLE POINT OF 0127.**
   *
   * `users.status` is a GLOBAL column; had the console written that instead, this assertion would be impossible — the
   * farmer would resolve to nothing everywhere. A farmer commonly belongs to two or three FPOs, and one organisation
   * suspending them must not touch the others or the consumer storefront.
   */
  it('resolves NORMALLY for a different tenant', async () => {
    const h = harness(['t-anand']);
    const other = await h.svc.effectiveAccess('u-kanji', 't-junagadh');
    expect(other.roles).toEqual(['farmer', 'dairy_farmer']);
    expect(other.permissions).toEqual(['listing.create', 'payout.request']);
  });

  it('resolves normally when there is no suspension at all', async () => {
    const h = harness([]);
    const access = await h.svc.effectiveAccess('u-kanji', 't-anand');
    expect(access.roles).toHaveLength(2);
    expect(access.permissions).toContain('listing.create');
  });

  /**
   * **THE SUSPENDED MEMBER COSTS THE DATABASE LESS, NOT MORE.** The early return happens BEFORE the role and permission
   * queries rather than by filtering their results — so a suspension cannot be defeated by a role or an override added
   * later, and the cheapest answer is also the safest one.
   */
  it('never runs the role or permission queries for a suspended member', async () => {
    const h = harness(['t-anand']);
    await h.svc.effectiveAccess('u-kanji', 't-anand');
    const sqls = h.seen.map((s) => s.sql).join('\n');
    expect(sqls).toMatch(/tenant_member_suspensions/);
    expect(sqls).not.toMatch(/role_permissions/);
    expect(sqls).not.toMatch(/staff_permission_overrides/);
  });

  it('commits and releases the connection on the suspended path too', async () => {
    // An early return that leaks a pooled connection would exhaust the pool the first time a suspended member's app
    // retried — which is precisely when a suspended member's app retries a lot.
    const h = harness(['t-anand']);
    await h.svc.effectiveAccess('u-kanji', 't-anand');
    expect(h.client.query).toHaveBeenCalledWith('COMMIT');
    expect(h.client.release).toHaveBeenCalled();
  });

  it('binds the tenant as a parameter, never interpolated', async () => {
    const h = harness(['t-anand']);
    await h.svc.effectiveAccess('u-kanji', 't-anand');
    const call = h.seen.find((s) => /tenant_member_suspensions/.test(s.sql))!;
    expect(call.params).toEqual(['u-kanji', 't-anand']);
    expect(call.sql).not.toContain('t-anand');
  });
});

describe('TENANT-1b-2 · the cache is keyed per tenant', () => {
  it('caches under a key carrying BOTH the tenant and the user', async () => {
    // A key missing the tenant would let a suspension in one organisation answer for another — the same cross-tenant
    // leak, one layer up.
    const h = harness(['t-anand']);
    await h.svc.effectiveAccess('u-kanji', 't-anand');
    const key = String(h.cache.wrap.mock.calls[0][0]);
    expect(key).toContain('t-anand');
    expect(key).toContain('u-kanji');
  });

  it('invalidates that exact key, so a lift takes effect without waiting for a TTL', async () => {
    const h = harness([]);
    await h.svc.effectiveAccess('u-kanji', 't-anand');
    const cachedKey = String(h.cache.wrap.mock.calls[0][0]);
    await h.svc.invalidate('u-kanji', 't-anand');
    expect(h.cache.del).toHaveBeenCalledWith(cachedKey);
  });
});
