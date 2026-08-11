// modules/identity/__tests__/tenant1b-member-detail.spec.ts · PC-56 TENANT-1b.
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: W154's TILES SAY WHAT THEY MEASURE, AND SAY NOTHING WHERE THERE IS NO SOURCE.**
//
// The screen prints a trust score of 81, twenty-eight active days and a dairy figure. Two of those three have no source
// on this platform, and the third does not exist for most members. This suite holds the read model to returning `null`
// for each rather than a plausible substitute — because a made-up number on a member's profile is read by staff as a
// reason to extend or withhold credit to a farmer.
import { MemberDetailReadModel } from '../read-models/member-detail.read-model';

const HEAD = {
  user_id: 'u1', full_name: 'Ramesh P.', status: 'active', phone: '+919821010210',
  language_code: 'gu', member_since: '2024-11-04T00:00:00Z', last_active_at: '2026-08-11T09:12:00Z',
  aadhaar_last4: '8817', has_aadhaar: true, has_pan: false, village_name: 'Junagadh (rural)',
  active_roles: 2,
};

const MONEY = { received_minor: '86420000', paid_count: 7, order_count: 42, first_order_at: '2024-11-20T00:00:00Z' };
const NO_DAIRY = { litres: null, amount_minor: null, fat: null, snf: null, rows: 0 };
const DAIRY = { litres: '426.000', amount_minor: '1864000', fat: '6.80', snf: '9.10', rows: 58 };
const DISPUTES = { total: 4, upheld: 0, open: 0 };

/**
 * A fake replica that answers each query by matching a fragment of its SQL.
 *
 * Matching on SQL text rather than call order is deliberate: the read model fires four glance queries with
 * `Promise.all`, and a harness that assumed an order would pass while the code returned dairy figures in the disputes
 * tile. It also lets each test assert on the SQL itself, which is how the vault-reference rule below is checked.
 */
function harness(overrides: Record<string, unknown[]> = {}, headRows: unknown[] = [HEAD]) {
  const seen: string[] = [];
  const table: { match: RegExp; rows: unknown[] }[] = [
    { match: /FROM users u\s+LEFT JOIN addresses/, rows: headRows },
    { match: /FROM user_tenant_roles utr\s+JOIN roles r/, rows: (overrides.roles as unknown[]) ?? [] },
    { match: /received_minor/, rows: (overrides.money as unknown[]) ?? [MONEY] },
    { match: /FROM milk_collections/, rows: (overrides.dairy as unknown[]) ?? [NO_DAIRY] },
    { match: /FROM animals/, rows: (overrides.animals as unknown[]) ?? [{ n: 2 }] },
    { match: /FROM disputes/, rows: (overrides.disputes as unknown[]) ?? [DISPUTES] },
    { match: /FROM user_quiet_hours/, rows: (overrides.quiet as unknown[]) ?? [] },
    { match: /FROM price_alerts/, rows: (overrides.alerts as unknown[]) ?? [] },
    { match: /FROM notification_preferences/, rows: (overrides.muted as unknown[]) ?? [] },
    { match: /FROM payouts p\s/, rows: (overrides.payoutActivity as unknown[]) ?? [] },
    { match: /FROM listings l/, rows: (overrides.listingActivity as unknown[]) ?? [] },
  ];
  // `params` is declared even though the fake ignores it: an argument the mock does not declare is an argument
  // `mock.calls[0][1]` cannot be typed, and the parameter-binding assertion below is exactly that argument. Third
  // occurrence of this trap in one wave, so it is written down rather than worked around.
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    void params;
    seen.push(sql);
    const hit = table.find((t) => t.match.test(sql));
    if (!hit) throw new Error(`no fake for query: ${sql.slice(0, 120)}`);
    return { rows: hit.rows };
  });
  // The parameter is DECLARED so `calls[0][0]` is typed: an untyped `jest.fn(() => …)` infers a ZERO-ARGUMENT tuple and
  // every assertion about the tenant id becomes `never`. Same trap as the PII-reveal suite, same fix, named twice.
  const replica = { forTenant: jest.fn((tenantId: string) => { void tenantId; return { query }; }) };
  return { rm: new MemberDetailReadModel(replica as never), query, seen, replica };
}

