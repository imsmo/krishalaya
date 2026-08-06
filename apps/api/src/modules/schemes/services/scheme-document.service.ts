// modules/schemes/services/scheme-document.service.ts · attach / list / detach supporting documents on a scheme
// application (P1-16). OWNER-ONLY (the applicant, anti-IDOR — a non-owner gets 404 via the not-found error, never a
// cross-user leak). Documents are editable ONLY while the application is still being prepared (draft /
// clarification_needed / appealed) — once it's under verification or decided, the evidence set is frozen.
// One ACID tx (UoW); audit + outbox in-tx (Law 4). The raw file never touches this service — only a media REF that
// is verified clean + owned by the caller before linking.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { SchemeApplicationRepository } from '../repositories/scheme-application.repository';
import { SchemeRepository } from '../repositories/scheme.repository';
import { SchemeDocumentRepository, SchemeDocumentRow } from '../repositories/scheme-document.repository';
import { AttachDocumentDto } from '../dto/attach-document.dto';
import { ApplicationNotFoundError, SchemesForbiddenError, DocumentsNotEditableError, DocumentMediaInvalidError, DocumentNotFoundError, InvalidApplicationError } from '../domain/schemes.errors';
import type { SchemesActor } from './dbt-transfer.service';

// Documents may only be changed while the applicant still owns the evidence set.
const EDITABLE = new Set(['draft', 'clarification_needed', 'appealed']);

@Injectable()
export class SchemeDocumentService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly applications: SchemeApplicationRepository,
    private readonly schemes: SchemeRepository,
    private readonly repo: SchemeDocumentRepository,
  ) {}

  async attach(tenantId: string, actor: SchemesActor, applicationId: string, dto: AttachDocumentDto): Promise<SchemeDocumentRow> {
    if (!actor.canApply) throw new SchemesForbiddenError('requires scheme.apply');
    return timed(this.metrics, 'schemes.document.attach', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const app = await this.applications.getForUpdate(tx, tenantId, applicationId);
        if (!app) throw new ApplicationNotFoundError(applicationId);
        if (app.applicantUserId !== actor.userId) throw new ApplicationNotFoundError(applicationId);   // owner-only (anti-IDOR → 404)
        if (!EDITABLE.has(app.status)) throw new DocumentsNotEditableError(app.status);

        // If the scheme declares required doc types, a provided docTypeId must be one of them.
        if (dto.docTypeId) {
          const scheme = await this.schemes.getById(tenantId, app.schemeId, tx);
          const required = scheme ? scheme.toJSON().requiredDocTypeIds : [];
          if (required.length > 0 && !required.includes(dto.docTypeId)) {
            throw new InvalidApplicationError(`docTypeId '${dto.docTypeId}' is not required by this scheme`);
          }
        }
        // Verify the media is clean, a document, and OWNED by the caller before linking (no attaching others' files).
        if (!(await this.repo.mediaAttachable(tx, tenantId, dto.mediaId, actor.userId))) throw new DocumentMediaInvalidError();

        const id = uuidv7();
        await this.repo.insert(tx, { id, tenantId, applicationId, mediaId: dto.mediaId, docTypeId: dto.docTypeId ?? null, note: dto.note ?? null, uploadedBy: actor.userId });
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'schemes.document.attached', entityType: 'scheme_application', entityId: applicationId, newValue: { documentId: id, mediaId: dto.mediaId, docTypeId: dto.docTypeId ?? null }, ip: null });
        await this.outbox.write(tx, { tenantId, aggregateType: 'scheme_application', aggregateId: applicationId, eventType: 'scheme_application.document_attached', payload: { v: 1, applicationId, documentId: id, docTypeId: dto.docTypeId ?? null } });
        // Read back the freshly-inserted row (or the pre-existing one if it was a duplicate no-op).
        const row = await this.repo.getForUpdate(tx, tenantId, id, applicationId);
        return row ?? { id, applicationId, mediaId: dto.mediaId, docTypeId: dto.docTypeId ?? null, note: dto.note ?? null, uploadedBy: actor.userId, createdAt: new Date().toISOString() };
      }, { userId: actor.userId }));
  }

  /** List the application's documents. Visible to the applicant (owner) or an officer (scheme.process). */
  async list(tenantId: string, actor: SchemesActor, applicationId: string): Promise<SchemeDocumentRow[]> {
    const app = await this.applications.getById(tenantId, applicationId);
    if (!app) throw new ApplicationNotFoundError(applicationId);
    const isOwner = app.applicantUserId === actor.userId;
    if (!isOwner && !actor.canProcess) throw new ApplicationNotFoundError(applicationId);   // anti-IDOR → 404
    return this.repo.listForApplication(tenantId, applicationId);
  }

  async detach(tenantId: string, actor: SchemesActor, applicationId: string, documentId: string): Promise<{ ok: boolean }> {
    if (!actor.canApply) throw new SchemesForbiddenError('requires scheme.apply');
    return this.uow.run(tenantId, async (tx) => {
      const app = await this.applications.getForUpdate(tx, tenantId, applicationId);
      if (!app) throw new ApplicationNotFoundError(applicationId);
      if (app.applicantUserId !== actor.userId) throw new ApplicationNotFoundError(applicationId);   // owner-only
      if (!EDITABLE.has(app.status)) throw new DocumentsNotEditableError(app.status);
      const doc = await this.repo.getForUpdate(tx, tenantId, documentId, applicationId);
      if (!doc) throw new DocumentNotFoundError(documentId);
      await this.repo.softDelete(tx, tenantId, documentId);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'schemes.document.detached', entityType: 'scheme_application', entityId: applicationId, newValue: { documentId }, ip: null });
      await this.outbox.write(tx, { tenantId, aggregateType: 'scheme_application', aggregateId: applicationId, eventType: 'scheme_application.document_detached', payload: { v: 1, applicationId, documentId } });
      return { ok: true };
    }, { userId: actor.userId });
  }
}
