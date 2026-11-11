// modules/schemes/services/field-verification.service.ts · PC-54 W54-3 `scheme-field-visits` (0066).
// PC-56 GOV-4a (GOV-4 Q2-A, lead-applied 2026-11-11 — the founder may reopen): field visits are not done through the platform for now.
// `schedule` and `submit` are CLOSED — FIELD_VISITS_ARE_NOT_RECORDED_HERE for every caller (a scheme.process holder included), before
// anything is read or written: no visit row, no status move. Until GOV-4a the comment here said "OTP sign-off remains a recorded STATUS";
// nothing ever wrote it (survey_gov4.md C-4) — a visit could be "submitted" with no farmer sign-off. What stays: the read of one
// application's visits recorded before GOV-4a, by its applicant or a `scheme.process` holder only (HOTFIX-15).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { FieldVerificationRepository, FieldVisit } from '../repositories/field-verification.repository';
import { SchemeApplicationRepository } from '../repositories/scheme-application.repository';
import { ApplicationNotFoundError, FieldVisitsAreNotRecordedHereError } from '../domain/schemes.errors';

export interface VisitActor { userId: string; canProcess: boolean }

@Injectable()
export class FieldVerificationService {
  // The unit of work stays injected (the module's provider shape is unchanged); since GOV-4a nothing here opens a transaction.
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, private readonly repo: FieldVerificationRepository, private readonly applications: SchemeApplicationRepository) {}

  /** PC-56 GOV-4a (Q2-A): CLOSED — refused by name for every caller (no permission is asked first, so the name is heard), before the
   *  application is read and before anything is written. */
  async schedule(_tenantId: string, _actor: VisitActor, _applicationId: string, _scheduledFor?: string): Promise<never> {
    throw new FieldVisitsAreNotRecordedHereError('schedule_visit');
  }

  /**
   * PC-56 HOTFIX-15 (survey GOV-1 F-3 / C-11): a visit carries the farm's GPS points, measurements and walk trace (PII / location), so
   * it is read ONLY by the application's applicant or a `scheme.process` holder of this organisation — anyone else, and an unknown id,
   * gets the same 404 with no body (`ApplicationNotFoundError`, exactly as `SchemeApplicationService.getById`) — no existence oracle.
   * The refusal comes BEFORE any visit is read. Until this wave the route had no permission and passed no actor.
   * KEPT by PC-56 GOV-4a: the applicant's own read of the visits recorded before (it writes nothing).
   */
  async list(tenantId: string, actor: VisitActor, applicationId: string): Promise<FieldVisit[]> {
    const app = await this.applications.getById(tenantId, applicationId);
    if (!app) throw new ApplicationNotFoundError(applicationId);
    if (app.applicantUserId !== actor.userId && !actor.canProcess) throw new ApplicationNotFoundError(applicationId); // 404, no IDOR
    return this.repo.listForApplication(tenantId, applicationId);
  }

  /** PC-56 GOV-4a (Q2-A): CLOSED — refused by name for every caller, before the visit is read or locked and before anything is written.
   *  (Before GOV-4a: officer-of-record only, optimistic lock, and no farmer sign-off was ever asked.) */
  async submit(_tenantId: string, _actor: VisitActor, _id: string, _dto: unknown): Promise<never> {
    throw new FieldVisitsAreNotRecordedHereError('submit_visit');
  }
}
