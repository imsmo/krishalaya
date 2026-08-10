// apps/admin-api/src/core/wallet/wallet-admin.module.ts · the single binding of the WALLET_ADMIN seam (Law 2/9).
//
// WHY THIS MODULE EXISTS RATHER THAN A PROVIDER IN EACH CONSUMER. `apps/wallet-service` is the sole money writer;
// every god-mode path that moves money reaches it through the WalletAdminPort seam bound to the gRPC client. Two
// planes hold that power — billing-ops (manual SaaS adjustments) and ledger-correction (W068, the only path by which
// a person's wallet balance changes by hand) — and BillingOpsModule originally declared the provider privately, so
// LedgerCorrectionModule could not resolve Symbol(WALLET_ADMIN) at all and the whole realm failed to boot.
//
// The fix is deliberately NOT "export it from billing-ops and import billing-ops into ledger-correction": that would
// make the module that corrects farmers' wallets depend on the SaaS-invoicing module, and drag billing's controller
// and permission surface along with it — the exact coupling ledger-correction's own header refuses. A shared core
// module keeps the two planes' permission surfaces disjoint while giving them ONE client instance instead of two
// (one gRPC channel, one place to change the binding, one seam to stub in tests).
//
// NOT @Global, on purpose. Money-writing capability should be granted by an explicit `imports:` line that a reviewer
// can see, never ambiently available to every module that happens to be mounted.
import { Module } from '@nestjs/common';
import { AdminConfig } from '../config/admin-config';
import { WALLET_ADMIN } from './wallet-admin.port';
import { WalletGrpcAdminClient } from './wallet-grpc.client';

@Module({
  providers: [
    { provide: WALLET_ADMIN, useFactory: (config: AdminConfig) => new WalletGrpcAdminClient(config), inject: [AdminConfig] },
  ],
  exports: [WALLET_ADMIN],
})
export class WalletAdminModule {}
