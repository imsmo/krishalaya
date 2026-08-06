// apps/admin-api/src/modules/billing-ops/__tests__/billing-ops.integration.spec.ts
// REAL end-to-end proof against a live Postgres (the schema apps/api builds + migrations 0002/0035). Proves:
// work a SaaS invoice draft→issued→overdue + record a dunning attempt (counter bumps, audit rows), and apply a
// manual billing adjustment (billing_adjustments row written + audit + idempotent replay). The wallet-service is
// the money writer in production; here a fake WalletAdminPort stands in for it (the gRPC server isn't booted in
// this suite) so we exercise the admin-side record/audit/idempotency. Runs only when DATABASE_ADMIN_URL is set.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AdminConfig } from '../../../core/config/admin-config';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { BillingRepository } from '../repositories/billing.repository';
import { SaasInvoicesAdminService } from '../services/saas-invoices-admin.service';
import { DunningService } from '../services/dunning.service';
import { ManualAdjustmentService } from '../services/manual-adjustment.service';
import { InvoicePaymentsService } from '../services/invoice-payments.service';
import { WalletAdminPort, PostAdjustmentInput } from '../../../core/wallet/wallet-admin.port';

const APP_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const run = APP_URL ? describe : describe.skip;

// Fake wallet-service: records calls, returns a fabricated txn id; idempotent on key (mirrors the real engine).
class FakeWallet implements WalletAdminPort {
  calls: PostAdjustmentInput[] = [];
  private byKey = new Map<string, string>();
  async post(input: PostAdjustmentInput) {
    this.calls.push(input);
    const existing = this.byKey.get(input.idempotencyKey);
    if (existing) return { txnId: existing, alreadyApplied: true };
    const txnId = randomUUID(); this.byKey.set(input.idempotencyKey, txnId);
    return { txnId, alreadyApplied: false };
  }
}

