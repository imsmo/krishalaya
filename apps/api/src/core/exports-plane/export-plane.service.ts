// core/exports-plane/export-plane.service.ts · the tenant export plane's use-cases (PC-56 TENANT-6e-2): enqueue, view
// (with position + ETA), mint a signed link, open a download and log the fetch. Generic — WHAT is in the file is the
// registered producer's business. One ACID tx per write, outbox in-tx (Law 4), idempotent enqueue (Law 3), audit on
// every act, tenant-scoped reads (404 for a non-member), fail-closed on the flag store.
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../observability/metrics';
import { AuditWriter } from '../audit/audit.writer';
import { FlagsService } from '../feature-flags/flags.service';
import { AppConfig } from '../config/app-config';
import { uuidv7 } from '../database/uuid.util';
import { OBJECT_STORE, ObjectStore } from '../media/s3-presign.service';
import { ForbiddenError } from '../../shared/errors/app-error';
import { ExportJob, ExportJobProps } from './domain/export-job.entity';
import { isDownloadable } from './domain/export-job.state';
import { ExportDomainEvent } from './domain/export-plane.events';
import { queueStanding, QueueStanding } from './domain/export-eta';
import { deriveLinkKey, EXPORT_LINK_TTL_SEC, mintExportLink, verifyExportLink, ExportLinkClaims } from './domain/export-link';
import {
  ExportDownloadRefusedError, ExportFileExpiredError, ExportJobNotFoundError, ExportNotReadyError, ExportParamsInvalidError,
  ExportPlaneDisabledError, TooManyOpenExportsError, UnknownDatasetError,
} from './domain/export-plane.errors';
import { DATASET_REGISTRY, DatasetRegistry } from './dataset.registry';
import { ExportJobRepository } from './export-job.repository';
import { DownloadOutcome, ExportDownloadRepository, FetchCounts } from './export-download.repository';

export const EXPORT_PLANE_FLAG = 'tenant_exports';
/** Open jobs one requester may have per tenant. A bound on write amplification (a stuck Export button), not a quota. */
export const MAX_OPEN_EXPORTS_PER_REQUESTER = 5;

export interface ExportActor { userId: string; permissions: ReadonlySet<string> }

/** The wire shape of a job — W2553's queued state and W2554's receipt are both projections of it. */
export interface ExportJobView {
  id: string; datasetCode: string; params: Record<string, unknown>; status: ExportJobProps['status']; attempts: number;
  requestedBy: string; queuedAt: string; startedAt: string | null; generatedAt: string | null; failedAt: string | null;
  expiredAt: string | null; expiresAt: string | null;
  /** W2554's receipt — present from `ready` on (kept through `expired`). */
  receipt: { fileName: string; rowCount: number; sha256: string; byteSize: number; contentType: string; generatedAt: string; requestedBy: string; notes: readonly string[] } | null;
  failure: { code: string; detail: string | null } | null;
  /** W2553's position and ETA — present ONLY while `queued`. `eta.kind === 'no_history'` is *"no estimate yet"*. */
  standing: QueueStanding | null;
  /** W2554's *"every fetch logged"* — present from `ready` on. */
  fetches: FetchCounts | null;
  /** A link is offered only while the file is served. Says why not otherwise, so the page never draws a dead button. */
  download: { kind: 'available'; linkTtlSec: number } | { kind: 'not_ready' } | { kind: 'file_expired'; expiredAt: string | null } | { kind: 'failed' };
}

export interface MintedLink { token: string; jti: string; expiresAt: string; ttlSec: number; downloadPath: string }

/** What `openDownload` hands the controller: the bytes to pipe and the receipt to check them against. */
export interface OpenDownload {
  job: ExportJobView;
  body: Readable;
  claims: ExportLinkClaims;
  /** Called by the controller once the response has ended, with what was actually sent. Writes the log row. */
  record(result: { outcome: 'served' | 'aborted' | 'storage_failed'; bytesServed: number; servedSha256: string | null }): Promise<void>;
}

