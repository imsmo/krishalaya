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
import { OpsAlertService } from './services/ops-alert.service';
import { OpsAlertRepository } from './repositories/ops-alert.repository';
import { OpsAlertsCadenceJob } from './jobs/ops-alerts.cadence-job';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { CodRemittanceService } from './services/cod-remittance.service';
import { CodRemittanceRepository } from './repositories/cod-remittance.repository';
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { ShipmentsController } from './controllers/v1/shipments.controller';
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

@Module({
  controllers: [ShipmentsController, PartnersController, VehiclesController, PickupSlotsController, ZonesController, RoutesController, ColdChainController],
  providers: [
    ShipmentService, ShipmentRepository, OrderConfirmedHandler,
    LogisticsPartnerService, VehicleService, PickupSlotService,
    LogisticsPartnerRepository, VehicleRepository, PickupSlotRepository,
    DeliveryZoneService, DeliveryRouteService, ColdChainService,
    DeliveryZoneRepository, DeliveryRouteRepository, ColdChainLogRepository, CodRemittanceService, CodRemittanceRepository, OpsAlertService, OpsAlertRepository,
    { provide: OpsAlertsCadenceJob,
      // Every 10 minutes: fast enough that a cold-chain breach is seen while the cargo can still be saved,
      // and safe to repeat because the 0086 dedupe key makes a re-fire inside the cooldown a DB no-op.
      useFactory: (svc: OpsAlertService) => new OpsAlertsCadenceJob(10 * 60_000, svc),
      inject: [OpsAlertService] }],
  exports: [ShipmentService, LogisticsPartnerService, VehicleService, PickupSlotService, DeliveryZoneService, DeliveryRouteService, ColdChainService],
})
export class LogisticsModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    private readonly orderConfirmed: OrderConfirmedHandler,
  ) {}
  // auto-create a shipment when an order is confirmed (orders.order_confirmed → pending shipment)
  onModuleInit(): void { this.registry.register(this.orderConfirmed); }
}
