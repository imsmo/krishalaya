// modules/insurance/insurance.module.ts
// Agri-Insurance (PRD M19, KV-BL-051/052/053/054): farmers/pashupalak/dairy_farmer/vyapari browse
// IRDAI-gated insurer + product catalogue, ENROL (crop/livestock/health+life — screens 283-285) creating
// policies in 'proposed' state, may CANCEL before activation, PAY the premium (DEV-23/KV-BL-053, screen 288)
// to ACTIVATE the policy, and FILE/track CLAIMS through to settlement (DEV-23/KV-BL-054, screens 289-293).
// Boundary rule (Law 11): other modules depend on the SERVICES exported here, never on repositories. Core
// infra (UnitOfWork, OutboxWriter, Idempotency, Quota, Metrics) is provided by CoreModule (global) and
// injected by token, same convention as listings/fintech.
//
// SCOPE (DEV-22, Wave 1-2 / KV-BL-051/052): partner + product browse, policy propose/cancel/get/list.
// SCOPE (DEV-23, Wave 3-4 / KV-BL-053/054, this build): premium collection VIA the existing payments module
// (initiatePremiumPayment() -> payments.createIntent -> gateway webhook -> payments.payment_succeeded ->
// PremiumPaymentSucceededHandler -> InsurancePolicy.activate(), never new capture/gateway code); claims
// file->evidence->docs->survey->decision->settle->close (InsuranceClaimService/Controller), settlement
// credits the claimant's wallet via the EXISTING WALLET_SERVICE port (see spec_dev23.md's money-path
// boundary statements for the payments/payouts-module gaps this batch records rather than invents around).
// DEFERRED (schema exists, waves 5+ / DEV-24+): worker PMSBY mobile flow + partner console UI (KV-BL-055/056,
// this batch ships the claims API only, no console screens), external integrations (KV-BL-057).
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { FintechModule } from '../fintech/fintech.module';
import { PaymentsModule } from '../payments/payments.module';

import { InsuranceProductsController } from './controllers/v1/insurance-products.controller';
import { InsurancePoliciesController } from './controllers/v1/insurance-policies.controller';
import { InsuranceClaimsController } from './controllers/v1/insurance-claims.controller';

import { InsuranceProductService } from './services/insurance-product.service';
import { InsurancePolicyService } from './services/insurance-policy.service';
import { InsuranceClaimService } from './services/insurance-claim.service';

import { InsuranceProductRepository } from './repositories/insurance-product.repository';
import { InsurancePolicyRepository } from './repositories/insurance-policy.repository';
import { InsuranceClaimRepository } from './repositories/insurance-claim.repository';

import { PremiumPaymentSucceededHandler } from './events/handlers/premium-payment-succeeded.handler';

@Module({
  imports: [
    FintechModule,   // for FinancialPartnerService — IRDAI-partner gating reuses the shared global table (Law 11)
    PaymentsModule,  // for PaymentService — premium collection rides the existing payment-intent chain (Law 11)
  ],
  controllers: [InsuranceProductsController, InsurancePoliciesController, InsuranceClaimsController],
  providers: [
    InsuranceProductService, InsurancePolicyService, InsuranceClaimService,
    InsuranceProductRepository, InsurancePolicyRepository, InsuranceClaimRepository,
    PremiumPaymentSucceededHandler,
  ],
  exports: [InsuranceProductService, InsurancePolicyService, InsuranceClaimService],
})
export class InsuranceModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    private readonly premiumPaymentSucceeded: PremiumPaymentSucceededHandler,
  ) {}
  // activate a 'proposed' policy -> 'active' once its premium payment settles (payments.payment_succeeded)
  onModuleInit(): void { this.registry.register(this.premiumPaymentSucceeded); }
}
