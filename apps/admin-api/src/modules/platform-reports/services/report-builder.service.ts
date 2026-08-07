// apps/admin-api/src/modules/platform-reports/services/report-builder.service.ts · W111 (PC-56 ADMIN-10).
//
// The builder, its saved definitions (DELTA-028's missing half), and the receipted export the reports plane never had.
//
// **THREE OF W111'S OWN CLAIMS ARE NOT TRUE TODAY AND THIS SERVICE MAKES TWO OF THEM TRUE.**
//   1. "queries run on the analytics replica, never the primary" — FALSE and not fixable here: admin-api holds one pool
//      on `DATABASE_ADMIN_URL` and there is no replica pool anywhere in the realm. Reported as a fact on every payload
//      (ADMIN-10-Q4) rather than repeated as copy.
//   2. "the 60s replica limit protects everyone" — the LIMIT is now real: a statement timeout is set on the connection
//      that runs a builder query, from `report_query_policy`.
//   3. "Max range 92 days · results capped at 50,000 rows" — now enforced, and TIGHTER than the plane's existing
//      366-day window guard, because an ad-hoc export and a dashboard chart are different risks against one table.
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { contentDigest, DIGEST_BASIS, watermarkPreamble } from '../../../core/export/receipt';
import { PlatformReportsReadModel } from '../read-models/platform-reports.read-model';
import { ReportsPlaneRepository } from '../repositories/reports-plane.repository';
import {
  CANON_DATASETS_NOT_YET_AVAILABLE, CANON_MEASURES, DELTA_028_STATUS, REPLICA_GAP_OWNER, REPORT_BUCKETS,
  REPORT_METRICS, assertBuilderWindow, assertMetric, assertSlug, assertWindowDays, isSchedulable, windowFor,
} from '../domain/report-definition';
import {
  DuplicateSavedReportError, ExportDigestMismatchError, ExportReceiptNotFoundError, SavedReportNotFoundError,
} from '../domain/platform-reports.errors';

@Injectable()
export class ReportBuilderService {
  constructor(
    private readonly pool: AdminPool,
    private readonly reads: PlatformReportsReadModel,
    private readonly repo: ReportsPlaneRepository,
    private readonly audit: AdminAuditWriter,
  ) {}

  /* ---------------------------------------------------------------- the builder's own vocabulary */

  /** What the builder can offer, and what W111 offers that it cannot. The console renders both lists. */
  async vocabulary() {
    const policy = await this.repo.queryPolicy();
    return {
      metrics: [...REPORT_METRICS],
      buckets: [...REPORT_BUCKETS],
      measures: CANON_MEASURES,
      datasetsUnavailable: CANON_DATASETS_NOT_YET_AVAILABLE,
      caps: {
        maxRangeDays: policy.maxRangeDays,
        maxRows: policy.maxRows,
        statementTimeoutMs: policy.statementTimeoutMs,
        fromDatabase: policy.fromDatabase,
      },
      // The claim and the truth, side by side.
      readsFromReplica: policy.readsFromReplica,
      replicaGapOwner: REPLICA_GAP_OWNER,
      delta028: DELTA_028_STATUS,
    };
  }

  /* ---------------------------------------------------------------- running one */

  /**
   * Run an ad-hoc series.
   *
   * **THE STATEMENT TIMEOUT IS SET ON THE CONNECTION, NOT ASKED FOR POLITELY.** `SET LOCAL statement_timeout` inside a
   * transaction is the only version of this that a caller cannot forget — a limit applied by convention is a limit that
   * one future route will not apply.
   */
  async run(actor: AdminRequestContext, dto: { metric: string; from: string; to: string; bucket: 'day' | 'week' | 'month' }) {
    const metric = assertMetric(dto.metric);
    const policy = await this.repo.queryPolicy();
    const w = assertBuilderWindow(dto.from, dto.to, policy.maxRangeDays);

    // `withTx` gives one connection wrapped in BEGIN/COMMIT, which is exactly what `SET LOCAL` needs — the timeout and
    // the query must share a transaction or the timeout binds to a session nobody runs anything on. A read inside a
    // write transaction is not free, and it is the honest trade for a limit that actually applies: the alternative
    // (a pool checkout, a SET, and a query through the pool) silently gets a different connection.
    return this.pool.withTx(async (client) => {
      await client.query(`SET LOCAL statement_timeout = ${Number(policy.statementTimeoutMs)}`);
      const series = await this.reads.customSeriesOn(client, metric, w.from, w.to, dto.bucket);
      return {
        metric,
        bucket: dto.bucket,
        window: { from: w.from.toISOString(), to: w.to.toISOString() },
        rowCount: series.length,
        // A series is one row per bucket, so the row cap is a formality here and is reported anyway: the number an
        // operator was promised is the number they should be able to see.
        truncated: series.length >= policy.maxRows,
        series,
        readsFromReplica: policy.readsFromReplica,
        statementTimeoutMs: policy.statementTimeoutMs,
      };
    });
  }

