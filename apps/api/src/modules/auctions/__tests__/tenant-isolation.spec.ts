// modules/auctions/__tests__/tenant-isolation.spec.ts · tenant-scoping SQL contract (CI gate).
// Every auction/bid read/write binds tenant_id (Law 1); the bid path row-locks the auction.
import { AuctionRepository } from '../repositories/auction.repository';
import { BidRepository } from '../repositories/bid.repository';

function fakeReplica() { const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }; return { provider: { forTenant: () => exec } as any, exec }; }

describe('auctions tenant isolation (SQL contract)', () => {
  it('auction.getForUpdate binds tenant_id + row-locks (serializes bids)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new AuctionRepository(fakeReplica().provider).getForUpdate(tx as any, 'tenantA', 'au1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/id=\$1 AND tenant_id=\$2/);
    expect(sql).toMatch(/FOR UPDATE/);
    expect(params).toEqual(['au1', 'tenantA']);
  });

  it('auction.update is optimistic-locked (version) and tenant-scoped', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const { Auction } = await import('../domain/auction.entity');
    const a = Auction.create({ id: 'au1', tenantId: 'tenantA', listingId: 'l1', kind: 'english_open', quantity: '200', unitCode: 'kg', startPriceMinor: 100000n, startsAt: new Date('2026-04-01T00:00:00Z'), endsAt: new Date('2026-04-02T00:00:00Z') });
    await new AuctionRepository(fakeReplica().provider).update(tx as any, a);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/WHERE id=\$1 AND tenant_id=\$2 AND version=\$7/);
    expect(sql).toMatch(/version=version\+1/);
    expect(params[1]).toBe('tenantA');
  });

  it('PC-56 TENANT-11a F-9: the close claim is PER TENANT (kv_app tx, RLS on) and bounded — no cross-tenant FOR UPDATE as kv_relay', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new AuctionRepository(fakeReplica().provider).dueToClose(tx as any, 'tenantA', new Date(), 100);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND status IN \('live','extended'\) AND ends_at <= \$2/);
    expect(sql).toMatch(/LIMIT \$3/);
    expect(params[0]).toBe('tenantA');
  });

  it('bid.highest binds tenant_id + auction_id', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new BidRepository(fakeReplica().provider).highest(tx as any, 'tenantA', 'au1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND auction_id=\$2/);
    expect(params).toEqual(['tenantA', 'au1']);
  });

  it('bid.listFor binds tenant_id + auction_id and is keyset (no OFFSET)', async () => {
    const { provider, exec } = fakeReplica();
    await new BidRepository(provider).listFor('tenantA', 'au1', { limit: 20 });
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND auction_id=\$2/);
    expect(sql).not.toMatch(/OFFSET/i);
    expect(params[0]).toBe('tenantA');
  });
});
