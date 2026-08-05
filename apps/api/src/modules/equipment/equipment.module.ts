// modules/equipment/equipment.module.ts
// Equipment & CHC (PRD M20): the farm-machinery RENTAL marketplace. An equipment owner / Custom Hiring
// Centre lists assets + rate cards; a renter requests a job, the owner quotes a deposit, the renter
// confirms (the advance is ESCROWED), the operator starts the meter (OTP-gated), completes with measured
// usage, and the owner SETTLES — the escrow is released to the owner, any shortfall collected from the
// renter, any unused hold refunded — all zero-sum, idempotent via the wallet boundary (Law 2). Gated by
// the `equipment` feature flag (default OFF).
//
// SCOPE (this build): equipment assets + per-asset rate cards + rental bookings (escrow hold → OTP start →
// usage-metered completion → escrow release/refund/collect settlement) + the confirm-timeout job.
// DEFERRED (schema in 0010, not wired): DRONES (registrations / pilots / flights, DGCA DigitalSky + RPL
// expiry jobs + no-fly/weather pre-flight gate), maintenance logs, GPS area-trace (±2%) precise billing,
// operator-pool integration (operator_user_id from labour), and the payments payout/intent linkage
// (settlement here moves in-platform wallet balances).
import { MaintenanceService } from './services/maintenance.service';
import { MaintenanceRepository } from './repositories/maintenance.repository';
import { Module } from '@nestjs/common';
import { EquipmentController } from './controllers/v1/equipment.controller';
import { RentalsController } from './controllers/v1/rentals.controller';
import { EquipmentAssetService } from './services/equipment-asset.service';
import { EquipmentRateService } from './services/equipment-rate.service';
import { EquipmentBookingService } from './services/equipment-booking.service';
import { EquipmentAssetRepository } from './repositories/equipment-asset.repository';
import { EquipmentRateRepository } from './repositories/equipment-rate.repository';
import { EquipmentBookingRepository } from './repositories/equipment-booking.repository';

// The confirm-timeout worker job (jobs/booking-confirm-timeout.job.ts) is instantiated by apps/worker with
// a privileged kv_relay Pool — not a DI provider (it takes a Pool), mirroring the other batch jobs.
@Module({
  controllers: [EquipmentController, RentalsController],
  providers: [EquipmentAssetService, EquipmentRateService, EquipmentBookingService, EquipmentAssetRepository, EquipmentRateRepository, EquipmentBookingRepository, MaintenanceService, MaintenanceRepository],
  exports: [EquipmentAssetService, EquipmentRateService, EquipmentBookingService],
})
export class EquipmentModule {}