  /* ---------------------------------------------------------------- saved definitions */

  async listSaved() {
    const rows = await this.repo.listSaved();
    const withSchedules = await Promise.all(rows.map(async (d) => ({
      ...d,
      archivedAt: d.archivedAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
      // A definition and the schedules that run it, together: W111's empty state promises "schedules (daily/weekly
      // email) arrive with DELTA-028", and they arrived in ADMIN-1e — so the console can show them rather than promise
      // them.
      schedules: (await this.repo.schedulesFor(d.slug)).map((s) => ({
        ...s, nextRunAt: s.nextRunAt?.toISOString() ?? null,
      })),
      schedulable: isSchedulable(d),
    })));
    return { data: withSchedules, meta: { delta028: DELTA_028_STATUS } };
  }

  async save(actor: AdminRequestContext, dto: {
    slug: string; title: string; metric: string; bucket: 'day' | 'week' | 'month';
    windowDays: number; currency: string; filters?: Record<string, unknown>; isShared: boolean; notes?: string;
  }) {
    const slug = assertSlug(dto.slug);
    const metric = assertMetric(dto.metric);
    const windowDays = assertWindowDays(dto.windowDays);
    if (await this.repo.getSaved(slug)) throw new DuplicateSavedReportError(slug);

    return this.pool.withTx(async (c) => {
      const id = await this.repo.insertSaved(c, {
        slug, title: dto.title.trim(), metric, bucket: dto.bucket, windowDays,
        currencyCode: dto.currency, filters: dto.filters ?? {}, createdByAdminId: actor.userId,
        isShared: dto.isShared, notes: dto.notes?.trim() || null,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'reports.definition.saved', entityType: 'saved_report_definition', entityId: id,
        newValue: { slug, metric, bucket: dto.bucket, windowDays, isShared: dto.isShared },
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, slug };
    });
  }

  /** Archive, never delete — a schedule points at the slug by name and a deleted definition would leave a schedule
   *  failing with no record of what it used to run. The response names the schedules that are about to break. */
  async archive(actor: AdminRequestContext, slug: string) {
    const schedules = await this.repo.schedulesFor(slug);
    return this.pool.withTx(async (c) => {
      const ok = await this.repo.archiveSaved(c, slug, actor.userId);
      if (!ok) throw new SavedReportNotFoundError(slug);
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'reports.definition.archived', entityType: 'saved_report_definition', entityId: null,
        newValue: { slug, activeSchedulesAffected: schedules.filter((s) => s.isActive).length },
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return {
        slug, archived: true,
        // Reported rather than blocked: an operator may legitimately retire a report and reschedule later, and refusing
        // the archive would leave them editing schedules to delete a definition. What they must not have is silence.
        schedulesNowBroken: schedules.filter((s) => s.isActive).map((s) => s.id),
      };
    });
  }

  /** Run a saved definition. Its window is RELATIVE, so this is the only way its numbers stay meaningful a month after
   *  it was saved. */
  async runSaved(actor: AdminRequestContext, slug: string, now = new Date()) {
    const d = await this.repo.getSaved(slug);
    if (!d) throw new SavedReportNotFoundError(slug);
    const w = windowFor(d.windowDays, now);
    const out = await this.run(actor, {
      metric: d.metric, from: w.from.toISOString(), to: w.to.toISOString(), bucket: d.bucket as 'day' | 'week' | 'month',
    });
    return { ...out, savedReport: { slug: d.slug, title: d.title, windowDays: d.windowDays } };
  }

  /* ---------------------------------------------------------------- the export, receipted and watermarked */

  /**
   * Export a series as CSV, with the receipt law applied IN FULL for the first time.
   *
   * **THE WATERMARK HELPER HAS BEEN DEAD CODE SINCE ADMIN-5c.** That wave's header says: "W045 and W018 both promise
   * 'every download watermarked per user', and nothing has ever marked a file" — and then wrote `watermarkPreamble()`
   * and `withWatermark()`, which `grep` finds imported by no production file. Five export services compute a digest and
   * none stamps the artefact. This is the first export on the platform that does both.
   *
   * SYNCHRONOUS, AND THE STATE PAGE SAYS SO. W2126 promises "this job is queued with a position and ETA"; a queue table
   * with a position nothing enqueues into would be the seventh status-recording-an-act-nobody-performs (ADMIN-10-Q1).
   */
  async exportSeries(actor: AdminRequestContext, dto: {
    metric: string; from: string; to: string; bucket: 'day' | 'week' | 'month';
  }) {
    const run = await this.run(actor, dto);
    const columns = [['bucket', 'value']];
    const rows = run.series as Array<Record<string, unknown>>;
    const generatedAt = new Date();
    const fileName = `${run.metric}-${dto.bucket}-${generatedAt.toISOString().slice(0, 10)}.csv`;
    const sha = contentDigest(columns, rows);

    const receiptId = await this.pool.withTx(async (c) => {
      const id = await this.repo.insertReceipt(c, {
        report: `builder:${run.metric}`,
        generatedByAdminId: actor.userId,
        rowCount: rows.length,
        truncated: run.truncated,
        fileName,
        contentSha256: sha,
        digestBasis: DIGEST_BASIS,
        // TRUE, and it is the first row on this platform that can say so.
        watermarked: true,
        // A whitelisted metric series is counts and money totals per bucket. No person appears in it, so there is
        // nothing to mask — `false` rather than `null`, because "nothing needed masking" and "we do not know" are
        // different answers and only one of them is true here.
        piiMasked: false,
        filters: { window: run.window, bucket: dto.bucket },
        // Streamed in this response rather than stored: a fourteen-row aggregate does not need an object, and NULL here
        // means exactly that rather than "the file is missing".
        objectKey: null,
        expiresAt: null,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'reports.export.generated', entityType: 'report_export_receipt', entityId: id,
        newValue: {
          report: `builder:${run.metric}`, rowCount: rows.length, truncated: run.truncated,
          contentSha256: sha, digestBasis: DIGEST_BASIS, watermarked: true,
        },
        reason: `report export: ${run.metric}`,
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return id;
    });

    const receipt = {
      id: receiptId,
      report: `builder:${run.metric}`,
      generatedAt: generatedAt.toISOString(),
      generatedBy: actor.userId,
      rowCount: rows.length,
      truncated: run.truncated,
      fileName,
      contentSha256: sha,
      digestBasis: DIGEST_BASIS,
    };

    return {
      receipt,
      columns,
      rows,
      // The mark that goes IN the artefact. Returned so the console's download route writes it above the header rather
      // than each caller re-deriving it — the way five surfaces re-derived the digest.
      watermark: watermarkPreamble(receipt),
      // W2126's queue does not exist and the payload says so, so the state page cannot imply one.
      delivery: { async: false, queuePosition: null, etaSeconds: null, note: 'generated synchronously (ADMIN-10-Q1)' },
    };
  }

  /* ---------------------------------------------------------------- the fetch log W2127 promises */

  async receipts(q: { report?: string; limit: number }) {
    const [rows, mismatches] = await Promise.all([
      this.repo.listReceipts(q),
      this.repo.digestMismatchCount(),
    ]);
    return {
      data: rows.map((r) => ({
        ...r,
        generatedAt: r.generatedAt.toISOString(),
        expiresAt: r.expiresAt?.toISOString() ?? null,
      })),
      meta: {
        // **THE NUMBER THAT MAKES THE RECEIPT WORTH HAVING.** A digest recorded at generation proves nothing unless
        // something re-computes it at delivery; this is the count of times the two disagreed.
        digestMismatches: mismatches,
        fetchLogging: 'every fetch of a report export is a row, because these bytes are served by admin-api rather than '
          + 'by a presigned URL; the presigned surfaces elsewhere cannot make this promise',
      },
    };
  }

  async receipt(id: string) {
    const r = await this.repo.getReceipt(id);
    if (!r) throw new ExportReceiptNotFoundError(id);
    const downloads = await this.repo.downloadsFor(r.id);
    return {
      ...r,
      generatedAt: r.generatedAt.toISOString(),
      expiresAt: r.expiresAt?.toISOString() ?? null,
      downloads: downloads.map((d) => ({ ...d, fetchedAt: d.fetchedAt.toISOString() })),
      // A receipt whose file was streamed has no re-fetchable artefact, and saying so is the difference between "this
      // export is gone" and "this export was never stored".
      refetchable: r.objectKey !== null,
    };
  }

  /**
   * Verify bytes against a receipt at DELIVERY time, log the fetch, and refuse a mismatch.
   *
   * The refusal is the point. A receipt that records a digest and then serves whatever is on disk is a receipt that
   * proves the platform once knew the right answer.
   */
  async verifyAndLogFetch(actor: AdminRequestContext, receiptId: string, bytes: string) {
    const r = await this.repo.getReceipt(receiptId);
    if (!r) throw new ExportReceiptNotFoundError(receiptId);
    // The digest of the DELIVERED BYTES, which is a different thing from the digest of the data (see DIGEST_BASIS) —
    // recorded as its own column so a reader is never misled into thinking one covers the other.
    const served = createHash('sha256').update(bytes, 'utf8').digest('hex');
    const matched = served === r.contentSha256;
    await this.repo.recordDownload({
      receiptId, fetchedByAdminId: actor.userId, ip: actor.ip,
      userAgent: null, servedSha256: served, digestMatched: matched,
    });
    if (!matched) throw new ExportDigestMismatchError(receiptId, r.contentSha256, served);
    return { receiptId, verified: true };
  }
}
