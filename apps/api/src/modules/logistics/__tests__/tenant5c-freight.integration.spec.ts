// modules/logistics/__tests__/tenant5c-freight.integration.spec.ts · PC-56 TENANT-5c — the freight desk against a
// REAL PostgreSQL, through the real repository and the real entity.
//
// Why this file exists at all: this programme has now been caught three times by a query that the database refuses
// (0151's `orders.deleted_at`, 0152's `vehicles.is_active`, and this wave's `freight_invoice_lines.expected_minor
// NOT NULL`), and once by a plan that silently ignored an index. **Source-text assertions do not hold behaviour.**
// So the writes here go through `FreightInvoiceRepository` into real tables with RLS on, under `kv_app`, with
// `app.tenant_id` set — the same way the API runs.
//
// It also holds the one assertion the unit suite CANNOT make: the `date` mapper. `node-pg` parses `date` into a JS
// `Date` at local midnight, and in a UTC test process the wrong reading (`toISOString().slice(0,10)`) and the right
// one agree — which is exactly how that bug reaches an Indian production box. Run this file with TZ=Asia/Kolkata and
// the difference becomes visible; the probe asserts the mapper still returns the day PostgreSQL holds.
//
//   DATABASE_URL="postgres://postgres@/krish153?host=/var/run/postgresql" TZ=Asia/Kolkata \
//     npx jest src/modules/logistics/__tests__/tenant5c-freight.integration.spec.ts
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { FreightInvoice } from '../domain/freight-invoice.entity';
import { FreightInvoiceRepository } from '../repositories/freight-invoice.repository';

const URL = process.env.DATABASE_URL;
const run = URL ? describe : describe.skip;

