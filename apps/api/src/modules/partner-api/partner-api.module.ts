// modules/partner-api/partner-api.module.ts · PC-55 A10 `partner-api-realm` — DARK.
// A financial partner (bank/NBFC/insurer) becomes a first-class API caller: authenticated by a hashed API key rather
// than a tenant JWT, scoped to its OWN book across every tenant it serves, and limited to reads. Everything here is
// behind the `partner_api` feature flag (seeded is_enabled=false in migration 0090); while it is off the routes answer
// 404, so the realm is invisible until the S2 security review signs it on.
// See ./README.md and PC55_A10_PARTNER_API_SECURITY_NOTES.md (Development_Program, outside this repo).
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { TenantWebhooksModule } from '../tenant-webhooks/tenant-webhooks.module';
import { WebhookRepository } from '../tenant-webhooks/repositories/webhook.repository';
import { PartnerApiController } from './controllers/v1/partner-api.controller';
import { PartnerApiRepository } from './repositories/partner-api.repository';
import { PartnerBookService } from './services/partner-book.service';
import { PartnerKeyGuard } from './guards/partner-key.guard';
import { PartnerWebhookFanoutHandler } from './events/handlers/partner-webhook-fanout.handler';
import { PARTNER_WEBHOOK_EVENT_TYPES } from './domain/partner-webhook.rules';

@Module({
  // The delivery rail is REUSED, not forked: WebhookRepository (webhook_deliveries + its proven enqueue semantics)
  // comes from the tenant module rather than being re-implemented here, so partner deliveries can never drift into a
  // second retry/backoff policy that nobody maintains.
  imports: [TenantWebhooksModule],
  controllers: [PartnerApiController],
  providers: [PartnerApiRepository, PartnerBookService, PartnerKeyGuard],
  exports: [PartnerApiRepository],
})
export class PartnerApiModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    private readonly partners: PartnerApiRepository,
    private readonly webhooks: WebhookRepository,
  ) {}

  onModuleInit(): void {
    // One handler per allow-listed event type. The registry holds a LIST per type, so these sit alongside the tenant
    // fanout handlers rather than displacing them.
    for (const eventType of PARTNER_WEBHOOK_EVENT_TYPES) {
      this.registry.register(new PartnerWebhookFanoutHandler(eventType, this.partners, this.webhooks));
    }
  }
}
