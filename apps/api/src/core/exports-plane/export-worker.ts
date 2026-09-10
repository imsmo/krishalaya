// core/exports-plane/export-worker.ts · the worker that turns a queued job into a file (PC-56 TENANT-6e-2).
//
// ONE JOB PER TICK, FIFO, under the runner's advisory lock (`ScheduledJobsRunner` takes it per job name before `run`),
// so N pods never make the same file twice and a district union's export never starves a village society's — the queue
// is one queue and the head is served in the order people pressed the button. The tick ALSO sweeps: claims whose pod
// died are released (their `attempts` remember it), and ready files past their retention are expired.
//
// THE FILE IS STREAMED. The producer yields rows; `CsvSink` writes them to a temp file while computing the sha256, the
// byte count and the DATA row count; the temp file is then streamed to the object store with its known length. The
// pod's memory holds one row at a time. The cap below is the single-PUT ceiling minus headroom, and is named on the
// receipt when hit rather than silently truncating (a truncated export that looks complete is how a reconciliation goes
// wrong months later — 0120's wording).
//
// THE TENANT HALF RUNS AS THE TENANT. Every write goes through the unit of work with `app.tenant_id` set, as `kv_app`,
// exactly as `DairyCycleCloseCadenceJob` does — the relay pool only ever answers "which job is next".
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { Pool } from 'pg';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../outbox/outbox.writer';
import { READ_REPLICA, ReadReplicaProvider } from '../database/read-replica.provider';
import { METRICS, Metrics, timed } from '../observability/metrics';
import { OBJECT_STORE, ObjectStore } from '../media/s3-presign.service';
import { ExportJob, ExportFailureCode, ExportReceipt } from './domain/export-job.entity';
import { ExportDomainEvent } from './domain/export-plane.events';
import { CsvSink, exportFileName } from './domain/csv';
import { DATASET_REGISTRY, DatasetRegistry } from './dataset.registry';
import { ExportJobRepository, QueuedRef } from './export-job.repository';

/** Below S3's 5 GB single-PUT ceiling with headroom. A dataset that needs more needs multipart, which is a change HERE
 *  and not a silent truncation THERE. */
export const EXPORT_MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;
/** A `running` claim older than this is presumed orphaned by a dead pod and released. Generous: a 4 GB file takes a while. */
export const EXPORT_STALE_CLAIM_MS = 60 * 60_000;
export const EXPORT_CONTENT_TYPE = 'text/csv; charset=utf-8';

export interface WorkerTickResult { generated: number; failed: number; released: number; expired: number; idle: boolean }

@Injectable()
export class ExportWorker {
  private readonly log = new Logger(ExportWorker.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(DATASET_REGISTRY) private readonly registry: DatasetRegistry,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    private readonly jobs: ExportJobRepository,
  ) {}

  /** One tick: sweep, then at most ONE job. `relay` is the runner's BYPASSRLS pool, used only to find rows. */
  async tick(relay: Pool, now = new Date()): Promise<WorkerTickResult> {
    const res: WorkerTickResult = { generated: 0, failed: 0, released: 0, expired: 0, idle: false };
    for (const ref of await this.jobs.peekStaleRunning(relay, EXPORT_STALE_CLAIM_MS)) {
      if (await this.transition(ref, (j) => { if (j.status === 'running') { j.release(); return true; } return false; })) res.released += 1;
    }
    for (const ref of await this.jobs.peekExpired(relay)) {
      if (await this.transition(ref, (j) => { if (j.status === 'ready' && j.expiresAt && j.expiresAt.getTime() <= now.getTime()) { j.expire(now); return true; } return false; })) res.expired += 1;
    }
    const head = await this.jobs.peekNextQueued(relay);
    if (!head) { res.idle = true; return res; }
    const outcome = await this.generate(head, now);
    if (outcome === 'ready') res.generated += 1; else if (outcome === 'failed') res.failed += 1;
    return res;
  }

