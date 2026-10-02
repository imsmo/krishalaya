// modules/group-lots/group-lots.module.ts
// Group lots (PRD §7.7): FPO / coordinator POOLING. A coordinator opens a lot for a product + target quantity, members pledge
// (and may withdraw until it lists), the lot becomes ready, is listed as ONE listing (sold directly or through an 11a
// auction), is SOLD when that order completes (the seller net is held), and is SETTLED when a second person confirms the
// prepared shares — every pledger paid from the real sale (PC-56 TENANT-11c, founder decision: maker ≠ checker).
//
// What this module registers:
//   • the ONE controller of `/v1/group-lots` (the listings duplicate is deleted — F-3);
//   • two outbox consumers, neither touching the relay's kv_relay transaction with a write it holds no grant for:
//     `orders.order_completed` (hop 1: read in kv_app, enqueue on the relay tx) and `group_lot.sale_settled` (hop 2: record the
//     sale + hold the proceeds in kv_app's unit of work).
// It reads the listings module only through ListingService (Law 11) and moves money only through WalletPort (Law 2).
// Gated by the `group_lots` feature flag + the per-lot coordinator check.
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { ListingsModule } from '../listings/listings.module';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { UiMessageRepository } from '../../core/i18n/ui-message.repository';
import { GroupLotsController } from './controllers/v1/group-lots.controller';
import { GroupLotService } from './services/group-lot.service';
import { GroupLotRepository } from './repositories/group-lot.repository';
import { GroupLotSettlementRepository } from './repositories/group-lot-settlement.repository';
import { GroupLotOrderCompletedHandler } from './events/handlers/order-completed.handler';
import { GroupLotSaleSettledHandler } from './events/handlers/sale-settled.handler';

@Module({
  imports: [ListingsModule],
  controllers: [GroupLotsController],
  providers: [GroupLotService, GroupLotRepository, GroupLotSettlementRepository, UiMessageRepository, GroupLotOrderCompletedHandler, GroupLotSaleSettledHandler],
  exports: [GroupLotService],
})
export class GroupLotsModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    private readonly orderCompleted: GroupLotOrderCompletedHandler,
    private readonly saleSettled: GroupLotSaleSettledHandler,
  ) {}
  onModuleInit(): void {
    this.registry.register(this.orderCompleted);
    this.registry.register(this.saleSettled);
  }
}