/** Canonical JSON: keys sorted at every depth, so `{a:1,b:2}` and `{b:2,a:1}` are one request. */
export function canonicalParams(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalParams).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonicalParams((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
export function paramsSha256(params: unknown): string { return createHash('sha256').update(canonicalParams(params), 'utf8').digest('hex'); }

@Injectable()
export class ExportPlaneService {
  private readonly linkKey: Buffer;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(DATASET_REGISTRY) private readonly registry: DatasetRegistry,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    private readonly audit: AuditWriter,
    private readonly flags: FlagsService,
    private readonly jobs: ExportJobRepository,
    private readonly downloads: ExportDownloadRepository,
    config: AppConfig,
  ) {
    // Derived once at construction: an empty or short secret refuses to construct the service, which refuses to boot the
    // module, which is the right time to find out (fail closed on misconfig, §4).
    this.linkKey = deriveLinkKey(config.auth.accessSecret);
  }

  private async assertPlaneOn(tenantId: string): Promise<void> {
    // FAILS CLOSED: a flag store that cannot answer must not enqueue work (the rule every dairy read model applies).
    const on = await this.flags.isEnabled(EXPORT_PLANE_FLAG, { tenantId }).catch(() => false);
    if (!on) throw new ExportPlaneDisabledError();
  }

  private can(actor: ExportActor, permission: string): boolean { return actor.permissions.has(permission) || actor.permissions.has('*'); }

  /**
   * ENQUEUE. The dataset's permission is the caller's controller's business (dairy's route requires `dairy.manage`);
   * this re-checks it against the REGISTRY's declaration so a route that forgot cannot enqueue a dataset its permission
   * does not cover (defence in depth, and the same permission then gates the receipt).
   *
   * IDEMPOTENT TWICE OVER, and the two are different things. The `Idempotency-Key` (house pattern) returns the SAME
   * response to a retried request — a 2G retry of one click. `findOpenTwin` returns the same JOB to a SECOND request for
   * the same file while the first is still open — a second click, a second tab. Only the second produces a new key;
   * neither produces a second queue row.
   */
  async enqueue(tenantId: string, actor: ExportActor, idemKey: string, input: { datasetCode: string; params: unknown }, ip: string | null): Promise<ExportJobView> {
    await this.assertPlaneOn(tenantId);
    const producer = this.registry.get(input.datasetCode);
    if (!producer) throw new UnknownDatasetError(input.datasetCode);
    if (!this.can(actor, producer.permission)) throw new ForbiddenError('Permission denied for this export');
    const parsed = producer.params.safeParse(input.params ?? {});
    if (!parsed.success) throw new ExportParamsInvalidError(parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '));
    const params = parsed.data as Record<string, unknown>;
    const hash = paramsSha256(params);

    return this.idem.remember(idemKey, actor.userId, 'exports.enqueue', () =>
      timed(this.metrics, 'exports.enqueue', { tenant: tenantId, dataset: producer.code }, () =>
        this.uow.run(tenantId, async (tx) => {
          const twin = await this.jobs.findOpenTwin(tx, tenantId, producer.code, hash, actor.userId);
          if (twin) return this.project(twin, await this.standingFor(tenantId, twin), null);
          if (await this.jobs.countOpenFor(tenantId, actor.userId) >= MAX_OPEN_EXPORTS_PER_REQUESTER) throw new TooManyOpenExportsError(MAX_OPEN_EXPORTS_PER_REQUESTER);
          const job = ExportJob.create({ id: uuidv7(), tenantId, datasetCode: producer.code, params, paramsSha256: hash, requestedBy: actor.userId });
          await this.jobs.insert(tx, job);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'exports.enqueued', entityType: 'tenant_export_job', entityId: job.id, newValue: { dataset: producer.code, params }, ip });
          await this.flush(tx, tenantId, job.id, job.pullEvents());
          // A freshly inserted row's standing is computed in the SAME transaction so the response says "position 1" when
          // the queue was empty rather than nothing at all.
          return this.project(job, await this.standingInTx(tx, job), null);
        }, { userId: actor.userId })));
  }

  /** W2553 / W2554: one read, the state decides which page it is. */
  async view(tenantId: string, actor: ExportActor, id: string): Promise<ExportJobView> {
    await this.assertPlaneOn(tenantId);
    const job = await this.mustSee(tenantId, actor, id);
    const [standing, fetches] = await Promise.all([this.standingFor(tenantId, job), this.fetchesFor(tenantId, job)]);
    return this.project(job, standing, fetches);
  }

  /** *"Download (link valid 15 min)"* — mints the signed link and AUDITS the mint with its jti, so a leaked link can be
   *  traced to the click that made it. Refused for anything but a served file, with the reason as the code. */
  async mintLink(tenantId: string, actor: ExportActor, id: string, ip: string | null, now = new Date()): Promise<MintedLink> {
    await this.assertPlaneOn(tenantId);
    const job = await this.mustSee(tenantId, actor, id);
    if (job.status === 'expired') throw new ExportFileExpiredError(job.toProps().expiredAt);
    if (!isDownloadable(job.status, job.expiresAt, now)) {
      if (job.status === 'ready') throw new ExportFileExpiredError(job.expiresAt);
      throw new ExportNotReadyError(job.status);
    }
    const nowSec = Math.floor(now.getTime() / 1000);
    const { token, claims } = mintExportLink(this.linkKey, { jobId: job.id, tenantId, mintedBy: actor.userId, nowSec });
    await this.uow.run(tenantId, (tx) => this.audit.write(tx, {
      tenantId, actorUserId: actor.userId, action: 'exports.link_minted', entityType: 'tenant_export_job', entityId: job.id,
      newValue: { jti: claims.jti, expiresAt: new Date(claims.expSec * 1000).toISOString() }, ip,
    }), { userId: actor.userId });
    this.metrics.inc('exports.link_minted', { tenant: tenantId });
    return { token, jti: claims.jti, expiresAt: new Date(claims.expSec * 1000).toISOString(), ttlSec: EXPORT_LINK_TTL_SEC, downloadPath: `/v1/exports/${job.id}/download` };
  }

  /**
   * THE FETCH. Verifies the link against THIS job in THIS tenant, then the job's own state, and writes a log row for the
   * refusal BEFORE throwing — a refused fetch that is not logged is a fetch log of the fetches that went well. On success
   * the caller pipes `body` and then `record()`s what was sent, digest included; the log row for a served fetch is
   * written after the bytes because that is when its facts exist (bytes served, digest matched). A crash between the two
   * loses that row and is named in the wave's report.
   */
  async openDownload(tenantId: string, actor: ExportActor, id: string, token: string | null | undefined, meta: { ip: string | null; userAgent: string | null }, now = new Date()): Promise<OpenDownload> {
    await this.assertPlaneOn(tenantId);
    const job = await this.mustSee(tenantId, actor, id);
    const nowSec = Math.floor(now.getTime() / 1000);
    const verdict = verifyExportLink(this.linkKey, token, { jobId: job.id, tenantId, nowSec });

    const refuse = async (outcome: DownloadOutcome, jti: string | null): Promise<never> => {
      await this.log(tenantId, actor.userId, { jobId: job.id, tokenJti: jti, outcome, ...meta });
      this.metrics.inc('exports.download_refused', { tenant: tenantId, outcome });
      throw new ExportDownloadRefusedError(outcome);
    };
    if (!verdict.ok) return refuse(verdict.outcome, verdict.jti);
    if (job.status !== 'ready') return refuse(job.status === 'expired' ? 'refused_file_expired' : 'refused_not_ready', verdict.claims.jti);
    if (!isDownloadable(job.status, job.expiresAt, now)) return refuse('refused_file_expired', verdict.claims.jti);

    const p = job.toProps();
    let body: Readable;
    try { body = await this.store.getObjectStream(p.storageKey as string); }
    catch (e) {
      await this.log(tenantId, actor.userId, { jobId: job.id, tokenJti: verdict.claims.jti, outcome: 'storage_failed', ...meta });
      throw e;
    }
    const view = this.project(job, null, await this.fetchesFor(tenantId, job));
    return {
      job: view, body, claims: verdict.claims,
      record: async (r) => {
        const matched = r.servedSha256 === null ? null : r.servedSha256 === p.contentSha256;
        await this.log(tenantId, actor.userId, {
          jobId: job.id, tokenJti: verdict.claims.jti, outcome: r.outcome, bytesServed: r.bytesServed,
          servedSha256: r.servedSha256, digestMatched: r.outcome === 'served' ? matched : null, ...meta,
        });
        this.metrics.inc('exports.download', { tenant: tenantId, outcome: r.outcome, matched: String(matched) });
      },
    };
  }

  /* ------------------------------------------------------------------------------------------------------------ */

  /** The job, or 404 — and 403 for a member without the DATASET's permission (W2554's restricted state has words; a
   *  member of the tenant is not enumerating anything by asking). A non-member never reaches the permission check:
   *  RLS returns no row, and no row is 404. */
  private async mustSee(tenantId: string, actor: ExportActor, id: string): Promise<ExportJob> {
    const job = await this.jobs.getById(tenantId, id);
    if (!job) throw new ExportJobNotFoundError(id);
    const producer = this.registry.get(job.datasetCode);
    // A job for a dataset nothing registers any more is still the tenant's job: readable by whoever may read exports at
    // all. Its permission is the strictest one we know — `*` only — because the declaration that would have said
    // otherwise is gone. It will already be `failed(unknown_dataset)` unless it predates the removal.
    const permission = producer?.permission ?? '*';
    if (!this.can(actor, permission)) throw new ForbiddenError('Permission denied for this export');
    return job;
  }

  private async standingFor(tenantId: string, job: ExportJob): Promise<QueueStanding | null> {
    if (job.status !== 'queued') return null;
    return queueStanding(await this.jobs.queueStanding(tenantId, job.id));
  }
  private async standingInTx(tx: TxContext, job: ExportJob): Promise<QueueStanding | null> {
    const r = await tx.query<{ ahead: number; sample: number; median_ms: number | null }>(`SELECT ahead, sample, median_ms FROM export_queue_standing($1)`, [job.id]);
    const row = r.rows[0];
    return queueStanding({ ahead: Number(row?.ahead ?? 0), sample: Number(row?.sample ?? 0), medianRunMs: row?.median_ms == null ? null : Number(row.median_ms) });
  }
  private async fetchesFor(tenantId: string, job: ExportJob): Promise<FetchCounts | null> {
    if (job.status !== 'ready' && job.status !== 'expired') return null;
    return this.downloads.countsFor(tenantId, job.id);
  }

  private async log(tenantId: string, userId: string, d: { jobId: string; tokenJti: string | null; outcome: DownloadOutcome; bytesServed?: number | null; servedSha256?: string | null; digestMatched?: boolean | null; ip: string | null; userAgent: string | null }): Promise<void> {
    await this.uow.run(tenantId, (tx) => this.downloads.insert(tx, { tenantId, fetchedBy: userId, ...d }), { userId });
  }

  private async flush(tx: TxContext, tenantId: string, jobId: string, evts: ExportDomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'tenant_export_job', aggregateId: jobId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }

  project(job: ExportJob, standing: QueueStanding | null, fetches: FetchCounts | null, now = new Date()): ExportJobView {
    const p = job.toProps();
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    const receipt = p.generatedAt && p.contentSha256 && p.fileName != null && p.rowCount != null
      ? { fileName: p.fileName, rowCount: p.rowCount, sha256: p.contentSha256, byteSize: p.byteSize ?? 0, contentType: p.contentType ?? 'text/csv; charset=utf-8', generatedAt: p.generatedAt.toISOString(), requestedBy: p.requestedBy, notes: p.notes }
      : null;
    let download: ExportJobView['download'];
    if (p.status === 'failed') download = { kind: 'failed' };
    else if (p.status === 'expired') download = { kind: 'file_expired', expiredAt: iso(p.expiredAt) };
    else if (isDownloadable(p.status, p.expiresAt, now)) download = { kind: 'available', linkTtlSec: EXPORT_LINK_TTL_SEC };
    else if (p.status === 'ready') download = { kind: 'file_expired', expiredAt: iso(p.expiresAt) };   // past retention, sweep not yet run
    else download = { kind: 'not_ready' };
    return {
      id: p.id, datasetCode: p.datasetCode, params: p.params, status: p.status, attempts: p.attempts, requestedBy: p.requestedBy,
      queuedAt: p.queuedAt.toISOString(), startedAt: iso(p.startedAt), generatedAt: iso(p.generatedAt), failedAt: iso(p.failedAt),
      expiredAt: iso(p.expiredAt), expiresAt: iso(p.expiresAt),
      receipt, failure: p.failureCode ? { code: p.failureCode, detail: p.failureDetail } : null,
      standing: p.status === 'queued' ? standing : null, fetches, download,
    };
  }
}
