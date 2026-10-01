// modules/identity/jobs/kyc-document-expiry.job.ts · PC-56 TENANT-9a · `expired` IS WRITTEN NOW (F-3).
//
// `expired` was a status no code wrote, so a lapsed licence stayed `verified`, the role stayed `verified`, and money kept
// moving; W121's "expired 14" was always 0. Per tenant, in ONE transaction: every verified document whose `valid_until` is
// BEFORE the cooperative's own today (`kyc_tenant_today`) moves to `expired` (0180's trigger re-checks the date), a
// decision row records it (`via expiry_job`, no person), the outbox carries `identity.kyc_expired` (→ `kyc.expired`, seed
// 0007), and every affected PERSON's roles are re-derived from the documents that remain (`projectRoleKyc`) — so a role
// with another valid evidencing document stays verified, and one without reads `expired`. The money gate reads validity
// itself too (`kyc_role_effective_status`), so the gate closes at midnight even if this job is late.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { noticeDay } from '../domain/kyc-expiry';
import { KycDocumentRepository } from '../repositories/kyc-document.repository';
import { UserTenantRoleRepository } from '../repositories/user-tenant-role.repository';
import { projectRoleKyc } from '../services/kyc-role-projector';

@Injectable()
export class KycDocumentExpiryJob {
  private readonly log = new Logger(KycDocumentExpiryJob.name);
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly audit: AuditWriter, private readonly kyc: KycDocumentRepository, private readonly utr: UserTenantRoleRepository,
    private readonly ui: UiMessageRepository,
  ) {}

  /** Returns the documents expired for the tenant. */
  async runForTenant(tenantId: string): Promise<number> {
    return this.uow.run(tenantId, async (tx) => {
      const lapsed = await tx.query<{ id: string; user_id: string | null; notify: string; doc_type_code: string; valid_until: string }>(
        `UPDATE kyc_documents SET status = 'expired', last_decision = 'expire', expired_at = now(), updated_at = now()
          WHERE id IN (SELECT id FROM kyc_documents
                        WHERE tenant_id = $1 AND status = 'verified' AND valid_until IS NOT NULL AND deleted_at IS NULL
                          AND valid_until < kyc_tenant_today($1)
                        ORDER BY valid_until, id LIMIT 500 FOR UPDATE SKIP LOCKED)
        RETURNING id, user_id, COALESCE(user_id, submitted_by) AS notify, doc_type_code, valid_until::text AS valid_until`, [tenantId]);
      if (lapsed.rows.length === 0) return 0;
      const words = await this.ui.mapsUnder('kyc.doc_type.', tx);
      const people = new Set<string>();
      for (const d of lapsed.rows) {
        await this.kyc.insertDecision(tx, { tenantId, documentId: d.id, act: 'expire', fromStatus: 'verified', toStatus: 'expired', decidedBy: null, via: 'expiry_job' });
        await this.outbox.write(tx, { tenantId, aggregateType: 'kyc_document', aggregateId: d.id, eventType: 'identity.kyc_expired',
          payload: { v: 1, kycId: d.id, userId: d.user_id, notifyUserId: d.notify, docTypeCode: d.doc_type_code, validUntil: d.valid_until,
            document: words.get(`kyc.doc_type.${d.doc_type_code}`) ?? { en: d.doc_type_code }, day: noticeDay(d.valid_until) } });
        if (d.user_id) people.add(d.user_id);
      }
      const roleWrites: Record<string, unknown> = {};
      for (const u of people) roleWrites[u] = await projectRoleKyc(tx, tenantId, u, this.kyc, this.utr);
      await this.audit.write(tx, { tenantId, actorUserId: null, action: 'kyc.documents.expired', entityType: 'kyc_document', entityId: null,
        oldValue: null, newValue: { documents: lapsed.rows.map((d) => d.id), roleWrites }, reason: 'valid_until passed (kyc-document-expiry job)', ip: null });
      this.log.log(`expired ${lapsed.rows.length} KYC documents for tenant ${tenantId}`);
      return lapsed.rows.length;
    });
  }
}
