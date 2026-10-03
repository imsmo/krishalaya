// modules/tenant-webhooks/tenant-webhooks.module.ts · tenant self-serve outbound webhooks — PC-56 TENANT-13a.
// A tenant admin (`api.manage`) registers https endpoints judged by the target guard (with a live DNS resolution), subscribes to PUBLIC
// events from the catalogue, and is shown a signing secret ONCE; the platform stores it envelope-encrypted and the apps/worker delivery
// job decrypts it to HMAC-sign each POST. At init one fanout handler is registered per distinct INTERNAL outbox type the catalogue
// maps (F-1 — the old module registered handlers under public names nothing emits). Gated by the `tenancy` flag.
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { WebhooksController } from './controllers/v1/webhooks.controller';
import { TenantWebhookService, WEBHOOK_RESOLVER, systemResolver } from './services/tenant-webhook.service';
import { WebhookDeliveryLogService } from './services/webhook-delivery-log.service';
import { WebhookRepository } from './repositories/webhook.repository';
import { WebhookFanoutHandler } from './events/handlers/webhook-fanout.handler';
import { CATALOGUE_INTERNAL_TYPES } from './domain/webhook-catalog';

@Module({
  controllers: [WebhooksController],
  providers: [TenantWebhookService, WebhookDeliveryLogService, WebhookRepository, { provide: WEBHOOK_RESOLVER, useValue: systemResolver }],
  // WebhookRepository is exported so modules/partner-api can enqueue into the SAME webhook_deliveries rail (PC-55 A10) — with
  // endpoint_kind 'partner' (F-19) — instead of forking a second delivery/retry implementation.
  exports: [TenantWebhookService, WebhookRepository],
})
export class TenantWebhooksModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    private readonly repo: WebhookRepository,
  ) {}

  onModuleInit(): void {
    for (const internalType of CATALOGUE_INTERNAL_TYPES) {
      this.registry.register(new WebhookFanoutHandler(internalType, this.repo));
    }
  }
}