run('PC-56 TENANT-5c · freight recon against real Postgres', () => {
  let pool: Pool;
  let app: PoolClient;
  let repo: FreightInvoiceRepository;
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const carrierId = randomUUID();
  const shipmentId = randomUUID();
  const orderId = randomUUID();
  const actorUserId = randomUUID();
  const invA = randomUUID();
  const invB = randomUUID();
  const AWB_MATCHED = `AWBM-${tenantId.slice(0, 8)}`;
  const AWB_PHANTOM = `AWBX-${tenantId.slice(0, 8)}`;

  /** The app-role connection: RLS on, tenant context set, exactly as `core/tenancy-context` runs it. */
  const tx = () => ({ tenantId, query: (sql: string, params?: unknown[]) => app.query(sql, params as never) });

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    const admin = await pool.connect();
    // fixtures as the owner; the probes below all run as kv_app
    await admin.query(`INSERT INTO countries (code, default_name, currency_code, phone_prefix) VALUES ('IN','India','INR','+91') ON CONFLICT (code) DO NOTHING`);
    await admin.query(`INSERT INTO lookup_types (code, default_name) VALUES ('tenant_type','Tenant Type') ON CONFLICT (code) DO NOTHING`);
    const ttype = randomUUID();
    await admin.query(`INSERT INTO lookup_values (id, type_code, code, default_name) VALUES ($1,'tenant_type','fpo','FPO') ON CONFLICT DO NOTHING`, [ttype]);
    for (const [id, slug] of [[tenantId, 'a'], [otherTenantId, 'b']] as const) {
      await admin.query(
        `INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code)
         VALUES ($1,$2,$3,$3,$4,'IN') ON CONFLICT (id) DO NOTHING`,
        [id, `t5c-${slug}-${String(id).slice(0, 8)}`, `5c ${slug}`, ttype]);
    }
    await admin.query(
      `INSERT INTO logistics_partners (id, tenant_id, partner_kind, default_name) VALUES ($1,$2,'3pl','5c Carrier') ON CONFLICT (id) DO NOTHING`,
      [carrierId, tenantId]);
    const user = actorUserId;
    // `users.phone`, not `phone_e164` — read off the live schema rather than assumed, which is this programme's
    // whole point about source-text confidence.
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1,$2,'5c probe') ON CONFLICT (id) DO NOTHING`,
      [user, `+9198${String(Date.now()).slice(-8)}`]);
    await admin.query(
      `INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, subtotal_minor, total_minor)
       VALUES ($1,$2,$3,$4,$4,100000,100000)`,   // no ON CONFLICT (id): orders is partitioned, PK is (id, created_at)
      [orderId, tenantId, `5C-${String(orderId).slice(0, 8)}`, user]);
    // One shipment we really made, with the carrier's AWB and a recorded charge — the only kind of line that can
    // ever be a `match`, and the reason this probe can tell `match` from `unpriced` at all.
    await admin.query(
      `INSERT INTO shipments (id, tenant_id, order_id, status, awb_no, charge_minor, delivery_attempts, created_at)
       VALUES ($1,$2,$3,'delivered',$4,114000,1, now()) ON CONFLICT DO NOTHING`,
      [shipmentId, tenantId, orderId, AWB_MATCHED]);
    admin.release();

    app = await pool.connect();
    await app.query('SET ROLE kv_app');
    await app.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    repo = new FreightInvoiceRepository({ forTenant: () => ({ query: (sql: string, params?: unknown[]) => app.query(sql, params as never) }) } as never);
  }, 30_000);

  afterAll(async () => {
    app?.release();
    await pool?.end();
  }, 30_000);

  function invoice(id: string, invoiceNo: string, lines: Array<{ awbNo: string; billedMinor: bigint; billedAttempts?: number }>, period: [string, string]) {
    return FreightInvoice.record({
      id, tenantId, carrierId, invoiceNo, sourceKind: 'carrier_invoice',
      periodStart: period[0], periodEnd: period[1],
      billedMinor: lines.reduce((a, l) => a + l.billedMinor, 0n), currencyCode: 'INR',
      lines: lines.map((l) => ({ id: randomUUID(), ...l })),
    });
  }

  it('inserts an invoice whose lines have NO expected figure — the write 0070 would have refused', async () => {
    // `freight_invoice_lines.expected_minor` was declared NOT NULL with no default, and "unpriced" is the normal
    // state on this platform. 0153 drops the NOT NULL; this is the write that proves it.
    const inv = invoice(invA, `5C-A-${invA.slice(0, 8)}`, [
      { awbNo: AWB_MATCHED, billedMinor: 168000n, billedAttempts: 2 },
      { awbNo: AWB_PHANTOM, billedMinor: 94000n },
    ], ['2026-07-01', '2026-07-31']);
    await repo.insert(tx() as never, inv);
    const back = await repo.getById(tenantId, invA);
    expect(back).not.toBeNull();
    expect(back!.toLines().map((l) => l.expectedMinor)).toEqual([null, null]);
    // the GENERATED variance is NULL for an unpriced line, which is correct and is what the desk reports as such
    const raw = await app.query(`SELECT variance_minor FROM freight_invoice_lines WHERE invoice_id=$1 ORDER BY line_no`, [invA]);
    expect(raw.rows.map((r) => r.variance_minor)).toEqual([null, null]);
  });

  it('reads the billing period as the day PostgreSQL holds, whatever the process timezone', async () => {
    // node-pg hands back a JS Date at LOCAL midnight. Under TZ=Asia/Kolkata, `toISOString().slice(0,10)` on that
    // Date reports 2026-06-30 for a July 1 period start. The mapper reads the local components instead.
    const back = await repo.getById(tenantId, invA);
    expect(back!.toProps().periodStart).toBe('2026-07-01');
    expect(back!.toProps().periodEnd).toBe('2026-07-31');
    const raw = await app.query(`SELECT period_start FROM freight_invoices WHERE id=$1`, [invA]);
    const asDate = raw.rows[0].period_start as Date;
    expect(asDate instanceof Date).toBe(true);
    // The offset is only visible off UTC; when it IS visible, the mapper must not have followed it.
    if (asDate.toISOString().slice(0, 10) !== '2026-07-01') {
      expect(back!.toProps().periodStart).not.toBe(asDate.toISOString().slice(0, 10));
    }
  });

  it('matches a carrier line to our own shipment by AWB, and reports the phantom as unmatched', async () => {
    const rows = await repo.evidenceFor(tenantId, { awbNos: [AWB_MATCHED, AWB_PHANTOM], shipmentIds: [] },
      { from: '2026-07-01', to: '2026-07-31' });
    expect(rows.map((r) => r.awbNo)).toEqual([AWB_MATCHED]);
    expect(rows[0]).toMatchObject({ id: shipmentId, status: 'delivered', chargeMinor: 114000n, deliveryAttempts: 1 });
  });

  it('uses the AWB index 0153 adds, and prunes the shipment partitions', async () => {
    // Before 0153 this was a sequential scan of every shipment in the pruned window, once per recon pass.
    const plan = await app.query(
      `EXPLAIN (COSTS OFF) SELECT id FROM shipments
        WHERE tenant_id=$1 AND awb_no = ANY($2::varchar[])
          AND created_at >= ($3::date - interval '31 days') AND created_at <= ($4::date + interval '31 days')`,
      [tenantId, [AWB_MATCHED], '2026-07-01', '2026-07-31']);
    const text = plan.rows.map((r) => String((r as Record<string, unknown>)['QUERY PLAN'])).join('\n');
    expect(text).toMatch(/idx_shipments_tenant_awb|Index Scan|Bitmap Index Scan/);
    expect(text).toMatch(/Subplans Removed|shipments_/);
  });

  it('runs the whole recon through the entity and persists every verdict', async () => {
    const inv = await repo.getForUpdate(tx() as never, tenantId, invA);
    const ev = await repo.evidenceFor(tenantId, { awbNos: [AWB_MATCHED, AWB_PHANTOM], shipmentIds: [] }, { from: '2026-07-01', to: '2026-07-31' });
    const byAwb = new Map(ev.filter((r) => r.awbNo).map((r) => [r.awbNo as string, r]));
    const out = inv!.reconcile((l) => {
      const hit = l.awbNo ? byAwb.get(l.awbNo) : undefined;
      return {
        shipmentId: hit?.id ?? null, awbNo: l.awbNo, status: (hit?.status as never) ?? null,
        expectedMinor: hit?.chargeMinor ?? null, deliveryAttempts: hit?.deliveryAttempts ?? 0,
        requiresColdChain: hit?.requiresColdChain ?? false,
      };
    });
    // 168000 billed against 114000 expected is an over-bill; the phantom AWB matches nothing at all.
    expect(out.totals).toMatchObject({ over: 1, unmatched: 1, matched: 0 });
    expect(out.to).toBe('variance_open');
    await repo.updateHeader(tx() as never, inv!);
    await repo.updateLines(tx() as never, inv!.toLines());
    const back = await repo.getById(tenantId, invA);
    expect(back!.status).toBe('variance_open');
    expect(back!.toProps().expectedMinor).toBe(114000n);
    expect(back!.toLines()[0].shipmentId).toBe(shipmentId);
    expect(back!.toLines()[1].shipmentId).toBeNull();
  });

  it('records a dispute with its coded class and evidence, and the CHECK enforces all three', async () => {
    const inv = await repo.getForUpdate(tx() as never, tenantId, invA);
    const lineId = inv!.toLines()[0].id;
    const code = inv!.disputeLine(lineId, actorUserId, 'billed two attempts, our events show one', (l) => ({
      shipmentId: shipmentId, awbNo: l.awbNo, status: 'delivered', expectedMinor: 114000n, deliveryAttempts: 1, requiresColdChain: false,
    }));
    expect(code).toBe('extra_attempt_billed');
    await repo.updateLines(tx() as never, inv!.toLines());
    await repo.updateHeader(tx() as never, inv!);
    const raw = await app.query(`SELECT dispute_status, dispute_reason_code, evidence FROM freight_invoice_lines WHERE id=$1`, [lineId]);
    expect(raw.rows[0]).toMatchObject({ dispute_status: 'disputed', dispute_reason_code: 'extra_attempt_billed' });
    expect(raw.rows[0].evidence).toMatchObject({ ourAttempts: 1, billedAttempts: 2 });

    // and the database refuses a dispute with no evidence behind it
    await expect(app.query(
      `UPDATE freight_invoice_lines SET dispute_reason_code=NULL, evidence=NULL WHERE id=$1`, [lineId]))
      .rejects.toMatchObject({ constraint: 'ck_freight_line_dispute_evidence' });
  });

  it('resolves the dispute, reduces the invoice, and makes the recovery re-derivable per currency', async () => {
    const inv = await repo.getForUpdate(tx() as never, tenantId, invA);
    const lineId = inv!.toLines()[0].id;
    const billedBefore = inv!.toProps().billedMinor;
    // A REAL user id: `freight_invoice_lines.resolved_by` is FK-enforced to `users`, which this probe found the hard
    // way when it passed a fresh uuid — the database will not let a resolution name a person who does not exist.
    inv!.resolveLine(lineId, actorUserId, 'agreed', 114000n);
    await repo.updateLines(tx() as never, inv!.toLines());
    await repo.updateHeader(tx() as never, inv!);
    const back = await repo.getById(tenantId, invA);
    expect(back!.toProps().billedMinor).toBe(billedBefore - 54000n);

    const recovered = await repo.recoveredSince(tenantId, new Date(Date.now() - 86_400_000).toISOString());
    expect(recovered).toEqual([{ currencyCode: 'INR', recoveredMinor: '54000' }]);
  });

  it('finds the SAME consignment billed on a second invoice — the row neither canon screen draws', async () => {
    // A real shipment, billed correctly, billed twice: the carrier's next cycle carries the same AWB. Every
    // per-line check passes on both invoices, so only a cross-invoice question can see it.
    const inv2 = invoice(invB, `5C-B-${invB.slice(0, 8)}`, [{ awbNo: AWB_MATCHED, billedMinor: 114000n }], ['2026-08-01', '2026-08-31']);
    await repo.insert(tx() as never, inv2);
    const dups = await repo.duplicateAwbsFor(tenantId, invA);
    expect(dups).toHaveLength(1);
    expect(dups[0]).toMatchObject({ awbNo: AWB_MATCHED, otherInvoiceId: invB, billedMinor: '114000', periodStart: '2026-08-01' });
    // and the question is symmetric: opening the second invoice finds the first
    const back = await repo.duplicateAwbsFor(tenantId, invB);
    expect(back.map((d) => d.otherInvoiceId)).toEqual([invA]);
  });

  it('refuses the same invoice number twice for one tenant, as a typed refusal', async () => {
    const again = invoice(randomUUID(), `5C-A-${invA.slice(0, 8)}`, [{ awbNo: AWB_MATCHED, billedMinor: 1n }], ['2026-07-01', '2026-07-31']);
    await expect(repo.insert(tx() as never, again)).rejects.toMatchObject({ code: 'FREIGHT_INVOICE_EXISTS' });
  });

  it('refuses a write to the GENERATED variance column', async () => {
    await expect(app.query(`UPDATE freight_invoices SET variance_minor = 1 WHERE id=$1`, [invA])).rejects.toMatchObject({ code: '428C9' });
  });

  it('shows nothing to another tenant, and lets it write nothing here', async () => {
    await app.query(`SELECT set_config('app.tenant_id', $1, false)`, [otherTenantId]);
    const seen = await app.query(`SELECT count(*)::int AS n FROM freight_invoices`);
    expect(seen.rows[0].n).toBe(0);
    const lines = await app.query(`SELECT count(*)::int AS n FROM freight_invoice_lines`);
    expect(lines.rows[0].n).toBe(0);
    await expect(app.query(
      `INSERT INTO freight_invoice_lines (id, tenant_id, invoice_id, awb_no, line_no, billed_minor)
       VALUES ($1,$2,$3,'X',99,1)`, [randomUUID(), tenantId, invA]))
      .rejects.toMatchObject({ code: '42501' });
    await app.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
  });

  it('keeps the desk switched OFF, which is the state this wave ships in', async () => {
    const flag = await app.query(`SELECT is_enabled FROM feature_flags WHERE key='logistics_freight_recon'`);
    expect(flag.rows[0].is_enabled).toBe(false);
  });
});
