// modules/offers/__tests__/tenant-isolation.spec.ts · tenant-scoping SQL contract (CI gate).
// Every offer read/write binds tenant_id (Law 1). listing_offers has NO version column, so mutations
// lock the row FOR UPDATE (no optimistic version clause); lists are keyset (never OFFSET); the
// expiry worker finder is bounded + SKIP LOCKED.
import { ListingOfferRepository } from '../repositories/listing-offer.repository';
import { ListingOffer } from '../domain/listing-offer.entity';

function fakeReplica() { const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }; return { provider: { forTenant: () => exec } as any, exec }; }
const repo = () => new ListingOfferRepository(fakeReplica().provider);

describe('offers tenant isolation (SQL contract)', () => {
  it('getForUpdate binds tenant_id + row-locks (no version column → FOR UPDATE serializes)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await repo().getForUpdate(tx as any, 'tenantA', 'o1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/id=\$1 AND tenant_id=\$2/);
    expect(sql).toMatch(/FOR UPDATE/);
    expect(params).toEqual(['o1', 'tenantA']);
  });

  it('insert binds tenant_id (and never writes a version column)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const o = ListingOffer.make({ id: 'o1', tenantId: 'tenantA', listingId: 'l1', buyerUserId: 'b1', quantity: '5', offeredPriceMinor: 100000n, expiresAt: new Date('2030-01-01T00:00:00Z') });
    await repo().insert(tx as any, o);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO listing_offers/);
    expect(sql).not.toMatch(/version/);
    expect(params).toContain('tenantA');
  });

  it('update is tenant-scoped and has NO optimistic version clause', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const o = ListingOffer.make({ id: 'o1', tenantId: 'tenantA', listingId: 'l1', buyerUserId: 'b1', quantity: '5', offeredPriceMinor: 100000n, expiresAt: new Date('2030-01-01T00:00:00Z') });
    await repo().update(tx as any, o);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/WHERE id=\$1 AND tenant_id=\$2/);
    expect(sql).not.toMatch(/version/);
    expect(params[1]).toBe('tenantA');
  });

  it('listForBuyer binds tenant_id + buyer_user_id and is keyset (no OFFSET)', async () => {
    const { provider, exec } = fakeReplica();
    await new ListingOfferRepository(provider).listForBuyer('tenantA', 'buyer1', { limit: 20 });
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND buyer_user_id=\$2/);
    expect(sql).toMatch(/ORDER BY created_at DESC, id DESC/);
    expect(sql).not.toMatch(/OFFSET/i);
    expect(params).toEqual(['tenantA', 'buyer1', 20]);
  });

  it('listForListing binds tenant_id + listing_id and is keyset (no OFFSET)', async () => {
    const { provider, exec } = fakeReplica();
    await new ListingOfferRepository(provider).listForListing('tenantA', 'l1', { limit: 50 });
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND listing_id=\$2/);
    expect(sql).not.toMatch(/OFFSET/i);
    expect(params).toEqual(['tenantA', 'l1', 50]);
  });

  // PC-56 HOTFIX-5 · B1: the cross-tenant kv_relay finder (`findDueToExpire`) is gone — kv_relay holds no grant on listing_offers, so the
  // registered `offers-expire` clock claims PER TENANT as kv_app; the contract (tenant-bound, bounded, SKIP LOCKED, open|countered) moved here.
  it('dueToExpire is tenant-bound, bounded + SKIP LOCKED over open|countered (the offers-expire clock, per tenant as kv_app)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await repo().dueToExpire(tx as any, 'tenantA', new Date(), 100);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND status IN \('open','countered'\) AND expires_at <= \$2/);
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(params[0]).toBe('tenantA');
  });
});
