// apps/admin-api/src/modules/billing-ops/__tests__/billing-ops.spec.ts · unit tests (pure/mocked). Covers: the
// invoice state machine + entity; dunning rules; the manual-adjustment money domain (bigint minor units, balanced
// zero-sum legs, cap); float-free revenue math; owner-RBAC for the billing roles + the NO-privilege-escalation
// property (Law 11); DTO validation; and the services proving every write audits IN-TX, the state machine is
// enforced, a missing invoice/tenant is a 404, money moves ONLY via the wallet-service (mocked port), the
// adjustment is MAKER-CHECKER (PC-56 ADMIN-1b): a request moves no money, the requester cannot decide their own
// request, applying is a separate act keyed by the ROW id, and a wallet failure leaves the row approved — never
// half-applied.
import { SaasInvoice } from '../domain/invoice.entity';
import { canTransition, assertTransition, IllegalInvoiceTransitionError, INVOICE_STATUSES } from '../domain/invoice.state';
import { isDunnable, nextDunningAttempt, MAX_DUNNING_ATTEMPTS } from '../domain/dunning';
import { assertAdjustmentAmount, buildAdjustmentLegs, MAX_ADJUSTMENT_MINOR } from '../domain/adjustment';
import { monthlyMinor, arrMinor, sumMrr } from '../domain/revenue';
import {
  InvalidAdjustmentError, InvalidDunningError, SaasInvoiceNotFoundError, BillingTenantNotFoundError,
  WalletAdjustmentFailedError, AdjustmentStateError, SelfApprovalError,
} from '../domain/billing-ops.errors';
import { SaasInvoicesAdminService } from '../services/saas-invoices-admin.service';
import { DunningService } from '../services/dunning.service';
import { ManualAdjustmentService } from '../services/manual-adjustment.service';
import { ApplyAdjustmentSchema, UpdateInvoiceSchema, RecordDunningSchema, QueryInvoicesSchema } from '../dto/billing-ops.dto';
import { resolveOwnerPermissions, hasOwnerPermission, OwnerPermissions } from '../../../core/rbac/owner-roles';

const TENANT = '11111111-1111-1111-1111-111111111111';
const actor = { userId: 'admin1', roles: ['platform_billing_ops'], ip: '10.0.0.1', requestId: 'req1' } as any;

const invoice = (status: any, dunningAttempts = 0) => SaasInvoice.rehydrate({
  id: 'inv1', tenantId: TENANT, subscriptionId: null, invoiceNo: 'KV-INV-1', status, currencyCode: 'INR',
  subtotalMinor: 100000n, taxMinor: 18000n, totalMinor: 118000n, dueDate: '2026-06-01', paidAt: null,
  dunningAttempts, lastDunnedAt: null, createdAt: new Date('2026-05-01T00:00:00Z'),
});

describe('invoice state machine', () => {
  it('draft→issued→overdue/paid/void; paid+void terminal', () => {
    expect(canTransition('draft', 'issued')).toBe(true);
    expect(canTransition('issued', 'overdue')).toBe(true);
    expect(canTransition('overdue', 'paid')).toBe(true);
    expect(canTransition('paid', 'issued')).toBe(false);
    expect(canTransition('void', 'issued')).toBe(false);
    expect(() => assertTransition('paid', 'void')).toThrow(IllegalInvoiceTransitionError);
  });
  it('covers all statuses', () => { expect(INVOICE_STATUSES.length).toBe(6); });
});

describe('SaasInvoice entity', () => {
  it('issue/markOverdue/void stamp transitions; illegal throws', () => {
    const i = invoice('draft');
    expect(i.issue()).toEqual({ from: 'draft', to: 'issued' });
    expect(i.markOverdue()).toEqual({ from: 'issued', to: 'overdue' });
    expect(() => invoice('paid').void()).toThrow(IllegalInvoiceTransitionError);
  });
  it('toJSON surfaces money as strings (never float)', () => {
    const j = invoice('issued').toJSON();
    expect(j.totalMinor).toBe('118000');
    expect(typeof j.totalMinor).toBe('string');
  });
});

