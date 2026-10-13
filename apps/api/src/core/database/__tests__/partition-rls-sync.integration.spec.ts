// core/database/__tests__/partition-rls-sync.integration.spec.ts · PC-56 HOTFIX-3 (migration 0203), against a LIVE Postgres.
//
// 0190's `sync_partition_rls` copied a partitioned parent's policies onto a child as `USING (pg_get_expr(polqual, parent))`.
// A policy whose deparsed text names its own table — 0090's `partner_own_book_loan_repayments` prints
// `loan_repayments.loan_id` inside its EXISTS — does not resolve on `loan_repayments_2026_10`, so `CALL ensure_partitions(3)`
// died with `missing FROM-clause entry for table "loan_repayments"` on every database built from the chain. 0203 rewrites the
// word-bounded `<parent>.` to `<child>.` and re-syncs every existing child. This file pins all three halves:
//   (a) a throwaway parent with a self-qualified USING and WITH CHECK copies onto its child naming the CHILD, never the parent;
//   (b) every real `loan_repayments` child carries `partner_own_book_loan_repayments`, child-qualified;
//   (c) `CALL ensure_partitions(3)` completes (and the partitions it creates for the probe are policy'd the same way).
//
//   DATABASE_ADMIN_URL=... DATABASE_URL=... TZ=Asia/Kolkata npx jest --selectProjects integration partition-rls-sync
import { Pool } from 'pg';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
// DDL (a throwaway partitioned table) and the owner-run procedures need the admin URL; without it this file skips.
const run = APP_URL && ADMIN_URL ? describe : describe.skip;

type PolicyRow = { relname: string; polname: string; cmd: string; permissive: boolean; roles: string[]; qual: string | null; check: string | null };

async function policiesOf(db: Pool, rel: string): Promise<PolicyRow[]> {
  const { rows } = await db.query<PolicyRow>(
    `SELECT c.relname, p.polname, p.polcmd::text AS cmd, p.polpermissive AS permissive,
            ARRAY(SELECT CASE WHEN r = 0 THEN 'public' ELSE r::regrole::text END FROM unnest(p.polroles) r ORDER BY 1) AS roles,
            pg_get_expr(p.polqual, p.polrelid) AS qual, pg_get_expr(p.polwithcheck, p.polrelid) AS "check"
       FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE p.polrelid = $1::regclass
      ORDER BY p.polname`,
    [rel]);
  return rows;
}

/** A word-bounded `<name>.` — the table-qualified reference the copy must never carry onto a child. */
const qualifiedBy = (name: string) => new RegExp(`(^|[^A-Za-z0-9_$"])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`);

const REF_ID = '00000000-0000-0000-0000-0000000000a1';

const DROP_PROBES =`DROP TABLE IF EXISTS hf3_probe CASCADE; DROP TABLE IF EXISTS "HF3 Probe" CASCADE; DROP TABLE IF EXISTS hf3_probe_ref CASCADE;`;

