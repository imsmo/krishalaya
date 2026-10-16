// modules/identity/services/privacy.service.ts · DPDP data-subject self-service (PRD §13.3).
// A user REQUESTS a data export (portability) or account deletion (erasure); the PLATFORM is the data controller
// and fulfils it server-side — the client only requests (Law 11). Owner-scoped to the caller's own userId (re-resolved from the token, no
// IDOR). Idempotent on the caller's key (Law 3) AND deduped to one OPEN request per kind. Erasure carries the statutory 90-day cooling-off
// (set in the domain). Each request emits an outbox event for the fulfilment plane.
//
// PC-56 STORE-4a (founder decisions 2026-10-16):
//   • D2 — THE EXPORT IS COMPILED AUTOMATICALLY ON THE EXPORT PLANE. `requestExport` enqueues the PERSONAL dataset `identity.dpdp_person`
//     (`exports/dpdp-person.producer.ts`) with params `{ userId: <the caller> }` in the request's own transaction, links the job to the request
//     (0214 `export_job_id`) and moves the request `open → in_progress` (the entity decides — Law 5). The request's list (`listMine`) JOINS the
//     plane's live job: `queued` → the position and the honest ETA, `ready` → the receipt (file, rows, sha256, generated-at, requester) and
//     `download.kind`, `expired` after the 7-day retention, `failed` with its code. The request moves `in_progress → completed` when a read
//     (the list, or a second request) sees the job `ready` or `expired` — a monotonic, idempotent write; NO outbox handler is added (the relay
//     gate stays 170). A second request while the job is queued/running answers the SAME request and job; a FAILED job is re-enqueued and
//     relinked on the next request; an EXPIRED one closes the old request and opens a new one.
//   • D1 — DELETION IS REFUSED WHILE ANYTHING IS OPEN. `requestDeletion` reads migration 0214's `kv_person_open_commitments` (orders as buyer
//     not completed / cancelled / refunded in ANY organisation, money in escrow, a wallet main balance) inside its transaction, and a person
//     with any of them gets `DSR_BLOCKED` (409) with the figures — nothing is written, and NO MONEY MOVES (a wallet balance is paid out by the
//     person through the existing payout flow). `commitments()` serves the same figures + the retention years (`platform.invoice_retention_years`,
//     0214) + the cooling days to the confirm page. An allowed request is audited `dsr.requested` (the request id and its kind — no PII).
//   • D3 — the cooling is 90 days (`ERASURE_COOLING_DAYS`) and the answer carries `coolingEndsAt`.
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ExportPlaneService, ExportJobView } from '../../../core/exports-plane/export-plane.service';
import { DomainError } from '../../../shared/errors/app-error';
import { DataSubjectRequest, DsrType, ERASURE_COOLING_DAYS } from '../domain/data-subject-request.entity';
import { DataSubjectRequestRepository, PersonCommitments } from '../repositories/data-subject-request.repository';
import { DPDP_PERSON_DATASET } from '../exports/dpdp-person.producer';

/** PC-56 STORE-4a · B1 (founder D1): a deletion request refused while something is open — the figures say what. 409. */
export class DsrBlockedError extends DomainError {
  constructor(c: PersonCommitments) {
    super('DSR_BLOCKED', 'Deletion cannot be requested while orders, escrow or a wallet balance are open', 409,
      { openOrders: c.openOrders, escrowMinor: c.escrowMinor, walletMinor: c.walletMinor, currencyCode: c.currencyCode, multiCurrency: c.multiCurrency });
  }
}

/** The pre-check's rule, pure (unit-tested): blocked while ANY order is open, ANY money is in escrow or ANY wallet balance is above zero. */
export function deletionBlocked(c: Pick<PersonCommitments, 'openOrders' | 'escrowMinor' | 'walletMinor'>): boolean {
  return c.openOrders > 0 || BigInt(c.escrowMinor) > 0n || BigInt(c.walletMinor) > 0n;
}

/** What the confirm page reads (`GET /v1/privacy/commitments`). Read-only; nothing moves. */
export interface CommitmentsView extends PersonCommitments { blocked: boolean; retentionYears: number | null; coolingDays: number }

/** The export half of a request row — the plane's live job, projected for its requester. */
export interface DsrExportView {
  jobId: string; status: ExportJobView['status']; standing: ExportJobView['standing']; receipt: ExportJobView['receipt'];
  download: ExportJobView['download']; failure: ExportJobView['failure']; expiresAt: string | null; generatedAt: string | null;
}
export interface DsrView { id: string; kind: 'export' | 'deletion'; status: string; coolingEndsAt: Date | null; requestedAt: Date | null; export: DsrExportView | null }

