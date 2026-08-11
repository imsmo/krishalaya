// modules/communication/services/template-admin.service.ts · tenant authoring of notification templates.
// Requires notification.manage (enforced at the controller). The event_code must exist in the GLOBAL catalog
// (fail-closed). A tenant may only ever write its OWN templates (tenant_id = caller's tenant) — platform
// defaults are not editable here (Law 11). Idempotent upsert on (event_code,channel,language_code,tenant_id).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { NotificationEventRepository } from '../repositories/notification-event.repository';
import { NotificationTemplateRepository } from '../repositories/notification-template.repository';
import { NotificationEventNotFoundError, SecurityCopyPlatformOnlyError } from '../domain/communication.errors';

export interface UpsertTemplateInput { eventCode: string; channel: string; languageCode: string; subject: string | null; body: string; providerTemplateRef: string | null; isActive: boolean; }

@Injectable()
export class TemplateAdminService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly events: NotificationEventRepository,
    private readonly templates: NotificationTemplateRepository,
  ) {}

  async upsert(tenantId: string, userId: string, dto: UpsertTemplateInput) {
    const event = await this.events.getByCode(dto.eventCode);
    if (!event) throw new NotificationEventNotFoundError(dto.eventCode);
    // **THE RULE W101 WROTE DOWN AND NOTHING ENFORCED (PC-56 ADMIN-11b).** This method's own header says "a tenant may
    // only ever write its OWN templates" and that was the whole of the check — so a tenant could author its own
    // `auth.otp` body, and `resolve()` prefers a tenant row over the platform default for every event. Refused here AND
    // by a trigger in 0122: two layers, each with its own test, because a service check binds one realm and this table
    // has three writers.
    if (event.userCanOptOut === false || event.priority === 'critical') {
      throw new SecurityCopyPlatformOnlyError(dto.eventCode);
    }
    return this.uow.run(tenantId, async (tx) => {
      await this.templates.upsert(tx, tenantId, dto, uuidv7());
      const [t] = await this.templates.listFor(tenantId, { eventCode: dto.eventCode, channel: dto.channel, languageCode: dto.languageCode, limit: 1 });
      return t?.toJSON() ?? { ...dto, tenantId };
    }, { userId });
  }
  async list(tenantId: string, q: { eventCode?: string; channel?: string; languageCode?: string; cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.templates.listFor(tenantId, q);
    const items = rows.map((t) => t.toJSON());
    const last = items[items.length - 1] as any;
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${last.createdAt?.toISOString?.() ?? ''}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
  async listCatalog() { return (await this.events.list()).map((e) => e.toJSON()); }
}
