// modules/schemes/services/field-verification.service.ts · PC-54 W54-3 `scheme-field-visits`.
// Canon rules (Appendix 6 + 0066 header): officer-of-record only may submit; evidence = media ids
// (geotag [{mediaId,lat,lng,capturedAt}], walk-trace media ref); one open visit per application (DB unique);
// OTP sign-off remains a recorded STATUS (the farmer-side OTP leg is its own future wave). Process-gated.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { FieldVerificationRepository, FieldVisit } from '../repositories/field-verification.repository';

export interface VisitActor { userId: string; canProcess: boolean }

@Injectable()
export class FieldVerificationService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, private readonly repo: FieldVerificationRepository) {}

  async schedule(tenantId: string, actor: VisitActor, applicationId: string, scheduledFor?: string) {
    if (!actor.canProcess) throw new ForbiddenError('requires scheme.process');
    const id = uuidv7();
    await this.uow.run(tenantId, async (tx) => {
      try { await this.repo.schedule(tx, { id, tenantId, applicationId, officerId: actor.userId, scheduledFor }); }
      catch (e: any) { if (e?.code === '23505') throw new ConflictError('an open field visit already exists for this application'); throw e; }
    }, { userId: actor.userId });
    return { id, status: 'scheduled' as const };
  }

  async list(tenantId: string, applicationId: string): Promise<FieldVisit[]> {
    return this.repo.listForApplication(tenantId, applicationId);
  }

  /** Officer-of-record submits findings; optimistic lock; server enforces the identity rule (W335/W337). */
  async submit(tenantId: string, actor: VisitActor, id: string, dto: { geotag: Array<{ mediaId: string; lat: number; lng: number; capturedAt: string }>; measuredValues: Record<string, unknown>; walkTraceMediaId?: string }) {
    if (!actor.canProcess) throw new ForbiddenError('requires scheme.process');
    return this.uow.run(tenantId, async (tx) => {
      const visit = await this.repo.getForUpdate(tx, tenantId, id);
      if (!visit) throw new NotFoundError('field visit not found');
      if (visit.officerId !== actor.userId) throw new ForbiddenError('officer-of-record only (W335/W337)');
      const geotag = dto.geotag.map((g) => ({ media_id: g.mediaId, lat: g.lat, lng: g.lng, captured_at: g.capturedAt }));
      const ok = await this.repo.submit(tx, tenantId, id, visit.version, { geotag, measuredValues: dto.measuredValues, walkTrace: dto.walkTraceMediaId });
      if (!ok) throw new ConflictError('visit is not submittable in its current state');
      return { id, status: 'submitted' as const };
    }, { userId: actor.userId });
  }
}
