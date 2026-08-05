// modules/identity/services/kyc-document.service.ts · KYC submit + admin review (audited).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { KycNotFoundError } from '../domain/identity.errors';
import { KycDocument } from '../domain/kyc-document.entity';
import { KycDocumentRepository } from '../repositories/kyc-document.repository';
import { UserTenantRoleRepository } from '../repositories/user-tenant-role.repository';
import { SubmitKycDto, ReviewKycDto } from '../dto/create-kyc-document.dto';

@Injectable()
export class KycDocumentService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly audit: AuditWriter,
    private readonly kyc: KycDocumentRepository,
    private readonly utr: UserTenantRoleRepository,
  ) {}

  async submit(tenantId: string, userId: string, dto: SubmitKycDto) {
    const id = await this.uow.run(tenantId, async (tx) => {
      const doc = KycDocument.submit({ id: uuidv7(), tenantId, userId, roleId: dto.roleId ?? null, docTypeId: dto.docTypeId, mediaId: dto.mediaId, docNoMasked: dto.docNoMasked, issuedBy: dto.issuedBy, validFrom: dto.validFrom, validUntil: dto.validUntil });
      await this.kyc.insert(tx, doc);
      await this.utr.setKycStatus(tx, tenantId, userId, dto.roleId ?? null, 'pending');
      await this.flush(tx, doc.id, doc.pullEvents(), tenantId);
      return doc.id;
    }, { userId });
    return { id };
  }

  async review(tenantId: string, reviewerId: string, kycId: string, dto: ReviewKycDto, ip: string | null) {
    const result = await this.uow.run(tenantId, async (tx) => {
      const doc = await this.kyc.getForUpdate(tx, tenantId, kycId);
      if (!doc) throw new KycNotFoundError(kycId);
      const before = doc.status;
      if (dto.decision === 'verify') { doc.verify(reviewerId); await this.utr.setKycStatus(tx, tenantId, doc.userId, doc.toProps().roleId, 'verified'); }
      else { doc.reject(reviewerId, dto.reason ?? 'rejected'); await this.utr.setKycStatus(tx, tenantId, doc.userId, doc.toProps().roleId, 'rejected'); }
      await this.kyc.update(tx, doc);
      await this.flush(tx, doc.id, doc.pullEvents(), tenantId);
      await this.audit.write(tx, { tenantId, actorUserId: reviewerId, action: `kyc.${dto.decision}`, entityType: 'kyc_document', entityId: doc.id, oldValue: { status: before }, newValue: { status: doc.status }, reason: dto.reason ?? null, ip });
      return doc.status;
    }, { userId: reviewerId });
    return { status: result };
  }

  list(tenantId: string, userId: string, status?: string) {
    return this.kyc.listByUser(tenantId, userId, status).then((docs) => docs.map((d) => d.toProps()));
  }

  /** PC-54 W54-1 `kyc-review-read-models` (Ledger Appendix 6): the reviewer QUEUE. Evidence-before-decision:
   *  without this read, kyc/:id/review was a blind write. Approve-gated at the controller. */
  async reviewQueue(tenantId: string, q: { status: string; cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.kyc.listForReview(tenantId, q);
    const items = rows.map((r) => ({ ...r.doc.toProps(), createdAt: r.createdAt }));
    const last = rows[rows.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${last.createdAt}|${last.doc.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
  /** PC-54 W54-1: the CASE read — submission facts + the media id (evidence pointer; PII stays masked). */
  async reviewCase(tenantId: string, id: string) {
    const doc = await this.kyc.getById(tenantId, id);
    return doc ? doc.toProps() : null;
  }

  /** Catalogue of accepted KYC document types (seeded 'doc_type' lookup) so the client shows a name
   *  and submits a real docTypeId instead of guessing a UUID. Read-only; no PII. */
  listDocTypes(tenantId: string) {
    return this.kyc.listDocTypes(tenantId);
  }

  private async flush(tx: TxContext, id: string, events: { type: string; payload: Record<string, unknown> }[], tenantId: string) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'kyc_document', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