run('core/database · sync_partition_rls copies a self-qualified policy onto the CHILD (HOTFIX-3, 0203)', () => {
  let db: Pool;

  beforeAll(async () => {
    db = new Pool({ connectionString: ADMIN_URL });
    await db.query(DROP_PROBES);
    await db.query(`
      CREATE TABLE hf3_probe_ref (id uuid PRIMARY KEY);
      CREATE TABLE hf3_probe (tenant_id uuid, created_at timestamptz NOT NULL, loan_id uuid) PARTITION BY RANGE (created_at);
      ALTER TABLE hf3_probe ENABLE ROW LEVEL SECURITY;
      ALTER TABLE hf3_probe FORCE ROW LEVEL SECURITY;
      CREATE POLICY hf3_probe_read ON hf3_probe FOR SELECT
        USING (EXISTS (SELECT 1 FROM hf3_probe_ref r WHERE r.id = hf3_probe.loan_id));
      CREATE POLICY hf3_probe_insert ON hf3_probe AS RESTRICTIVE FOR INSERT TO kv_app
        WITH CHECK (EXISTS (SELECT 1 FROM hf3_probe_ref r WHERE r.id = hf3_probe.loan_id));
      CREATE TABLE hf3_probe_2026_10 PARTITION OF hf3_probe FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');`);
    // Written into the child directly while it has no RLS of its own yet (a new partition does not inherit relrowsecurity).
    await db.query(`INSERT INTO hf3_probe_ref (id) VALUES ($1)`, [REF_ID]);
    await db.query(
      `INSERT INTO hf3_probe_2026_10 (tenant_id, created_at, loan_id) VALUES
         (NULL, '2026-10-05', $1), (NULL, '2026-10-06', '00000000-0000-0000-0000-0000000000f3')`,
      [REF_ID]);
  });

  afterAll(async () => {
    if (db) {
      await db.query(DROP_PROBES);
      await db.end();
    }
  });

  it('(precondition) the parent really deparses a table-qualified self reference — the shape that broke 0190', async () => {
    const parent = await policiesOf(db, 'hf3_probe');
    expect(parent.map((p) => p.polname)).toEqual(['hf3_probe_insert', 'hf3_probe_read']);
    expect(parent.find((p) => p.polname === 'hf3_probe_read')!.qual).toMatch(qualifiedBy('hf3_probe'));
    expect(parent.find((p) => p.polname === 'hf3_probe_insert')!.check).toMatch(qualifiedBy('hf3_probe'));
  });

  it('(a) copies both policies onto the child, rewritten to the child name, everything else unchanged', async () => {
    await db.query(`CALL sync_partition_rls('hf3_probe', 'hf3_probe_2026_10')`);
    const parent = await policiesOf(db, 'hf3_probe');
    const child = await policiesOf(db, 'hf3_probe_2026_10');
    expect(child.map((p) => p.polname)).toEqual(parent.map((p) => p.polname));
    for (const c of child) {
      const p = parent.find((x) => x.polname === c.polname)!;
      expect([c.cmd, c.permissive, c.roles]).toEqual([p.cmd, p.permissive, p.roles]);
      for (const expr of [c.qual, c.check].filter((e): e is string => e !== null)) {
        expect(expr).toContain('hf3_probe_2026_10.loan_id');
        expect(expr).not.toMatch(qualifiedBy('hf3_probe'));
        expect(expr).toContain('hf3_probe_ref r');          // a name that merely STARTS with the parent's is left alone
      }
    }
    const { rows } = await db.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'hf3_probe_2026_10'::regclass`);
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('(a) is idempotent — a second call creates nothing', async () => {
    const before = (await policiesOf(db, 'hf3_probe_2026_10')).length;
    await db.query(`CALL sync_partition_rls('hf3_probe', 'hf3_probe_2026_10')`);
    expect((await policiesOf(db, 'hf3_probe_2026_10')).length).toBe(before);
  });

  it('(a) the copied policy is live: read directly as kv_app, the child\'s self reference filters on the child\'s own row', async () => {
    // Two rows were written straight into the child in beforeAll (before it had RLS); only one names a ref row.
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query('GRANT SELECT ON hf3_probe_2026_10, hf3_probe_ref TO kv_app');
      await c.query('SET LOCAL ROLE kv_app');
      const { rows } = await c.query(`SELECT loan_id::text FROM hf3_probe_2026_10`);
      expect(rows).toEqual([{ loan_id: REF_ID }]);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('(a) a parent whose name needs quoting is rewritten the same way', async () => {
    await db.query(`
      CREATE TABLE "HF3 Probe" (tenant_id uuid, created_at timestamptz NOT NULL, loan_id uuid) PARTITION BY RANGE (created_at);
      ALTER TABLE "HF3 Probe" ENABLE ROW LEVEL SECURITY;
      CREATE POLICY q_read ON "HF3 Probe" FOR SELECT USING (EXISTS (SELECT 1 FROM hf3_probe_ref r WHERE r.id = "HF3 Probe".loan_id));
      CREATE TABLE "HF3 Probe Oct" PARTITION OF "HF3 Probe" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');`);
    try {
      await db.query(`CALL sync_partition_rls('"HF3 Probe"', '"HF3 Probe Oct"')`);
      const [c] = await policiesOf(db, '"HF3 Probe Oct"');
      expect(c.polname).toBe('q_read');
      expect(c.qual).toContain('"HF3 Probe Oct".loan_id');
      expect(c.qual).not.toContain('"HF3 Probe".');
    } finally {
      // ensure_partitions (below) cannot name a quoted parent's partitions — drop it before (c) runs.
      await db.query(`DROP TABLE IF EXISTS "HF3 Probe" CASCADE`);
    }
  });

  it('(b) every real loan_repayments child carries partner_own_book_loan_repayments, qualified by the CHILD', async () => {
    const { rows: children } = await db.query<{ child: string }>(
      `SELECT c.relname AS child FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'loan_repayments'::regclass ORDER BY 1`);
    expect(children.length).toBeGreaterThan(0);
    const [parentPolicy] = (await policiesOf(db, 'loan_repayments')).filter((p) => p.polname === 'partner_own_book_loan_repayments');
    expect(parentPolicy.qual).toMatch(qualifiedBy('loan_repayments'));
    const missing: string[] = [];
    for (const { child } of children) {
      const pol = (await policiesOf(db, child)).find((p) => p.polname === 'partner_own_book_loan_repayments');
      if (!pol) { missing.push(child); continue; }
      expect([pol.cmd, pol.permissive, pol.roles]).toEqual([parentPolicy.cmd, parentPolicy.permissive, parentPolicy.roles]);
      expect(pol.qual).toContain(`${child}.loan_id`);
      expect(pol.qual).not.toMatch(qualifiedBy('loan_repayments'));
    }
    expect(missing).toEqual([]);
  });

  it('(c) CALL ensure_partitions(3) completes, and the probe partitions it creates are policy\'d by the child name', async () => {
    await expect(db.query('CALL ensure_partitions(3)')).resolves.toBeDefined();
    const { rows: probeChildren } = await db.query<{ child: string }>(
      `SELECT c.relname AS child FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'hf3_probe'::regclass ORDER BY 1`);
    expect(probeChildren.map((r) => r.child)).toContain('hf3_probe_default');
    expect(probeChildren.length).toBeGreaterThan(2);
    for (const { child } of probeChildren) {
      const pols = await policiesOf(db, child);
      expect(pols.map((p) => p.polname)).toEqual(['hf3_probe_insert', 'hf3_probe_read']);
      for (const p of pols) {
        const expr = (p.qual ?? p.check)!;
        expect(expr).toContain(`${child}.loan_id`);
        expect(expr).not.toMatch(qualifiedBy('hf3_probe'));
      }
    }
    // Repo-wide: no child of any public partitioned parent is missing a policy its parent carries.
    const { rows: gaps } = await db.query(`
      SELECT c.relname AS child, pp.polname
        FROM pg_inherits i
        JOIN pg_class p ON p.oid = i.inhparent AND p.relnamespace = 'public'::regnamespace AND p.relrowsecurity
        JOIN pg_class c ON c.oid = i.inhrelid
        JOIN pg_policy pp ON pp.polrelid = i.inhparent
       WHERE NOT EXISTS (SELECT 1 FROM pg_policy cp WHERE cp.polrelid = i.inhrelid AND cp.polname = pp.polname)`);
    expect(gaps).toEqual([]);
  }, 300_000);
});
