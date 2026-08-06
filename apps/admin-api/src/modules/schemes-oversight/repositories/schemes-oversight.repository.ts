// apps/admin-api/src/modules/schemes-oversight/repositories/schemes-oversight.repository.ts · ALL SQL for the
// cross-tenant scheme-oversight plane (W074 applications, W076 DBT, W078 performance).
//
// EVERY QUERY HERE DELIBERATELY OMITS A TENANT PREDICATE, which is the opposite of Law 1 and is the entire point of
// this file: it is god-mode oversight (Law 11), kv_admin bypasses RLS, and the platform view exists precisely because
// gov-console tokens are tenant-scoped and this realm is not. Stated at the top so its absence reads as a decision.
//
// TWO RULES THIS FILE FOLLOWS THAT THE TENANT-SIDE EQUIVALENT DOES NOT:
//   • NO `SELECT *`, ANYWHERE. The tenant-side `dbt-bounce.repository.ts` uses `SELECT *` and therefore carries
//     `bank_ref` into its row type. W076 forbids bank fields on THIS surface entirely, so every column is listed by
//     hand and `assertNoBankFields` checks the result on the way out.
//   • EVERY QUERY IS WINDOW-BOUNDED. `dbt_transfers` and `scheme_application_events` are partitioned by created_at
//     (Law 8); an unbounded scan across every partition is the query that takes the platform down at 75M households.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import type { OversightFilters } from '../domain/application-oversight';

/** Applicant PII is joined here and NOWHERE else. `users.full_name` and `users.phone` are plaintext columns (0003),
 *  so the mask is applied in the service before anything leaves — the raw values exist only between this query and
 *  `maskApplicant`. */
const APP_COLS = `a.id, a.tenant_id, a.scheme_id, a.scheme_version, a.scheme_version_id, a.status,
  a.assisted_by, a.govt_app_ref, a.eligibility_check, a.submitted_at, a.decided_at, a.created_at,
  a.rejection_reason_code,
  u.id AS applicant_user_id, u.full_name AS applicant_full_name, u.phone AS applicant_phone,
  s.code AS scheme_code, s.default_name AS scheme_name, t.name AS tenant_name`;

@Injectable()
export class SchemesOversightRepository {
  constructor(private readonly pool: AdminPool) {}

  /* ============================ W074 · the applications pipeline ============================ */

