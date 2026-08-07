// apps/admin-api/src/modules/ledger-ops/ledger-ops.module.ts · W059/W064/W065 (PC-56 ADMIN-6).
//
// Separate from recon-monitor, and the boundary is what each plane may READ. recon-monitor deliberately never touches
// `ledger_entries` or `ledger_transactions` — its own header says so — because it answers "do the books balance" from
// aggregates and run outcomes. This module reads the transactions themselves: every leg, every counterparty, every
// balance, across every tenant. Sharing a module would mean sharing a permission, and `recon.read` — held by anybody
// who watches the reconciliation board — would become the permission to read the platform's complete payment history.
import { Module } from '@nestjs/common';
import { LedgerOpsController } from './ledger-ops.controller';
import { LedgerOpsRepository } from './repositories/ledger-ops.repository';
import { LedgerExplorerService } from './services/ledger-explorer.service';
import { WalletAccountsService } from './services/wallet-accounts.service';

@Module({
  controllers: [LedgerOpsController],
  providers: [LedgerOpsRepository, LedgerExplorerService, WalletAccountsService],
})
export class LedgerOpsModule {}
