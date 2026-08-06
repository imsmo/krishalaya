// apps/admin-api/src/modules/billing-ops/billing-ops.module.ts · the god-mode SaaS-BILLING plane (Law 11 + Law
// 2/9). Owns: the SaaS-invoice admin (status transitions), dunning (payment-failure follow-up), the revenue
// dashboard (MRR/ARR/receivables), and MANUAL money adjustments. Money moves ONLY via the wallet-service — bound
// here through the WALLET_ADMIN token to the gRPC client (apps/wallet-service is the sole money writer). Mounts
// under AdminCoreModule (auth/RBAC/FIDO2/step-up/audit are @Global).
import { Module } from '@nestjs/common';
import { AdminConfig } from '../../core/config/admin-config';
import { WALLET_ADMIN } from '../../core/wallet/wallet-admin.port';
import { WalletGrpcAdminClient } from '../../core/wallet/wallet-grpc.client';
import { BillingOpsController } from './billing-ops.controller';
import { BillingRepository } from './repositories/billing.repository';
import { SaasInvoicesAdminService } from './services/saas-invoices-admin.service';
import { DunningService } from './services/dunning.service';
import { ManualAdjustmentService } from './services/manual-adjustment.service';
import { RevenueDashboardService } from './services/revenue-dashboard.service';
import { SubscriptionViewService } from './services/subscription-view.service';
import { InvoicePaymentsService } from './services/invoice-payments.service';
import { DunningPolicyService } from './services/dunning-policy.service';
import { InvoicePdfService } from './services/invoice-pdf.service';
import { SubscriptionWriteService } from './services/subscription-write.service';
import { BillingExportService } from './services/billing-export.service';
import { InvoiceBulkService } from './services/invoice-bulk.service';
import { RevenueSeriesService } from './services/revenue-series.service';
import { RenewalVisibilityService } from './services/renewal-visibility.service';

@Module({
  controllers: [BillingOpsController],
  providers: [
    BillingRepository, SaasInvoicesAdminService, DunningService, ManualAdjustmentService, RevenueDashboardService, SubscriptionViewService,
    InvoicePaymentsService, DunningPolicyService, InvoicePdfService, SubscriptionWriteService,
    BillingExportService, InvoiceBulkService, RevenueSeriesService, RenewalVisibilityService,
    // the ONLY money writer (Law 2/9): the wallet-service gRPC client behind the WalletAdminPort seam.
    { provide: WALLET_ADMIN, useFactory: (config: AdminConfig) => new WalletGrpcAdminClient(config), inject: [AdminConfig] },
  ],
})
export class BillingOpsModule {}