  /** Keyset over (created_at, id) DESC, matching `idx_scheme_apps_oversight` (0106). Never OFFSET: rows arrive while
   *  an operator works through a queue, and an OFFSET page would repeat and skip — a skipped application here is a
   *  farmer nobody looks at again. */
  async listApplications(f: OversightFilters, cursor: { c: string; id: string } | undefined, limit: number): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'a.deleted_at IS NULL';
    if (f.status) where += ` AND a.status = ${p(f.status)}::application_status`;
    if (f.schemeId) where += ` AND a.scheme_id = ${p(f.schemeId)}`;
    if (f.tenantId) where += ` AND a.tenant_id = ${p(f.tenantId)}`;
    if (f.assistedOnly) where += ' AND a.assisted_by IS NOT NULL';
    if (cursor) { const cc = p(cursor.c), ci = p(cursor.id); where += ` AND (a.created_at < ${cc} OR (a.created_at = ${cc} AND a.id < ${ci}))`; }
    const lp = p(limit);
    const r = await this.pool.query(
      `SELECT ${APP_COLS}
         FROM scheme_applications a
         JOIN users u   ON u.id = a.applicant_user_id
         JOIN schemes s ON s.id = a.scheme_id
         LEFT JOIN tenants t ON t.id = a.tenant_id
        WHERE ${where}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${lp}`, params);
    return r.rows;
  }

  async getApplication(id: string): Promise<Record<string, unknown> | null> {
    const r = await this.pool.query(
      `SELECT ${APP_COLS}, a.rejection_reason, a.form_data
         FROM scheme_applications a
         JOIN users u   ON u.id = a.applicant_user_id
         JOIN schemes s ON s.id = a.scheme_id
         LEFT JOIN tenants t ON t.id = a.tenant_id
        WHERE a.id = $1 AND a.deleted_at IS NULL`, [id]);
    return r.rows[0] ?? null;
  }

  /** The 9 tab counts. A SEPARATE query so it can fail on its own (Law 12) — the queue is still worth showing
   *  without its chips, and a failed count must render as "unknown" rather than 0. The filters other than `status`
   *  are applied so the chips describe the list the operator is actually looking at. */
  async statusCounts(f: Omit<OversightFilters, 'status'>): Promise<Array<{ status: string; n: number }>> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'deleted_at IS NULL';
    if (f.schemeId) where += ` AND scheme_id = ${p(f.schemeId)}`;
    if (f.tenantId) where += ` AND tenant_id = ${p(f.tenantId)}`;
    if (f.assistedOnly) where += ' AND assisted_by IS NOT NULL';
    const r = await this.pool.query(
      `SELECT status::text AS status, count(*)::int AS n FROM scheme_applications WHERE ${where} GROUP BY status`, params);
    return r.rows.map((x: any) => ({ status: x.status, n: x.n }));
  }

  /** W074's "61% filed ambassador-assisted". Counted over the same filter set as the list. */
  async assistedCounts(f: Omit<OversightFilters, 'status'>): Promise<{ assisted: number; total: number }> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'deleted_at IS NULL';
    if (f.schemeId) where += ` AND scheme_id = ${p(f.schemeId)}`;
    if (f.tenantId) where += ` AND tenant_id = ${p(f.tenantId)}`;
    const r = await this.pool.query(
      `SELECT count(*) FILTER (WHERE assisted_by IS NOT NULL)::int AS assisted, count(*)::int AS total
         FROM scheme_applications WHERE ${where}`, params);
    return { assisted: r.rows[0]?.assisted ?? 0, total: r.rows[0]?.total ?? 0 };
  }

  /** The state-transition trail for one application. `scheme_application_events` is partitioned, so this is bounded
   *  by the application's own id via the (application_id, created_at) index. */
  async applicationEvents(applicationId: string, limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT from_status::text AS from_status, to_status::text AS to_status, note, actor_user_id, created_at
         FROM scheme_application_events WHERE application_id = $1 ORDER BY created_at DESC LIMIT $2`, [applicationId, limit]);
    return r.rows;
  }

  /** The single-row PII read behind an audited unmask. Separated from `getApplication` on purpose: two call sites
   *  with different audit obligations must not share one query that returns everything. */
  async applicantPii(applicationId: string): Promise<{ userId: string; fullName: string | null; phone: string | null } | null> {
    const r = await this.pool.query(
      `SELECT u.id, u.full_name, u.phone
         FROM scheme_applications a JOIN users u ON u.id = a.applicant_user_id
        WHERE a.id = $1 AND a.deleted_at IS NULL`, [applicationId]);
    const x = r.rows[0];
    return x ? { userId: x.id, fullName: x.full_name ?? null, phone: x.phone ?? null } : null;
  }

  /* ============================ W076 · the DBT monitor ============================
     NO bank_ref in any of these. `pfms_ref` is present and is the GOVERNMENT's transaction handle, not an account
     identifier — it is the string an operator quotes to PFMS to ask what happened to a credit.                    */

  /** The four tiles: credits observed in the window, the rupee total, and the per-scheme instalment rollup. */
  async dbtTiles(days: number): Promise<{ transfers: number; amountMinor: string; farmers: number; lastCreditedOn: string | null }> {
    const r = await this.pool.query(
      `SELECT count(*)::int AS transfers,
              COALESCE(SUM(amount_minor), 0)::text AS amount_minor,
              count(DISTINCT user_id)::int AS farmers,
              MAX(credited_on)::text AS last_credited_on
         FROM dbt_transfers
        WHERE created_at >= now() - ($1::int * interval '1 day')`, [days]);
    const x = r.rows[0] ?? {};
    return { transfers: x.transfers ?? 0, amountMinor: String(x.amount_minor ?? '0'), farmers: x.farmers ?? 0, lastCreditedOn: x.last_credited_on ?? null };
  }

  /** Per-scheme rollup — the canon's "pm_kisan · 20th instalment · 8,412 · ₹2,000 each". `instalments` is the set of
   *  instalment numbers seen, so the console can say "20th" rather than inventing one. */
  async dbtByScheme(days: number, limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT s.code AS scheme_code, s.default_name AS scheme_name,
              count(*)::int AS transfers,
              COALESCE(SUM(d.amount_minor), 0)::text AS amount_minor,
              count(DISTINCT d.user_id)::int AS farmers,
              MAX(d.instalment_no)::int AS latest_instalment,
              MAX(d.credited_on)::text AS last_credited_on
         FROM dbt_transfers d JOIN schemes s ON s.id = d.scheme_id
        WHERE d.created_at >= now() - ($1::int * interval '1 day')
        GROUP BY s.code, s.default_name
        ORDER BY SUM(d.amount_minor) DESC NULLS LAST
        LIMIT $2`, [days, limit]);
    return r.rows;
  }

  /** The credit stream. Keyset on (credited_on, id) — the order an operator reads it in, newest credit first. */
  async dbtRecent(days: number, schemeId: string | undefined, cursor: { c: string; id: string } | undefined, limit: number): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [days]; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `d.created_at >= now() - ($1::int * interval '1 day')`;
    if (schemeId) where += ` AND d.scheme_id = ${p(schemeId)}`;
    if (cursor) { const cc = p(cursor.c), ci = p(cursor.id); where += ` AND (d.credited_on < ${cc}::date OR (d.credited_on = ${cc}::date AND d.id < ${ci}))`; }
    const lp = p(limit);
    const r = await this.pool.query(
      `SELECT d.id, d.credited_on::text AS credited_on, d.instalment_no, d.amount_minor::text AS amount_minor,
              d.pfms_ref, d.application_id, a.govt_app_ref,
              s.code AS scheme_code, t.name AS tenant_name,
              u.id AS user_id, u.full_name AS applicant_full_name, u.phone AS applicant_phone
         FROM dbt_transfers d
         JOIN schemes s ON s.id = d.scheme_id
         LEFT JOIN users u ON u.id = d.user_id
         LEFT JOIN tenants t ON t.id = d.tenant_id
         LEFT JOIN scheme_applications a ON a.id = d.application_id
        WHERE ${where}
        ORDER BY d.credited_on DESC, d.id DESC
        LIMIT ${lp}`, params);
    return r.rows;
  }

  /** Bounced transfers by reason. The canon's "Aadhaar-seeding failures 184" is the `aadhaar_not_seeded` slice of
   *  this — computed from the real reason code rather than being its own guessed number. */
  async dbtBouncesByReason(days: number): Promise<Array<{ reasonCode: string; open: number; total: number; amountMinor: string }>> {
    const r = await this.pool.query(
      `SELECT reason_code,
              count(*) FILTER (WHERE resolution = 'open')::int AS open,
              count(*)::int AS total,
              COALESCE(SUM(amount_minor), 0)::text AS amount_minor
         FROM dbt_bounces
        WHERE bounced_on >= (now() - ($1::int * interval '1 day'))::date AND deleted_at IS NULL
        GROUP BY reason_code
        ORDER BY count(*) DESC`, [days]);
    return r.rows.map((x: any) => ({ reasonCode: x.reason_code, open: x.open, total: x.total, amountMinor: String(x.amount_minor ?? '0') }));
  }

  /** The bounce list. Column-by-column, and `bank_ref` is NOT among them — see domain/dbt-safety.ts for why this is
   *  a law with a runtime check rather than a habit. */
  async dbtBounces(days: number, resolution: string | undefined, limit: number): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [days]; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `b.bounced_on >= (now() - ($1::int * interval '1 day'))::date AND b.deleted_at IS NULL`;
    if (resolution) where += ` AND b.resolution = ${p(resolution)}`;
    const lp = p(limit);
    const r = await this.pool.query(
      `SELECT b.id, b.bounced_on::text AS bounced_on, b.reason_code, b.reason_note,
              b.amount_minor::text AS amount_minor, b.resolution, b.resolved_at, b.application_id,
              s.code AS scheme_code, t.name AS tenant_name,
              u.id AS user_id, u.full_name AS applicant_full_name, u.phone AS applicant_phone
         FROM dbt_bounces b
         JOIN schemes s ON s.id = b.scheme_id
         LEFT JOIN users u ON u.id = b.user_id
         LEFT JOIN tenants t ON t.id = b.tenant_id
        WHERE ${where}
        ORDER BY b.bounced_on DESC, b.id DESC
        LIMIT ${lp}`, params);
    return r.rows;
  }

  /* ============================ W078 · performance ============================ */

  /** Benefits facilitated, split by whether the credit can be attributed to an application filed here. Two numbers,
   *  because claiming an unattributable credit as "facilitated" is the one thing this screen must not do. */
  async benefitTotals(sinceIso: string): Promise<{ attributed: { amountMinor: string; transfers: number }; unattributed: { amountMinor: string; transfers: number } }> {
    const r = await this.pool.query(
      `SELECT COALESCE(SUM(amount_minor) FILTER (WHERE application_id IS NOT NULL), 0)::text AS att_amount,
              count(*) FILTER (WHERE application_id IS NOT NULL)::int AS att_n,
              COALESCE(SUM(amount_minor) FILTER (WHERE application_id IS NULL), 0)::text AS un_amount,
              count(*) FILTER (WHERE application_id IS NULL)::int AS un_n
         FROM dbt_transfers WHERE created_at >= $1::timestamptz`, [sinceIso]);
    const x = r.rows[0] ?? {};
    return {
      attributed: { amountMinor: String(x.att_amount ?? '0'), transfers: x.att_n ?? 0 },
      unattributed: { amountMinor: String(x.un_amount ?? '0'), transfers: x.un_n ?? 0 },
    };
  }

  /** Filed / decided / approved / assisted in the window — the four numbers the approval rate and assisted share are
   *  built from, in one pass so they cannot disagree with each other. */
  async applicationTotals(sinceIso: string): Promise<{ filed: number; decided: number; approved: number; assisted: number }> {
    const r = await this.pool.query(
      `SELECT count(*)::int AS filed,
              count(*) FILTER (WHERE status IN ('approved','disbursed','closed','rejected'))::int AS decided,
              count(*) FILTER (WHERE status IN ('approved','disbursed','closed'))::int AS approved,
              count(*) FILTER (WHERE assisted_by IS NOT NULL)::int AS assisted
         FROM scheme_applications
        WHERE created_at >= $1::timestamptz AND deleted_at IS NULL AND status <> 'draft'`, [sinceIso]);
    const x = r.rows[0] ?? {};
    return { filed: x.filed ?? 0, decided: x.decided ?? 0, approved: x.approved ?? 0, assisted: x.assisted ?? 0 };
  }

  /** Median seconds from submission to the `disbursed` transition, via `percentile_cont` — the same shape
   *  support-oversight uses for its first-response median. Uses the EVENT's created_at rather than
   *  `decided_at`, because `decided_at` is stamped at approval and disbursal happens later. */
  async medianTimeToDisbursal(sinceIso: string): Promise<{ p50Seconds: number | null; sampleSize: number; disbursals: number }> {
    const r = await this.pool.query(
      `WITH d AS (
         SELECT e.application_id, MIN(e.created_at) AS disbursed_at
           FROM scheme_application_events e
          WHERE e.to_status = 'disbursed' AND e.created_at >= $1::timestamptz
          GROUP BY e.application_id
       )
       SELECT percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (d.disbursed_at - a.submitted_at))
              ) FILTER (WHERE a.submitted_at IS NOT NULL) AS p50_seconds,
              count(*) FILTER (WHERE a.submitted_at IS NOT NULL)::int AS sample_size,
              count(*)::int AS disbursals
         FROM d JOIN scheme_applications a ON a.id = d.application_id`, [sinceIso]);
    const x = r.rows[0] ?? {};
    return {
      p50Seconds: x.p50_seconds === null || x.p50_seconds === undefined ? null : Number(x.p50_seconds),
      sampleSize: x.sample_size ?? 0,
      disbursals: x.disbursals ?? 0,
    };
  }

  /** Top schemes by benefit rupees — the canon's "Top schemes by benefit ₹ (YTD)". */
  async topSchemesByBenefit(sinceIso: string, limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT s.code AS scheme_code, s.default_name AS scheme_name,
              COALESCE(SUM(d.amount_minor), 0)::text AS amount_minor, count(*)::int AS transfers
         FROM dbt_transfers d JOIN schemes s ON s.id = d.scheme_id
        WHERE d.created_at >= $1::timestamptz
        GROUP BY s.code, s.default_name
        ORDER BY SUM(d.amount_minor) DESC NULLS LAST
        LIMIT $2`, [sinceIso, limit]);
    return r.rows;
  }

  /** Rejections by CODE, with uncoded rows returned as a `null` code so the service can report them as uncoded rather
   *  than folding them into `other`. That distinction is the whole reason 0106 exists. */
  async rejectionsByCode(sinceIso: string): Promise<Array<{ code: string | null; n: number }>> {
    const r = await this.pool.query(
      `SELECT rejection_reason_code AS code, count(*)::int AS n
         FROM scheme_applications
        WHERE status = 'rejected' AND deleted_at IS NULL
          AND COALESCE(decided_at, created_at) >= $1::timestamptz
        GROUP BY rejection_reason_code`, [sinceIso]);
    return r.rows.map((x: any) => ({ code: x.code ?? null, n: x.n }));
  }
}