function exportViewOf(v: ExportJobView | null): DsrExportView | null {
  if (!v) return null;
  return { jobId: v.id, status: v.status, standing: v.standing, receipt: v.receipt, download: v.download, failure: v.failure, expiresAt: v.expiresAt, generatedAt: v.generatedAt };
}
function toJSON(d: DataSubjectRequest, job: ExportJobView | null = null): DsrView {
  const p = d.toProps();
  return { id: p.id, kind: p.requestType === 'erasure' ? 'deletion' : 'export', status: p.status, coolingEndsAt: p.coolingEndsAt, requestedAt: p.createdAt ?? null, export: exportViewOf(job) };
}
/** The client's key, hashed with the person and the act (the STORE-3a shape — `idempotency_keys.key` is bounded). */
const keyOf = (scope: string, userId: string, key: string) => createHash('sha256').update(`${scope}:${userId}:${key}`).digest('base64url');

@Injectable()
export class PrivacyService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: DataSubjectRequestRepository,
    private readonly audit: AuditWriter,
    private readonly exportsPlane: ExportPlaneService,
  ) {}

  /* ------------------------------------------------------------------------------------------------------------ */
  /* EXPORT (founder D2)                                                                                           */
  /* ------------------------------------------------------------------------------------------------------------ */
  requestExport(tenantId: string, userId: string, idemKey: string, ip: string | null = null): Promise<DsrView> {
    return this.idem.remember(keyOf('dsr.portability', userId, idemKey), userId, 'identity.dsr.portability', () =>
      timed(this.metrics, 'identity.dsr.open', { tenant: tenantId, type: 'portability' }, async () => {
        // a request already open: read its job (committed earlier — the replica sees it) BEFORE deciding, outside the write
        const res = await this.uow.run(tenantId, async (tx) => {
          await this.repo.lockPerson(tx, userId, 'portability');
          const existing = await this.repo.findOpen(tx, userId, 'portability');
          if (existing) {
            const jobId = existing.toProps().exportJobId ?? null;
            const job = jobId ? await this.exportsPlane.viewPersonal(tenantId, userId, jobId) : null;
            if (job && (job.status === 'queued' || job.status === 'running')) return { dsr: existing, jobId };   // the SAME request, the SAME job
            if (job && job.status === 'ready') { await this.settle(tx, existing, job); return { dsr: existing, jobId }; }   // the file is there
            if (job && job.status === 'expired') {
              await this.settle(tx, existing, job);                       // the old file is gone: close it, open a new request below
            } else {
              // no job yet (a request from before 0214) or a FAILED job: enqueue now and (re)link the SAME request
              const queued = await this.enqueue(tx, tenantId, userId, ip);
              existing.linkExportJob(queued);
              if (existing.toProps().status === 'open') existing.transition('in_progress');
              await this.repo.update(tx, existing);
              return { dsr: existing, jobId: queued };
            }
          }
          const dsr = DataSubjectRequest.open({ id: uuidv7(), userId, requestType: 'portability' });
          await this.repo.insert(tx, dsr);
          const jobId = await this.enqueue(tx, tenantId, userId, ip);
          dsr.linkExportJob(jobId);
          dsr.transition('in_progress');
          await this.repo.update(tx, dsr);
          await this.outbox.write(tx, { tenantId, aggregateType: 'data_subject_request', aggregateId: dsr.id, eventType: 'identity.dsr_opened', payload: { v: 1, dsrId: dsr.id, userId, requestType: 'portability' } });
          await this.audit.write(tx, { tenantId, actorUserId: userId, action: 'dsr.requested', entityType: 'data_subject_request', entityId: dsr.id, newValue: { kind: 'export', exportJobId: jobId }, ip });
          return { dsr, jobId };
        }, { userId });
        // the job as the plane says now (committed) — position + ETA while queued
        const job = res.jobId ? await this.exportsPlane.viewPersonal(tenantId, userId, res.jobId) : null;
        return toJSON(await this.reread(tenantId, userId, res.dsr), job);
      }));
  }

  private async enqueue(tx: TxContext, tenantId: string, userId: string, ip: string | null): Promise<string> {
    const r = await this.exportsPlane.enqueueInTx(tx, tenantId, userId, { datasetCode: DPDP_PERSON_DATASET, params: { userId } }, ip);
    // a personal dataset is never behind the plane's flag (founder D2) — 'off' here means the dataset is not registered, which is a defect
    if (r.kind !== 'queued') throw new Error('identity.dpdp_person: the personal export could not be queued');
    return r.jobId;
  }

  /** The request moves `in_progress → completed` once its file was produced (`ready`, or `expired` after it was served) — monotonic. */
  private async settle(tx: TxContext, dsr: DataSubjectRequest, job: ExportJobView): Promise<void> {
    if (dsr.toProps().status !== 'in_progress') return;
    dsr.transition('completed', `export ${job.status} · job ${job.id}${job.receipt ? ` · sha256 ${job.receipt.sha256}` : ''}`);
    await this.repo.update(tx, dsr);
  }

  private async reread(tenantId: string, userId: string, d: DataSubjectRequest): Promise<DataSubjectRequest> {
    const rows = await this.repo.listByUser(tenantId, userId);
    return rows.find((x) => x.id === d.id) ?? d;
  }

  /* ------------------------------------------------------------------------------------------------------------ */
  /* DELETION (founder D1 / D3)                                                                                    */
  /* ------------------------------------------------------------------------------------------------------------ */
  /** Erasure request. An optional free-text `reason` (the "why leaving" the app collects) is NOT a DPDP field, so it
   *  is NOT stored on the request row — it rides the outbox event (length-capped) for the fulfilment/CRM plane only. */
  requestDeletion(tenantId: string, userId: string, idemKey: string, reason?: string, ip: string | null = null): Promise<DsrView> {
    return this.idem.remember(keyOf('dsr.erasure', userId, idemKey), userId, 'identity.dsr.erasure', () =>
      timed(this.metrics, 'identity.dsr.open', { tenant: tenantId, type: 'erasure' }, () =>
        this.uow.run(tenantId, async (tx) => {
          await this.repo.lockPerson(tx, userId, 'erasure');
          const existing = await this.repo.findOpen(tx, userId, 'erasure');
          if (existing) return toJSON(existing);                       // one open request per kind — idempotent
          // THE PRE-CHECK (founder D1): across every organisation, in this transaction — refused with the figures; nothing written
          const c = await this.repo.commitments(tx, userId);
          if (deletionBlocked(c)) throw new DsrBlockedError(c);
          const dsr = DataSubjectRequest.open({ id: uuidv7(), userId, requestType: 'erasure' });
          await this.repo.insert(tx, dsr);
          const reasonNote = reason ? String(reason).slice(0, 500) : undefined;   // capped; never a raw dump
          await this.outbox.write(tx, { tenantId, aggregateType: 'data_subject_request', aggregateId: dsr.id, eventType: 'identity.dsr_opened', payload: { v: 1, dsrId: dsr.id, userId, requestType: 'erasure', ...(reasonNote ? { reason: reasonNote } : {}) } });
          // "this action is recorded" (canon W300) — TRUE: the request id, its kind and the cooling date; no PII, no reason text
          await this.audit.write(tx, { tenantId, actorUserId: userId, action: 'dsr.requested', entityType: 'data_subject_request', entityId: dsr.id, newValue: { kind: 'deletion', coolingEndsAt: dsr.toProps().coolingEndsAt?.toISOString() ?? null }, ip });
          return toJSON(dsr);
        }, { userId })));
  }

  /** The confirm page's figures (founder D1): the same read the pre-check makes, + the retention years and the cooling days. Read-only. */
  async commitments(tenantId: string, userId: string): Promise<CommitmentsView> {
    return this.uow.run(tenantId, async (tx) => {
      const c = await this.repo.commitments(tx, userId);
      const retentionYears = await this.repo.invoiceRetentionYears(tx);
      return { ...c, blocked: deletionBlocked(c), retentionYears, coolingDays: ERASURE_COOLING_DAYS };
    }, { userId });
  }

  /* ------------------------------------------------------------------------------------------------------------ */
  /* THE LIST (bounded) — each export request joined to the plane's live job                                       */
  /* ------------------------------------------------------------------------------------------------------------ */
  async listMine(tenantId: string, userId: string): Promise<{ items: DsrView[] }> {
    const rows = await this.repo.listByUser(tenantId, userId);
    const items: DsrView[] = [];
    for (const d of rows) {
      const jobId = d.toProps().exportJobId ?? null;
      const job = jobId ? await this.exportsPlane.viewPersonal(tenantId, userId, jobId) : null;
      if (job && (job.status === 'ready' || job.status === 'expired') && d.toProps().status === 'in_progress') {
        await this.uow.run(tenantId, async (tx) => {
          const locked = await this.repo.getForUpdate(tx, d.id, userId);
          if (locked) { await this.settle(tx, locked, job); d.transition('completed'); }
        }, { userId });
      }
      items.push(toJSON(d, job));
    }
    return { items };
  }
}

export type { DsrType };
