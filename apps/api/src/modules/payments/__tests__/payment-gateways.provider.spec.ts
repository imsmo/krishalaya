// modules/payments/__tests__/payment-gateways.provider.spec.ts · [DEV-31] MECHANICAL PROOF for the
// Razorpay/RazorpayX drop-in. Proves the actual DI factories (not a hand-rolled re-implementation) flip driver
// purely on config: RAZORPAY_KEY_ID set → GatewayRegistry registers RazorpayGateway (default when
// PAYMENTS_DEFAULT_PROVIDER=razorpay); RAZORPAYX_KEY_ID set → PAYOUT_GATEWAY resolves to RazorpayXGateway; unset
// → the deterministic sandbox in non-prod, and PAYOUT_GATEWAY throws in prod (fail-closed — Law: no fake money
// rail live). Also proves the HTTP wiring shape (baseUrl + Basic-auth header) for both gateways with
// placeholder-shaped, non-credential test values (contract §7). Mirrors the gold-standard pattern already
// shipped for the insurance gateways (DEV-25, modules/insurance/__tests__/insurance-gateways.spec.ts).
import { createHmac } from 'node:crypto';
import { gatewayRegistryProvider, payoutGatewayProvider, mandateGatewayProvider } from '../gateway/payment-gateways.provider';
import { GatewayRegistry } from '../gateway/gateway.registry';
import { RazorpayGateway } from '../gateway/razorpay.gateway';
import { SandboxGateway } from '../gateway/sandbox.gateway';
import { RazorpayXGateway } from '../gateway/razorpayx.gateway';
import { SandboxPayoutGateway } from '../gateway/sandbox-payout.gateway';
import { SandboxMandateGateway } from '../gateway/sandbox-mandate.gateway';

const fakeResilience = () => ({ run: (_d: string, fn: () => Promise<unknown>) => fn(), configure: () => {} }) as any;

function fakePaymentsConfig(overrides: Partial<{
  isProd: boolean; allowSandbox: boolean; defaultProvider: string;
  razorpayConfigured: boolean; razorpayxConfigured: boolean;
}> = {}) {
  const isProd = overrides.isProd ?? false;
  return {
    payments: {
      isProd,
      allowSandbox: overrides.allowSandbox ?? !isProd,
      defaultProvider: overrides.defaultProvider ?? 'sandbox',
      payoutWebhookSecret: 'test-payout-webhook-secret-unset',
      razorpay: {
        keyId: overrides.razorpayConfigured ? 'test-rzp-keyid-unset' : '',
        keySecret: overrides.razorpayConfigured ? 'test-rzp-keysecret-unset' : '',
        webhookSecret: 'test-rzp-webhook-secret-unset',
        baseUrl: 'https://razorpay.example.test',
        configured: !!overrides.razorpayConfigured,
      },
      razorpayx: {
        keyId: overrides.razorpayxConfigured ? 'test-rzpx-keyid-unset' : '',
        keySecret: overrides.razorpayxConfigured ? 'test-rzpx-keysecret-unset' : '',
        accountNumber: 'test-account-number-unset',
        baseUrl: 'https://razorpayx.example.test',
        webhookSecret: 'test-rzpx-webhook-secret-unset',
        configured: !!overrides.razorpayxConfigured,
      },
    },
  } as any;
}