describe('TENANT-1b · the tenant boundary', () => {
  it('returns null when the person is not a member of this tenant', async () => {
    // The EXISTS join on `user_tenant_roles` is the boundary. Without it this route is a platform-wide profile reader
    // keyed on a uuid, with RLS as the only net. `null` becomes a 404 rather than a 403: telling a caller "that person
    // exists but is not yours" is an enumeration oracle across 15,000 tenants.
    const h = harness({}, []);
    expect(await h.rm.get('t1', 'u-outsider')).toBeNull();
    // And it stops there: no money, no dairy, no preferences were read for somebody who is not ours.
    expect(h.query).toHaveBeenCalledTimes(1);
  });

  /**
   * **AND THE BOUNDARY IS ASSERTED ON THE SQL, BECAUSE THE TEST ABOVE CANNOT SEE IT.**
   *
   * A mutation run proved this: deleting the entire `EXISTS (… user_tenant_roles …)` clause from the query left all
   * sixteen tests green. Of course it did — the harness is the thing that returns no row for an outsider, so the test
   * above was asserting that the read model handles an empty result, not that the query would produce one. **A rule
   * expressed in SQL is invisible to a value-level assertion; only an assertion on the SQL text catches it.** Same shape
   * as the trap in the PII-reveal suite, where a defaulted parameter swallowed the very case under test.
   */
  it('scopes the head query to this tenant’s membership, in the SQL itself', async () => {
    const h = harness();
    await h.rm.get('t1', 'u1');
    const head = h.seen[0];
    expect(head).toMatch(/EXISTS \(SELECT 1 FROM user_tenant_roles utr/);
    expect(head).toMatch(/utr\.user_id = u\.id AND utr\.tenant_id = \$2/);
    // The tenant id is bound as a PARAMETER, never interpolated: this query takes a uuid from a URL path.
    expect(h.query.mock.calls[0][1]).toEqual(['u1', 't1']);
  });

  it('reads every query through the tenant-scoped replica', async () => {
    const h = harness();
    await h.rm.get('t1', 'u1');
    for (const call of h.replica.forTenant.mock.calls) expect(call[0]).toBe('t1');
  });

  /**
   * **A LAPSED MEMBER RENDERS, FLAGGED, RATHER THAN VANISHING.** They still have payouts, orders and a KYC history this
   * organisation is accountable for, and W154 says so itself: "membership history stays with the member". Hiding the
   * record the moment somebody deactivated a role would make a tenant's own books unreachable.
   */
  it('flags a member with no active role instead of refusing them', async () => {
    const h = harness({}, [{ ...HEAD, active_roles: 0 }]);
    const m = await h.rm.get('t1', 'u1');
    expect(m?.membershipInactive).toBe(true);
    expect(m?.glance.lifetimeReceivedMinor).toBe('86420000');
  });
});

describe('TENANT-1b · PII discipline on the detail read', () => {
  it('masks the phone and never selects a vault reference', async () => {
    const h = harness();
    const m = await h.rm.get('t1', 'u1');
    // W154 prints `+91 98••• ••210`. The unmasked number is a separate, recorded, reasoned act.
    expect(m?.phoneMasked).toBe('+91 98••• ••210');
    const head = h.seen[0];
    // The refs may be TESTED for presence and must never be selected as values: what we cannot leak, we cannot lose.
    expect(head).toMatch(/aadhaar_vault_ref IS NOT NULL/);
    expect(head).toMatch(/pan_vault_ref IS NOT NULL/);
    expect(head).not.toMatch(/,\s*u\.aadhaar_vault_ref/);
    expect(head).not.toMatch(/,\s*u\.pan_vault_ref/);
    expect(m?.hasAadhaarVault).toBe(true);
    expect(m?.hasPanVault).toBe(false);
    // Last four is not the number: it is what W154 shows as `XXXX-XXXX-8817`.
    expect(m?.aadhaarLast4).toBe('8817');
  });
});

describe('TENANT-1b · the tiles that have no source return null', () => {
  it('never returns a trust score', async () => {
    const h = harness();
    const m = await h.rm.get('t1', 'u1');
    // W154's "trusted · 81". `grep -rl "trust_score"` finds nothing in the migrations or the api.
    expect(m?.glance.trustScore).toBeNull();
    // What IS real is the record underneath the badge: 4 disputes, none upheld — the canon's "4/4 disputes clean".
    expect(m?.glance.disputesAgainst).toBe(4);
    expect(m?.glance.disputesAgainstUpheld).toBe(0);
  });

  /**
   * **AND THIS ABSENCE IS THE FINDING, NOT JUST A MISSING FEATURE.** The only per-day record of somebody using the
   * platform is `login_events`, which carries no tenant_id. Counting it would tell this organisation how often the
   * member opened the app for a DIFFERENT one — the realm-identity problem for the twelfth time in this programme.
   */
  it('never returns a per-day activity count, and never reads the login trail', async () => {
    const h = harness();
    const m = await h.rm.get('t1', 'u1');
    expect(m?.glance.activeDays30d).toBeNull();
    for (const sql of h.seen) expect(sql).not.toMatch(/login_events/);
    // The one activity fact that IS tenant-safe — the member's own last-seen timestamp — is still returned.
    expect(m?.lastActiveAt).toBe('2026-08-11T09:12:00.000Z');
  });
});

describe('TENANT-1b · unknown is not zero', () => {
  it('returns null dairy for a member with no collections, not a ₹0 tile', async () => {
    // A groundnut grower with a "Dairy ₹0" tile is a question staff waste time on. Ninth application of unknown ≠ zero.
    const h = harness({ dairy: [NO_DAIRY] });
    expect((await h.rm.get('t1', 'u1'))?.glance.dairy).toBeNull();
  });

  it('returns the dairy figures when there are collections', async () => {
    const h = harness({ dairy: [DAIRY] });
    const d = (await h.rm.get('t1', 'u1'))?.glance.dairy;
    expect(d).toEqual({ litres: '426.000', amountMinor: '1864000', avgFatPct: '6.80', avgSnfPct: '9.10', animalCount: 2 });
  });

  /** **FAT IS AVERAGED BY WEIGHT, NOT BY ROW.** A 2 kg evening can must not count as much as a 12 kg morning one; a
   *  plain AVG() would print a number no dairy manager recognises. Asserted on the SQL because the arithmetic is the
   *  database's, and a mutation to `AVG(mc.fat_pct)` would otherwise pass every value-level test in this file. */
  it('weights the fat average by the milk weight', async () => {
    const h = harness({ dairy: [DAIRY] });
    await h.rm.get('t1', 'u1');
    const sql = h.seen.find((s) => /FROM milk_collections/.test(s))!;
    expect(sql).toMatch(/SUM\(mc\.fat_pct \* mc\.weight_kg\)\s*\/\s*NULLIF\(SUM\(mc\.weight_kg\), 0\)/);
    expect(sql).not.toMatch(/AVG\(mc\.fat_pct\)/);
    // And it joins through dairy_memberships, because milk_collections is keyed on membership_id and never on a user.
    expect(sql).toMatch(/JOIN dairy_memberships dm ON dm\.id = mc\.membership_id/);
    // Bounded by the partition key, so this is at most 30 daily partitions rather than a sweep of the whole table.
    expect(sql).toMatch(/mc\.collected_on >= \(CURRENT_DATE - 30\)/);
  });
});

describe('TENANT-1b · roles, documents and activity', () => {
  it('keeps inactive roles in the list, marked', async () => {
    const h = harness({
      roles: [
        { role_code: 'farmer', kyc_status: 'verified', is_active: true, since: '2024-11-04T00:00:00Z', documents: [{ docType: 'aadhaar', status: 'verified', validUntil: null }] },
        { role_code: 'worker', kyc_status: 'rejected', is_active: false, since: '2025-02-01T00:00:00Z', documents: null },
      ],
    });
    const m = await h.rm.get('t1', 'u1');
    // Dropping the inactive row would hide WHY a payout was refused, which is the question staff open this page with.
    expect(m?.roles).toHaveLength(2);
    expect(m?.roles[1]).toMatchObject({ roleCode: 'worker', isActive: false, documents: [] });
    expect(m?.roles[0].documents[0].docType).toBe('aadhaar');
  });

  it('attaches a person-level document to every role, and never another tenant’s document', async () => {
    const h = harness();
    await h.rm.get('t1', 'u1');
    const sql = h.seen.find((s) => /FROM user_tenant_roles utr\s+JOIN roles r/.test(s))!;
    // `role_id IS NULL` = filed against the PERSON, so it belongs under every role — that is what W154's "inherits
    // Aadhaar" means. An Aadhaar is an Aadhaar whichever capacity needed it first.
    expect(sql).toMatch(/k\.role_id = utr\.role_id OR k\.role_id IS NULL/);
    // A document filed through a DIFFERENT tenant is not shown, for the same reason the login trail is not.
    expect(sql).toMatch(/k\.tenant_id = \$1 OR k\.tenant_id IS NULL/);
  });

  it('merges payouts and listings newest-first and bounds the strip', async () => {
    const h = harness({
      payoutActivity: [
        { at: '2026-07-11T00:00:00Z', amount_minor: '4466000', status: 'paid', purpose: 'settlement' },
        { at: '2026-05-02T00:00:00Z', amount_minor: '120000', status: 'paid', purpose: 'wage' },
      ],
      listingActivity: [
        { at: '2026-07-09T00:00:00Z', status: 'published', title: '24 qtl GG-20', price_minor: '638000' },
      ],
    });
    const a = (await h.rm.get('t1', 'u1'))!.activity;
    expect(a.map((x) => [x.kind, x.at.slice(0, 10)])).toEqual([
      ['payout', '2026-07-11'],
      ['listing', '2026-07-09'],
      ['payout', '2026-05-02'],
    ]);
    expect(a[0]).toMatchObject({ amountMinor: '4466000', label: 'settlement', status: 'paid' });
  });

  it('labels a payout whose purpose the lookup cannot name as empty, never as settlement', async () => {
    // Guessing "settlement" for an unnamed purpose would put crop-sale wording on a wage line.
    const h = harness({ payoutActivity: [{ at: '2026-07-11T00:00:00Z', amount_minor: '1000', status: 'paid', purpose: null }] });
    expect((await h.rm.get('t1', 'u1'))!.activity[0].label).toBe('');
  });
});

describe('TENANT-1b · the member’s own choices', () => {
  it('reports absent quiet hours as absent, not as consent to a 22:00 call', async () => {
    const h = harness({ quiet: [] });
    expect((await h.rm.get('t1', 'u1'))?.preferences.quietHours).toBeNull();
  });

  it('returns the member’s quiet hours with their timezone', async () => {
    const h = harness({ quiet: [{ starts: '21:00:00', ends: '06:00:00', timezone: 'Asia/Kolkata' }] });
    expect((await h.rm.get('t1', 'u1'))?.preferences.quietHours)
      .toEqual({ starts: '21:00:00', ends: '06:00:00', timezone: 'Asia/Kolkata' });
  });

  it('reads only the notification rows the member switched OFF', async () => {
    const h = harness();
    await h.rm.get('t1', 'u1');
    const sql = h.seen.find((s) => /FROM notification_preferences/.test(s))!;
    // An exhaustive dump would be the member's whole notification surface rendered in a tenant console.
    expect(sql).toMatch(/is_enabled = false/);
    expect(sql).toMatch(/LIMIT 50/);
  });
});
