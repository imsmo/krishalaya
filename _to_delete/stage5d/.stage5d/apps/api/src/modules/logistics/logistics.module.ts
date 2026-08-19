// modules/logistics/logistics.module.ts
// Order fulfilment (M07): a confirmed order auto-creates a SHIPMENT (orders.order_confirmed →
// OrderConfirmedHandler), which ops/riders drive pending→…→out_for_delivery→delivered. Proof-of-delivery
// is OTP-gated; on delivery it emits logistics.shipment_delivered → orders marks the order delivered
// (→ quality window → settlement). NO money moves here. Gated by the `logistics` feature flag (OFF).
//
// SCOPE: this build ships the shipment vertical (the order-fulfilment spine), the fleet registry (API-W3-03:
// partners / vehicles / pickup slots), AND zones-routing (API-W3-04): delivery serviceability/charge zones,
// Saturday Village Run routes, and cold-chain (reefer/vaccine) temperature telemetry. The cold-chain breach
// alerter + Village-Run consolidation run as worker jobs (apps/worker) — see jobs/. No master-data sub-features
// of this module remain deferred.
import { RiderPayoutService } from './services/rider-payout.service';
import { RiderPayoutRepository } from './repositories/rider-payout.repository';
import { OpsAlertService } from './services/ops-alert.service';
import { OpsAlertRepository } from './repositories/ops-alert.repository';
import { OpsAlertsCadenceJob } from './jobs/ops-alerts.cadence-job';
import { CodRemittanceService } from './services/cod-remittance.service';
import { CodRemittanceRepository } from './repositories/cod-remittance.repository';
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { ShipmentsController } from './controllers/v1/shipments.controller';
import { OrdersModule } from '../orders/orders.module';
import { PartnersController, VehiclesController, PickupSlotsController } from './controllers/v1/partners.controller';
import { ZonesController } from './controllers/v1/zones.controller';
import { RoutesController, ColdChainController } from './controllers/v1/routes.controller';
import { ShipmentService } from './services/shipment.service';
import { ShipmentRepository } from './repositories/shipment.repository';
import { LogisticsPartnerService } from './services/logistics-partner.service';
import { VehicleService } from './services/vehicle.service';
import { PickupSlotService } from './services/pickup-slot.service';
import { LogisticsPartnerRepository } from './repositories/logistics-partner.repository';
import { VehicleRepository } from './repositories/vehicle.repository';
import { PickupSlotRepository } from './repositories/pickup-slot.repository';
import { DeliveryZoneService } from './services/delivery-zone.service';
import { DeliveryRouteService } from './services/delivery-route.service';
import { ColdChainService } from './services/cold-chain.service';
import { DeliveryZoneRepository } from './repositories/delivery-zone.repository';
import { DeliveryRouteRepository } from './repositories/delivery-route.repository';
import { ColdChainLogRepository } from './repositories/cold-chain-log.repository';
import { OrderConfirmedHandler } from './events/handlers/order-confirmed.handler';
// PC-56 TENANT-5b · W229's register + W231's board, and the clock W229's own sentence needs.
import { FleetRegisterReadModel } from './read-models/fleet-register.read-model';
// PC-56 TENANT-5c · the freight desk: two tables 0070 created and no application code had ever touched.
import { FreightController } from './controllers/v1/freight.controller';
import { FreightInvoiceService } from './services/freight-invoice.service';
import { FreightInvoiceRepository } from './repositories/freight-invoice.repository';
import { FreightDeskReadModel } from './read-models/freight-desk.read-model';
// PC-56 TENANT-5d · W225's overview and W244's insights.
import { LogisticsDeskController } from './controllers/v1/logistics-desk.controller';
import { LogisticsDeskReadModel } from './read-models/logistics-desk.read-model';
import { LogisticsDeskRepository } from './repositories/logistics-desk.repository';
import { RouteBoardReadModel } from './read-models/route-board.read-model';
import { RcExpiryParkingJob } from './jobs/rc-expiry-parking.job';
import { RcExpiryParkingCadenceJob } from './jobs/rc-expiry-parking.cadence-job';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { AppConfig } from '../../core/config/app-config';
import { FlagsService } from '../../core/feature-flags/flags.service';
import { METRICS, Metrics } from '../../core/observability/metrics';

