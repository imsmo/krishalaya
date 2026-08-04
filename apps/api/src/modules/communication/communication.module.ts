// modules/communication/communication.module.ts
// Communication (PRD M13) — the NOTIFICATION SPINE. Krishalaya owns the policy + content: a GLOBAL event
// catalog, per event×channel×language templates (+ tenant overrides), user preferences + quiet hours, and the
// partitioned delivery log with cost tracking. Every module's domain events flow through the outbox relay; the
// DomainEventFanoutHandler (one per mapped event type) renders + dispatches notifications via the EXTERNAL
// notifier gateway (push/in-app/email/sms — resilience-wrapped, degrade-not-die) inside the relay tx. Gated by
// the `communication` flag (default OFF).
//
// SCOPE: (A) the NOTIFICATION SPINE — event catalog browse + tenant template authoring + preferences + quiet
// hours + inbox (list/mark-read) + delivery-status webhook + the domain-event→notification fanout with channel
// resolution (opt-out + quiet-hours + critical bypass) + external dispatch via the gateway port; AND (B) the
// MESSAGING vertical — conversations + messages (chat, partitioned) + masked privacy-proxy calls via the masking
// provider port. A new chat message emits comm.message_posted, which the SAME fanout turns into a push/in-app
// alert to the other participants. Gated by the `communication` flag (default OFF).
// DEFERRED: the smart-digest batching engine + a DB-level failed-notification retry poller; IVR/voice rendering.
import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { NotificationsController } from './controllers/v1/notifications.controller';
import { PreferencesController } from './controllers/v1/preferences.controller';
import { TemplatesController } from './controllers/v1/templates.controller';
import { DeliveryWebhookController } from './controllers/v1/delivery-webhook.controller';
import { ConversationsController } from './controllers/v1/conversations.controller';
import { MaskedCallsController } from './controllers/v1/masked-calls.controller';
import { MaskedCallWebhookController } from './controllers/v1/masked-call-webhook.controller';
import { DevicesController } from './controllers/v1/devices.controller';
import { BroadcastsController } from './controllers/v1/broadcasts.controller';
import { NotificationService } from './services/notification.service';
import { BroadcastService } from './services/broadcast.service';
import { BroadcastRepository } from './repositories/broadcast.repository';
import { BroadcastRequestedHandler } from './events/handlers/broadcast-requested.handler';
import { PreferenceService } from './services/preference.service';
import { TemplateAdminService } from './services/template-admin.service';
import { ConversationService } from './services/conversation.service';
import { MessageService } from './services/message.service';
import { MaskedCallService } from './services/masked-call.service';
import { DeviceService } from './services/device.service';
import { NotificationEventRepository } from './repositories/notification-event.repository';
import { NotificationTemplateRepository } from './repositories/notification-template.repository';
import { NotificationPreferenceRepository } from './repositories/notification-preference.repository';
import { QuietHoursRepository } from './repositories/quiet-hours.repository';
import { NotificationRepository } from './repositories/notification.repository';
import { ConversationRepository } from './repositories/conversation.repository';
import { MessageRepository } from './repositories/message.repository';
import { MaskedCallRepository } from './repositories/masked-call.repository';
import { PushDeviceRepository } from './repositories/push-device.repository';
import { notificationGatewayProvider, maskingProviderProvider, pushSenderProvider } from './gateway/gateway.provider';
import { DomainEventFanoutHandler } from './events/handlers/domain-event-fanout.handler';
import { NOTIFICATION_EVENT_MAP } from './events/notification-event-map';

@Module({
  controllers: [NotificationsController, PreferencesController, TemplatesController, DeliveryWebhookController, ConversationsController, MaskedCallsController, MaskedCallWebhookController, DevicesController, BroadcastsController],
  providers: [
    NotificationService, PreferenceService, TemplateAdminService, ConversationService, MessageService, MaskedCallService, DeviceService, BroadcastService,
    NotificationEventRepository, NotificationTemplateRepository, NotificationPreferenceRepository, QuietHoursRepository, NotificationRepository,
    ConversationRepository, MessageRepository, MaskedCallRepository, PushDeviceRepository, BroadcastRepository,
    notificationGatewayProvider, maskingProviderProvider, pushSenderProvider,
  ],
  exports: [NotificationService, ConversationService, MessageService, MaskedCallService],
})
export class CommunicationModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly registry: OutboxHandlerRegistry,
    private readonly notifications: NotificationService,
    private readonly broadcasts: BroadcastRepository,
  ) {}
  // Register one fanout consumer per mapped domain-event type (the registry keys by a single eventType).
  onModuleInit(): void {
    for (const entry of NOTIFICATION_EVENT_MAP) this.registry.register(new DomainEventFanoutHandler(entry, this.notifications));
    // The tenant-broadcast fan-out (communication.broadcast_requested → notification spine, batched).
    this.registry.register(new BroadcastRequestedHandler(this.broadcasts, this.notifications));
  }
}
