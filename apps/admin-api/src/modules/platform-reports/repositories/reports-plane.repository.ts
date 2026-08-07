// apps/admin-api/src/modules/platform-reports/repositories/reports-plane.repository.ts · PC-56 ADMIN-10.
//
// The writes and the reads this plane did not have: saved definitions (DELTA-028's missing half), persisted export
// receipts, the download log that makes "every fetch logged" true, and the two dashboard figures W001 needs and nothing
// computed — payout success and an order rate.
//
// Read-only figures stay in `platform-reports.read-model.ts`, which owns every dashboard SELECT. This file is the plane's
// WRITE side plus the two new reads, kept apart so the read model remains one file an auditor can read end to end.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import { BUILDER_MAX_ROWS, BUILDER_STATEMENT_TIMEOUT_MS } from '../domain/report-definition';

export interface SavedReportRow {
  id: string;
  slug: string;
  title: string;
  metric: string;
  bucket: string;
  windowDays: number;
  currencyCode: string;
  filters: Record<string, unknown>;
  createdByAdminId: string;
  isShared: boolean;
  archivedAt: Date | null;
  notes: string | null;
  createdAt: Date;
}

const SR_COLS = `id, slug, title, metric, bucket, window_days, currency_code, filters,
  created_by_admin_id, is_shared, archived_at, notes, created_at`;

function toSaved(r: Record<string, unknown>): SavedReportRow {
  return {
    id: String(r.id),
    slug: String(r.slug),
    title: String(r.title),
    metric: String(r.metric),
    bucket: String(r.bucket),
    windowDays: Number(r.window_days),
    currencyCode: String(r.currency_code),
    filters: (r.filters ?? {}) as Record<string, unknown>,
    createdByAdminId: String(r.created_by_admin_id),
    isShared: Boolean(r.is_shared),
    archivedAt: r.archived_at ? new Date(String(r.archived_at)) : null,
    notes: (r.notes as string | null) ?? null,
    createdAt: new Date(String(r.created_at)),
  };
}

export interface ReceiptRow {
  id: string;
  report: string;
  generatedAt: Date;
  generatedByAdminId: string;
  rowCount: number;
  truncated: boolean;
  fileName: string;
  contentSha256: string;
  digestBasis: string;
  watermarked: boolean;
  piiMasked: boolean | null;
  filters: Record<string, unknown>;
  objectKey: string | null;
  expiresAt: Date | null;
}

function toReceipt(r: Record<string, unknown>): ReceiptRow {
  return {
    id: String(r.id),
    report: String(r.report),
    generatedAt: new Date(String(r.generated_at)),
    generatedByAdminId: String(r.generated_by_admin_id),
    rowCount: Number(r.row_count),
    truncated: Boolean(r.truncated),
    fileName: String(r.file_name),
    contentSha256: String(r.content_sha256),
    digestBasis: String(r.digest_basis),
    watermarked: Boolean(r.watermarked),
    piiMasked: r.pii_masked === null || r.pii_masked === undefined ? null : Boolean(r.pii_masked),
    filters: (r.filters ?? {}) as Record<string, unknown>,
    objectKey: (r.object_key as string | null) ?? null,
    expiresAt: r.expires_at ? new Date(String(r.expires_at)) : null,
  };
}

@Injectable()
export class ReportsPlaneRepository {
  constructor(private readonly db: AdminPool) {}

  /* ---------------------------------------------------------------- the policy */

  async queryPolicy(): Promise<{
    statementTimeoutMs: number; maxRangeDays: number; maxRows: number; readsFromReplica: boolean; fromDatabase: boolean;
  }> {
    try {
      const r = await this.db.query(
        'SELECT statement_timeout_ms, max_range_days, max_rows, reads_from_replica FROM report_query_policy WHERE id = true');
      const x = r.rows[0];
      if (!x) throw new Error('no policy row');
      return {
        statementTimeoutMs: Number(x.statement_timeout_ms),
        maxRangeDays: Number(x.max_range_days),
        maxRows: Number(x.max_rows),
        readsFromReplica: Boolean(x.reads_from_replica),
        fromDatabase: true,
      };
    } catch {
      // The shipped defaults are the same numbers, so the fallback is the same policy rather than an absence of one —
      // and the caller reports that it fell back, because a limit nobody could read is not a limit anybody agreed.
      return {
        statementTimeoutMs: BUILDER_STATEMENT_TIMEOUT_MS,
        maxRangeDays: 92,
        maxRows: BUILDER_MAX_ROWS,
        readsFromReplica: false,
        fromDatabase: false,
      };
    }
  }

  /* ---------------------------------------------------------------- saved definitions */

  async listSaved(includeArchived = false): Promise<SavedReportRow[]> {
    const r = await this.db.query(
      `SELECT ${SR_COLS} FROM saved_report_definitions
        WHERE deleted_at IS NULL ${includeArchived ? '' : 'AND archived_at IS NULL'}
        ORDER BY created_at DESC, id DESC LIMIT 200`);
    return r.rows.map(toSaved);
  }