@Module({
  // PC-56 TENANT-5a · the money gate needs the ORDERS module's public service (OrderService.transportStatus)
  // so a shipment cannot be assigned, scheduled or picked up for an order nobody has paid for. The module
  // blueprint's rule holds: another module's PUBLIC SERVICE, never its repositories.
  imports: [OrdersModule],
  controllers: [ShipmentsController, PartnersController, VehiclesController, PickupSlotsController, ZonesController, RoutesController, ColdChainController, FreightController, LogisticsDeskController],
  providers: [
    ShipmentService, ShipmentRepository, OrderConfirmedHandler,
    LogisticsPartnerService, VehicleService, PickupSlotService,
    LogisticsPartnerRepository, VehicleRepository, PickupSlotRepository,
    DeliveryZoneService, DeliveryRouteService, ColdChainService,
    DeliveryZoneRepository, DeliveryRouteRepository, ColdChainLogRepository, CodRemittanceService, CodRemittanceRepository, OpsAlertService, OpsAlertRepository, RiderPayoutService, RiderPayoutRepository,
    FleetRegisterReadModel, RouteBoardReadModel,
    FreightInvoiceService, FreightInvoiceRepository, FreightDeskReadModel,
    LogisticsDeskRepository, LogisticsDeskReadModel,
    { provide: RcExpiryParkingJob,
      useFactory: (vehicles: VehicleRepository, flags: FlagsService, metrics: Metrics) => new RcExpiryParkingJob(vehicles, flags, metrics),
      inject: [VehicleRepository, FlagsService, METRICS] },
    { provide: RcExpiryParkingCadenceJob,
      useFactory: (config: AppConfig, job: RcExpiryParkingJob) =>
        new RcExpiryParkingCadenceJob(config.jobs.logisticsFleet.rcParkingIntervalMs, job, config.jobs.logisticsFleet.rcParkingBatchSize),
      inject: [AppConfig, RcExpiryParkingJob] },
    { provide: OpsAlertsCadenceJob,
      // Every 10 minutes: fast enough that a cold-chain breach is seen while the cargo can still be saved,
      // and safe to repeat because the 0086 dedupe key makes a re-fire inside the cooldown a DB no-op.
      useFactory: (svc: OpsAlertService) => new OpsAlertsCadenceJob(10 * 60_000, svc),
      inject: [OpsAlertService] }],
  exports: [ShipmentService, LogisticsPartnerService, VehicleService, PickupSlotService, DeliveryZoneService, DeliveryRouteService, ColdChainService, FleetRegisterReadModel, RouteBoardReadModel, FreightInvoiceService],
})
export class LogisticsModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobRegistry: ScheduledJobRegistry,
    private readonly config: AppConfig,
    private readonly orderConfirmed: OrderConfirmedHandler,
    private readonly opsAlerts: OpsAlertsCadenceJob,
    private readonly rcParking: RcExpiryParkingCadenceJob,
  ) {}
  onModuleInit(): void {
    // auto-create a shipment when an order is confirmed (orders.order_confirmed → pending shipment)
    this.registry.register(this.orderConfirmed);
    if (this.config.jobs.logisticsFleet.enabled) {
      // **PC-56 TENANT-5b · `OpsAlertsCadenceJob` WAS CONSTRUCTED HERE AND NEVER REGISTERED.** The factory
      // above it has always built the object — with a comment reading "Every 10 minutes: fast enough that a
      // cold-chain breach is seen while the cargo can still be saved" — and `SCHEDULED_JOB_REGISTRY` was not
      // imported by this module at all, so nothing ever called `run()`. Seven other modules register their
      // cadence jobs; this one built its only one and dropped it. Cold-chain breach alerting has therefore
      // never fired on a clock since it was written, which is the mechanism behind W229's reefer row and
      // W225's cold-chain tab.
      this.jobRegistry.register(this.opsAlerts);
      // …and W229's own sentence: "an expired RC parks the vehicle automatically". Gated per tenant by
      // `logistics_rc_parking` INSIDE the job, so this registration only gives it a clock.
      this.jobRegistry.register(this.rcParking);
    }
  }
}
