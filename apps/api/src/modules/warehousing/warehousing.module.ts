// modules/warehousing/warehousing.module.ts
// Warehousing & WDRA receipts (PRD M21): farmers/traders deposit produce in warehouses and the warehouse records its own assay entry (not a lab
// certificate; it sets no price). PC-56 OPS-2b: this platform does NOT issue an eNWR (issue refused by name, founder Q3-A); receipts already
// recorded stay readable; a receipt is never released on its own (refused by name) and is cancelled only by the warehouse's named operator, keyed,
// with a reason, audited (Q5-A); no receipt can be named on a loan application (Q7-A, fintech). A STORAGE FEE would be collected at release (quantity in quintals × rate/qtl/month × months)
// through the wallet boundary (depositor userMain → operator userMain, txnType 'storage_fee', zero-sum +
// idempotent — Law 2) — but release is REFUSED BY NAME since PC-56 OPS-1a (paused until the depositor confirms
// it herself; README "The money path"). Gated by the `warehousing` feature flag (default OFF).
//
// SCOPE (this build): warehouses (incl. platform-global/independent WDRA, cross-tenant visible) + storage
// bookings (request → confirm → store; release refused by name) + the warehouse's assay entries + the eNWR records (read; operator cancel).
// DEFERRED (schema in 0010, not wired): NWR PLEDGE → loan collateral + partial release + default (fintech
// flow), mark-to-market revaluation job, re-assay-due job, auto-valuation from assay grade × mandi price,
// multi-unit → quintal conversion (fees assume quintals), repository (NERL/CCRL) API integration.
import { Module } from '@nestjs/common';
import { WarehousesController } from './controllers/v1/warehouses.controller';
import { StorageBookingsController } from './controllers/v1/storage-bookings.controller';
import { NwrController } from './controllers/v1/nwr.controller';
import { WarehouseService } from './services/warehouse.service';
import { StorageBookingService } from './services/storage-booking.service';
import { AssayReportService } from './services/assay-report.service';
import { NwrReceiptService } from './services/nwr-receipt.service';
import { WarehouseRepository } from './repositories/warehouse.repository';
import { StorageBookingRepository } from './repositories/storage-booking.repository';
import { AssayReportRepository } from './repositories/assay-report.repository';
import { NwrReceiptRepository } from './repositories/nwr-receipt.repository';

@Module({
  controllers: [WarehousesController, StorageBookingsController, NwrController],
  providers: [WarehouseService, StorageBookingService, AssayReportService, NwrReceiptService, WarehouseRepository, StorageBookingRepository, AssayReportRepository, NwrReceiptRepository],
  exports: [WarehouseService, StorageBookingService, AssayReportService, NwrReceiptService],
})
export class WarehousingModule {}
