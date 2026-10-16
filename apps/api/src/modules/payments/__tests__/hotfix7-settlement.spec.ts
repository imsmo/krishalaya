// modules/payments/__tests__/hotfix7-settlement.spec.ts · PC-56 HOTFIX-7 — THE ONE SETTLEMENT PLACE FAILS CLOSED ON AN UNFUNDED ESCROW, PRICES IN THE
// ORGANISATION'S COUNTRY, AND THE RESOLUTION REFUND'S KEYS ARE DERIVED, NOT MINTED. Unit (hand-built service, mocked ports):
//   (1) B1 / D1 — `settle` reads the order's funding (kv_app) BEFORE any leg: none → `skipped_unfunded`, NO wallet post, NO settlement line, the
//       metric, the audit `order.settlement_skipped {reason, totalMinor}` on the caller's tx, and the tenant's coupon top-up still runs; a
//       captured payment → the `settle:<orderId>` post exactly as before; a partial COD booking → nothing released (`partially_funded_escrow`);
//       ledger-booked COD cash covering the gross (TENANT-SW-a) → settles;
//   (2) B3 — the country: the payload's (orders carries it), else `tenants.country_code` read as kv_app; neither → SETTLEMENT_COUNTRY_UNKNOWN
//       and no leg; the taxes are asked in THAT country (never a literal);
//   (3) D3 — `dispute-refund:<id>` / `return-refund:<id>` / `-remainder:` / `-clawback:`; the gateway key `gateway-refund:<paymentId>:<referenceId>`
//       fits idempotency_keys.key varchar(120) once scoped; `splitResolution` caps at the gross; `fundingVerdict`.
import { OrderSettlementService } from '../services/order-settlement.service';
import { fundingVerdict, EscrowFunding } from '../repositories/settlement-funding.repository';
import { resolutionRefundKey, resolutionRemainderKey, resolutionClawbackKey, resolutionGatewayRefundKey, RESOLUTION_GATEWAY_ENDPOINT, splitResolution, RESOLUTION_REFUND_TXN_TYPE } from '../domain/resolution-refund';

const T = 't-hf7', O = '0217a000-0000-7000-8000-00000000000a', SELLER = 'seller-1';
const payload = (over: Record<string, unknown> = {}) => ({ sellerUserId: SELLER, buyerUserId: 'buyer-1', totalMinor: '452000', deliveryFeeMinor: '26000', platformFeeMinor: '26000', buyerCommissionMinor: '0', currencyCode: 'INR', source: 'direct', ...over });

function build(o: { funding?: Partial<EscrowFunding>; split?: boolean; country?: string | null } = {}) {
  const posts: Array<{ idempotencyKey: string; legs: Array<{ account: { accountCode: string; kind: string }; amountMinor: bigint }> }> = [];
  const wallet = { post: jest.fn(async (_tx: unknown, i: any) => { posts.push(i); return { txnId: 'txn', alreadyApplied: false }; }), balanceMinor: jest.fn() } as any;
  const flags = { isEnabled: jest.fn(async (k: string) => (k === 'commission_split' ? !!o.split : false)) } as any;
  const snapshot = { v: 1, ruleId: 'rule-1', scope: 'platform', rateBps: 350, fixedMinor: '0', capMinor: null, platformShareBps: 1000, chargedTo: 'seller', resolvedOn: '2026-10-01' };
  const pricing = { frozenForOrder: jest.fn(async () => ({ snapshot, buyerCommissionMinor: 0n, recordedNow: false })),
    quoteFrozen: jest.fn(async () => ({ sellerNetMinor: 380000n, tenantCommissionMinor: 12600n, gstOnCommissionMinor: 2520n, tdsMinor: 4000n, platformShareMinor: 880n, commissionMinor: 14000n - 1400n + 1400n })),
    taxes: jest.fn() } as any;
  const lines = { insert: jest.fn() } as any;
  const holds = { lockOpenTx: jest.fn(async () => []), deferTx: jest.fn() } as any;
  const couponMoney = { settleOrderInTx: jest.fn() } as any;
  const uow = { run: jest.fn((_t: string, fn: (tx: unknown) => Promise<unknown>) => fn({ query: jest.fn() })) } as any;
  const metrics = { inc: jest.fn(), observe: jest.fn() } as any;
  const funding = { escrowFundingTx: jest.fn(async () => ({ capturedPaymentId: null, codLedgerMinor: 0n, emdMinor: 0n, ...o.funding })),
    tenantCountryTx: jest.fn(async () => (o.country === undefined ? 'IN' : o.country)) } as any;
  const audits: any[] = [];
  const audit = { write: jest.fn(async (_tx: unknown, e: unknown) => { audits.push(e); }) } as any;
  const svc = new OrderSettlementService(wallet, flags, pricing, lines, holds, couponMoney, uow, metrics, funding, audit);
  return { svc, posts, wallet, lines, couponMoney, metrics, audits, funding, pricing };
}
const relayTx = { query: jest.fn() } as any;

