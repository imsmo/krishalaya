// modules/communication/services/whatsapp.service.ts · PC-56 TENANT-8e · WHATSAPP, DECLARED HONESTLY, BY NAME (W425–W430).
//
// The hub (W425) prints what IS: the provider registry's answer (no WhatsApp provider — `whatsapp_provider_connected()`
// false), the serving templates by channel (WhatsApp: 0 — 8a's plane, where a WhatsApp override parks at "with the
// provider"), the catalogued events that list WhatsApp as a channel (each records a leg it cannot send), the cooperative's
// in-app announcements over 30 days COUNTED FROM THE DELIVERY LOG (sent · held · suppressed · failed — never a copy), and
// the opt-in policy record. Every WhatsApp act the canon draws is in `WHATSAPP_REFUSED` with what exists instead and the
// gap's owner.
//
// THE ONE WRITE (W430): the cooperative's opt-in policy — the consent sources it intends to use and the statement its
// members will be shown — reviewed by the API, keyed by the form, audited, an outbox event; collected: NOT (0179).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { AUDIT_WRITER, AuditWriter } from '../../../core/audit/audit.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { WhatsAppRepository, OptinPolicyRow } from '../repositories/whatsapp.repository';
import { BroadcastRepository } from '../repositories/broadcast.repository';
import { addCounts, countBroadcast } from '../domain/broadcast-counts';
import { OptinInput, OptinReview, WHATSAPP_REFUSED, reviewOptinPolicy } from '../domain/whatsapp-policy';
import { CommForbiddenError, WhatsAppPolicyChangedError, WhatsAppPolicyRefusedError } from '../domain/communication.errors';
import type { WriteMeta } from './broadcast.service';

export const HUB_WINDOW_DAYS = 30;
/** The hub sums at most this many fanned-out broadcasts in its window (newest first) — and says so when it hits it. */
export const HUB_BROADCAST_MAX = 200;
export const WhatsAppEvents = { PolicySaved: 'communication.whatsapp_optin_policy_saved' } as const;

export interface WhatsAppActor { userId: string; canRead: boolean; canManagePolicy: boolean }

@Injectable()
export class WhatsAppService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly repo: WhatsAppRepository,
    private readonly broadcasts: BroadcastRepository,
  ) {}

  async hub(tenantId: string, actor: WhatsAppActor, now = new Date()) {
    if (!actor.canRead && !actor.canManagePolicy) throw new CommForbiddenError('the channels hub needs notification.manage or notification.broadcast.send');
    const from = new Date(now.getTime() - HUB_WINDOW_DAYS * 86_400_000);
    const [provider, serving, overrides, declaring, policy, byStatus, ids] = await Promise.all([
      this.repo.providerFacts(tenantId), this.repo.servingByChannel(tenantId), this.repo.whatsappOverrides(tenantId), this.repo.eventsDeclaringWhatsApp(),
      this.repo.getPolicy(tenantId), this.broadcasts.statusCounts(tenantId), this.broadcasts.fannedOutSince(tenantId, from, HUB_BROADCAST_MAX),
    ]);
    const logs = await this.broadcasts.logGroups(tenantId, ids);
    const counts = addCounts([...logs.values()].map((l) => countBroadcast(l.recipients, l.groups)));
    const whatsappServing = serving.find((s) => s.channel === 'whatsapp');
    return {
      provider: { connected: provider.connected, messageProviders: provider.messageProviders },
      templates: { byChannel: serving, whatsappServing: (whatsappServing?.platform ?? 0) + (whatsappServing?.own ?? 0), whatsappOverrides: overrides, eventsDeclaringWhatsApp: declaring },
      broadcasts: { windowDays: HUB_WINDOW_DAYS, byStatus, fannedOut: ids.length, cut: ids.length >= HUB_BROADCAST_MAX, counts },
      optin: { recorded: policy !== null, collectionState: 'not_collected' as const, version: policy?.version ?? null },
      refused: WHATSAPP_REFUSED,
    };
  }

  async policy(tenantId: string, actor: WhatsAppActor): Promise<{ policy: OptinPolicyRow | null; sources: Array<{ code: string; name: string }>; collectionState: 'not_collected'; canManage: boolean; providerConnected: boolean }> {
    const [policy, sources, provider] = await Promise.all([this.repo.getPolicy(tenantId), this.repo.optinSources(), this.repo.providerFacts(tenantId)]);
    return { policy, sources, collectionState: 'not_collected', canManage: actor.canManagePolicy, providerConnected: provider.connected };
  }

  async previewPolicy(tenantId: string, actor: WhatsAppActor, dto: OptinInput): Promise<OptinReview> {
    const [existing, sources] = await Promise.all([this.repo.getPolicy(tenantId), this.repo.optinSources()]);
    return reviewOptinPolicy(dto, { canManage: actor.canManagePolicy, vocabulary: sources.map((s) => s.code), existing });
  }

  async savePolicy(tenantId: string, actor: WhatsAppActor, key: string, dto: OptinInput & { expectVersion?: number }, meta: WriteMeta) {
    return this.idem.remember(key, actor.userId, 'communication.whatsapp.optin_policy', () =>
      this.uow.run(tenantId, async (tx) => {
        const existing = await this.repo.getPolicy(tenantId, tx);
        if (dto.expectVersion !== undefined && (existing?.version ?? null) !== dto.expectVersion) throw new WhatsAppPolicyChangedError();
        const sources = await this.repo.optinSources();
        const review = reviewOptinPolicy(dto, { canManage: actor.canManagePolicy, vocabulary: sources.map((s) => s.code), existing });
        if (!review.ready) throw new WhatsAppPolicyRefusedError(review.refusals);
        const s = review.stored;
        if (existing) await this.repo.updatePolicy(tx, tenantId, s.sources, s.consentStatement!, actor.userId);
        else await this.repo.insertPolicy(tx, tenantId, s.sources, s.consentStatement!, actor.userId);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: WhatsAppEvents.PolicySaved, entityType: 'whatsapp_optin_policy', entityId: tenantId,
          oldValue: existing ? { sources: existing.sources, consentStatement: existing.consentStatement, version: existing.version } : null,
          newValue: { sources: s.sources, consentStatement: s.consentStatement, collectionState: 'not_collected' }, ip: meta.ip, requestId: meta.requestId });
        await this.outbox.write(tx, { tenantId, aggregateType: 'whatsapp_optin_policy', aggregateId: tenantId, eventType: WhatsAppEvents.PolicySaved, payload: { v: 1, sources: s.sources } });
        return { saved: true, version: (existing?.version ?? 0) + 1, collectionState: 'not_collected' as const };
      }, { userId: actor.userId }));
  }
}
