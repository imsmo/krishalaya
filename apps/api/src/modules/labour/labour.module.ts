// modules/labour/labour.module.ts
// Labour (PRD M28): the dignified-work spine. An employer (farmer/FPO, worker.book) POSTS a booking with
// THE DIGNITY FLOOR snapshotted from minimum_wages (an offer below the statutory minimum is impossible —
// enforced in the domain AND by chk_dignity_floor in the DB), assigns workers, workers CONSENT, and on
// completion WAGES ARE SETTLED through the wallet boundary (employer userMain → worker userMain,
// txnType 'wage_payout', zero-sum + idempotent — Law 2). Gated by the `labour` feature flag (default OFF).
//
// SCOPE (this build): worker profiles (+ self-declared skills) + bookings + assignments + worker self-apply
// + GEO-FENCED clock-in / clock-out / employer dual-confirm attendance + lookups catalogue + ROSTER CONFIRM (escrow + fee,
// PC-56 TENANT-11b) + the pay run (confirmed attendance × rate + OT) + the respond-timeout job + the labour desk (consent).
// DEFERRED (named): worker advances/baki, insurance, migrant engagement, safety checklists, grievances, crews/sardars and
// crew broadcast, invite fan-out, worker availability, minimum-wage admin CRUD + gazette-sync job, auto-accept, the
// same-day fairness fee (founder: rule not set), wage runs (W166, TENANT-SWEEP).
import { STATE_LEDGER_PROVIDER, stateLedgerProviderFromEnv } from './providers/state-ledger.provider';
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { UNIT_OF_WORK, UnitOfWork } from '../../core/database/unit-of-work';
import { BookingRespondTimeoutJob } from './jobs/booking-respond-timeout.job';
import { LabourSummaryController } from './controllers/v1/summary.controller';
import { LabourMoneyService } from './services/labour-money.service';
import { LabourMoneyRepository } from './repositories/labour-money.repository';
import { WorkersController } from './controllers/v1/workers.controller';
import { BookingsController } from './controllers/v1/bookings.controller';
import { AssignmentsController } from './controllers/v1/assignments.controller';
import { LookupsController } from './controllers/v1/lookups.controller';
import { MgnregaController } from './controllers/v1/mgnrega.controller';
import { MgnregaService } from './services/mgnrega.service';
import { MgnregaRepository } from './repositories/mgnrega.repository';
import { WorkerProfileService } from './services/worker-profile.service';
import { LabourBookingService } from './services/labour-booking.service';
import { MinimumWageService } from './services/minimum-wage.service';
import { AttendanceService } from './services/attendance.service';
import { LabourLookupsService } from './services/labour-lookups.service';
import { WorkerProfileRepository } from './repositories/worker-profile.repository';
import { LabourBookingRepository } from './repositories/labour-booking.repository';
import { BookingAssignmentRepository } from './repositories/booking-assignment.repository';
import { MinimumWageRepository } from './repositories/minimum-wage.repository';
import { AttendanceRepository } from './repositories/attendance.repository';

// PC-56 TENANT-11b · F-1 / F-9: the respond-timeout job is REGISTERED in SCHEDULED_JOB_REGISTRY (it was instantiated nowhere)
// and claims per tenant in kv_app's unit of work — never as kv_relay on labour_bookings, which kv_relay holds no grant on.
// The labour money (escrow at roster confirm, the pay run, the release) lives in LabourMoneyService, through WalletPort.
@Module({
  controllers: [WorkersController, BookingsController, AssignmentsController, LookupsController, MgnregaController, LabourSummaryController],
  providers: [
    WorkerProfileService, LabourBookingService, MinimumWageService, AttendanceService, LabourLookupsService, LabourMoneyService,
    WorkerProfileRepository, LabourBookingRepository, BookingAssignmentRepository, MinimumWageRepository, AttendanceRepository, LabourMoneyRepository,
    MgnregaService, MgnregaRepository,
    { provide: STATE_LEDGER_PROVIDER, useFactory: () => stateLedgerProviderFromEnv(process.env) },
    { provide: BookingRespondTimeoutJob, inject: [UNIT_OF_WORK, LabourBookingRepository, LabourBookingService],
      useFactory: (u: UnitOfWork, r: LabourBookingRepository, s: LabourBookingService) => new BookingRespondTimeoutJob(5 * 60_000, u, r, s) },
  ],
  exports: [WorkerProfileService, LabourBookingService],
})
export class LabourModule implements OnModuleInit {
  constructor(@Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry, private readonly respondTimeout: BookingRespondTimeoutJob) {}
  onModuleInit(): void { this.jobs.register(this.respondTimeout); }
}