describe('PC-56 HOTFIX-7 · (1) B1 — settlement fails closed on an unfunded escrow (founder D1)', () => {
  it('a pay-on-delivery completion (no captured payment, no COD cash booked): skipped_unfunded — no wallet post, no line; metric + audit; the coupon top-up still runs', async () => {
    const w = build();
    expect(await w.svc.settle(relayTx, T, O, payload())).toBe('skipped_unfunded');
    expect(w.wallet.post).not.toHaveBeenCalled();
    expect(w.lines.insert).not.toHaveBeenCalled();
    expect(w.metrics.inc).toHaveBeenCalledWith('payments.settlement_skipped_unfunded', { tenant: T, reason: 'unfunded_escrow' });
    expect(w.audits).toEqual([expect.objectContaining({ tenantId: T, actorUserId: null, action: 'order.settlement_skipped', entityType: 'order', entityId: O,
      newValue: expect.objectContaining({ reason: 'unfunded_escrow', totalMinor: '452000' }) })]);
    expect(w.couponMoney.settleOrderInTx).toHaveBeenCalledWith(relayTx, { tenantId: T, orderId: O, sellerUserId: SELLER });
  });
  it('a captured payment funds it: ONE `settle:<orderId>` post, zero-sum, escrow −gross (unchanged); a line is recorded', async () => {
    const w = build({ funding: { capturedPaymentId: 'pay-1' } });
    expect(await w.svc.settle(relayTx, T, O, payload())).toBe('settled');
    expect(w.posts.map((p) => p.idempotencyKey)).toEqual([`settle:${O}`]);
    const legs = w.posts[0].legs;
    expect(legs.reduce((s, l) => s + l.amountMinor, 0n)).toBe(0n);
    expect(legs.find((l) => l.account.accountCode === 'escrow')!.amountMinor).toBe(-452000n);
    expect(w.lines.insert).toHaveBeenCalledTimes(1);
    expect(w.audits).toEqual([]);
  });
  it('COD cash booked on the ledger covering the gross (TENANT-SW-a cod-collect) settles; a partial booking releases NOTHING (partially_funded_escrow)', async () => {
    expect(await build({ funding: { codLedgerMinor: 452000n } }).svc.settle(relayTx, T, O, payload())).toBe('settled');
    const part = build({ funding: { codLedgerMinor: 100000n } });
    expect(await part.svc.settle(relayTx, T, O, payload())).toBe('skipped_unfunded');
    expect(part.wallet.post).not.toHaveBeenCalled();
    expect(part.audits[0].newValue).toMatchObject({ reason: 'partially_funded_escrow', codLedgerMinor: '100000' });
  });
  it('fundingVerdict: a captured payment is funded outright; booked cash + deposit must cover the gross; nothing → unfunded', () => {
    expect(fundingVerdict({ capturedPaymentId: 'p', codLedgerMinor: 0n, emdMinor: 0n }, 5n)).toBe('funded');
    expect(fundingVerdict({ capturedPaymentId: null, codLedgerMinor: 3n, emdMinor: 2n }, 5n)).toBe('funded');
    expect(fundingVerdict({ capturedPaymentId: null, codLedgerMinor: 3n, emdMinor: 1n }, 5n)).toBe('partial');
    expect(fundingVerdict({ capturedPaymentId: null, codLedgerMinor: 0n, emdMinor: 0n }, 5n)).toBe('unfunded');
  });
});