run('billing-ops (integration, real Postgres — invoices + dunning + adjustments + payments)', () => {
  let pool: AdminPool; let inspect: Pool;
  let invoiceSvc: SaasInvoicesAdminService; let dunningSvc: DunningService; let adjustSvc: ManualAdjustmentService; let wallet: FakeWallet;
  let paymentSvc: InvoicePaymentsService;
  // A SECOND operator, because maker-checker is not testable with one (0093). Must be a real users row: the 0093
  // columns are FKs to users(id), so a random uuid would fail the constraint rather than the control.
  let CHECKER_ID = '';
  const actor = { userId: randomUUID(), roles: ['platform_billing_ops'], amr: ['hwk'], authTimeSec: Math.floor(Date.now() / 1000), sessionId: '', permissions: new Set(['billing.manage']), ip: '10.0.0.1', requestId: 'itest' } as any;
  let tenantId = ''; let invoiceId = '';

  beforeAll(async () => {
    const config = new AdminConfig({ NODE_ENV: 'test', DATABASE_ADMIN_URL: APP_URL, ADMIN_JWT_SECRET: 's'.repeat(40) });
    pool = new AdminPool(config);
    const audit = new AdminAuditWriter(pool);
    const repo = new BillingRepository(pool);
    wallet = new FakeWallet();
    invoiceSvc = new SaasInvoicesAdminService(pool, audit, repo);
    dunningSvc = new DunningService(pool, audit, repo);
    adjustSvc = new ManualAdjustmentService(pool, audit, repo, wallet);
    paymentSvc = new InvoicePaymentsService(pool, audit, repo);
    inspect = new Pool({ connectionString: APP_URL });
    const t = await inspect.query(`SELECT id FROM tenants LIMIT 1`);
    tenantId = t.rows[0].id;
    // two distinct real users: the requester (actor) and the approver
    const us = await inspect.query(`SELECT id FROM users ORDER BY created_at LIMIT 2`);
    actor.userId = us.rows[0].id;
    CHECKER_ID = us.rows[1]?.id ?? us.rows[0].id;
    const inv = await inspect.query(
      `INSERT INTO saas_invoices (tenant_id, invoice_no, status, currency_code, subtotal_minor, tax_minor, total_minor, due_date, line_items)
       VALUES ($1,$2,'draft','INR',100000,18000,118000, CURRENT_DATE - 1, '[]'::jsonb) RETURNING id`,
      [tenantId, `KV-ITEST-${Date.now()}`]);
    invoiceId = inv.rows[0].id;
  }, 30000);

  afterAll(async () => {
    if (inspect) {
      await inspect.query(`DELETE FROM saas_invoice_dunning_attempts WHERE invoice_id=$1`, [invoiceId]).catch(() => undefined);
      await inspect.query(`DELETE FROM billing_adjustments WHERE tenant_id=$1 AND reason='itest goodwill'`, [tenantId]).catch(() => undefined);
      await inspect.query(`DELETE FROM saas_invoices WHERE id=$1`, [invoiceId]).catch(() => undefined);
      await inspect.end();
    }
    await pool?.onModuleDestroy();
  });

  it('invoice: draft→issued→overdue + a dunning attempt (counter + audit)', async () => {
    await invoiceSvc.update(actor, invoiceId, { action: 'issue', reason: 'cycle billing' });
    await invoiceSvc.update(actor, invoiceId, { action: 'mark_overdue', reason: 'past due date' });
    const out: any = await dunningSvc.record(actor, invoiceId, { channel: 'email', outcome: 'sent', note: 'first reminder' });
    expect(out.attemptNo).toBe(1);
    const row = await inspect.query(`SELECT status, dunning_attempts FROM saas_invoices WHERE id=$1`, [invoiceId]);
    expect(row.rows[0].status).toBe('overdue');
    expect(row.rows[0].dunning_attempts).toBe(1);
    const au = await inspect.query(`SELECT count(*)::int AS c FROM audit_log WHERE entity_id=$1 AND action IN ('billing.invoice_issued','billing.invoice_overdue','billing.invoice_dunned')`, [invoiceId]);
    expect(au.rows[0].c).toBe(3);
  });

  it('adjustment: REQUEST → a second operator decides → apply moves the money (PC-56 ADMIN-1b, 0093)', async () => {
    const req = { tenantId, direction: 'credit' as const, amountMinor: '50000', currency: 'INR', reason: 'itest goodwill' };
    const requested: any = await adjustSvc.request(actor, req);
    expect(requested.status).toBe('awaiting_approval');
    // the request itself moves NO money — that is the whole point of the control
    expect(requested.walletTxnId).toBeNull();
    expect(wallet.calls.length).toBe(0);

    // THE DATABASE, not just the service, refuses self-approval
    await expect(adjustSvc.decide(actor, requested.id, { decision: 'approve' })).rejects.toThrow();

    const checker = { ...actor, userId: CHECKER_ID };
    const approved: any = await adjustSvc.decide(checker, requested.id, { decision: 'approve' });
    expect(approved.status).toBe('approved');

    const applied: any = await adjustSvc.apply(checker, requested.id);
    expect(applied.walletTxnId).toBeTruthy();
    expect(wallet.calls.length).toBe(1);

    // applying again is idempotent: no second wallet post, no second audit row
    await adjustSvc.apply(checker, requested.id);
    expect(wallet.calls.length).toBe(1);

    const row = await inspect.query(
      `SELECT direction, amount_minor, status, requested_by, decided_by, wallet_txn_id, applied_at
         FROM billing_adjustments WHERE id=$1`, [requested.id]);
    expect(row.rows[0].direction).toBe('credit');
    expect(String(row.rows[0].amount_minor)).toBe('50000');
    expect(row.rows[0].status).toBe('applied');
    expect(row.rows[0].requested_by).not.toBe(row.rows[0].decided_by);   // maker ≠ checker, on the row
    expect(row.rows[0].wallet_txn_id).toBeTruthy();
    expect(row.rows[0].applied_at).toBeTruthy();

    const au = await inspect.query(
      `SELECT action FROM audit_log WHERE entity_id=$1 ORDER BY created_at`, [requested.id]);
    expect(au.rows.map((r: any) => r.action)).toEqual([
      'billing.adjustment_requested', 'billing.adjustment_approved', 'billing.adjustment_applied',
    ]);
  });

  it('payments: a receipt settles by ARITHMETIC, and a reversal reopens the invoice (0092)', async () => {
    // a fresh issued invoice for this test's own money story
    const inv = await inspect.query(
      `INSERT INTO saas_invoices (tenant_id, invoice_no, status, currency_code, subtotal_minor, tax_minor,
                                  total_minor, due_date, line_items)
       VALUES ($1, $2, 'issued', 'INR', 100000, 0, 100000, CURRENT_DATE + 5, '[]'::jsonb) RETURNING id`,
      [tenantId, `ITEST-PAY-${Date.now()}`]);
    const payInvoiceId = inv.rows[0].id;

    const partial: any = await paymentSvc.record(actor, payInvoiceId, {
      amountMinor: '40000', currency: 'INR', method: 'bank_transfer', reference: `UTR-${Date.now()}`,
      receivedAt: new Date().toISOString(), idempotencyKey: `pay-${Date.now()}`,
    });
    expect(partial.status).toBe('partially_paid');          // derived, never typed
    expect(partial.paidMinor).toBe('40000');
    expect(partial.outstandingMinor).toBe('60000');

    const settling: any = await paymentSvc.record(actor, payInvoiceId, {
      amountMinor: '60000', currency: 'INR', method: 'upi', reference: `UPI-${Date.now()}`,
      receivedAt: new Date().toISOString(), idempotencyKey: `pay2-${Date.now()}`,
    });
    expect(settling.status).toBe('paid');
    expect(settling.outstandingMinor).toBe('0');

    // THE BOUNCED CHEQUE: reversing the second payment must reopen a PAID invoice — impossible through the
    // operator transition table, which is exactly why the reconciliation table exists.
    const list = await paymentSvc.list(payInvoiceId);
    const second = (list.payments as any[]).find((x) => x.method === 'upi');
    const reversed: any = await paymentSvc.reverse(actor, second.id, { reason: 'cheque bounced in itest' });
    expect(reversed.status).toBe('partially_paid');
    expect(reversed.paidMinor).toBe('40000');
    expect(reversed.outstandingMinor).toBe('60000');

    const after = await inspect.query(`SELECT status, paid_minor::text AS paid FROM saas_invoices WHERE id=$1`, [payInvoiceId]);
    expect(after.rows[0].status).toBe('partially_paid');
    expect(after.rows[0].paid).toBe('40000');               // the denormalised sum tracked the reversal
  });
});