describe('dunning rules', () => {
  it('only issued/partially_paid/overdue are dunnable', () => {
    expect(isDunnable('issued')).toBe(true);
    expect(isDunnable('overdue')).toBe(true);
    expect(isDunnable('draft')).toBe(false);
    expect(isDunnable('paid')).toBe(false);
  });
  it('nextDunningAttempt increments; rejects non-dunnable + past the cap', () => {
    expect(nextDunningAttempt('issued', 0)).toBe(1);
    expect(() => nextDunningAttempt('paid', 0)).toThrow(InvalidDunningError);
    expect(() => nextDunningAttempt('overdue', MAX_DUNNING_ATTEMPTS)).toThrow(InvalidDunningError);
  });
});

describe('manual-adjustment money domain', () => {
  it('amount must be positive minor units within the cap', () => {
    expect(assertAdjustmentAmount(100n)).toBe(100n);
    expect(() => assertAdjustmentAmount(0n)).toThrow(InvalidAdjustmentError);
    expect(() => assertAdjustmentAmount(-5n)).toThrow(InvalidAdjustmentError);
    expect(() => assertAdjustmentAmount(MAX_ADJUSTMENT_MINOR + 1n)).toThrow(InvalidAdjustmentError);
  });
  it('credit legs: +tenant.main / −platform.promo_liability, summing to ZERO', () => {
    const legs = buildAdjustmentLegs(TENANT, 'credit', 50000n);
    expect(legs.find((l) => l.ownerKind === 'tenant')).toMatchObject({ accountCode: 'main', amountMinor: 50000n, ownerId: TENANT });
    expect(legs.find((l) => l.ownerKind === 'platform')).toMatchObject({ accountCode: 'promo_liability', amountMinor: -50000n });
    expect(legs.reduce((s, l) => s + l.amountMinor, 0n)).toBe(0n);
  });
  it('debit legs mirror the credit (tenant debited), still zero-sum', () => {
    const legs = buildAdjustmentLegs(TENANT, 'debit', 50000n);
    expect(legs.find((l) => l.ownerKind === 'tenant')!.amountMinor).toBe(-50000n);
    expect(legs.reduce((s, l) => s + l.amountMinor, 0n)).toBe(0n);
  });
});

describe('revenue math (float-free)', () => {
  it('annual normalises to monthly via integer division; monthly passes through', () => {
    expect(monthlyMinor('annual', 1200000n)).toBe(100000n);
    expect(monthlyMinor('monthly', 99900n)).toBe(99900n);
    expect(monthlyMinor('annual', 100n)).toBe(8n);   // floor, never a float
  });
  it('arr = mrr × 12; sumMrr aggregates', () => {
    expect(arrMinor(100000n)).toBe(1200000n);
    expect(sumMrr([{ cycle: 'monthly', priceMinor: 100000n }, { cycle: 'annual', priceMinor: 1200000n }])).toBe(200000n);
  });
});

describe('owner roles for billing', () => {
  it('platform_billing_ops manage+read; viewer read-only; tenant roles NOTHING; no cross-perm', () => {
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_billing_ops']), OwnerPermissions.BillingManage)).toBe(true);
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_billing_viewer']), OwnerPermissions.BillingManage)).toBe(false);
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_billing_viewer']), OwnerPermissions.BillingRead)).toBe(true);
    expect(hasOwnerPermission(resolveOwnerPermissions(['tenant_admin']), OwnerPermissions.BillingManage)).toBe(false);
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_billing_ops']), OwnerPermissions.ReconManage)).toBe(false);
  });
});

