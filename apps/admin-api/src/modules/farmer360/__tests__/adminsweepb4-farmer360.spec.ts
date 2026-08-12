// PC-56 ADMIN-SWEEP-b4 · Farmer 360 — the view log before the view, unknown ≠ zero, refuse-not-degrade with the
// failing source NAMED, masked everywhere including the export, and the grant conjunction on the way out.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  GMV_ORDER_STATUSES, EXPORT_REASON_MIN, assertExportReason, identityView, moneyTile, listedValueMinor,
  engagementView, mergeTimeline, exportRows, Farmer360RuleError, type TimelineItem,
} from '../domain/farmer360';
import { Farmer360Repository } from '../repositories/farmer360.repository';
import { Farmer360Service } from '../services/farmer360.service';
import {
  FarmerNotFoundError, InvalidFarmer360RequestError, ExportGrantMissingError, ProfileAssemblyFailedError,
} from '../domain/farmer360.errors';
import { ownerRoleCatalogue } from '../../../core/rbac/owner-roles';

function codeOf(fn: () => unknown): string | null {
  try { fn(); return null; } catch (e) { return e instanceof Farmer360RuleError ? e.code : `<not a rule error: ${e}>`; }
}

/* ================================================================================================ */
describe('ADMIN-SWEEP-b4 · domain: unknown ≠ zero, exact money, masked identity', () => {
  it('GMV counts only realized states, verbatim from 0005', () => {
    expect([...GMV_ORDER_STATUSES]).toEqual(['delivered', 'completed']);
  });
  it('a null tile stays null and carries its basis — a farmer with no dairy membership never reads as earning ₹0', () => {
    expect(moneyTile(null, 'no dairy membership exists — unknown, not zero', 0))
      .toEqual({ valueMinor: null, basis: 'no dairy membership exists — unknown, not zero', n: 0 });
    expect(moneyTile(0n, 'zero after looking', 3).valueMinor).toBe('0');   // a REAL zero is a string '0', not null
  });
  it('listed value is exact bigint price×qty (three decimals, half-up — the moderation queue’s own arithmetic)', () => {
    expect(listedValueMinor([{ priceMinor: '638000', quantityAvailable: '24' }])).toBe(15_312_000n);
    expect(listedValueMinor([{ priceMinor: '1', quantityAvailable: '0.500' }])).toBe(1n);           // half-up
    expect(listedValueMinor([])).toBeNull();                                                        // no listings = unknown
    expect(codeOf(() => listedValueMinor([{ priceMinor: '100', quantityAvailable: 'lots' }]))).toBe('F360_BAD_QUANTITY');
  });
  it('identity leaves masked, and the EXPORT rows carry the masked shape only', () => {
    const id = identityView({ userId: 'u1', fullName: 'Ramesh Patel', phone: '+919876543210', languageCode: 'gu', createdAt: '2024-11-01', tenants: ['Anand FPO'] });
    expect(id.name).not.toContain('Patel');
    expect(id.phone).not.toBe('+919876543210');
    const { columns, rows } = exportRows({
      identity: id,
      gmv: moneyTile(1n, 'b', 1), listed: moneyTile(null, 'b', 0), dairy30d: moneyTile(null, 'b', 0),
      schemesYtd: moneyTile(2n, 'b', 1), wallet: moneyTile(3n, 'b', 1),
      risk: { score: 81, band: 'trusted' },
      engagement: engagementView({ activeDays30: 28, lastActiveAt: null, languageCode: 'gu' }),
      disputes: { raised: 2, against: 2, resolved: 4, open: 0 },
    });
    expect(columns).toEqual(['section', 'field', 'value', 'basis']);
    const flat = JSON.stringify(rows);
    expect(flat).not.toContain('+919876543210');
    expect(flat).not.toContain('Ramesh Patel');
    expect(flat).toContain('name_masked');
  });
  it('engagement clamps to [0,30] and names its only real source', () => {
    expect(engagementView({ activeDays30: 45, lastActiveAt: null, languageCode: 'gu' }).activeDays30).toBe(30);
    expect(engagementView({ activeDays30: -1, lastActiveAt: null, languageCode: 'gu' }).activeDays30).toBe(0);
    expect(engagementView({ activeDays30: 5, lastActiveAt: null, languageCode: 'gu' }).basis).toContain('login_events');
  });
  it('the timeline merges newest-first, bounded, every item labelled by kind', () => {
    const items: TimelineItem[] = [
      { kind: 'order', at: '2026-07-11', label: 'a', amountMinor: '1', ref: '1' },
      { kind: 'benefit', at: '2026-06-28', label: 'b', amountMinor: '2', ref: '2' },
      { kind: 'listing', at: '2026-07-09', label: 'c', amountMinor: null, ref: '3' },
    ];
    expect(mergeTimeline(items, 2).map((x) => x.kind)).toEqual(['order', 'listing']);
  });
  it('the export reason has a floor, by code', () => {
    expect(EXPORT_REASON_MIN).toBe(10);
    expect(codeOf(() => assertExportReason('because'))).toBe('F360_REASON_REQUIRED');
    expect(assertExportReason('  DSR follow-up, case #812  ')).toBe('DSR follow-up, case #812');
  });
});

