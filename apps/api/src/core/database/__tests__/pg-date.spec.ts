// core/database/__tests__/pg-date.spec.ts · PC-56 TENANT-6b-1.
//
// Two jobs. First, hold the mapper's behaviour in the timezone where the old one broke — asserted by CONSTRUCTING the
// value node-pg constructs (a JS Date at local midnight) rather than by reading a string, because the whole defect
// lived in the gap between those two things. Second, SWEEP the repository for the wrong shapes, so the twenty-odd
// display-only sites that still carry one can only ever go DOWN in number and no new site can appear.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pgDate, pgDateOrNull, pgLocalDay } from '../pg-date';

/** What node-pg hands back for `date '2026-07-13'`: a JS Date at LOCAL midnight. */
const asNodePgDate = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe('core/pg-date · the date PostgreSQL actually holds', () => {
  it('returns the calendar day, not an instant, for the value node-pg constructs', () => {
    expect(pgDate(asNodePgDate(2026, 7, 13))).toBe('2026-07-13');
    expect(pgDate(asNodePgDate(2026, 1, 1))).toBe('2026-01-01');
    expect(pgDate(asNodePgDate(2026, 12, 31))).toBe('2026-12-31');
  });

  it('zero-pads month and day, so the string sorts and compares as a date', () => {
    expect(pgDate(asNodePgDate(2026, 3, 4))).toBe('2026-03-04');
    expect(pgDate(asNodePgDate(2026, 3, 4)) < pgDate(asNodePgDate(2026, 3, 14))).toBe(true);
  });

  /**
   * THE DEFECT, held as a test rather than a comment. Under a timezone ahead of UTC, local midnight is the PREVIOUS
   * day in UTC — which is how a bill-attach predicate missed every row and a farmer was paid twice. This assertion
   * only means something when the suite runs under such a zone, so it states the condition rather than skipping
   * silently: run the api suite with TZ=Asia/Kolkata and it becomes the regression guard for the real bug.
   */
  it('does not consult toISOString() or toString() AT ALL — the two shapes that were wrong', () => {
    // [MUTATION GAP] The first version of this test only asserted the difference when the HOST timezone happened to be
    // ahead of UTC. Under a UTC runner — which is every CI box — reintroducing `toISOString()` therefore SURVIVED, which
    // is the very defect this file exists for, and `process.env.TZ` cannot be changed once jest's environment has
    // resolved it. So the contract is asserted directly instead of via the ambient timezone: the mapper must read the
    // Date's LOCAL COMPONENTS, so stubbing the two methods it must never call cannot change its answer.
    const d = new Date(2026, 6, 13);
    Object.defineProperty(d, 'toISOString', { value: () => '1999-01-01T00:00:00.000Z' });
    Object.defineProperty(d, 'toString', { value: () => 'Xxx Xxx 99 1999' });
    expect(pgDate(d)).toBe('2026-07-13');            // an ISO-based mapper would answer 1999-01-01
    expect(pgDateOrNull(d)).toBe('2026-07-13');      // a String()-based one would answer "Xxx Xxx 99"
    expect(pgLocalDay(d)).toBe('2026-07-13');
  });

  it('reads the day PostgreSQL holds in every zone the platform can be deployed in', () => {
    // Belt and braces on the real thing: whatever zone this process is in, local midnight of a day IS that day. Run the
    // api suite with TZ=Asia/Kolkata (the launch market) and this is the regression guard for the live double-payment;
    // under UTC it still pins the padding and the component order.
    for (const [y, m, dd] of [[2026, 7, 13], [2026, 1, 1], [2026, 12, 31], [2026, 3, 8], [2026, 11, 1]] as const) {
      expect(pgDate(new Date(y, m - 1, dd))).toBe(`${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`);
    }
  });

  it('never yields the OTHER wrong shape — a human-readable date nobody can parse', () => {
    const out = pgDate(asNodePgDate(2026, 7, 13));
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(asNodePgDate(2026, 7, 13)).slice(0, 10)).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('passes an already-formatted string through, truncated to the calendar day', () => {
    expect(pgDate('2026-07-13')).toBe('2026-07-13');
    expect(pgDate('2026-07-13T18:30:00.000Z')).toBe('2026-07-13');
  });

  it('separates NULL from the empty string, so a nullable column stays nullable', () => {
    expect(pgDateOrNull(null)).toBeNull();
    expect(pgDateOrNull(undefined)).toBeNull();
    expect(pgDate(null)).toBe('');
    expect(pgDate(undefined)).toBe('');
  });

  it('reads a timestamptz\'s local day under its own name, and refuses a value too short to hold one', () => {
    expect(pgLocalDay(asNodePgDate(2026, 7, 13))).toBe('2026-07-13');
    expect(pgLocalDay('2026-07-13T09:15:00+05:30')).toBe('2026-07-13');
    expect(pgLocalDay(null)).toBeNull();
    expect(pgLocalDay('2026-07')).toBeNull();
  });
});

/* --------------------------------------------------------------------------------------------------------- */
/* THE SWEEP                                                                                                 */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * A source sweep does not prove behaviour — this programme has said so before — so it is not doing that job here. It
 * is doing an INVENTORY job: `toISOString().slice(0,10)` on a value read from a `date` column is wrong everywhere, and
 * the eight sites where a wrong day fed a WRITE PREDICATE or a MONEY DECISION were fixed by TENANT-6b-1 and are
 * proven live. The rest are display-only (an invoice or a certificate printed a day early). They are listed here by
 * name so that:
 *
 *   • no NEW file can acquire the pattern without this test failing, and
 *   • the list can only ever shrink — a wave that touches one of these files removes its line.
 *
 * Delete a line when you fix its file. Never add one.
 */
const REMAINING_DISPLAY_ONLY = [
  'modules/contract-farming/repositories/contract-milestone.repository.ts',   // due_on → toJSON only
  'modules/dairy/repositories/milk-rate-card.repository.ts',                  // effective_from/to; in-force test is in SQL
  'modules/equipment/repositories/equipment-rate.repository.ts',              // effective_from/to; resolution is in SQL
  'modules/exports/repositories/compliance-requirement.repository.ts',        // effective_from/to; window filtered in SQL
  'modules/fintech/repositories/loan-repayment.repository.ts',                // due_date → toJSON only
  'modules/insurance/repositories/insurance-claim.repository.ts',             // event_date; 72h test uses the DTO
  'modules/labour/repositories/labour-booking.repository.ts',                 // start/end_date; wage floor uses the DTO
  'modules/land-soil-weather/repositories/soil-test.repository.ts',           // sampled_on/valid_until; append-only
  'modules/payments/repositories/commission-rule.repository.ts',              // effective_from/to; rate resolution is in SQL
  'modules/schemes/repositories/dbt-transfer.repository.ts',                  // credited_on; insert is from the DTO
  'modules/tenancy/repositories/usage-counter.repository.ts',                 // period; read-only
  'modules/warehousing/repositories/assay-report.repository.ts',              // valid_until; no reader
  'modules/warehousing/repositories/nwr-receipt.repository.ts',               // expires_at; never compared
  'modules/warehousing/repositories/storage-booking.repository.ts',           // expected_arrival; update writes other columns
];

/**
 * The OTHER wrong shape — `String(dateValue).slice(0,10)` — yields `"Mon Jul 13"` for the JS Date node-pg hands back,
 * in EVERY timezone rather than only ahead of UTC. TENANT-6b-1 found it in **17 files across 12 modules** (37 call
 * sites) and checked every column it was applied to against the live schema: all of them are `date`. Among them were
 * `partner_api`'s outbound `due_date`/`maturity_date`/`next_due_date` — dates this platform hands to EXTERNAL
 * partners — `vehicles.rc_valid_until`, `plan_changes.effective_date` and `rider_payouts.effective_from`.
 *
 * All 17 are fixed: `pgDate` is strictly better in both branches (it returns the calendar day for a Date and the same
 * first ten characters for a string), so the swap could not regress a call site — and the whole api suite confirmed it,
 * which also established that no test had been asserting the broken output.
 *
 * The list is EMPTY and must stay empty.
 */
const REMAINING_STRINGIFIED: string[] = [];

/** Comments describe defects; they must not trip the guard that looks for them. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SRC = path.join(__dirname, '..', '..', '..');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (e.name.endsWith('.ts') && !e.name.includes('.spec.') && !p.includes('__tests__')) out.push(p);
  }
  return out;
};
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/');

describe('core/pg-date · the sweep (this list may shrink, never grow)', () => {
  const files = walk(SRC);

  it('finds the offset-dependent mapper ONLY in files already on the inventory', () => {
    const found = files.filter((f) => {
      // `.toISOString().slice(0,10)` applied to something that came out of a row — the `instanceof Date` ternary is
      // the tell, because a value that MIGHT be a Date came from the driver.
      return /instanceof Date\s*\?[^\n]*toISOString\(\)\.slice\(0, *10\)/.test(codeOf(fs.readFileSync(f, 'utf8')));
    }).map(rel).sort();
    expect(found).toEqual([...REMAINING_DISPLAY_ONLY].sort());
  });

  it('finds the stringified-Date mapper ONLY in files already on the inventory', () => {
    const found = files.filter((f) => /String\(\s*(?:x|r|row|v)\.\w+\s*\)\.slice\(0, *10\)/i.test(codeOf(fs.readFileSync(f, 'utf8'))))
      .map(rel).sort();
    expect(found).toEqual([...REMAINING_STRINGIFIED].sort());
  });

  it('keeps the eight repaired sites repaired — each reads dates through core/database/pg-date', () => {
    const repaired = [
      'modules/dairy/repositories/milk-collection.repository.ts',
      'modules/tenancy/repositories/subscription.repository.ts',
      'modules/tenancy/repositories/saas-invoice.repository.ts',
      'modules/fintech/repositories/loan.repository.ts',
      'modules/exports/repositories/exporter-registration.repository.ts',
      'modules/land-soil-weather/repositories/crop-season.repository.ts',
      'modules/livestock/repositories/animal.repository.ts',
      'modules/insurance/repositories/insurance-policy.repository.ts',
      // and the two jobs that WROTE a due date a day early
      'modules/tenancy/jobs/saas-billing-cycle.job.ts',
      'modules/tenancy/jobs/renewal-invoices.job.ts',
    ];
    for (const r of repaired) {
      const src = fs.readFileSync(path.join(SRC, r), 'utf8');
      expect(src).toMatch(/from '(?:\.\.\/)+core\/database\/pg-date'/);
      expect(codeOf(src)).not.toMatch(/instanceof Date\s*\?[^\n]*toISOString\(\)\.slice\(0, *10\)/);
    }
  });

  it('states the size of the debt it is carrying, so nobody mistakes the list for zero', () => {
    // 15 display-only `toISOString` sites remain; the 37-call-site `String(date)` family is closed.
    // [PC-56 TENANT-6c-1] 15 → 14. `modules/dairy/repositories/milk-bill.repository.ts` came off the list: 0157 gives
    // a bill a `cycle_id`, so its (period_start, period_end) stopped being a label and became the window a cycle's
    // close instant is compared against and its bills are grouped by. The list can only ever SHRINK — a wave that
    // needs to add a site to it is a wave that reintroduced the defect.
    expect(REMAINING_DISPLAY_ONLY.length).toBe(14);
    expect(REMAINING_STRINGIFIED.length).toBe(0);
  });
});