describe('dto validation', () => {
  it('apply-adjustment: positive minor-unit string + uuid tenant; rejects float/negative/unknown keys', () => {
    const ok = { tenantId: TENANT, direction: 'credit', amountMinor: '50000', currency: 'INR', reason: 'goodwill credit', idempotencyKey: 'adj-2026-0001' };
    expect(ApplyAdjustmentSchema.safeParse(ok).success).toBe(true);
    expect(ApplyAdjustmentSchema.safeParse({ ...ok, amountMinor: '50.5' }).success).toBe(false);   // no float
    expect(ApplyAdjustmentSchema.safeParse({ ...ok, amountMinor: '-5' }).success).toBe(false);
    expect(ApplyAdjustmentSchema.safeParse({ ...ok, tenantId: 'nope' }).success).toBe(false);
    expect(ApplyAdjustmentSchema.safeParse({ ...ok, evil: 1 }).success).toBe(false);               // .strict
  });
  it('invoice update + dunning enums; query clamps limit', () => {
    expect(UpdateInvoiceSchema.safeParse({ action: 'void', reason: 'duplicate invoice' }).success).toBe(true);
    expect(UpdateInvoiceSchema.safeParse({ action: 'mark_paid', reason: 'x' }).success).toBe(false);
    expect(RecordDunningSchema.safeParse({ channel: 'sms' }).success).toBe(true);
    expect(RecordDunningSchema.safeParse({ channel: 'pigeon' }).success).toBe(false);
    expect(QueryInvoicesSchema.safeParse({ limit: 999 }).success).toBe(false);
  });
});

function harness() {
  const client = { __c: true };
  const pool = { withTx: async (fn: any) => fn(client) } as any;
  const audit = { write: jest.fn(async () => undefined), log: jest.fn(async () => undefined) } as any;
  return { client, pool, audit };
}

describe('SaasInvoicesAdminService', () => {
  it('get: 404 when missing', async () => {
    const { pool, audit } = harness();
    const repo = { getInvoice: jest.fn(async () => null) } as any;
    await expect(new SaasInvoicesAdminService(pool, audit, repo).get('inv1')).rejects.toBeInstanceOf(SaasInvoiceNotFoundError);
  });
  it('update: void audits old→new in-tx', async () => {
    const { pool, audit, client } = harness();
    const repo = { getInvoiceForUpdate: jest.fn(async () => invoice('issued')), updateInvoiceStatus: jest.fn() } as any;
    await new SaasInvoicesAdminService(pool, audit, repo).update(actor, 'inv1', { action: 'void', reason: 'duplicate' });
    expect(repo.updateInvoiceStatus).toHaveBeenCalledWith(client, 'inv1', 'void', 'admin1');
    expect(audit.write).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'billing.invoice_void', oldValue: { status: 'issued' } }));
  });
  it('update: illegal transition throws + audits nothing', async () => {
    const { pool, audit } = harness();
    const repo = { getInvoiceForUpdate: jest.fn(async () => invoice('paid')), updateInvoiceStatus: jest.fn() } as any;
    await expect(new SaasInvoicesAdminService(pool, audit, repo).update(actor, 'inv1', { action: 'issue', reason: 'x' })).rejects.toBeInstanceOf(IllegalInvoiceTransitionError);
    expect(audit.write).not.toHaveBeenCalled();
  });
});

describe('DunningService', () => {
  it('404 when invoice missing', async () => {
    const { pool, audit } = harness();
    const repo = { getInvoiceForUpdate: jest.fn(async () => null) } as any;
    await expect(new DunningService(pool, audit, repo).record(actor, 'inv1', { channel: 'sms', outcome: 'sent' })).rejects.toBeInstanceOf(SaasInvoiceNotFoundError);
  });
  it('records attempt + bumps counter + audits in-tx', async () => {
    const { pool, audit, client } = harness();
    const repo = { getInvoiceForUpdate: jest.fn(async () => invoice('overdue', 2)), insertDunningAttempt: jest.fn(), bumpInvoiceDunning: jest.fn() } as any;
    const out: any = await new DunningService(pool, audit, repo).record(actor, 'inv1', { channel: 'call', outcome: 'promised_pay' });
    expect(out.attemptNo).toBe(3);
    expect(repo.bumpInvoiceDunning).toHaveBeenCalledWith(client, 'inv1', 3);
    expect(audit.write).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'billing.invoice_dunned' }));
  });
  it('non-dunnable invoice throws + writes nothing', async () => {
    const { pool, audit } = harness();
    const repo = { getInvoiceForUpdate: jest.fn(async () => invoice('paid')), insertDunningAttempt: jest.fn(), bumpInvoiceDunning: jest.fn() } as any;
    await expect(new DunningService(pool, audit, repo).record(actor, 'inv1', { channel: 'sms', outcome: 'sent' })).rejects.toBeInstanceOf(InvalidDunningError);
    expect(repo.insertDunningAttempt).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });
});