/* ================================================================================================ */
/* Service layer over the stub pool (the established harness). */
class StubClient {
  calls: Array<{ sql: string; params: unknown[] }> = [];
  results = new Map<string, any[] | Error>();
  when(fragment: string, rows: any[] | Error) { this.results.set(fragment, rows); }
  async query(sql: string, params?: unknown[]) {
    this.calls.push({ sql, params: params ?? [] });
    for (const [frag, rows] of this.results) {
      if (sql.includes(frag)) {
        if (rows instanceof Error) throw rows;
        return { rows, rowCount: rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  }
}
function harness() {
  const client = new StubClient();
  const pool = { query: (sql: string, params?: unknown[]) => client.query(sql, params) };
  const audit = { write: jest.fn(), log: jest.fn().mockResolvedValue(undefined) };
  const repo = new Farmer360Repository(pool as any);
  const svc = new Farmer360Service(audit as any, repo);
  return { client, audit, svc };
}
const WHO = { userId: 'u1', fullName: 'Ramesh Patel', phone: '+919876543210', languageCode: 'gu', createdAt: '2024-11-01', lastActiveAt: null, tenants: ['Anand FPO'] };
const actorWith = (perms: string[]) => ({ userId: 'op-1', roles: ['platform_farmer360'], permissions: new Set(perms), ip: null, requestId: 'r1' }) as any;
const VIEWER = actorWith(['analytics.farmer360', 'analytics.read']);

function stubSources(client: StubClient) {
  client.when('FROM users u WHERE u.id = $1', [WHO]);
  client.when('FROM orders WHERE seller_user_id', [{ total: '86420000', n: 42 }]);
  client.when("status = 'published'", [{ priceMinor: '638000', quantityAvailable: '24' }]);
  client.when('FROM wallet_accounts', [{ bal: '112000' }]);
  client.when('FROM dairy_memberships WHERE farmer_user_id', [{ n: 1 }]);
  client.when('JOIN dairy_memberships dm', [{ total: '1864000' }]);
  client.when('FROM dbt_transfers WHERE user_id', [{ total: '1600000', n: 2, attributed: 2 }]);
  client.when('FROM disputes WHERE', [{ raised: 2, against: 2, resolved: 4, open: 0 }]);
  client.when('FROM login_events', [{ days: 28 }]);
  client.when('FROM risk_scores', [{ score: 81, band: 'trusted' }]);
  client.when('FROM orders\n        WHERE seller_user_id = $1 ORDER BY', []);
  client.when('FROM listings\n        WHERE seller_user_id = $1 AND deleted_at IS NULL ORDER BY', []);
  client.when('FROM dbt_transfers d LEFT JOIN schemes', []);
}

describe('ADMIN-SWEEP-b4 · FIND → RECORD → ASSEMBLE, refusal with the source named', () => {
  it('a probe for a nonexistent person is a 404 that leaves NO access row', async () => {
    const { audit, svc } = harness();
    await expect(svc.profile('ghost', VIEWER)).rejects.toBeInstanceOf(FarmerNotFoundError);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('the access row is written BEFORE assembly, carries shape not figures, and a full profile assembles', async () => {
    const { client, audit, svc } = harness();
    stubSources(client);
    const p = await svc.profile('u1', VIEWER);
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log.mock.calls[0][0]).toMatchObject({ action: 'analytics.farmer360_opened', entityId: 'u1' });
    expect(JSON.stringify(audit.log.mock.calls[0][0].newValue)).not.toContain('86420000');   // shape, never figures
    expect(p.identity.phone).not.toBe('+919876543210');
    expect(p.gmv.valueMinor).toBe('86420000');
    expect(p.listed.valueMinor).toBe('15312000');
    expect(p.risk).toEqual({ score: 81, band: 'trusted' });
    expect(p.disputes.resolved).toBe(4);
  });

  it('a failing source REFUSES the whole profile as 503 with the source named — and the access row was still written', async () => {
    const { client, audit, svc } = harness();
    stubSources(client);
    client.when('FROM dbt_transfers WHERE user_id', new Error('replica gone'));
    const err = await svc.profile('u1', VIEWER).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ProfileAssemblyFailedError);
    expect((err as any).getResponse().message).toContain('schemes');   // WHICH read failed
    expect(audit.log).toHaveBeenCalledTimes(1);                        // the attempt is on the record
  });

  it('dairy with NO membership is null-not-zero and skips the bills join entirely', async () => {
    const { client, svc } = harness();
    stubSources(client);
    client.when('FROM dairy_memberships WHERE farmer_user_id', [{ n: 0 }]);
    const p = await svc.profile('u1', VIEWER);
    expect(p.dairy30d.valueMinor).toBeNull();
    expect(p.dairy30d.basis).toContain('unknown, not zero');
    expect(client.calls.some((c) => c.sql.includes('JOIN dairy_memberships dm'))).toBe(false);
  });
});

describe('ADMIN-SWEEP-b4 · the export conjunction and its receipt', () => {
  it('farmer360 WITHOUT analytics.export is a 403 naming the conjunction — nothing assembled, nothing logged', async () => {
    const { audit, svc } = harness();
    await expect(svc.exportProfile('u1', VIEWER, { reason: 'DSR follow-up, case #812' }))
      .rejects.toBeInstanceOf(ExportGrantMissingError);
    expect(audit.log).not.toHaveBeenCalled();
  });
  it('a thin reason is 422 before any read', async () => {
    const { audit, svc } = harness();
    await expect(svc.exportProfile('u1', actorWith(['analytics.farmer360', 'analytics.export']), { reason: 'because' }))
      .rejects.toBeInstanceOf(InvalidFarmer360RequestError);
    expect(audit.log).not.toHaveBeenCalled();
  });
  it('with both grants: masked rows, digest, append-only receipt, the reason in audit, and the SYNC delivery truth', async () => {
    const { client, audit, svc } = harness();
    stubSources(client);
    client.when('INSERT INTO report_export_receipts', [{ id: 'rc1' }]);
    const out = await svc.exportProfile('u1', actorWith(['analytics.farmer360', 'analytics.export']), { reason: 'DSR follow-up, case #812' });
    expect(out.receipt.id).toBe('rc1');
    expect(out.receipt.piiMasked).toBe(true);
    expect(out.receipt.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(out.rows)).not.toContain('+919876543210');
    expect(out.delivery).toMatchObject({ async: false, queuePosition: null, etaSeconds: null });
    // two audit rows: the view (an export IS a view) and the export with its reason
    const actions = audit.log.mock.calls.map((c: any[]) => c[0].action);
    expect(actions).toEqual(['analytics.farmer360_opened', 'analytics.farmer360_exported']);
    expect(audit.log.mock.calls[1][0].reason).toBe('DSR follow-up, case #812');
    const ins = client.calls.find((c) => c.sql.includes('INSERT INTO report_export_receipts'))!;
    expect(ins.params).toContain('farmer360_profile');
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-b4 · the absences that are the design (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('no phone predicate anywhere in this module — the b2 identity decision, held hardest on the deepest lens', () => {
    const dir = path.join(__dirname, '..');
    for (const f of ['repositories/farmer360.repository.ts', 'dto/farmer360.dto.ts']) {
      const text = strip(fs.readFileSync(path.join(dir, f), 'utf8'));
      expect(text).not.toMatch(/phone\s*(=|LIKE|ILIKE|IN\b)/i);
    }
  });
  it('0135 creates NO tables — the canon’s “no new tables” kept literally; indexes only', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations', '0135_farmer360_read_paths.sql'), 'utf8')
      .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).toMatch(/CREATE INDEX idx_dairy_memberships_farmer/);
    expect(sql).toMatch(/CREATE INDEX idx_disputes_raised_by/);
  });
  it('the grant split holds: farmer360 is its own role, and neither aggregate-analytics role acquires the person lens', () => {
    // resolved arrays, not source text — the b1 lesson
    const byRole = new Map<string, readonly string[]>(ownerRoleCatalogue().map((r) => [r.role, r.permissions]));
    expect(byRole.get('platform_farmer360')).toContain('analytics.farmer360');
    expect(byRole.get('platform_farmer360')).not.toContain('analytics.export');   // looking ≠ taking the file away
    expect(byRole.get('platform_analytics_ops')).not.toContain('analytics.farmer360');
    expect(byRole.get('platform_analytics_viewer')).not.toContain('analytics.farmer360');
  });
});
