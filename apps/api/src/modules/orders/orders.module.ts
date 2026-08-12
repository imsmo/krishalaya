// modules/orders/orders.module.ts
// Cart → checkout → order lifecycle. Reads listing price/seller via ListingService (cross-module
// public API, Law 11 — never the listings repository). The money/payment step is owned by the
// payments module and gated by the `online_payments` feature flag; payment success flows back here
// via the outbox relay → PaymentSucceededHandler (no synchronous cross-module call).
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { ListingsModule } from '../listings/listings.module';
import { PaymentsModule } from '../payments/payments.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { CartsController } from './controllers/v1/carts.controller';
import { CheckoutController } from './controllers/v1/checkout.controller';
import { OrdersController } from './controllers/v1/orders.controller';
import { CartService } from './services/cart.service';
import { CartItemService } from './services/cart-item.service';
import { CheckoutService } from './services/checkout.service';
import { CheckoutGroupService } from './services/checkout-group.service';
import { OrderService } from './services/order.service';
import { OrderPaymentService } from './services/order-payment.service';
import { OrderItemService } from './services/order-item.service';
import { OrderTimelineReadModel } from './read-models/order-timeline.read-model';
import { OrderTrackingReadModel } from './read-models/order-tracking.read-model';
import { OrderBuyerSummaryReadModel } from './read-models/order-buyer-summary.read-model';
import { OrderConsoleReadModel } from './read-models/order-console.read-model';
import { TenantOrderStatsReadModel } from './read-models/tenant-order-stats.read-model';
import { OrdersPublisher } from './events/orders.publisher';
import { CartRepository } from './repositories/cart.repository';
import { CartItemRepository } from './repositories/cart-item.repository';
import { CheckoutGroupRepository } from './repositories/checkout-group.repository';
import { OrderRepository } from './repositories/order.repository';
import { OrderItemRepository } from './repositories/order-item.repository';
import { DeliveryZoneRepository } from '../logistics/repositories/delivery-zone.repository'; // read-only serviceability for delivery-methods lookup (stateless, READ_REPLICA only — provided here to avoid a module cycle)
import { SellerConfirmTimeoutJob } from './jobs/seller-confirm-timeout.job';
import { AutoCompleteQualityWindowJob } from './jobs/auto-complete-quality-window.job';
import { AbandonedCartsJob } from './jobs/abandoned-carts.job';
import { PaymentSucceededHandler } from './events/handlers/payment-succeeded.handler';
import { OfferAcceptedHandler } from './events/handlers/offer-accepted.handler';
import { QuoteAcceptedHandler } from './events/handlers/quote-accepted.handler';
import { AuctionWonHandler } from './events/handlers/auction-won.handler';
import { ShipmentDeliveredHandler } from './events/handlers/shipment-delivered.handler';
import { DisputeOpenedHandler } from './events/handlers/dispute-opened.handler';
import { DisputeResolvedHandler } from './events/handlers/dispute-resolved.handler';

@Module({
  imports: [ListingsModule, PaymentsModule, PromotionsModule, MembershipsModule],   // PaymentsModule: ChargePricingService; PromotionsModule: CouponService; MembershipsModule: member checkout benefits
  controllers: [CartsController, CheckoutController, OrdersController],
  providers: [
    CartService, CartItemService, CheckoutService, CheckoutGroupService, OrderService, OrderPaymentService, OrderItemService,
    OrderTimelineReadModel, OrderTrackingReadModel, OrderBuyerSummaryReadModel, TenantOrderStatsReadModel, OrderConsoleReadModel, OrdersPublisher,
    CartRepository, CartItemRepository, CheckoutGroupRepository, OrderRepository, OrderItemRepository, DeliveryZoneRepository,
    SellerConfirmTimeoutJob, AutoCompleteQualityWindowJob, AbandonedCartsJob,
    PaymentSucceededHandler, OfferAcceptedHandler, QuoteAcceptedHandler, AuctionWonHandler, ShipmentDeliveredHandler, DisputeOpenedHandler, DisputeResolvedHandler,
  ],
  exports: [OrderService, SellerConfirmTimeoutJob, AutoCompleteQualityWindowJob, AbandonedCartsJob],
})
export class OrdersModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    private readonly paymentSucceeded: PaymentSucceededHandler,
    private readonly offerAccepted: OfferAcceptedHandler,
    private readonly auctionWon: AuctionWonHandler,
    private readonly quoteAccepted: QuoteAcceptedHandler,
    private readonly shipmentDelivered: ShipmentDeliveredHandler,
    private readonly disputeOpened: DisputeOpenedHandler,
    private readonly disputeResolved: DisputeResolvedHandler,
  ) {}
  onModuleInit(): void { this.registry.register(this.paymentSucceeded); this.registry.register(this.offerAccepted); this.registry.register(this.auctionWon); this.registry.register(this.quoteAccepted); this.registry.register(this.shipmentDelivered); this.registry.register(this.disputeOpened); this.registry.register(this.disputeResolved); }
}
