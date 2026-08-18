// modules/identity/services/privacy.service.ts · DPDP data-subject self-service (PRD §13.3).
// A user REQUESTS a data export (portability) or account deletion (erasure); the PLATFORM is the data controller
// and fulfils it server-side (compliance-ops in admin-api compiles the export / runs retention holds then erases)
// — the client only requests (Law 11). Owner-scoped to the caller's own userId (re-resolved from the token, no
// IDOR). Idempotent on the caller's key (Law 3) AND deduped to one OPEN request per kind. Erasure carries the
// statutory 90-day cooling-off (set in the domain). Each request emits an outbox event for the fulfilment plane.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { DataSubjectRequest, DsrType } from '../domain/data-subject-request.entity';
import { DataSubjectRequestRepository } from '../repositories/data-subject-request.repository';

function toJSON(d: DataSubjectRequest) {
  const p = d.toProps();
  return { id: p.id, kind: p.requestType === 'erasure' ? 'deletion' : 'export', status: p.status, coolingEndsAt: p.coolingEndsAt };
}

@Injectable()
export class PrivacyService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: DataSubjectRequestRepository,
  ) {}

  requestExport(tenantId: string, userId: string, idemKey: string) { return this.open(tenantId, userId, idemKey, 'portability'); }
  /** Erasure request. An optional free-text `reason` (the "why leaving" the app collects) is NOT a DPDP field, so it
   *  is NOT stored on the request row — it rides the outbox event (length-capped) for the fulfilment/CRM plane only. */
  requestDeletion(tenantId: string, userId: string, idemKey: string, reason?: string) { return this.open(tenantId, userId, idemKey, 'erasure', reason); }

  private open(tenantId: string, userId: string, idemKey: string, requestType: DsrType, reason?: string) {
    return this.idem.remember(idemKey, userId, `identity.dsr.${requestType}`, () =>
      timed(this.metrics, 'identity.dsr.open', { tenant: tenantId, type: requestType }, () =>
        this.uow.run(tenantId, async (tx) => {
          const existing = await this.repo.findOpen(tx, userId, requestType);
          if (existing) return toJSON(existing);                       // one open request per kind — idempotent
          const dsr = DataSubjectRequest.open({ id: uuidv7(), userId, requestType });
          await this.repo.insert(tx, dsr);
          const reasonNote = reason ? String(reason).slice(0, 500) : undefined;   // capped; never a raw dump
          await this.outbox.write(tx, { tenantId, aggregateType: 'data_subject_request', aggregateId: dsr.id, eventType: 'identity.dsr_opened', payload: { v: 1, dsrId: dsr.id, userId, requestType, ...(reasonNote ? { reason: reasonNote } : {}) } });
          return toJSON(dsr);
        }, { userId })));
  }

  async listMine(tenantId: string, userId: string) {
    const rows = await this.repo.listByUser(tenantId, userId);
    return { items: rows.map(toJSON) };
  }
}
