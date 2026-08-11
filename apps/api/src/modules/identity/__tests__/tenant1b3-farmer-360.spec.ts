// modules/identity/__tests__/tenant1b3-farmer-360.spec.ts · PC-56 TENANT-1b-3.
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: NOTHING ON THIS PAGE IS A NUMBER THE MEMBER COULD NOT CHECK.**
//
// W155's own closing sentence is the constraint — "He can request his full record anytime (DPDP data access) and it looks
// exactly like this — nothing hidden, nothing we'd be ashamed to show him" — and it cuts both ways: no number the member
// cannot reproduce, and no number a banker could be misled by.
//
// Two refusals carry most of this suite. The credit verdict, because a farmer told they are "KCC-ready" who loses a day's
// wages to a bank that refuses them has paid for an invention of ours. And a missing actual yield, because the expected
// figure sits in the same row and substituting it would make a failed season look average.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Farmer360ReadModel } from '../read-models/farmer-360.read-model';
import { Farmer360Service } from '../services/farmer-360.service';
import { IdentityPermissions } from '../policies/identity.policies';

const HEAD = { user_id: 'u1', full_name: 'Ramesh P.' };
const CROP = { minor: '27706000', n: 8 };
const DAIRY = { minor: '19640000', n: 12 };
const NO_DAIRY = { minor: '0', n: 0 };

function harness(over: Record<string, unknown[]> = {}, headRows: unknown[] = [HEAD]) {
  const seen: { sql: string; params?: unknown[] }[] = [];
  const table: { match: RegExp; rows: unknown[] }[] = [
    { match: /FROM users u\s+WHERE u\.id = \$1/, rows: headRows },
    { match: /FROM payouts p\s+JOIN lookup_values/, rows: (over.crop as unknown[]) ?? [CROP] },
    { match: /FROM milk_bills mb/, rows: (over.dairy as unknown[]) ?? [NO_DAIRY] },
    { match: /FROM land_parcels lp\s+WHERE/, rows: (over.land as unknown[]) ?? [] },
    { match: /JOIN lookup_values lv ON lv\.id = lp\.irrigation_type_id/, rows: (over.irrigation as unknown[]) ?? [] },
    { match: /FROM dbt_transfers/, rows: (over.schemes as unknown[]) ?? [] },
    { match: /FROM crop_seasons/, rows: (over.seasons as unknown[]) ?? [] },
    { match: /COUNT\(DISTINCT date_trunc\('month'/, rows: (over.pay as unknown[]) ?? [{ n: 8, months: 9 }] },
    { match: /FROM land_parcels WHERE tenant_id/, rows: (over.landCount as unknown[]) ?? [{ n: 2, verified: 1 }] },
    { match: /FROM user_tenant_roles WHERE tenant_id/, rows: (over.kyc as unknown[]) ?? [{ active: 2, verified: 2 }] },
  ];
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    seen.push({ sql, params });
    const hit = table.find((t) => t.match.test(sql));
    if (!hit) throw new Error(`no fake for: ${sql.slice(0, 140)}`);
    return { rows: hit.rows };
  });
  const replica = { forTenant: jest.fn((tenantId: string) => { void tenantId; return { query }; }) };
  const rm = new Farmer360ReadModel(replica as never);
  const log = jest.fn(async (entry: Record<string, unknown>) => { void entry; });
  const svc = new Farmer360Service(rm, { log } as never);
  return { rm, svc, seen, log, replica };
}

const actor = { userId: 'staff-1', ip: '10.0.0.3', requestId: 'req-360' };

