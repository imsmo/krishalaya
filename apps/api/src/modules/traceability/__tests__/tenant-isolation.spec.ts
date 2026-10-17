// modules/traceability/__tests__/tenant-isolation.spec.ts · scoping SQL contract (CI gate).
// trace_lots bind tenant_id + lock FOR UPDATE; lists keyset (no OFFSET). trace_events bind tenant_id + lot,
// timeline ASC keyset; the public scan path uses the SECURITY DEFINER trace_scan() function (NOT a raw
// tenant-bypassing SELECT) — verified by the repo issuing `SELECT trace_scan($1)`, never a bare table read.
import { TraceLotRepository } from '../repositories/trace-lot.repository';
import { TraceEventRepository } from '../repositories/trace-event.repository';
import { TraceLot } from '../domain/trace-lot.entity';
import { TraceEvent } from '../domain/trace-event.entity';

function fakeReplica() { const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }; return { provider: { forTenant: () => exec } as any, exec }; }
const lot = () => TraceLot.create({ id: 'l1', tenantId: 'tenantA', listingId: 'lst1', qrToken: 'QR1', farmerUserId: 'u1', parcelId: null, cropSeasonId: null, declaredInputs: [], certificateIds: [] });

describe('trace_lots isolation', () => {
  it('getForUpdate binds tenant_id + FOR UPDATE; insert binds tenant_id', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new TraceLotRepository(fakeReplica().provider).getForUpdate(tx as any, 'tenantA', 'l1');
    expect(tx.query.mock.calls[0][0]).toMatch(/id=\$1 AND tenant_id=\$2/); expect(tx.query.mock.calls[0][0]).toMatch(/FOR UPDATE/);
    const tx2 = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await new TraceLotRepository(fakeReplica().provider).insert(tx2 as any, lot());
    expect(tx2.query.mock.calls[0][0]).toMatch(/INSERT INTO trace_lots/); expect(tx2.query.mock.calls[0][1]).toContain('tenantA');
  });
  it('findByListing binds tenant_id + FOR UPDATE; list keyset (no OFFSET)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new TraceLotRepository(fakeReplica().provider).findByListing(tx as any, 'tenantA', 'lst1');
    expect(tx.query.mock.calls[0][0]).toMatch(/tenant_id=\$1 AND listing_id=\$2/); expect(tx.query.mock.calls[0][0]).toMatch(/FOR UPDATE/);
    const { provider, exec } = fakeReplica();
    await new TraceLotRepository(provider).listFor('tenantA', { box: 'mine', farmerUserId: 'u1', limit: 50 });
    expect(exec.query.mock.calls[0][0]).toMatch(/ORDER BY created_at DESC, id DESC/); expect(exec.query.mock.calls[0][0]).not.toMatch(/OFFSET/i);
  });
  // PC-56 HOTFIX-7 · B10 / B25: the public read is `trace_scan_v2` (0217 — live organisations only, allow-listed meta); 0028's trace_scan is no longer called
  // PC-56 STORE-5b · B10: … and now `trace_scan_v3` (0219 — + product, place, hashes, the seal, the certificates; `{live:false}` for a dark organisation)
  it('public scan goes through the SECURITY DEFINER trace_scan_v3() function (no raw table read)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [{ provenance: null }], rowCount: 1 }) };
    await new TraceLotRepository(fakeReplica().provider).scan(tx as any, 'QR1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/SELECT trace_scan_v3\(\$1\)/); expect(sql).not.toMatch(/FROM trace_lots/); expect(params).toEqual(['QR1']);
  });
});

describe('trace_events isolation', () => {
  it('insert binds tenant_id; lastHash + timeline bind tenant_id + lot; timeline ASC keyset (no OFFSET)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const e = TraceEvent.append({ traceLotId: 'l1', tenantId: 'tenantA', eventCode: 'listed', meta: {}, prevHash: 'l1', createdAt: new Date('2026-10-17T00:00:00.000Z') });   // STORE-5b: v2 carries its instant
    await new TraceEventRepository(fakeReplica().provider).insert(tx as any, e);
    expect(tx.query.mock.calls[0][0]).toMatch(/INSERT INTO trace_events/); expect(tx.query.mock.calls[0][1]).toContain('tenantA');
    const tx2 = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new TraceEventRepository(fakeReplica().provider).lastHash(tx2 as any, 'tenantA', 'l1');
    expect(tx2.query.mock.calls[0][0]).toMatch(/tenant_id=\$1 AND trace_lot_id=\$2/);
    const { provider, exec } = fakeReplica();
    await new TraceEventRepository(provider).listForLot('tenantA', 'l1', { limit: 50 });
    expect(exec.query.mock.calls[0][0]).toMatch(/ORDER BY created_at ASC, id ASC/); expect(exec.query.mock.calls[0][0]).not.toMatch(/OFFSET/i);
  });
});
