// modules/identity/jobs/kyc-expiry-reminders.job.ts · worker job: nudge the people whose verified KYC lapses soon.
//
// [PC-56 TENANT-9a] F-3: "Within `days`, remind once" was false — there was no sent-marker, so every tick re-emitted
// `identity.kyc_expiring` for every verified document within the window AND for every already-lapsed one, forever, and
// the event had no consumer. Now: a document is reminded ONCE (`expiry_reminded_at`, 0180), only while it is still valid
// (a lapsed one is the expiry job's business), the window is in the cooperative's own days (`kyc_tenant_today`), and the
// payload carries what `kyc.expiring` (seed 0007) renders: the recipient, the document's name in each language, the day.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { noticeDay } from '../domain/kyc-expiry';
import { KycDocumentRepository } from '../repositories/kyc-document.repository';

@Injectable()
export class KycExpiryRemindersJob {
  private readonly log = new Logger(KycExpiryRemindersJob.name);
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork, @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly kyc: KycDocumentRepository, private readonly ui: UiMessageRepository,
  ) {}
  /** Within `days`, remind ONCE. Returns the number of reminders queued for the tenant. */
  async runForTenant(tenantId: string, days = 30): Promise<number> {
    return this.uow.run(tenantId, async (tx) => {
      const due = await tx.query<{ id: string; notify: string; doc_type_code: string; valid_until: string }>(
        `SELECT id, COALESCE(user_id, submitted_by) AS notify, doc_type_code, valid_until::text AS valid_until FROM kyc_documents
          WHERE tenant_id = $1 AND status='verified' AND valid_until IS NOT NULL AND expiry_reminded_at IS NULL AND deleted_at IS NULL
            AND valid_until >= kyc_tenant_today($1) AND valid_until <= kyc_tenant_today($1) + $2::int
          ORDER BY valid_until, id LIMIT 500 FOR UPDATE SKIP LOCKED`, [tenantId, days]);
      if (due.rows.length === 0) return 0;
      const words = await this.ui.mapsUnder('kyc.doc_type.', tx);
      for (const d of due.rows) {
        await this.outbox.write(tx, { tenantId, aggregateType: 'kyc_document', aggregateId: d.id, eventType: 'identity.kyc_expiring',
          payload: { v: 1, kycId: d.id, notifyUserId: d.notify, docTypeCode: d.doc_type_code, validUntil: d.valid_until,
            document: words.get(`kyc.doc_type.${d.doc_type_code}`) ?? { en: d.doc_type_code }, day: noticeDay(d.valid_until) } });
        await this.kyc.markReminded(tx, tenantId, d.id);
      }
      this.log.log(`queued ${due.rows.length} KYC expiry reminders for tenant ${tenantId}`);
      return due.rows.length;
    });
  }
}