describe('PC-56 HOTFIX-7 · (2) B3 — the organisation\'s country, never a literal', () => {
  it('split ON: the payload\'s country prices the commission (quoteFrozen gets it); the tenant row is not read', async () => {
    const w = build({ funding: { capturedPaymentId: 'p' }, split: true });
    expect(await w.svc.settle(relayTx, T, O, payload({ countryCode: 'NP' }))).toBe('settled');
    expect(w.pricing.quoteFrozen).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ countryCode: 'NP' }));
    expect(w.funding.tenantCountryTx).not.toHaveBeenCalled();
  });
  it('no country in the payload → tenants.country_code (kv_app); none there either → SETTLEMENT_COUNTRY_UNKNOWN, no leg, metric', async () => {
    const w = build({ funding: { capturedPaymentId: 'p' }, split: true, country: 'BD' });
    await w.svc.settle(relayTx, T, O, payload());
    expect(w.pricing.quoteFrozen).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ countryCode: 'BD' }));
    const none = build({ funding: { capturedPaymentId: 'p' }, split: true, country: null });
    await expect(none.svc.settle(relayTx, T, O, payload())).rejects.toMatchObject({ code: 'SETTLEMENT_COUNTRY_UNKNOWN', httpStatus: 503 });
    expect(none.wallet.post).not.toHaveBeenCalled();
    expect(none.metrics.inc).toHaveBeenCalledWith('payments.settlement_country_unknown', { tenant: T, where: 'settle' });
  });
});

describe('PC-56 HOTFIX-7 · (3) D3 — the resolution refund\'s keys (Law 3: derived from the act)', () => {
  const D = '0217d000-0000-7000-8000-000000000001', P = '0217e000-0000-7000-8000-000000000002';
  it('the ledger keys: dispute-refund / return-refund / -remainder / -clawback; the txn type stays `refund`', () => {
    expect(resolutionRefundKey('dispute', D)).toBe(`dispute-refund:${D}`);
    expect(resolutionRefundKey('return', D)).toBe(`return-refund:${D}`);
    expect(resolutionRemainderKey('dispute', D)).toBe(`dispute-remainder:${D}`);
    expect(resolutionClawbackKey('return', D)).toBe(`return-clawback:${D}`);
    expect(RESOLUTION_REFUND_TXN_TYPE).toBe('refund');
  });
  it('a second refund on the same payment asks the gateway under its OWN key; the scoped key fits varchar(120)', () => {
    expect(resolutionGatewayRefundKey(P, D)).toBe(`gateway-refund:${P}:${D}`);
    expect(resolutionGatewayRefundKey(P, D)).not.toBe(resolutionGatewayRefundKey(P, P));
    const scoped = `system::${RESOLUTION_GATEWAY_ENDPOINT}::${resolutionGatewayRefundKey(P, D)}`;   // idempotency.service.pg's scoping
    expect(scoped.length).toBeLessThanOrEqual(120);
  });
  it('splitResolution caps the refund at the gross; the seller keeps the rest', () => {
    expect(splitResolution(100000n, 40000n)).toEqual({ refundMinor: 40000n, remainderMinor: 60000n });
    expect(splitResolution(100000n, 999999n)).toEqual({ refundMinor: 100000n, remainderMinor: 0n });
  });
});
