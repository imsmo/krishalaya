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
// expiry jobs + no-fly/weather pre-flight gate), GPS area-trace (±2%) precise billing,
// operator-pool integration (operator_user_id from labour), and the payments payout/intent linkage
// (settlement here moves in-platform wallet balances).
// [PC-56 OPS-4a — CORRECTED, survey C-8] maintenance logs are wired (PC-54 W54-12: MaintenanceService below).
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

// [PC-56 OPS-4a — CORRECTED, survey C-7] The confirm-timeout job (jobs/booking-confirm-timeout.job.ts) takes a Pool and is NOT
// instantiated anywhere (apps/worker does not construct it), and 0079 revokes every privilege on equipment_bookings from kv_relay —
// so un-confirmed hires never expire today. It stays out of DI until a process that holds the grant runs it (OPS4-B15).
@Module({
  controllers: [EquipmentController, RentalsController],
  providers: [EquipmentAssetService, EquipmentRateService, EquipmentBookingService, EquipmentAssetRepository, EquipmentRateRepository, EquipmentBookingRepository, MaintenanceService, MaintenanceRepository],
  exports: [EquipmentAssetService, EquipmentRateService, EquipmentBookingService],
})
export class EquipmentModule {}
