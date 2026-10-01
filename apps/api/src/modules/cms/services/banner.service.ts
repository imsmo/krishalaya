// modules/cms/services/banner.service.ts · schedule + serve promotional banners (tenant-owned; money-free).
// create/activate/deactivate need cms.manage (+ audit on create). The `live` list + click tracking are open to
// any authenticated user; recordClick increments atomically (no lost-update race). authz THROWS.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Banner } from '../domain/banner.entity';
import { DomainEvent } from '../domain/cms.events';
import { BannerRepository } from '../repositories/banner.repository';
import { CreateBannerDto } from '../dto/create-banner.dto';
import { BannerNotFoundError, CmsForbiddenError } from '../domain/cms.errors';
/** PC-56 TENANT-8c: the banner actor is its own (pages moved to cms.pages.*); banners keep `cms.manage` until 8d. */
export interface CmsActor { userId: string; canManage: boolean }

@Injectable()
export class BannerService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: BannerRepository,
  ) {}

  async create(tenantId: string, actor: CmsActor, dto: CreateBannerDto, ip: string | null) {
    if (!actor.canManage) throw new CmsForbiddenError('requires cms.manage');
    return timed(this.metrics, 'cms.banner.create', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const b = Banner.create({ id: uuidv7(), tenantId, placement: dto.placement, mediaId: dto.mediaId, languageCode: dto.languageCode ?? null,
          targetUrl: dto.targetUrl ?? null, audienceRules: dto.audienceRules, startsAt: new Date(dto.startsAt), endsAt: new Date(dto.endsAt) });
        await this.repo.insert(tx, b, actor.userId);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'cms.banner_created', entityType: 'banner', entityId: b.id, newValue: { placement: dto.placement }, ip });
        await this.flush(tx, tenantId, b.id, b.pullEvents());
        return b.toJSON();
      }, { userId: actor.userId }));
  }
  async setActive(tenantId: string, actor: CmsActor, id: string, active: boolean) {
    if (!actor.canManage) throw new CmsForbiddenError('requires cms.manage');
    return this.uow.run(tenantId, async (tx) => {
      const b = await this.repo.getForUpdate(tx, tenantId, id);
      if (!b) throw new BannerNotFoundError(id);
      if (active) b.activate(); else b.deactivate();
      await this.repo.update(tx, b, tenantId);
      return b.toJSON();
    }, { userId: actor.userId });
  }
  /** Public click tracking — atomic increment; 404 if the banner is gone. */
  async recordClick(tenantId: string, actor: CmsActor, id: string) {
    return this.uow.run(tenantId, async (tx) => {
      const ok = await this.repo.incrementClick(tx, tenantId, id);
      if (!ok) throw new BannerNotFoundError(id);
      return { ok: true };
    }, { userId: actor.userId });
  }
  async getById(tenantId: string, id: string) { const b = await this.repo.getById(tenantId, id); if (!b) throw new BannerNotFoundError(id); return b.toJSON(); }
  async list(tenantId: string, actor: CmsActor, q: { box: 'live' | 'all'; placement?: string; cursor?: { c: string; id: string }; limit: number }) {
    if (q.box === 'all' && !actor.canManage) throw new CmsForbiddenError('requires cms.manage');
    const rows = await this.repo.listFor(tenantId, q);
    const items = rows.map((b) => b.toJSON());
    const last = items[items.length - 1] as any;
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${last.createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
  private async flush(tx: TxContext, tenantId: string, id: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'banner', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
