// modules/livestock/livestock.module.ts
// Livestock (PRD M15): the animal asset registry + the VET MARKETPLACE. A farmer registers their animals
// (Pashu Aadhaar/INAPH), browses vets, and books a vet service; the vet drives the service lifecycle; on
// completion the FARMER (payer) settles the fee through the wallet boundary (farmer userMain → vet userMain,
// txnType 'service_fee', zero-sum + idempotent — Law 2). Gated by the `livestock` feature flag (default OFF).
//
// SCOPE (this build): animal registry (species/breeds master data + farmer animals) + vet profiles + vet
// service catalog + vet bookings + fee settlement.
// DEFERRED (schema in 0009, not wired): animal health events (partitioned lifetime file), ownership
// transfers (INAPH re-registration), animal attribute EAV, livestock-for-sale listings, prescriptions +
// items, semen catalog + insemination/AI records, disease-outbreak geofence alerts, vaccination/PD reminder
// jobs, INAPH sync, vet-fee commission split. All DAIRY tables (MCC/milk/coop/d2c) belong to module #16.
import { Module } from '@nestjs/common';
import { AnimalsController } from './controllers/v1/animals.controller';
import { VetsController } from './controllers/v1/vets.controller';
import { VetBookingsController } from './controllers/v1/vet-bookings.controller';
import { AnimalService } from './services/animal.service';
import { AnimalSpeciesService } from './services/animal-species.service';
import { VetService } from './services/vet.service';
import { VetBookingService } from './services/vet-booking.service';
import { AnimalRepository } from './repositories/animal.repository';
import { AnimalSpeciesRepository } from './repositories/animal-species.repository';
import { AnimalBreedRepository } from './repositories/animal-breed.repository';
import { VetProfileRepository } from './repositories/vet-profile.repository';
import { VetServiceRepository } from './repositories/vet-service.repository';
import { HealthRepository } from './repositories/health.repository';
import { HealthService } from './services/health.service';
import { VetBookingRepository } from './repositories/vet-booking.repository';

@Module({
  controllers: [AnimalsController, VetsController, VetBookingsController],
  providers: [
    AnimalService, AnimalSpeciesService, VetService, VetBookingService,
    AnimalRepository, AnimalSpeciesRepository, AnimalBreedRepository, VetProfileRepository, VetServiceRepository, VetBookingRepository, HealthRepository, HealthService,
  ],
  exports: [AnimalService, VetService, VetBookingService],
})
export class LivestockModule {}
