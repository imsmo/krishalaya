// modules/schemes/services/field-verification.service.ts · PC-54 W54-3 `scheme-field-visits`.
// Canon rules (Appendix 6 + 0066 header): officer-of-record only may submit; evidence = media ids
// (geotag [{mediaId,lat,lng,capturedAt}], walk-trace media ref); one open visit per application (DB unique);
// OTP sign-off remains a recorded STATUS (the farmer-side OTP leg is its own future wave). Process-gated.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { FieldVerificationRepository, FieldVisit } from '../repositories/field-verification.repository';
import { SchemeApplicationRepository } from '../repositories/scheme-application.repository';
import { ApplicationNotFoundError } from '../domain/schemes.errors';

export interface VisitActor { userId: string; canProcess: boolean }

@Injectable()
export class FieldVerificationService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, private readonly repo: FieldVerificationRepository, private readonly applications: SchemeApplicationRepository) {}

  async schedule(tenantId: string, actor: VisitActor, applicationId: string, scheduledFor?: string) {
    if (!actor.canProcess) throw new ForbiddenError('requires scheme.process');
    const id = uuidv7();
    await this.uow.run(tenantId, async (tx) => {
      try { await this.repo.schedule(tx, { id, tenantId, applicationId, officerId: actor.userId, scheduledFor }); }
      catch (e: any) { if (e?.code === '23505') throw new ConflictError('an open field visit already exists for this application'); throw e; }
    }, { userId: actor.userId });
    return { id, status: 'scheduled' as const };
  }

  /**
   * PC-56 HOTFIX-15 (survey GOV-1 F-3 / C-11): a visit carries the farm's GPS points, measurements and walk trace (PII / location), so
   * it is read ONLY by the application's applicant or a `scheme.process` holder of this organisation — anyone else, and an unknown id,
   * gets the same 404 with no body (`ApplicationNotFoundError`, exactly as `SchemeApplicationService.getById`) — no existence oracle.
   * The refusal comes BEFORE any visit is read. Until this wave the route had no permission and passed no actor.
   */
  async list(tenantId: string, actor: VisitActor, applicationId: string): Promise<FieldVisit[]> {
    const app = await this.applications.getById(tenantId, applicationId);
    if (!app) throw new ApplicationNotFoundError(applicationId);
    if (app.applicantUserId !== actor.userId && !actor.canProcess) throw new ApplicationNotFoundError(applicationId); // 404, no IDOR
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