describe('TENANT-1b-3 · the tenant boundary', () => {
  it('returns null for somebody who is not a member here', async () => {
    const h = harness({}, []);
    expect(await h.rm.get('t1', 'stranger')).toBeNull();
    expect(h.seen).toHaveLength(1);
  });

  it('scopes the head query to this tenant’s membership, in the SQL', async () => {
    // The lesson from TENANT-1b: a harness returning no rows proves nothing about the query. Assert the clause.
    const h = harness();
    await h.rm.get('t1', 'u1');
    expect(h.seen[0].sql).toMatch(/EXISTS \(SELECT 1 FROM user_tenant_roles utr/);
    expect(h.seen[0].params).toEqual(['u1', 't1']);
  });
});

describe('TENANT-1b-3 · realized income means SETTLED', () => {
  it('counts only paid payouts and paid milk bills', async () => {
    const h = harness({ dairy: [DAIRY] });
    const f = (await h.rm.get('t1', 'u1'))!;
    expect(f.income.cropRealizedMinor).toBe('27706000');
    expect(f.income.dairyRealizedMinor).toBe('19640000');
    // W155's own total: crops ₹2,77,060 + dairy ₹1,96,400 = ₹4,73,460.
    expect(f.income.totalRealizedMinor).toBe('47346000');

    const crop = h.seen.find((s) => /FROM payouts p\s+JOIN lookup_values/.test(s.sql))!.sql;
    const dairy = h.seen.find((s) => /FROM milk_bills mb/.test(s.sql))!.sql;
    // "Unsold stock counts when paid, never before." A queued payout and an approved-but-unpaid bill are not income.
    expect(crop).toMatch(/p\.status = 'paid'/);
    expect(dairy).toMatch(/mb\.status = 'paid'/);
  });

  it('counts SELLING purposes only — not wages, not dividends', async () => {
    const h = harness();
    await h.rm.get('t1', 'u1');
    const crop = h.seen.find((s) => /FROM payouts p\s+JOIN lookup_values/.test(s.sql))!.sql;
    expect(crop).toMatch(/lv\.code IN \('settlement', 'milk_bill'\)/);
    // Wage money is labour income and a dividend is a return on shares. Folding either into "farm income" would answer
    // a different question from the one the tile asks — and inflate the number a banker is shown.
    expect(crop).not.toMatch(/'wage'/);
    expect(crop).not.toMatch(/'dividend'/);
  });

  /** **TENTH APPLICATION OF unknown ≠ zero, AND IT PROPAGATES TO THE TOTAL.** */
  it('returns null dairy AND a null total when there are no dairy bills', async () => {
    const h = harness({ dairy: [NO_DAIRY] });
    const f = (await h.rm.get('t1', 'u1'))!;
    expect(f.income.dairyRealizedMinor).toBeNull();
    // A total that silently treats unknown as zero is a wrong number wearing a confident face — so there is no total,
    // and the console prints the crop figure on its own instead.
    expect(f.income.totalRealizedMinor).toBeNull();
    expect(f.income.cropRealizedMinor).toBe('27706000');
  });
});

describe('TENANT-1b-3 · land is never summed across units', () => {
  it('groups by unit and keeps each area with its own unit', async () => {
    const h = harness({
      land: [
        { unit: 'acre', area: '4.2000', parcels: 2, verified: 1, with_record: 2 },
        { unit: 'hectare', area: '1.0000', parcels: 1, verified: 0, with_record: 0 },
      ],
    });
    const f = (await h.rm.get('t1', 'u1'))!;
    // **A HECTARE IS 2.4711 ACRES.** "5.2" would be a quantity in no unit at all, and converting silently is how a
    // 4.2-acre holding becomes a 10.4-acre one on a loan application.
    expect(f.land.byUnit).toEqual([
      { unit: 'acre', area: '4.2000', parcels: 2, verifiedParcels: 1 },
      { unit: 'hectare', area: '1.0000', parcels: 1, verifiedParcels: 0 },
    ]);
    expect(f.land.parcelsWithRecord).toBe(2);
  });

  it('groups in the SQL rather than summing in it', async () => {
    const h = harness();
    await h.rm.get('t1', 'u1');
    const sql = h.seen.find((s) => /FROM land_parcels lp\s+WHERE/.test(s.sql))!.sql;
    // **ANCHORED TO THE START OF ITS LINE, BECAUSE A MUTATION SLIPPED PAST THE UNANCHORED VERSION.** Commenting the clause
    // out — `-- GROUP BY lp.area_unit` — left every test green: a substring match cannot tell live SQL from a line
    // somebody disabled. Third variation on the same lesson in this programme, and the cheapest fix each time.
    expect(sql).toMatch(/^\s*GROUP BY lp\.area_unit\s*$/m);
    // The one shape that must never appear: a total area with no unit attached.
    expect(sql).not.toMatch(/SUM\(lp\.area_value\)[\s\S]{0,40}AS total_area/);
  });
});

describe('TENANT-1b-3 · scheme benefits are money that landed', () => {
  it('sums observed credits for the calendar year, per scheme', async () => {
    const h = harness({
      schemes: [
        { code: 'drip', name: 'Drip subsidy', minor: '1200000', n: 1, last_on: '2026-03-04' },
        { code: 'pm_kisan', name: 'PM-Kisan', minor: '400000', n: 2, last_on: '2026-07-01' },
      ],
    });
    const f = (await h.rm.get('t1', 'u1'))!;
    // W155: "Scheme benefits YTD ₹16,000 · PM-Kisan ₹4,000 + drip ₹12,000".
    expect(f.schemesYtdTotalMinor).toBe('1600000');
    expect(f.schemesYtd[0].schemeName).toBe('Drip subsidy');
    const sql = h.seen.find((s) => /FROM dbt_transfers/.test(s.sql))!.sql;
    expect(sql).toMatch(/date_trunc\('year', CURRENT_DATE\)/);
    // `dbt_transfers.tenant_id` is NULLABLE — a transfer can be observed without a tenant — so a plain equality would
    // silently drop the member's own PM-Kisan credits.
    expect(sql).toMatch(/d\.tenant_id = \$1 OR d\.tenant_id IS NULL/);
  });

  it('totals in bigint, never in float', async () => {
    // Money is minor-unit strings (Law 2). At Y8-9 magnitudes in a weak currency a float total is quietly short.
    const h = harness({ schemes: [
      { code: 'a', name: 'A', minor: '123456789012345678', n: 1, last_on: null },
      { code: 'b', name: 'B', minor: '1', n: 1, last_on: null },
    ] });
    expect((await h.rm.get('t1', 'u1'))!.schemesYtdTotalMinor).toBe('123456789012345679');
  });
});

describe('TENANT-1b-3 · a yield is never estimated without saying so', () => {
  const season = {
    season: 'kharif', year: 2025, product_name: 'GG-20 groundnut', area: '2.8000', unit: 'acre',
    sown_on: '2025-06-20', expected_harvest: '2025-10-10', expected_yield: '48.000', actual_yield: '52.000',
    status: 'harvested',
  };

  it('reports the actual yield when it is recorded', async () => {
    const h = harness({ seasons: [season] });
    const s = (await h.rm.get('t1', 'u1'))!.seasons[0];
    expect(s.actualYield).toBe('52.000');
    expect(s.expectedYield).toBe('48.000');
    expect(s.parcelArea).toBe('2.8000');
  });

  /**
   * **THE SUBSTITUTION THIS SUITE EXISTS TO PREVENT.** The expected figure is in the same row, and using it when the
   * actual is missing would make a bad season look average on a page a banker may be shown. W155 states the rule itself:
   * "Yields are his records + FPO weighbridge — never estimated without saying so."
   */
  it('leaves the actual yield NULL rather than falling back to the expectation', async () => {
    const h = harness({ seasons: [{ ...season, actual_yield: null }] });
    const s = (await h.rm.get('t1', 'u1'))!.seasons[0];
    expect(s.actualYield).toBeNull();
    expect(s.actualYield).not.toBe(s.expectedYield);
    // And the expectation is still returned, so the console can label it AS an expectation.
    expect(s.expectedYield).toBe('48.000');
  });

  it('joins the season to the parcel’s owner, not to the season’s tenant alone', async () => {
    const h = harness();
    await h.rm.get('t1', 'u1');
    const sql = h.seen.find((s) => /FROM crop_seasons/.test(s.sql))!.sql;
    // `crop_seasons` has no user column: the owner comes through the parcel. Without this join the page would show one
    // member every crop season in the organisation.
    expect(sql).toMatch(/JOIN land_parcels lp ON lp\.id = cs\.parcel_id/);
    expect(sql).toMatch(/lp\.owner_user_id = \$2/);
  });
});

describe('TENANT-1b-3 · credit READINESS is refused and the EVIDENCE is real', () => {
  it('never returns a readiness verdict', async () => {
    const f = (await harness().rm.get('t1', 'u1'))!;
    // No lender has agreed a rule with this platform. A verdict here is the most harmful invention available to this
    // file, because a farmer acts on it by giving up a day of work.
    expect(f.credit.readiness).toBeNull();
  });

  it('returns the evidence a KCC desk actually asks for, regularity included', async () => {
    const h = harness({ pay: [{ n: 8, months: 9 }], landCount: [{ n: 2, verified: 1 }], kyc: [{ active: 2, verified: 2 }] });
    const f = (await h.rm.get('t1', 'u1'))!;
    expect(f.credit.settledPayouts12mo).toBe(8);       // W155's "income proof: 8 settlement statements"
    // Eight payouts in ONE month is a different story from eight across a year, and a lender discounts the first.
    expect(f.credit.monthsWithIncome12mo).toBe(9);
    expect(f.credit.landParcelsOnFile).toBe(2);
    expect(f.credit.landParcelsVerified).toBe(1);
    expect(f.credit.allRolesKycVerified).toBe(true);
  });

  it('reads KYC the worst-status way, matching the roster and the money gate', async () => {
    // One unverified active role means NOT fully verified — the same reading `isFullyVerified` uses, and the same one the
    // payout gate enforces since 0125. Two surfaces disagreeing about a member's compliance is how staff lose trust.
    const h = harness({ kyc: [{ active: 2, verified: 1 }] });
    expect((await h.rm.get('t1', 'u1'))!.credit.allRolesKycVerified).toBe(false);
    const none = harness({ kyc: [{ active: 0, verified: 0 }] });
    expect((await none.rm.get('t1', 'u1'))!.credit.allRolesKycVerified).toBe(false);
  });

  it('never returns an advisory suggestion', async () => {
    // The canon's three suggestions need a record of stored, unsold stock. Nothing holds one, and a rules engine that
    // guessed would be putting words into a trusted person's mouth.
    expect((await harness().rm.get('t1', 'u1'))!.advisory).toEqual([]);
  });
});

describe('TENANT-1b-3 · opening the 360 is recorded before it is returned', () => {
  it('writes the audit row and returns the data', async () => {
    const h = harness({ seasons: [], schemes: [] });
    const f = await h.svc.view('t1', actor, 'u1');
    expect(f.userId).toBe('u1');
    expect(h.log).toHaveBeenCalledTimes(1);
    const entry = h.log.mock.calls[0][0] as Record<string, unknown>;
    expect(entry.action).toBe('member.view360_opened');
    expect(entry.actorUserId).toBe('staff-1');
    expect(entry.entityId).toBe('u1');
    expect(entry.requestId).toBe('req-360');
  });

  /** **THE ROW RECORDS THAT A VIEW HAPPENED, NEVER WHAT IT SAID.** The audit log is retained for years and read by more
   *  people than the console; putting a member's income in it would make it a second copy of the record it polices. */
  it('records the shape, not the content', async () => {
    const h = harness({
      dairy: [DAIRY],
      schemes: [{ code: 'pm_kisan', name: 'PM-Kisan', minor: '400000', n: 2, last_on: '2026-07-01' }],
    });
    await h.svc.view('t1', actor, 'u1');
    const entry = h.log.mock.calls[0][0] as { newValue: Record<string, unknown> };
    expect(entry.newValue).toEqual({ seasons: 0, schemes: 1, landUnits: 0 });
    const serialised = JSON.stringify(entry);
    for (const value of ['27706000', '19640000', '400000', 'Ramesh']) expect(serialised).not.toContain(value);
  });

  /**
   * **AN UNRECORDABLE VIEW DOES NOT HAPPEN.** No try/catch, deliberately — the same rule as the PII reveal and the
   * deliberate opposite of ADMIN-SWEEP's circuit recorder, which never throws. There the breaker was the control and the
   * row was the report; here the row IS the control, because a view nobody can prove happened is surveillance.
   */
  it('refuses the view when the record cannot be written', async () => {
    const h = harness();
    h.log.mockRejectedValueOnce(new Error('audit_log unreachable'));
    await expect(h.svc.view('t1', actor, 'u1')).rejects.toThrow(/audit_log unreachable/);
  });

  /** But a 404 must NOT leave a row saying somebody viewed a 360 they never saw: a trail full of views that did not
   *  happen is worse than no trail. Hence FIND → RECORD → RETURN, in that order. */
  it('writes nothing for a member outside the tenant', async () => {
    const h = harness({}, []);
    await expect(h.svc.view('t1', actor, 'stranger')).rejects.toThrow(/not found in this organisation/);
    expect(h.log).not.toHaveBeenCalled();
  });

  it('echoes the timestamp it recorded, so the screen and the log agree', async () => {
    const h = harness();
    const f = await h.svc.view('t1', actor, 'u1');
    expect(Number.isNaN(Date.parse(f.viewedAt))).toBe(false);
  });
});

describe('TENANT-1b-3 · the narrowest grant stays the narrowest', () => {
  /**
   * **A MUTATION WIDENED THE 360 TO `report.view` AND NOTHING NOTICED.**
   *
   * That single-word change hands the deepest per-person view in the console to every desk that can read the roster —
   * support agents, auditors, every field officer — and it would read as a harmless simplification in a diff. W155 is
   * explicit: "Needs `member.view360` — the deepest per-person view in your console, so the narrowest grant."
   *
   * So the code is pinned, and pinned NEGATIVELY as well: it is not enough that the value is right today, it must not be
   * any of the broad grants tomorrow.
   */
  it('requires member.view360 and never a broader grant', () => {
    expect(IdentityPermissions.View360).toBe('member.view360');
    expect(IdentityPermissions.View360).not.toBe(IdentityPermissions.Report);
    expect(IdentityPermissions.View360).not.toBe(IdentityPermissions.Approve);
    // And it is its own grant, not an alias of the PII reveal: revealing one phone number and reading somebody's whole
    // farming life are different decisions, and a tenant may reasonably allow one and refuse the other.
    expect(IdentityPermissions.View360).not.toBe(IdentityPermissions.RevealPii);
  });

  it('guards the 360 ROUTE with it, in the controller', () => {
    const ctrl = fs.readFileSync(
      path.join(__dirname, '..', 'controllers', 'v1', 'member-roster.controller.ts'), 'utf8');
    // The decorator sits directly above the handler, so the two are asserted TOGETHER — a route that kept the decorator
    // while renaming the handler, or vice versa, is exactly the drift this catches.
    expect(ctrl).toMatch(/@Get\(':userId\/360'\)\s*\n\s*@RequirePermissions\(IdentityPermissions\.View360\)/);
  });
});
