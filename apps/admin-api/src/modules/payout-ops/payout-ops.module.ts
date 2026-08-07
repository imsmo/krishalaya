// apps/admin-api/src/modules/payout-ops/payout-ops.module.ts · W062/W063/W066/W067/W442 (PC-56 ADMIN-6b).
//
// SEPARATE FROM ledger-ops, AND THE BOUNDARY IS WHAT EACH PLANE CAN DO RATHER THAN WHAT IT CAN SEE. ledger-ops is a
// read plane: it can look at every transaction on the platform and change nothing (its only write is an append-only
// verification record). This module can authorise money LEAVING. Sharing a module would mean sharing a module-level
// guard set, and the ledger auditor — a role deliberately granted to people outside the money team — would sit one
// decorator's mistake away from the disbursement button.
//
// SEPARATE FROM ledger-correction TOO, though both move money, because they move it in opposite directions. A
// correction adjusts the record of money already inside the platform and is itself correctable by another entry. An
// approval sends money to 214 third-party bank accounts and is not recallable by anything this platform can do. The
// person who reconciles the books is not automatically the person who should authorise a disbursement.
import { Module } from '@nestjs/common';
import { PayoutOpsController } from './payout-ops.controller';
import { PayoutOpsRepository } from './repositories/payout-ops.repository';
import { PayoutBatchesService } from './services/payout-batches.service';
import { SettlementOversightService } from './services/settlement-oversight.service';

@Module({
  controllers: [PayoutOpsController],
  providers: [PayoutOpsRepository, PayoutBatchesService, SettlementOversightService],
})
export class PayoutOpsModule {}
