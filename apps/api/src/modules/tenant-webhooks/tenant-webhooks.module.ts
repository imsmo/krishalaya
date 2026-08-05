// modules/tenant-webhooks/tenant-webhooks.module.ts · tenant self-serve outbound webhooks (P1-11). A tenant
// registers https endpoints (SSRF-guarded), subscribes to events, and gets a signing secret ONCE; the platform
// stores it ENCRYPTED (AES-256-GCM) and the apps/worker delivery job decrypts it to HMAC-sign each POST. On every
// relayed outbox event of an allow-listed type, the fanout handler enqueues a delivery per active endpoint IN THE
// RELAY TX. Gated by the `tenancy` flag + tenant.settings (NOT god-mode, Law 11). At init we register one fanout
// handler per WEBHOOK_EVENT_TYPE (the registry keys handlers by eventType).
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { WebhooksController } from './controllers/v1/webhooks.controller';
import { TenantWebhookService } from './services/tenant-webhook.service';
import { WebhookRepository } from './repositories/webhook.repository';
import { WebhookFanoutHandler } from './events/handlers/webhook-fanout.handler';
import { WEBHOOK_EVENT_TYPES } from './domain/webhook-events';

@Module({
  controllers: [WebhooksController],
  providers: [TenantWebhookService, WebhookRepository],
  // WebhookRepository is exported so modules/partner-api can enqueue into the SAME webhook_deliveries rail
  // (PC-55 A10) instead of forking a second delivery/retry implementation.
  exports: [TenantWebhookService, WebhookRepository],
})
export class TenantWebhooksModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    private readonly repo: WebhookRepository,
  ) {}

  onModuleInit(): void {
    // One handler per allow-listed event type → the relay fans each matching event out to subscribed endpoints.
    for (const eventType of WEBHOOK_EVENT_TYPES) {
      this.registry.register(new WebhookFanoutHandler(eventType, this.repo));
    }
  }
}
