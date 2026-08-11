// modules/market-intel/__tests__/tenant-isolation.spec.ts · scoping SQL contract (CI gate).
// price_alerts (tenant-scoped) bind tenant_id + lock FOR UPDATE; matchActive uses FOR UPDATE SKIP LOCKED; lists
// are keyset (no OFFSET). mandi_prices/predictions are GLOBAL (no tenant_id) but bound product_id (partition
// prune) and order by the partition key DESC; the user inbox of alerts is filtered by user_id.
import { PriceAlertRepository } from '../repositories/price-alert.repository';
import { MandiPriceRepository } from '../repositories/mandi-price.repository';
import { PricePredictionRepository } from '../repositories/price-prediction.repository';
import { PriceAlert } from '../domain/price-alert.entity';
import { MandiPrice } from '../domain/mandi-price.entity';

function fakeReplica() { const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }; return { provider: { forTenant: () => exec } as any, exec }; }
const alert = () => PriceAlert.create({ id: 'a1', tenantId: 'tenantA', userId: 'u1', productId: 'p1', regionId: 'r1', direction: 'above', thresholdMinor: 250000n });

describe('price_alerts isolation', () => {
  it('getForUpdate binds tenant_id + FOR UPDATE; insert binds tenant_id', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new PriceAlertRepository(fakeReplica().provider).getForUpdate(tx as any, 'tenantA', 'a1');
    expect(tx.query.mock.calls[0][0]).toMatch(/id=\$1 AND tenant_id=\$2/); expect(tx.query.mock.calls[0][0]).toMatch(/FOR UPDATE/);
    const tx2 = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await new PriceAlertRepository(fakeReplica().provider).insert(tx2 as any, alert());
    expect(tx2.query.mock.calls[0][0]).toMatch(/INSERT INTO price_alerts/); expect(tx2.query.mock.calls[0][1]).toContain('tenantA');
  });
  it('matchActive binds tenant_id + product + FOR UPDATE SKIP LOCKED', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new PriceAlertRepository(fakeReplica().provider).matchActive(tx as any, 'tenantA', 'p1', 'r1');
    const [sql] = tx.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND product_id=\$2/); expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
  });
  it('user list binds user_id; keyset (no OFFSET)', async () => {
    const { provider, exec } = fakeReplica();
    await new PriceAlertRepository(provider).listForUser('tenantA', 'u1', { limit: 50 });
    expect(exec.query.mock.calls[0][0]).toMatch(/tenant_id=\$1 AND user_id=\$2/); expect(exec.query.mock.calls[0][0]).not.toMatch(/OFFSET/i);
  });
});

describe('mandi_prices (global, partitioned)', () => {
  it('history bounds product_id + orders by price_date DESC (partition prune); keyset (no OFFSET)', async () => {
    const { provider, exec } = fakeReplica();
    await new MandiPriceRepository(provider).listFor('tenantA', { productId: 'p1', limit: 50 });
    const [sql] = exec.query.mock.calls[0];
    expect(sql).toMatch(/product_id=\$1/); expect(sql).toMatch(/ORDER BY price_date DESC, id DESC/); expect(sql).not.toMatch(/OFFSET/i);
  });
  it('insert targets mandi_prices (no tenant_id column — global) and stamps the anomaly verdict', async () => {
    // PC-56 ADMIN-SWEEP: `insert` now RETURNS the id + price_date, because the caller needs both to enqueue a review row
    // that points at a partitioned table (Law 8). The stub returns them.
    const tx = { query: jest.fn().mockResolvedValue({ rows: [{ id: '42', price_date: '2026-06-20' }], rowCount: 1 }) };
    const m = MandiPrice.observe({ mandiId: null, regionId: 'r1', productId: 'p1', gradeOptionId: null, priceDate: '2026-06-20', minMinor: null, maxMinor: null, modalMinor: 250000n, unitCode: 'quintal', arrivalsQty: null, source: 'agmarknet', currencyCode: 'INR' });
    const out = await new MandiPriceRepository(fakeReplica().provider).insert(tx as any, m, { state: 'quarantined', deviationBp: 9_500, referenceModalMinor: 25_000n });
    const sql = tx.query.mock.calls[0][0];
    expect(sql).toMatch(/INSERT INTO mandi_prices/); expect(sql).not.toMatch(/tenant_id/);
    // **THE VERDICT IS IN THE SAME STATEMENT AS THE PRICE, not a follow-up UPDATE.** A row that existed for even one
    // statement without its state would be a row the alert loop could read as accepted — and the alert loop runs a few
    // lines later, in the same transaction.
    expect(sql).toMatch(/anomaly_state, deviation_bp, reference_modal_minor/);
    expect(tx.query.mock.calls[0][1]).toEqual(expect.arrayContaining(['quarantined', 9_500, '25000']));
    expect(out).toEqual({ id: '42', priceDate: '2026-06-20' });
  });

  it('judges a manual price only against ACCEPTED observations from trusted sources', async () => {
    // Judging one bad price against the last bad price is how a typo becomes the new normal: two 10× entries in a row
    // would agree with each other and both sail through.
    const tx = { query: jest.fn().mockResolvedValue({ rows: [{ modal_minor: '640000' }] }) };
    const ref = await new MandiPriceRepository(fakeReplica().provider).referenceModal(tx as any, 'p1', 'r1', '2026-06-20');
    const sql = tx.query.mock.calls[0][0];
    expect(sql).toMatch(/anomaly_state IN \('accepted','released'\)/);
    expect(sql).toMatch(/source IN \('agmarknet','enam','platform_txn'\)/);
    // Bounded by the partition key, both ends — an unbounded scan of a billions-of-rows table on the ingest path.
    expect(sql).toMatch(/price_date <= \$2::date AND price_date > \$2::date/);
    expect(ref).toBe(640000n);
  });

  it('enqueues the anomaly review on the queue that has existed since 0013', async () => {
    // No new queue table: `ai_review_queue.queue_kind` has carried 'price_anomaly' since migration 0013 and was
    // enqueued by nobody. A second queue would split one worklist across two consoles.
    const tx = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await new MandiPriceRepository(fakeReplica().provider).enqueueAnomalyReview(tx as any, {
      tenantId: 't1', priceId: '42', priceDate: '2026-06-20', deviationBp: 12_000,
    });
    const sql = tx.query.mock.calls[0][0];
    expect(sql).toMatch(/INSERT INTO ai_review_queue/);
    expect(sql).toMatch(/'price_anomaly'/);
    expect(sql).toMatch(/subject_kind, subject_bigint_id, subject_date/);
    // A 10x typo is looked at before a 25% one: lower priority number sorts first in this table's convention.
    expect(tx.query.mock.calls[0][1][1]).toBe(10);
  });
});

describe('price_predictions (global, partitioned)', () => {
  it('latest bounds product+region, orders created_at DESC', async () => {
    const { provider, exec } = fakeReplica();
    await new PricePredictionRepository(provider).latest('tenantA', 'p1', 'r1');
    expect(exec.query.mock.calls[0][0]).toMatch(/product_id=\$1 AND region_id=\$2/); expect(exec.query.mock.calls[0][0]).toMatch(/ORDER BY created_at DESC/);
  });
});
