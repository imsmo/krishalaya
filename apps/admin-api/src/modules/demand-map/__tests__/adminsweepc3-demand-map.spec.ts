// PC-56 ADMIN-SWEEP-c3 · the demand map — DELTA-027's three warnings, pinned as structure.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BASES, DemandRuleError, K_ANONYMITY_FLOOR, assertExportReason, belowFloor, exportFloor, gapVerdict,
  isoWeekOf, searchInterest, weekWindow,
} from '../domain/demand-map';
import { DemandMapService } from '../services/demand-map.service';
import { DemandMapRepository } from '../repositories/demand-map.repository';

function codeOf(fn: () => unknown): string | null {
  try { fn(); return null; } catch (e) { return e instanceof DemandRuleError ? e.code : `<not a rule error: ${e}>`; }
}

/* ================================================================================================ */
describe('ADMIN-SWEEP-c3 · the k-anonymity floor', () => {
  it('the floor is FIVE distinct buyers — below it, an aggregate is one buyer wearing a number', () => {
    expect(K_ANONYMITY_FLOOR).toBe(5);
  });
  it('the boundary is exact: 4 buyers is below the floor, 5 is not', () => {
    expect(belowFloor({ buyersN: 4 })).toBe(true);
    expect(belowFloor({ buyersN: 5 })).toBe(false);
    expect(belowFloor({ buyersN: 0 })).toBe(true);
  });
  it('exportFloor drops below-floor cells and COUNTS the drop — a silent floor reads as complete', () => {
    const cells = [{ buyersN: 5, id: 'a' }, { buyersN: 4, id: 'b' }, { buyersN: 12, id: 'c' }];
    const { kept, suppressed } = exportFloor(cells);
    expect(kept.map((c) => c.id)).toEqual(['a', 'c']);
    expect(suppressed).toBe(1);
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-c3 · search ≠ requirement, and search has no number at all', () => {
  it("the third source's only inhabitant is not_recorded, and the reason says WHY", () => {
    const s = searchInterest();
    expect(s.kind).toBe('not_recorded');
    expect(s.reason).toContain('metrics counter');
    expect(s.reason).toContain('never been recorded');
  });
  it('the bases keep the two clocks apart: demand/supply are now, order flow is the week', () => {
    expect(BASES.demand).toContain('as of now');
    expect(BASES.orderFlow).toContain('selected week');
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-c3 · the gap verdict', () => {
  it('is computed in bigint and floors the percentage', () => {
    // canon's own row: 1,84,00,000 demand vs 66,20,000 supply → 64%
    expect(gapVerdict('18400000', '6620000')).toEqual({ kind: 'gap', pct: 64 });
  });
  it('supply meeting or exceeding demand is covered — no negative gap, no celebration chip', () => {
    expect(gapVerdict('100', '100')).toEqual({ kind: 'covered' });
    expect(gapVerdict('100', '250')).toEqual({ kind: 'covered' });
  });
  it('no rupee figure means UNVALUED, not a 100% gap — a count is not a value', () => {
    expect(gapVerdict(null, '500')).toEqual({ kind: 'unvalued' });
    expect(gapVerdict('0', null)).toEqual({ kind: 'unvalued' });
  });
  it('nothing listed against valued demand is a 100% gap', () => {
    expect(gapVerdict('500', null)).toEqual({ kind: 'gap', pct: 100 });
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-c3 · the week window', () => {
  it("parses the canon's own chip: 2026-W28 is Monday 06 Jul to Monday 13 Jul, exclusive", () => {
    const w = weekWindow('2026-W28', new Date('2026-08-12T00:00:00Z'));
    expect(w.start.toISOString()).toBe('2026-07-06T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-07-13T00:00:00.000Z');
    expect(w.isoWeek).toBe('2026-W28');
  });
  it('defaults to the week containing now', () => {
    expect(weekWindow(undefined, new Date('2026-08-12T10:00:00Z')).isoWeek).toBe('2026-W33');
  });
  it('a week the year does not have is REFUSED, never silently read as the next year', () => {
    expect(codeOf(() => weekWindow('2026-W54', new Date()))).toBe('DEMAND_BAD_WEEK');
    expect(codeOf(() => weekWindow('2027-W53', new Date()))).toBe('DEMAND_BAD_WEEK');  // 2027 has 52 — the check is per-year, not a constant 53
    expect(weekWindow('2026-W53', new Date()).isoWeek).toBe('2026-W53');               // and 2026 HAS a W53
    expect(codeOf(() => weekWindow('2026-W00', new Date()))).toBe('DEMAND_BAD_WEEK');
    expect(codeOf(() => weekWindow('julio', new Date()))).toBe('DEMAND_BAD_WEEK');
  });
  it('isoWeekOf handles the year boundary (Jan 1 can belong to the previous year’s last week)', () => {
    expect(isoWeekOf(new Date(Date.UTC(2027, 0, 1)))).toEqual({ year: 2026, week: 53 });
  });
  it('the export reason has a floor and it is the CONDITION that is asserted', () => {
    expect(codeOf(() => assertExportReason('short'))).toBe('DEMAND_EXPORT_REASON');
    expect(assertExportReason('  monthly growth review  ')).toBe('monthly growth review');
  });
});

/* ================================================================================================ */
class StubPool {
  calls: Array<{ sql: string; params: unknown[] }> = [];
  results = new Map<string, any[]>();
  when(fragment: string, rows: any[]) { this.results.set(fragment, rows); }
  async query(sql: string, params: unknown[] = []) {
    this.calls.push({ sql, params });
    for (const [frag, rows] of this.results) if (sql.includes(frag)) return { rows, rowCount: rows.length };
    return { rows: [{ n: 0, openN: 0, categoryOnlyN: 0, nonInrN: 0, unlocatableN: 0 }], rowCount: 1 };
  }
}

const CELL = (over: Partial<Record<string, unknown>> = {}) => ({
  districtId: 'd-rajkot', districtName: 'Rajkot', productId: 'p-cumin', productName: 'Cumin',
  demandMinor: '18400000', unvaluedN: 0, buyersN: 7, requirementsN: 9,
  supplyMinor: '6620000', listingsN: 3, ...over,
});

function makeService(pool: StubPool, audit = { log: jest.fn().mockResolvedValue(undefined) }) {
  return { svc: new DemandMapService(audit as any, new DemandMapRepository(pool as any)), audit };
}

const ACTOR_READ = { userId: 'adm-1', roles: ['ops'], permissions: new Set(['analytics.read']), ip: '::1', requestId: 'r1' } as any;
const ACTOR_EXPORT = { ...ACTOR_READ, permissions: new Set(['analytics.read', 'analytics.export']) } as any;

describe('ADMIN-SWEEP-c3 · the page assembly', () => {
  function stubbed() {
    const pool = new StubPool();
    pool.when('FULL OUTER JOIN', [
      CELL(),
      CELL({ productId: 'p-onion', productName: 'Onion', demandMinor: '4460000', supplyMinor: '3990000', buyersN: 3, requirementsN: 3 }),
      CELL({ districtId: 'd-anand', districtName: 'Anand', productId: 'p-gg20', productName: 'GG-20 groundnut', demandMinor: '1000', supplyMinor: '5000', buyersN: 6 }),
    ]);
    pool.when('SUM(o.total_minor)', [{ districtId: 'd-rajkot', districtName: 'Rajkot', flowMinor: '9900000', ordersN: 41 }]);
    pool.when('"unlocatableN"', [{ openN: 15, categoryOnlyN: 2, nonInrN: 1, unlocatableN: 3 }]);
    pool.when('COUNT(*)::int AS n', [{ n: 4 }]);
    pool.when('centroid_lat', [
      { id: 'd-rajkot', lat: '22.303900', lng: '70.802200' },
      { id: 'd-anand', lat: null, lng: null },
    ]);
    return pool;
  }

  it('assembles districts, gaps, the floor marks and the honest third column', async () => {
    const { svc } = makeService(stubbed());
    const out = await svc.page('2026-W28');

    expect(out.week.isoWeek).toBe('2026-W28');
    expect(out.searchInterest.kind).toBe('not_recorded');

    // intensity: Rajkot sums BOTH product cells (18400000 + 4460000) and carries its flow + centroid
    expect(out.intensity[0]).toMatchObject({
      districtName: 'Rajkot', demandMinor: '22860000', requirementsN: 12,
      orderFlowMinor: '9900000', ordersN: 41, centroid: { lat: 22.3039, lng: 70.8022 },
    });
    expect(out.intensity[1]).toMatchObject({ districtName: 'Anand', centroid: null, orderFlowMinor: null });

    // gaps: only 'gap' cells, widest first; Anand (covered) is absent
    expect(out.gaps.map((g) => g.productName)).toEqual(['Cumin', 'Onion']);
    expect(out.gaps[0].verdict).toEqual({ kind: 'gap', pct: 64 });
    expect(out.gaps[0].belowFloor).toBe(false);
    expect(out.gaps[1].belowFloor).toBe(true);           // 3 buyers < 5
    expect(out.gapsTotal).toBe(2);

    expect(out.floor.k).toBe(K_ANONYMITY_FLOOR);
    expect(out.accounting.unlocatable.n).toBe(3);
    expect(out.accounting.ordersUnlocatable.n).toBe(4);
    expect(out.accounting.categoryOnly.basis).toContain('counted');
  });

  it('the SQL carries the conditions: district level 2 by ltree ancestry, the honest status sets, INR only', async () => {
    const pool = stubbed();
    const { svc } = makeService(pool);
    await svc.page(undefined);
    const cells = pool.calls.find((c) => c.sql.includes('FULL OUTER JOIN'))!.sql;
    expect(cells).toContain("r.status IN ('open', 'partially_matched')");   // partially matched is still unmet demand
    expect(cells).toContain("l.status = 'published'");
    expect(cells).toContain('level = 2');
    expect(cells).toContain('d.path @> leaf.path');
    expect(cells).toContain("currency_code = 'INR'");
    const flow = pool.calls.find((c) => c.sql.includes('SUM(o.total_minor)'))!;
    expect(flow.sql).toContain('o.created_at >= $1 AND o.created_at < $2'); // half-open week, bind params
    expect(flow.sql).toContain("o.status <> 'cancelled'");
    expect(flow.params).toHaveLength(2);
  });

  it('a failed source refuses the WHOLE map with the source named — partial data never shows as complete', async () => {
    const pool = stubbed();
    (pool as any).query = async (sql: string) => {
      if (sql.includes('FULL OUTER JOIN')) throw new Error('boom');
      return { rows: [{ n: 0, openN: 0, categoryOnlyN: 0, nonInrN: 0, unlocatableN: 0 }], rowCount: 1 };
    };
    const { svc } = makeService(pool);
    await expect(svc.page(undefined)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DEMAND_ASSEMBLY_FAILED', message: expect.stringContaining('requirements-and-supply') }),
    });
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-c3 · the export and its floor', () => {
  function stubbedForExport() {
    const pool = new StubPool();
    pool.when('FULL OUTER JOIN', [
      CELL(),                                                        // 7 buyers — exports
      CELL({ productId: 'p-onion', productName: 'Onion', buyersN: 2 }), // 2 buyers — suppressed
    ]);
    pool.when('SUM(o.total_minor)', []);
    pool.when('"unlocatableN"', [{ openN: 0, categoryOnlyN: 0, nonInrN: 0, unlocatableN: 0 }]);
    pool.when('COUNT(*)::int AS n', [{ n: 0 }]);
    pool.when('centroid_lat', []);
    pool.when('INSERT INTO report_export_receipts', [{ id: 'rcpt-1' }]);
    return pool;
  }

  it('looking is not taking away: analytics.read alone cannot export', async () => {
    const { svc } = makeService(stubbedForExport());
    await expect(svc.exportCells(ACTOR_READ, { reason: 'monthly growth review' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DEMAND_EXPORT_GRANT' }),
    });
  });

  it('the floor is applied BEFORE the digest: suppressed cells are absent from the file and counted in the receipt', async () => {
    const pool = stubbedForExport();
    const { svc, audit } = makeService(pool);
    const out = await svc.exportCells(ACTOR_EXPORT, { week: '2026-W28', reason: 'monthly growth review' });

    expect(out.rows).toHaveLength(1);                       // Onion (2 buyers) never left
    expect(out.rows[0][0]).toBe('Rajkot');
    expect(out.suppressed).toMatchObject({ cells: 1, k: K_ANONYMITY_FLOOR });

    const ins = pool.calls.find((c) => c.sql.includes('INSERT INTO report_export_receipts'))!;
    expect(ins.params[0]).toBe('demand_map');
    expect(ins.params[2]).toBe(1);                          // row_count = what actually left
    expect(JSON.parse(ins.params[9] as string)).toMatchObject({ week: '2026-W28', kFloor: 5, suppressedCells: 1 });

    expect(out.delivery.async).toBe(false);                 // ADMIN-10-Q1, third application
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'analytics.demand_map_exported', reason: 'monthly growth review',
      newValue: expect.objectContaining({ suppressedCells: 1 }),
    }));
  });

  it('a thin reason is refused as 422 and nothing is written', async () => {
    const pool = stubbedForExport();
    const { svc } = makeService(pool);
    await expect(svc.exportCells(ACTOR_EXPORT, { reason: 'because' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DEMAND_EXPORT_REASON' }),
    });
    expect(pool.calls.find((c) => c.sql.includes('INSERT INTO'))).toBeUndefined();
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-c3 · the absences that ARE the design (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the controller has exactly ONE write-shaped route, and it is the export — no rebuild chain exists', () => {
    const src = strip(fs.readFileSync(path.join(__dirname, '..', 'demand-map.controller.ts'), 'utf8'));
    const posts = src.match(/@Post\((.*?)\)/g) ?? [];
    expect(posts).toEqual(["@Post('export')"]);
    expect(src).not.toMatch(/rebuild|refresh|retry/i);
    expect(src).toContain('OwnerPermissions.AnalyticsRead');   // rides the existing grant, named by the canon itself
    expect(src).toContain('StepUpReauthGuard');                // a file that leaves is step-up gated
  });

  it('no analytics.demand permission was minted — the catalog is unchanged by this wave', () => {
    const src = strip(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'core', 'rbac', 'owner-roles.ts'), 'utf8'));
    expect(src).not.toContain("'analytics.demand");
  });

  it('0137 is read paths only: two partial indexes, no table, no materialized view, no backfill', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations', '0137_demand_read_paths.sql'), 'utf8')
      .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    expect(sql).toMatch(/idx_requirements_demand/);
    expect(sql).toMatch(/idx_listings_supply/);
    expect(sql).toMatch(/IN \('open', 'partially_matched'\)/);
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/MATERIALIZED/i);
    expect(sql).not.toMatch(/UPDATE /i);
  });

  it('the finding itself, pinned: NO migration creates a search-query table — the day one does, this wave’s refusal is over', () => {
    const dir = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations');
    const offenders = fs.readdirSync(dir).filter((f) => {
      if (!f.endsWith('.sql')) return false;
      const sql = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
      // search_synonyms (0015) is CONTENT configuration; what must not exist unnoticed is a QUERY log —
      // the table this wave would have read, had anyone ever written it.
      return /CREATE TABLE\s+search_(quer|log|event|click|interest)/i.test(sql);
    });
    expect(offenders).toEqual([]);
  });
});
