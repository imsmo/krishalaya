// apps/admin-api/src/modules/ledger-correction/ledger-correction.module.ts · W068 (PC-56 ADMIN-5e).
//
// Its own module rather than a corner of recon-monitor, and the boundary is what the two planes can DO. recon-monitor
// observes and annotates: it opens investigations, freezes accounts, records notes. This one MOVES MONEY. Sharing a
// module would mean sharing a permission surface, and `recon.manage` — held by anybody who works the recon board —
// would become the permission that can post a correction against a farmer's wallet.
import { Module } from '@nestjs/common';
import { LedgerCorrectionController } from './ledger-correction.controller';
import { CorrectionRepository } from './repositories/correction.repository';
import { CorrectionService } from './services/correction.service';

@Module({
  controllers: [LedgerCorrectionController],
  providers: [CorrectionRepository, CorrectionService],
})
export class LedgerCorrectionModule {}
