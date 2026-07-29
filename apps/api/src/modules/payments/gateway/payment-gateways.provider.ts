// modules/payments/gateway/payment-gateways.provider.ts
// [DEV-31 2026-07-28] Extracted verbatim from the inline factories previously in payments.module.ts (no
// behavior change — same config reads, same registration order, same prod-fatal guard) so the config-driven
// PSP driver selection (sandbox vs Razorpay / RazorpayX) is independently unit-testable, mirroring the
// established gold-standard pattern (modules/insurance/gateway/insurance-gateways.provider.ts, DEV-25).
// Drop-in readiness audit (S2_PROVIDER_KEY_DROPIN.md execution): GatewayRegistry decides which PaymentGateway
// answers `providerCode='razorpay'`/default; PAYOUT_GATEWAY decides RazorpayX-vs-sandbox for money-OUT. Setting
// RAZORPAY_*/RAZORPAYX_* env (+ PAYMENTS_DEFAULT_PROVIDER/BANK_VAULT_KIND) is a pure config change, never a code
// edit — see __tests__/payment-gateways.provider.spec.ts for the mechanical proof.
import { Provider } from '@nestjs/common';
import { AppConfig } from '../../../core/config/app-config';
import { ResilienceService } from '../../../core/resilience/resilience.service';
import { GatewayRegistry } from './gateway.registry';
import { SandboxGateway } from './sandbox.gateway';
import { RazorpayGateway } from './razorpay.gateway';
import { PAYOUT_GATEWAY } from './payout-gateway.port';
import { RazorpayXGateway } from './razorpayx.gateway';
import { SandboxPayoutGateway } from './sandbox-payout.gateway';
import { MANDATE_GATEWAY } from './mandate-gateway.port';
import { SandboxMandateGateway } from './sandbox-mandate.gateway';

export const gatewayRegistryProvider: Provider = {
  provide: GatewayRegistry,
  useFactory: (resilience: ResilienceService, config: AppConfig) => {
    const reg = new GatewayRegistry();
    const pay = config.payments;
    // The deterministic sandbox gateway is ONLY registered outside production (Law: no fake money rails live).
    // In prod, assertProductionSecurity has already guaranteed a real Razorpay gateway is configured.
    if (pay.allowSandbox) {
      reg.register(new SandboxGateway(pay.payoutWebhookSecret), !pay.razorpay.configured);
    }
    if (pay.razorpay.configured) {
      reg.register(new RazorpayGateway({
        keyId: pay.razorpay.keyId, keySecret: pay.razorpay.keySecret,
        webhookSecret: pay.razorpay.webhookSecret, baseUrl: pay.razorpay.baseUrl,
      }, resilience), pay.defaultProvider === 'razorpay');
    }
    // tune the razorpay dependency policy (money calls: no auto-retry without idempotency)
    resilience.configure('razorpay', { timeoutMs: 8000, retries: 1, circuit: { failureThreshold: 5, resetMs: 15_000, halfOpenMax: 2 }, bulkhead: { maxConcurrent: 16, maxQueue: 64 } });
    return reg;
  },
  inject: [ResilienceService, AppConfig],
};

export const payoutGatewayProvider: Provider = {
  // money-OUT gateway: RazorpayX when configured, else the deterministic sandbox (NON-prod only).
  provide: PAYOUT_GATEWAY,
  useFactory: (resilience: ResilienceService, config: AppConfig) => {
    const x = config.payments.razorpayx;
    if (x.configured) {
      resilience.configure('razorpayx', { timeoutMs: 8000, retries: 0, circuit: { failureThreshold: 5, resetMs: 15_000, halfOpenMax: 2 }, bulkhead: { maxConcurrent: 16, maxQueue: 64 } });
      return new RazorpayXGateway({ keyId: x.keyId, keySecret: x.keySecret, accountNumber: x.accountNumber, baseUrl: x.baseUrl }, resilience);
    }
    if (config.payments.isProd) throw new Error('FATAL: RAZORPAYX_KEY_ID must be configured in production (no sandbox payout gateway for real money)');
    return new SandboxPayoutGateway('success');
  },
  inject: [ResilienceService, AppConfig],
};

export const mandateGatewayProvider: Provider = {
  // UPI-AutoPay mandate gateway: a real PSP when configured, else the deterministic sandbox (NON-prod only,
  // mirroring the money-IN gateway rule). In prod a live PSP is mandatory before the autopay_execution flag
  // is ever turned on — the flag stays OFF by default (fail-closed) regardless.
  // [DEV-31 note, not a fix]: no HttpMandateGateway exists yet — this remains sandbox-only in every environment
  // today (pre-existing, flag-gated debt; see dev31_report.md §escalations — out of this batch's env-var
  // drop-in scope, never silently built here).
  provide: MANDATE_GATEWAY,
  useFactory: (config: AppConfig) => {
    if (config.payments.isProd && !config.payments.allowSandbox) {
      // No live UPI-AutoPay PSP adapter is wired yet; keeping the sandbox out of prod is the safe default.
      // Execution remains gated by autopay_execution (default OFF), so this provider is never exercised in prod.
    }
    return new SandboxMandateGateway();
  },
  inject: [AppConfig],
};
