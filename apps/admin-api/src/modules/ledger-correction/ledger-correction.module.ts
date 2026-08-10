// apps/admin-api/src/modules/ledger-correction/ledger-correction.module.ts · W068 (PC-56 ADMIN-5e).
//
// Its own module rather than a corner of recon-monitor, and the boundary is what the two planes can DO. recon-monitor
// observes and annotates: it opens investigations, freezes accounts, records notes. This one MOVES MONEY. Sharing a
// module would mean sharing a permission surface, and `recon.manage` — held by anybody who works the recon board —
// would become the permission that can post a correction against a farmer's wallet.
import { Module } from '@nestjs/common';
// Money moves ONLY through the wallet-service (Law 2/9). WalletAdminModule binds the WALLET_ADMIN seam and is
// imported explicitly here — not inherited from billing-ops, whose permission surface this module deliberately
// does not share (see the header above).
import { WalletAdminModule } from '../../core/wallet/wallet-admin.module';
import { LedgerCorrectionController } from './ledger-correction.controller';
import { CorrectionRepository } from './repositories/correction.repository';
import { CorrectionService } from './services/correction.service';

@Module({
  imports: [WalletAdminModule],
  controllers: [LedgerCorrectionController],
  providers: [CorrectionRepository, CorrectionService],
})
export class LedgerCorrectionModule {}