  async getSaved(slug: string): Promise<SavedReportRow | null> {
    const r = await this.db.query(
      `SELECT ${SR_COLS} FROM saved_report_definitions
        WHERE slug = $1 AND archived_at IS NULL AND deleted_at IS NULL`, [slug]);
    return r.rows[0] ? toSaved(r.rows[0]) : null;
  }

  async insertSaved(c: PoolClient, v: {
    slug: string; title: string; metric: string; bucket: string; windowDays: number;
    currencyCode: string; filters: Record<string, unknown>; createdByAdminId: string; isShared: boolean; notes: string | null;
  }): Promise<string> {
    const r = await c.query(
      `INSERT INTO saved_report_definitions
         (slug, title, metric, bucket, window_days, currency_code, filters, created_by_admin_id, is_shared, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$8) RETURNING id`,
      [v.slug, v.title, v.metric, v.bucket, v.windowDays, v.currencyCode, JSON.stringify(v.filters),
        v.createdByAdminId, v.isShared, v.notes]);
    return String(r.rows[0].id);
  }

  /** Archive rather than delete. A schedule points at a slug by NAME (0095), so a deleted definition would make a
   *  schedule fail with no trace of what it used to run; an archived one leaves the definition readable beside the
   *  failure. */
  async archiveSaved(c: PoolClient, slug: string, byAdminId: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE saved_report_definitions SET archived_at = now(), updated_at = now(), updated_by = $2
        WHERE slug = $1 AND archived_at IS NULL AND deleted_at IS NULL`, [slug, byAdminId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Schedules pointing at a slug. Read before archiving so the console can say "two schedules run this" rather than
   *  letting somebody discover it when a board pack stops arriving. */
  async schedulesFor(slug: string): Promise<{ id: string; cadence: string; isActive: boolean; nextRunAt: Date | null }[]> {
    const r = await this.db.query(
      `SELECT id, cadence, is_active, next_run_at FROM scheduled_reports
        WHERE report = $1 AND deleted_at IS NULL ORDER BY created_at DESC`, [slug]);
    return r.rows.map((x) => ({
      id: String(x.id), cadence: String(x.cadence), isActive: Boolean(x.is_active),
      nextRunAt: x.next_run_at ? new Date(String(x.next_run_at)) : null,
    }));
  }

  /* ---------------------------------------------------------------- receipts + downloads */

  async insertReceipt(c: PoolClient, v: {
    report: string; generatedByAdminId: string; rowCount: number; truncated: boolean; fileName: string;
    contentSha256: string; digestBasis: string; watermarked: boolean; piiMasked: boolean | null;
    filters: Record<string, unknown>; objectKey: string | null; expiresAt: Date | null;
  }): Promise<string> {
    const r = await c.query(
      `INSERT INTO report_export_receipts
         (report, generated_by_admin_id, row_count, truncated, file_name, content_sha256, digest_basis,
          watermarked, pii_masked, filters, object_key, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) RETURNING id`,
      [v.report, v.generatedByAdminId, v.rowCount, v.truncated, v.fileName, v.contentSha256, v.digestBasis,
        v.watermarked, v.piiMasked, JSON.stringify(v.filters), v.objectKey, v.expiresAt]);
    return String(r.rows[0].id);
  }

  async getReceipt(id: string): Promise<ReceiptRow | null> {
    const r = await this.db.query(
      `SELECT id, report, generated_at, generated_by_admin_id, row_count, truncated, file_name, content_sha256,
              digest_basis, watermarked, pii_masked, filters, object_key, expires_at
         FROM report_export_receipts WHERE id = $1`, [id]);
    return r.rows[0] ? toReceipt(r.rows[0]) : null;
  }

  async listReceipts(q: { report?: string; limit: number }): Promise<ReceiptRow[]> {
    const params: unknown[] = [];
    let where = '';
    if (q.report) { params.push(q.report); where = `WHERE report = $${params.length}`; }
    params.push(q.limit);
    const r = await this.db.query(
      `SELECT id, report, generated_at, generated_by_admin_id, row_count, truncated, file_name, content_sha256,
              digest_basis, watermarked, pii_masked, filters, object_key, expires_at
         FROM report_export_receipts ${where}
        ORDER BY generated_at DESC, id DESC LIMIT $${params.length}`, params);
    return r.rows.map(toReceipt);
  }

  /** One row per FETCH. Awaited by the caller before bytes are sent: W2127 promises every fetch is logged, and a
   *  best-effort log would make that promise true only while the database was healthy. */
  async recordDownload(v: {
    receiptId: string; fetchedByAdminId: string; ip: string | null; userAgent: string | null;
    servedSha256: string | null; digestMatched: boolean | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO report_export_downloads
         (receipt_id, fetched_by_admin_id, ip, user_agent, served_sha256, digest_matched)
       VALUES ($1,$2,$3::inet,$4,$5,$6)`,
      [v.receiptId, v.fetchedByAdminId, v.ip, v.userAgent?.slice(0, 300) ?? null, v.servedSha256, v.digestMatched]);
  }

  async downloadsFor(receiptId: string, limit = 50): Promise<{
    fetchedAt: Date; fetchedByAdminId: string; ip: string | null; digestMatched: boolean | null;
  }[]> {
    const r = await this.db.query(
      `SELECT fetched_at, fetched_by_admin_id, ip, digest_matched FROM report_export_downloads
        WHERE receipt_id = $1 ORDER BY fetched_at DESC LIMIT $2`, [receiptId, limit]);
    return r.rows.map((x) => ({
      fetchedAt: new Date(String(x.fetched_at)),
      fetchedByAdminId: String(x.fetched_by_admin_id),
      ip: (x.ip as string | null) ?? null,
      digestMatched: x.digest_matched === null ? null : Boolean(x.digest_matched),
    }));
  }

  /** Every mismatch across the plane. A count on its own read, because "has any export ever been served altered" is a
   *  question somebody asks once a quarter and must be able to answer in one query. */
  async digestMismatchCount(): Promise<number> {
    const r = await this.db.query(
      'SELECT count(*)::int AS n FROM report_export_downloads WHERE digest_matched = false');
    return Number(r.rows[0]?.n ?? 0);
  }

  /* ---------------------------------------------------------------- the two dashboard figures nothing computed */

  /**
   * Payout outcomes in a window. **`pending` IS COUNTED AND EXCLUDED FROM THE RATE** — a payout still moving is not a
   * failure, and folding it in would drop the success rate every time a batch was mid-flight, which is exactly when
   * somebody is reading the tile.
   */
  async payoutOutcomes(from: Date, to: Date): Promise<{
    succeeded: number; failed: number; pending: number; reversed: number; cancelled: number;
  }> {
    // The enum is `('queued','processing','success','failed','reversed','cancelled')` — **`success`, not `succeeded`**.
    // Worth the note: the obvious spelling is the wrong one and would have produced a permanent 0% success rate that
    // looked like a platform-wide payout outage rather than like a typo.
    const r = await this.db.query(
      `SELECT
         count(*) FILTER (WHERE status = 'success')::int   AS succeeded,
         count(*) FILTER (WHERE status = 'failed')::int    AS failed,
         count(*) FILTER (WHERE status IN ('queued','processing'))::int AS pending,
         count(*) FILTER (WHERE status = 'reversed')::int  AS reversed,
         count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
       FROM payouts WHERE created_at >= $1 AND created_at < $2`,
      [from.toISOString(), to.toISOString()]);
    const x = r.rows[0] ?? {};
    return {
      succeeded: Number(x.succeeded ?? 0), failed: Number(x.failed ?? 0), pending: Number(x.pending ?? 0),
      // Counted and reported separately rather than folded into either side. A REVERSED payout succeeded and then came
      // back — calling it a failure would understate the rail and calling it a success would overstate the outcome, and
      // a cancelled payout was never attempted at all.
      reversed: Number(x.reversed ?? 0), cancelled: Number(x.cancelled ?? 0),
    };
  }

  /** **THERE IS NO RETRY COUNT ON THIS PLATFORM.** W001's tile reads "99.4% · ▼ 0.2 pt · 41 retries" and `payouts` has
   *  no `attempt_count`, no `retry_count` and no attempts table: `grep -rn attempt db/migrations/0006_money.sql`
   *  returns nothing. The figure is unavailable rather than approximated — a retry count guessed from failure rows would
   *  be a number nobody could reproduce (ADMIN-10-Q5). */
  readonly payoutRetriesAvailable = false;

  /** Orders in a window, for the rate. One count over one window — the honest half of W001's "Orders / min · peak". */
  async orderCount(from: Date, to: Date): Promise<number> {
    const r = await this.db.query(
      'SELECT count(*)::int AS n FROM orders WHERE created_at >= $1 AND created_at < $2',
      [from.toISOString(), to.toISOString()]);
    return Number(r.rows[0]?.n ?? 0);
  }

  /** GMV for a bare window, used for the day-over-day delta. Kept here rather than widening the read model's `gmv()`
   *  signature: the dashboard needs two windows and the report needs one, and one function serving both would grow a
   *  parameter nobody reading it could explain. */
  async gmvMinorFor(from: Date, to: Date, currency: string): Promise<bigint> {
    const r = await this.db.query(
      `SELECT COALESCE(SUM(total_minor), 0)::text AS gmv
         FROM orders WHERE created_at >= $1 AND created_at < $2 AND currency_code = $3`,
      [from.toISOString(), to.toISOString(), currency]);
    return BigInt(String(r.rows[0]?.gmv ?? '0'));
  }
}
