// PC-56 ADMIN-SWEEP-c1 · the portal sync registry — a read that cannot lie about a sync that never ran.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { portalTruth, ackLag, pendingPushes, neverSynced } from '../domain/portal-sync';
import { PortalSyncService } from '../services/portal-sync.service';
import { SchemesRegistryRepository } from '../repositories/schemes-registry.repository';

/* ================================================================================================ */
describe('ADMIN-SWEEP-c1 · the truth vocabulary', () => {
  it("health has no 'healthy' — a portal nobody has called has only a mapping state", () => {
    expect(portalTruth(true)).toBe('mapped_never_pulled');
    expect(portalTruth(false)).toBe('manual');
  });
  it('ack lag is measured only when acknowledgements exist, and unmeasured says WHY', () => {
    expect(ackLag(3, 4.5)).toEqual({ kind: 'measured', p50Hours: 4.5, over: 3 });
    expect(ackLag(0, null).kind).toBe('unmeasured');
    expect((ackLag(0, null) as any).reason).toContain('invented times');
    // a count with no percentile (or vice versa) is a broken read, not a measurement
    expect(ackLag(3, null).kind).toBe('unmeasured');
  });
  it('pending pushes travels with its basis — the number must not outlive its definition', () => {
    const p = pendingPushes(42);
    expect(p.n).toBe(42);
    expect(p.basis).toContain('acknowledgement number has not been recorded');
  });
  it('neverSynced is asserted from the DATA and flips on any sync claim', () => {
    expect(neverSynced([{ syncStatus: 'pending', lastSyncedAt: null }])).toBe(true);
    expect(neverSynced([])).toBe(true);
    expect(neverSynced([{ syncStatus: 'synced', lastSyncedAt: null }])).toBe(false);
    expect(neverSynced([{ syncStatus: 'pending', lastSyncedAt: '2026-08-01' }])).toBe(false);
  });
});

/* ================================================================================================ */
class StubPool {
  calls: string[] = [];
  results = new Map<string, any[]>();
  when(fragment: string, rows: any[]) { this.results.set(fragment, rows); }
  async query(sql: string) {
    this.calls.push(sql);
    for (const [frag, rows] of this.results) if (sql.includes(frag)) return { rows, rowCount: rows.length };
    return { rows: [], rowCount: 0 };
  }
}

describe('ADMIN-SWEEP-c1 · the registry read end to end', () => {
  it('assembles the honest row: never-pulled truth, real pending count, unmeasured lag', async () => {
    const pool = new StubPool();
    pool.when('NOT EXISTS', [{ n: 3 }]);   // registered FIRST: the manual-count SQL also contains the refs fragment
    pool.when('FROM external_entity_refs x', [{
      authorityId: 'a1', authorityName: 'Gujarat Agri Dept', level: 'state',
      providerCode: 'ikhedut', externalId: 'GJ-AGRI-01', endpointLabel: 'state portal', syncStatus: 'pending',
      lastSyncedAt: null, mappedAt: 'x', pendingPushes: 42, ackedN: 0, ackLagP50Hours: null,
    }]);
    const svc = new PortalSyncService(new SchemesRegistryRepository(pool as any));
    const out = await svc.registry();
    expect(out.portals[0]).toMatchObject({
      providerCode: 'ikhedut', lastPull: null, truth: 'mapped_never_pulled',
      pendingPushes: { n: 42 },
    });
    expect(out.portals[0].ackLag.kind).toBe('unmeasured');
    expect(out.manualAuthorities).toBe(3);
    expect(out.neverSynced).toBe(true);
  });

  it('the registry SQL computes pending pushes and p50 over the RIGHT rows (conditions in the query itself)', async () => {
    const pool = new StubPool();
    const svc = new PortalSyncService(new SchemesRegistryRepository(pool as any));
    await svc.registry();
    const sql = pool.calls.find((s) => s.includes('FROM external_entity_refs x'))!;
    expect(sql).toContain("sa.submitted_at IS NOT NULL AND sa.govt_app_ref IS NULL");          // pending = submitted, unacked
    expect(sql).toContain('percentile_cont(0.5)');
    expect(sql).toContain('sa.govt_acked_at IS NOT NULL AND sa.submitted_at IS NOT NULL');     // lag over stamped rows only
    expect(sql).toContain("s.authority_id = x.entity_id");                                     // grouped through the scheme's authority
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-c1 · the absences that ARE the design (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('schemes.sync exists NOWHERE in code — 0120\'s rule, applied before the promise instead of after', () => {
    // Walk admin-api src (comments stripped): the string may appear in prose, never in code.
    const root = path.join(__dirname, '..', '..', '..');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!['node_modules', 'dist', '__tests__'].includes(e.name)) walk(p); continue; }
        if (!e.name.endsWith('.ts') || e.name.endsWith('.spec.ts')) continue;
        if (strip(fs.readFileSync(p, 'utf8')).includes("'schemes.sync'")) offenders.push(path.relative(root, p));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
  it('no write route exists on the portal-sync path — the registry is a read by construction', () => {
    const src = strip(fs.readFileSync(path.join(__dirname, '..', 'schemes-registry-ops.controller.ts'), 'utf8'));
    // every portal-sync mention in code sits under a @Get; no @Post touches it
    expect(src).toMatch(/@Get\('portal-sync'\)/);
    expect(src).not.toMatch(/@Post\('portal-sync/);
  });
  it('0136: the ack clock column, never backfilled; the two partial indexes; NO run-request table', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations', '0136_portal_ack_truth.sql'), 'utf8')
      .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    expect(sql).toMatch(/ADD COLUMN govt_acked_at timestamptz/);
    expect(sql).not.toMatch(/UPDATE scheme_applications/i);          // no backfill — invented times refused
    expect(sql).toMatch(/idx_schemeapps_awaiting_ack/);
    expect(sql).toMatch(/idx_schemeapps_acked/);
    expect(sql).not.toMatch(/CREATE TABLE/i);                        // no run-request table nothing would consume
  });
  it("apps/api's UPDATE stamps the clock exactly once, in the SQL itself (no service path can skip it)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', '..', 'api', 'src', 'modules', 'schemes', 'repositories', 'scheme-application.repository.ts'),
      'utf8');
    expect(src).toContain('govt_acked_at=CASE WHEN govt_acked_at IS NULL AND govt_app_ref IS NULL AND $5::varchar IS NOT NULL THEN now() ELSE govt_acked_at END');
  });
});