describe('gatewayRegistryProvider (pay-in: sandbox vs Razorpay, config-driven)', () => {
  it('non-prod + Razorpay not configured: only sandbox registered, sandbox is default', async () => {
    const reg: GatewayRegistry = await (gatewayRegistryProvider as any).useFactory(fakeResilience(), fakePaymentsConfig());
    expect(reg.has('sandbox')).toBe(true);
    expect(reg.has('razorpay')).toBe(false);
    expect(reg.default()).toBeInstanceOf(SandboxGateway);
  });

  it('non-prod + Razorpay configured + PAYMENTS_DEFAULT_PROVIDER=razorpay: both registered, Razorpay is default', async () => {
    const config = fakePaymentsConfig({ razorpayConfigured: true, defaultProvider: 'razorpay' });
    const reg: GatewayRegistry = await (gatewayRegistryProvider as any).useFactory(fakeResilience(), config);
    expect(reg.has('sandbox')).toBe(true);
    expect(reg.has('razorpay')).toBe(true);
    expect(reg.default()).toBeInstanceOf(RazorpayGateway);
    expect(reg.default().providerCode).toBe('razorpay');
  });

  it('prod + Razorpay configured: sandbox is NEVER registered (Law: no fake money rail live)', async () => {
    const config = fakePaymentsConfig({ isProd: true, allowSandbox: false, razorpayConfigured: true, defaultProvider: 'razorpay' });
    const reg: GatewayRegistry = await (gatewayRegistryProvider as any).useFactory(fakeResilience(), config);
    expect(reg.has('sandbox')).toBe(false);
    expect(reg.default()).toBeInstanceOf(RazorpayGateway);
  });

  it('the Razorpay adapter wires baseUrl + Basic-auth header shape correctly (createOrder)', async () => {
    const config = fakePaymentsConfig({ razorpayConfigured: true, defaultProvider: 'razorpay' });
    const reg: GatewayRegistry = await (gatewayRegistryProvider as any).useFactory(fakeResilience(), config);
    const gw = reg.get('razorpay');
    let captured: { url: string; headers: any } | null = null;
    global.fetch = (async (url: string, init: any) => { captured = { url, headers: init.headers }; return { ok: true, status: 200, json: async () => ({ id: 'order_1' }) }; }) as any;
    await gw.createOrder({ amountMinor: 10000n, currencyCode: 'INR', receipt: 'r1' });
    expect(captured!.url).toBe('https://razorpay.example.test/v1/orders');
    expect(captured!.headers.authorization).toBe('Basic ' + Buffer.from('test-rzp-keyid-unset:test-rzp-keysecret-unset').toString('base64'));
    delete (global as any).fetch;
  });

  it('webhook HMAC path: a self-computed signature over a fixture payload (placeholder secret) verifies; a forged one is rejected', async () => {
    const config = fakePaymentsConfig({ razorpayConfigured: true, defaultProvider: 'razorpay' });
    const reg: GatewayRegistry = await (gatewayRegistryProvider as any).useFactory(fakeResilience(), config);
    const gw = reg.get('razorpay');
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 10000, currency: 'INR', notes: { tenant_id: 't1' } } } } });
    const goodSig = createHmac('sha256', 'test-rzp-webhook-secret-unset').update(body).digest('hex');
    expect(gw.verifySignature(body, goodSig)).toBe(true);
    expect(gw.verifySignature(body, 'forged-signature-deadbeef')).toBe(false);
  });
});

describe('payoutGatewayProvider (money-OUT: sandbox vs RazorpayX, config-driven)', () => {
  it('RAZORPAYX_KEY_ID configured: resolves to RazorpayXGateway wired to baseUrl/account/Basic-auth', async () => {
    const config = fakePaymentsConfig({ razorpayxConfigured: true });
    const gw = await (payoutGatewayProvider as any).useFactory(fakeResilience(), config);
    expect(gw).toBeInstanceOf(RazorpayXGateway);

    let captured: { url: string; headers: any; body: string } | null = null;
    global.fetch = (async (url: string, init: any) => { captured = { url, headers: init.headers, body: init.body }; return { ok: true, status: 200, json: async () => ({ id: 'pout_1' }) }; }) as any;
    await gw.createPayout({ idempotencyKey: 'idem-1', amountMinor: 5000n, currencyCode: 'INR', fundAccountRef: 'fa_1' });
    expect(captured!.url).toBe('https://razorpayx.example.test/v1/payouts');
    expect(captured!.headers.authorization).toBe('Basic ' + Buffer.from('test-rzpx-keyid-unset:test-rzpx-keysecret-unset').toString('base64'));
    expect(captured!.headers['x-payout-idempotency']).toBe('idem-1');
    expect(JSON.parse(captured!.body).account_number).toBe('test-account-number-unset');
    delete (global as any).fetch;
  });

  it('unset in non-prod: honest degrade to the deterministic SandboxPayoutGateway (never a fabricated payout)', async () => {
    const gw = await (payoutGatewayProvider as any).useFactory(fakeResilience(), fakePaymentsConfig());
    expect(gw).toBeInstanceOf(SandboxPayoutGateway);
  });

  it('unset in production: FAILS CLOSED (throws synchronously) — no sandbox payout gateway may ever run live', () => {
    const config = fakePaymentsConfig({ isProd: true, allowSandbox: false });
    expect(() => (payoutGatewayProvider as any).useFactory(fakeResilience(), config)).toThrow(/RAZORPAYX_KEY_ID must be configured in production/);
  });
});

describe('mandateGatewayProvider (UPI-AutoPay: no live PSP wired yet — pre-existing, flag-gated debt, not a DEV-31 regression)', () => {
  it('always resolves to SandboxMandateGateway today (autopay_execution stays OFF by default, Law 8)', async () => {
    const gw = await (mandateGatewayProvider as any).useFactory(fakePaymentsConfig());
    expect(gw).toBeInstanceOf(SandboxMandateGateway);
  });
});
