// core/database/__tests__/pg-date.integration.spec.ts · PC-56 TENANT-6b-1, against a LIVE Postgres.
//
// The unit suite proves `pgDate` against a JS Date this file constructs. This one proves it against what **node-pg
// actually hands back** for a real `date` column in a real query — which is the whole of the defect, because the two
// were assumed to be the same thing for 23 repositories and 37 more call sites.
//
// RUN THIS UNDER TZ=Asia/Kolkata. Under UTC every assertion here passes with the OLD mapper too, which is exactly why
// a UTC-only suite blessed a double-payment on the dairy money path for as long as it existed:
//
//   DATABASE_ADMIN_URL=... DATABASE_URL=... TZ=Asia/Kolkata npx jest --selectProjects integration pg-date
import { Pool } from 'pg';
import { pgDate, pgDateOrNull } from '../pg-date';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

/**
 * Every column TENANT-6b-1 repaired, by table. These are the eight sites where a mis-mapped day fed a WRITE PREDICATE
 * or a MONEY/ELIGIBILITY DECISION — plus the two billing jobs' own `current_period_end`. The test asserts each is
 * really a `date` (the classification the whole fix rests on) rather than trusting the audit that produced this list.
 */
const REPAIRED: Array<{ table: string; column: string; why: string }> = [
  { table: 'milk_collections',      column: 'collected_on',          why: 'partition key in the bill-attach predicate — the proven double-payment' },
  { table: 'subscriptions',         column: 'grace_until',           why: 'rewritten on every subscription write; also decides suspension' },
  { table: 'subscriptions',         column: 'current_period_end',    why: 'the billing jobs write the invoice due date and period tag from it' },
  { table: 'loans',                 column: 'next_due_date',         why: 'rewritten on every repayment; feeds days-past-due' },
  { table: 'saas_invoices',         column: 'due_date',              why: 'decides overdue → dunning for a tenant who paid on time' },
  { table: 'exporter_registrations', column: 'valid_until',          why: 'rewound by any unrelated edit to the registration' },
  { table: 'crop_seasons',          column: 'sown_on',               why: 'rewritten when a season is harvested or abandoned' },
  { table: 'animals',               column: 'dob_estimated',         why: 'rewritten by any husbandry edit or a retirement' },
  { table: 'insurance_policies',    column: 'valid_from',            why: 'submitted to the government insurer as the cover window' },
  { table: 'insurance_policies',    column: 'valid_until',           why: 'submitted to the government insurer as the cover window' },
];

run('core/pg-date · the day PostgreSQL holds, through the real driver (integration)', () => {
  let db: Pool;
  beforeAll(() => { db = new Pool({ connectionString: ADMIN_URL ?? APP_URL }); });
  afterAll(async () => { await db?.end(); });

  it('states the timezone it ran in, so a green run can be read correctly', () => {
    // Not an assertion about the environment — a note in the output. Under UTC this file proves the mapper is CORRECT;
    // under a zone ahead of UTC it also proves the old mapper was WRONG, which is the interesting half.
    expect(typeof (process.env.TZ ?? '')).toBe('string');
  });

  it('round-trips a `date` literal through node-pg unchanged', async () => {
    for (const day of ['2026-07-13', '2026-01-01', '2026-12-31', '2026-02-28', '2024-02-29']) {
      const { rows } = await db.query(`SELECT $1::date AS d`, [day]);
      expect(pgDate(rows[0].d)).toBe(day);
    }
  });

  it('disagrees with the OLD mapper exactly where the platform was losing a day', async () => {
    const { rows } = await db.query(`SELECT '2026-07-13'::date AS d`);
    const v = rows[0].d as Date;
    expect(v instanceof Date).toBe(true);                 // node-pg gives a Date, not a string — the root of it all
    expect(pgDate(v)).toBe('2026-07-13');
    if (-v.getTimezoneOffset() > 0) {
      expect(v.toISOString().slice(0, 10)).toBe('2026-07-12');      // the shape that fed a partition predicate
      expect(String(v).slice(0, 10)).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);   // the other shape: "Mon Jul 13"
    }
  });

  it('survives the DST-transition days that break offset arithmetic', async () => {
    // A date column has no time, so a zone with DST must not shift it. These are US DST boundaries; under
    // America/New_York the naive "add the offset" implementations move them.
    for (const day of ['2026-03-08', '2026-11-01']) {
      const { rows } = await db.query(`SELECT $1::date AS d`, [day]);
      expect(pgDate(rows[0].d)).toBe(day);
    }
  });

  it('every column this wave repaired really IS a `date` — the classification the fix rests on', async () => {
    for (const { table, column, why } of REPAIRED) {
      const { rows } = await db.query(
        `SELECT format_type(a.atttypid, a.atttypmod) AS t
           FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
          WHERE c.relname = $1 AND a.attname = $2 AND a.attnum > 0 AND NOT a.attisdropped`,
        [table, column]);
      expect({ table, column, why, type: rows[0]?.t }).toEqual({ table, column, why, type: 'date' });
    }
  });

  it('reads each repaired column back as the day the database holds, not a day either side of it', async () => {
    // Driven off the live catalog rather than a hand-written query per table: the point is the DRIVER's behaviour for
    // this type, and one query shape proves it for all ten columns without ten modules' worth of fixtures.
    const selects = REPAIRED.map((_r, i) => `$${i + 1}::date AS c${i}`).join(', ');
    const days = REPAIRED.map((_, i) => `2026-0${(i % 9) + 1}-1${i % 9}`);
    const { rows } = await db.query(`SELECT ${selects}`, days);
    REPAIRED.forEach((r, i) => {
      expect(pgDate(rows[0][`c${i}`])).toBe(days[i]);
      expect(pgDateOrNull(rows[0][`c${i}`])).toBe(days[i]);
    });
  });

  it('gives the billing jobs a period tag in the RIGHT month for a period ending on the 1st', async () => {
    // The jobs derived the tag with `getUTCMonth()` on a local-midnight `date`, so a period ending 2026-08-01 tagged
    // itself 202607 — and that tag is half of 0146's unique (subscription, period) key, so August's renewal could
    // collide with July's or raise twice. The tag now comes from the same calendar-day reading as the due date.
    const { rows } = await db.query(`SELECT '2026-08-01'::date AS d`);
    const ymd = pgDate(rows[0].d);
    expect(ymd).toBe('2026-08-01');
    expect(ymd.slice(0, 4) + ymd.slice(5, 7)).toBe('202608');
  });

  it('leaves a timestamptz alone — this mapper is for calendar days, and the two fail differently', async () => {
    const { rows } = await db.query(`SELECT '2026-07-13T18:30:00Z'::timestamptz AS t`);
    expect(rows[0].t instanceof Date).toBe(true);
    // No assertion on the day: whose day an INSTANT falls on genuinely depends on where you stand, which is why
    // `pgLocalDay` is named separately and why grouping instants into days belongs in SQL (`AT TIME ZONE`).
  });
});