  /**
   * Make ONE file. Public so a live test can drive a specific job without a relay pool.
   * Returns what the job became, or `skipped` when the claim was lost to another worker (SKIP LOCKED) or the row moved.
   */
  async generate(ref: QueuedRef, now = new Date()): Promise<'ready' | 'failed' | 'skipped'> {
    // 1. CLAIM, in its own short transaction, so the file is written outside any lock.
    const claimed = await this.uow.run(ref.tenantId, async (tx) => {
      const job = await this.jobs.getForUpdate(tx, ref.tenantId, ref.id, { skipLocked: true });
      if (!job || job.status !== 'queued') return null;
      job.claim(now);
      await this.jobs.update(tx, job);
      await this.flush(tx, job);
      return job;
    }, { userId: 'system' });
    if (!claimed) return 'skipped';
    if (claimed.status === 'failed') { this.metrics.inc('exports.job_failed', { code: 'too_many_attempts' }); return 'failed'; }

    const producer = this.registry.get(claimed.datasetCode);
    if (!producer) return this.finishFailed(ref, 'unknown_dataset', `no producer registered for ${claimed.datasetCode}`);

    return timed(this.metrics, 'exports.generate', { dataset: producer.code }, async () => {
      let dir: string | null = null;
      try {
        // 2. PRODUCE, as a read, streamed into a temp file with the digest computed on the way.
        const today = await this.today(ref.tenantId);
        const outcome = await producer.produce({ tenantId: ref.tenantId, requestedBy: claimed.requestedBy, today }, claimed.params);
        if (outcome.kind === 'refused') return this.finishFailed(ref, outcome.code, outcome.detail);

        dir = await mkdtemp(join(tmpdir(), 'kv-export-'));
        const path = join(dir, 'file.csv');
        const out = createWriteStream(path);
        const sink = new CsvSink((chunk) => new Promise<void>((resolve, reject) => {
          if (out.write(chunk)) resolve(); else { out.once('drain', resolve); out.once('error', reject); }
        }));
        await sink.header(outcome.file.header);
        let tooLarge = false;
        for await (const row of outcome.file.rows) {
          await sink.row(row);
          if (sink.bytesSoFar > EXPORT_MAX_FILE_BYTES) { tooLarge = true; break; }
        }
        out.end();
        await once(out, 'finish');
        const facts = sink.finish();
        if (tooLarge) return this.finishFailed(ref, 'producer_failed', `file exceeded ${EXPORT_MAX_FILE_BYTES} bytes at ${facts.rowCount} rows`);

        // 3. STORE. The key carries tenant and job, never a tenant's name.
        const fileName = exportFileName(producer.code, outcome.file.fileSuffix, today);
        const storageKey = `exports/${ref.tenantId}/${ref.id}/${fileName}`;
        try { await this.store.putObjectStream(storageKey, createReadStream(path), EXPORT_CONTENT_TYPE, facts.byteSize); }
        catch (e) { return this.finishFailed(ref, 'storage_failed', (e as Error).message); }

        // 4. READY, with the receipt and the notice, in one transaction.
        const receipt: ExportReceipt = { fileName, contentType: EXPORT_CONTENT_TYPE, rowCount: facts.rowCount, sha256: facts.sha256, byteSize: facts.byteSize, storageKey, notes: outcome.file.notes };
        const name = await producer.datasetName();
        const done = await this.transition(ref, (j) => { if (j.status === 'running') { j.succeed(receipt, name, new Date()); return true; } return false; });
        if (!done) { this.log.warn(`export ${ref.id} was not running when its file finished — claim released or expired underneath the run; the object at ${storageKey} is orphaned`); return 'skipped'; }
        this.metrics.inc('exports.job_ready', { dataset: producer.code });
        return 'ready';
      } catch (e) {
        return this.finishFailed(ref, 'producer_failed', (e as Error).message);
      } finally {
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  }

  private async finishFailed(ref: QueuedRef, code: ExportFailureCode, detail: string | null): Promise<'failed' | 'skipped'> {
    const done = await this.transition(ref, (j) => { if (j.status === 'running') { j.fail(code, detail); return true; } return false; });
    if (done) { this.metrics.inc('exports.job_failed', { code }); this.log.warn(`export ${ref.id} failed: ${code}${detail ? ` — ${detail.slice(0, 200)}` : ''}`); }
    return done ? 'failed' : 'skipped';
  }

  /** Re-read FOR UPDATE, apply, write, flush — the one shape every state hop after the claim takes. */
  private async transition(ref: QueuedRef, apply: (j: ExportJob) => boolean): Promise<boolean> {
    return this.uow.run(ref.tenantId, async (tx) => {
      const job = await this.jobs.getForUpdate(tx, ref.tenantId, ref.id);
      if (!job || !apply(job)) return false;
      await this.jobs.update(tx, job);
      await this.flush(tx, job);
      return true;
    }, { userId: 'system' });
  }

  private async today(tenantId: string): Promise<string> {
    const r = await this.replica.forTenant(tenantId).query<{ d: string }>(`SELECT current_date::text AS d`);
    return String(r.rows[0]?.d ?? '');
  }

  private async flush(tx: TxContext, job: ExportJob): Promise<void> {
    const evts: ExportDomainEvent[] = job.pullEvents();
    for (const e of evts) await this.outbox.write(tx, { tenantId: job.tenantId, aggregateType: 'tenant_export_job', aggregateId: job.id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