describe('ManualAdjustmentService — MAKER-CHECKER (PC-56 ADMIN-1b, 0093)', () => {
  const req = { tenantId: TENANT, direction: 'credit' as const, amountMinor: '50000', currency: 'INR', reason: 'goodwill' };
  const MAKER = actor.userId;
  const checker = { ...actor, userId: '00000000-0000-4000-8000-0000000000cc' };

  it('REQUEST moves no money: the wallet is never called and the row is awaiting_approval', async () => {
    const { pool, audit, client } = harness();
    const repo = {
      tenantExists: jest.fn(async () => true),
      insertAdjustmentRequest: jest.fn(async () => ({ id: 'a1', status: 'awaiting_approval', requestedBy: MAKER })),
    } as any;
    const wallet = { post: jest.fn() } as any;
    const out: any = await new ManualAdjustmentService(pool, audit, repo, wallet).request(actor, req);
    expect(out.status).toBe('awaiting_approval');
    expect(wallet.post).not.toHaveBeenCalled();                       // the whole point: a request is not a payment
    expect(repo.insertAdjustmentRequest).toHaveBeenCalledWith(client, expect.objectContaining({ amountMinor: 50000n, requestedBy: MAKER }));
    expect(audit.write).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'billing.adjustment_requested' }));
  });

  it('404 when the tenant does not exist — nothing is written', async () => {
    const { pool, audit } = harness();
    const repo = { tenantExists: jest.fn(async () => false), insertAdjustmentRequest: jest.fn() } as any;
    await expect(new ManualAdjustmentService(pool, audit, repo, { post: jest.fn() } as any).request(actor, req))
      .rejects.toBeInstanceOf(BillingTenantNotFoundError);
    expect(repo.insertAdjustmentRequest).not.toHaveBeenCalled();
  });

  it('REFUSES SELF-APPROVAL — the requester cannot decide their own request', async () => {
    const { pool, audit } = harness();
    const repo = {
      getAdjustmentForUpdate: jest.fn(async () => ({ id: 'a1', status: 'awaiting_approval', requestedBy: MAKER })),
      decideAdjustment: jest.fn(),
    } as any;
    await expect(new ManualAdjustmentService(pool, audit, repo, { post: jest.fn() } as any).decide(actor, 'a1', { decision: 'approve' }))
      .rejects.toBeInstanceOf(SelfApprovalError);
    expect(repo.decideAdjustment).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('a second operator may approve, and the decision is audited in-tx', async () => {
    const { pool, audit, client } = harness();
    const repo = {
      getAdjustmentForUpdate: jest.fn(async () => ({ id: 'a1', status: 'awaiting_approval', requestedBy: MAKER, amountMinor: '50000', direction: 'credit' })),
      decideAdjustment: jest.fn(),
    } as any;
    const out: any = await new ManualAdjustmentService(pool, audit, repo, { post: jest.fn() } as any).decide(checker, 'a1', { decision: 'approve' });
    expect(out.status).toBe('approved');
    expect(repo.decideAdjustment).toHaveBeenCalledWith(client, 'a1', 'approved', checker.userId, null);
    expect(audit.write).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'billing.adjustment_approved' }));
  });

  it('only an awaiting_approval request can be decided', async () => {
    const { pool, audit } = harness();
    const repo = { getAdjustmentForUpdate: jest.fn(async () => ({ id: 'a1', status: 'applied', requestedBy: MAKER })), decideAdjustment: jest.fn() } as any;
    await expect(new ManualAdjustmentService(pool, audit, repo, { post: jest.fn() } as any).decide(checker, 'a1', { decision: 'approve' }))
      .rejects.toBeInstanceOf(AdjustmentStateError);
  });

  it('APPLY refuses anything that is not approved — the wallet is never called', async () => {
    const { pool, audit } = harness();
    const repo = { getAdjustmentForUpdate: jest.fn(async () => ({ id: 'a1', status: 'awaiting_approval', requestedBy: MAKER })) } as any;
    const wallet = { post: jest.fn() } as any;
    await expect(new ManualAdjustmentService(pool, audit, repo, wallet).apply(checker, 'a1')).rejects.toBeInstanceOf(AdjustmentStateError);
    expect(wallet.post).not.toHaveBeenCalled();
  });

  it('APPLY posts BALANCED bigint legs, keys the post by the ROW id, then stamps + audits in-tx', async () => {
    const { pool, audit, client } = harness();
    const row = { id: 'a1', status: 'approved', requestedBy: MAKER, tenantId: TENANT, direction: 'credit', amountMinor: '50000', currency: 'INR', reason: 'goodwill' };
    const repo = { getAdjustmentForUpdate: jest.fn(async () => row), markAdjustmentApplied: jest.fn() } as any;
    const wallet = { post: jest.fn(async () => ({ txnId: 't9', alreadyApplied: false })) } as any;
    const out: any = await new ManualAdjustmentService(pool, audit, repo, wallet).apply(checker, 'a1');
    const arg = wallet.post.mock.calls[0][0];
    expect(arg.txnType).toBe('billing_adjustment');
    // keyed by the ROW, not by a client-supplied string: a resubmitted, corrected adjustment is a different row and
    // therefore a different key — it can never be swallowed as a replay of the one that was rejected.
    expect(arg.idempotencyKey).toBe(`billing_adjustment:${TENANT}:a1`);
    expect(arg.legs.reduce((s: bigint, l: any) => s + l.amountMinor, 0n)).toBe(0n);   // zero-sum
    expect(arg.legs.every((l: any) => typeof l.amountMinor === 'bigint')).toBe(true); // never float
    expect(repo.markAdjustmentApplied).toHaveBeenCalledWith(client, 'a1', 't9', `billing_adjustment:${TENANT}:a1`, checker.userId);
    expect(audit.write).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'billing.adjustment_applied' }));
    expect(out.status).toBe('applied');
  });

  it('APPLY is idempotent: an already-applied row is returned without a second wallet post', async () => {
    const { pool, audit } = harness();
    const repo = { getAdjustmentForUpdate: jest.fn(async () => ({ id: 'a1', status: 'applied', walletTxnId: 't9' })), markAdjustmentApplied: jest.fn() } as any;
    const wallet = { post: jest.fn() } as any;
    const out: any = await new ManualAdjustmentService(pool, audit, repo, wallet).apply(checker, 'a1');
    expect(out.walletTxnId).toBe('t9');
    expect(wallet.post).not.toHaveBeenCalled();
    expect(repo.markAdjustmentApplied).not.toHaveBeenCalled();
  });

  it('a wallet failure leaves the row APPROVED (never half-applied) + audits the failure', async () => {
    const { pool, audit } = harness();
    const row = { id: 'a1', status: 'approved', requestedBy: MAKER, tenantId: TENANT, direction: 'credit', amountMinor: '50000', currency: 'INR', reason: 'goodwill' };
    const repo = { getAdjustmentForUpdate: jest.fn(async () => row), markAdjustmentApplied: jest.fn() } as any;
    const wallet = { post: jest.fn(async () => { throw new Error('insufficient balance'); }) } as any;
    await expect(new ManualAdjustmentService(pool, audit, repo, wallet).apply(checker, 'a1')).rejects.toBeInstanceOf(WalletAdjustmentFailedError);
    expect(repo.markAdjustmentApplied).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'billing.adjustment_failed' }));
  });
});
