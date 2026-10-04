// modules/schemes/repositories/scheme-desk.repository.ts · PC-56 TENANT-SW-b · D — the SQL behind the tenant schemes desk (W202 / W203) and
// the eligibility sweep (0198 scheme_eligibility_sweeps + rows). tenant_id in EVERY query of a tenant table (Law 1) + RLS. The scheme
// registry (`schemes`) is global and READ-ONLY here — kv_app holds SELECT only since 0198 (F-8).
import { pgDate, pgDateOrNull } from '../../../core/database/pg-date';
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
export interface SweepRow {
  id: string; schemeId: string; schemeVersion: number; runDate: string; status: string; requestedBy: string; reason: string; membersEvaluated: number;
  eligibleCount: number; eligibleNotApplied: number; startedAt: string | null; finishedAt: string | null; failure: string | null; createdAt: string;
}
const SWEEP_COLS = `id, scheme_id, scheme_version, run_date::text AS run_date, status, requested_by, reason, members_evaluated, eligible_count, eligible_not_applied,
  started_at, finished_at, failure, created_at`;
const toSweep = (r: any): SweepRow => ({ id: r.id, schemeId: r.scheme_id, schemeVersion: Number(r.scheme_version), runDate: pgDate(r.run_date), status: r.status,
  requestedBy: r.requested_by, reason: r.reason, membersEvaluated: Number(r.members_evaluated), eligibleCount: Number(r.eligible_count),
  eligibleNotApplied: Number(r.eligible_not_applied), startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), failure: r.failure ?? null, createdAt: iso(r.created_at) as string });

export interface PipelineRow {
  id: string; schemeId: string; status: string; applicantUserId: string; applicantName: string | null; applicantPhone: string; assistedBy: string | null; assistedByName: string | null;
  govtAppRef: string | null; rejectionReasonCode: string | null; submittedAt: string | null; decidedAt: string | null; changedAt: Date; changedAtRaw: string;
  clarificationNote: string | null; openBounceReason: string | null; formFields: string[];
}

@Injectable()
export class SchemeDeskRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  // ---- the desk's aggregates (W202) ----
  async summaryFacts(tenantId: string, fy: { start: string; end: string }) {
    const db = this.replica.forTenant(tenantId);
    const a = await db.query(
      `SELECT count(*) FILTER (WHERE status NOT IN ('draft','closed','rejected','disbursed'))::int AS open_apps,
              count(DISTINCT scheme_id) FILTER (WHERE status NOT IN ('draft','closed','rejected','disbursed'))::int AS open_schemes,
              count(*) FILTER (WHERE decided_at >= $2::date AND decided_at < $3::date)::int AS decided_fy,
              count(*) FILTER (WHERE decided_at >= $2::date AND decided_at < $3::date AND status IN ('rejected','appealed'))::int AS rejected_fy
         FROM scheme_applications WHERE tenant_id=$1 AND deleted_at IS NULL`, [tenantId, fy.start, fy.end]);
    const t = await db.query(
      `SELECT COALESCE(sum(t.amount_minor) FILTER (WHERE NOT EXISTS (SELECT 1 FROM dbt_bounces x WHERE x.tenant_id = t.tenant_id AND x.transfer_id = t.id
                                                     AND x.resolution IN ('open','abandoned') AND x.deleted_at IS NULL)), 0)::text AS landed,
              count(*)::int AS transfers, count(DISTINCT t.user_id)::int AS members
         FROM dbt_transfers t WHERE t.tenant_id=$1 AND t.credited_on >= $2::date AND t.credited_on < $3::date AND t.created_at >= now() - interval '3 years'`, [tenantId, fy.start, fy.end]);
    const s = await db.query(
      `SELECT DISTINCT ON (scheme_id) scheme_id, id, run_date::text AS run_date, eligible_not_applied FROM scheme_eligibility_sweeps
        WHERE tenant_id=$1 AND status='done' ORDER BY scheme_id, created_at DESC`, [tenantId]);
    const c = await db.query(`SELECT status::text AS status, count(*)::int AS n FROM scheme_applications WHERE tenant_id=$1 AND deleted_at IS NULL GROUP BY status`, [tenantId]);
    return {
      openApplications: a.rows[0]?.open_apps ?? 0, openSchemes: a.rows[0]?.open_schemes ?? 0, decidedFy: a.rows[0]?.decided_fy ?? 0, rejectedFy: a.rows[0]?.rejected_fy ?? 0,
      landedMinor: t.rows[0]?.landed ?? '0', transfers: t.rows[0]?.transfers ?? 0, members: t.rows[0]?.members ?? 0,
      sweeps: s.rows.map((x: any) => ({ schemeId: x.scheme_id, sweepId: x.id, runDate: pgDate(x.run_date), eligibleNotApplied: Number(x.eligible_not_applied) })),
      statusCounts: Object.fromEntries(c.rows.map((x: any) => [x.status, x.n])) as Record<string, number>,
    };
  }
  /** The per-scheme table: active schemes + every scheme the tenant has applications for, with open apps and FY benefit (read). */
  async schemeTable(tenantId: string, fy: { start: string; end: string }) {
    const r = await this.replica.forTenant(tenantId).query(
      `WITH apps AS (SELECT scheme_id, count(*) FILTER (WHERE status NOT IN ('draft','closed','rejected','disbursed'))::int AS open_apps, count(*)::int AS all_apps
                       FROM scheme_applications WHERE tenant_id=$1 AND deleted_at IS NULL GROUP BY scheme_id),
            fyb AS (SELECT scheme_id, sum(amount_minor)::text AS benefit, count(*)::int AS transfers FROM dbt_transfers
                     WHERE tenant_id=$1 AND credited_on >= $2::date AND credited_on < $3::date AND created_at >= now() - interval '3 years' GROUP BY scheme_id)
       SELECT s.id, s.code, s.default_name, lv.code AS category, s.application_window, s.version, s.is_active, COALESCE(apps.open_apps,0) AS open_apps,
              COALESCE(apps.all_apps,0) AS all_apps, fyb.benefit, COALESCE(fyb.transfers,0) AS transfers
         FROM schemes s LEFT JOIN lookup_values lv ON lv.id = s.category_id LEFT JOIN apps ON apps.scheme_id = s.id LEFT JOIN fyb ON fyb.scheme_id = s.id
        WHERE s.deleted_at IS NULL AND (s.is_active OR apps.scheme_id IS NOT NULL)
        ORDER BY COALESCE(fyb.benefit::numeric, 0) DESC, open_apps DESC, s.code LIMIT 200`, [tenantId, fy.start, fy.end]);
    return r.rows.map((x: any) => ({ schemeId: x.id, code: x.code, name: x.default_name, category: x.category ?? null, window: x.application_window ?? null, version: Number(x.version),
      isActive: x.is_active, openApplications: Number(x.open_apps), allApplications: Number(x.all_apps), fyBenefitMinor: x.benefit ?? null, fyTransfers: Number(x.transfers) }));
  }
  async schemeByCode(code: string, tenantId: string) {
    const r = await this.replica.forTenant(tenantId).query(`SELECT id, code, default_name, benefit_summary, eligibility_rules, version, is_active FROM schemes WHERE code=$1 AND deleted_at IS NULL`, [code]);
    return r.rows[0] ? { id: r.rows[0].id as string, code: r.rows[0].code as string, name: r.rows[0].default_name as string, benefitSummary: r.rows[0].benefit_summary,
      eligibilityRules: r.rows[0].eligibility_rules, version: Number(r.rows[0].version), isActive: r.rows[0].is_active as boolean } : null;
  }

  // ---- the pipeline (W203) ----
  async pipelineCounts(tenantId: string, schemeId: string, fy: { start: string; end: string }): Promise<Record<string, number>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT count(*) FILTER (WHERE status='under_verification')::int AS under_verification, count(*) FILTER (WHERE status='clarification_needed')::int AS clarification_needed,
              count(*) FILTER (WHERE status='submitted')::int AS submitted, count(*) FILTER (WHERE status='draft')::int AS draft,
              count(*) FILTER (WHERE status IN ('approved','disbursed') AND decided_at >= $3::date AND decided_at < $4::date)::int AS approved_disbursed_fy,
              count(*) FILTER (WHERE status IN ('rejected','appealed'))::int AS rejected_appealed
         FROM scheme_applications WHERE tenant_id=$1 AND scheme_id=$2 AND deleted_at IS NULL`, [tenantId, schemeId, fy.start, fy.end]);
    return r.rows[0] ?? {};
  }
  /** One tab's rows, oldest change first (Waiting ▾), µs keyset on (updated_at, id). form_data is NEVER selected — only its keys. */
  async pipeline(tenantId: string, q: { schemeId: string; statuses: string[]; fyOnly?: { start: string; end: string }; cursor?: { c: string; id: string }; limit: number }): Promise<PipelineRow[]> {
    const params: unknown[] = [tenantId, q.schemeId, q.statuses];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `a.tenant_id=$1 AND a.scheme_id=$2 AND a.status::text = ANY($3::text[]) AND a.deleted_at IS NULL`;
    if (q.fyOnly) where += ` AND a.decided_at >= ${p(q.fyOnly.start)}::date AND a.decided_at < ${p(q.fyOnly.end)}::date`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (a.updated_at > ${cc}::timestamptz OR (a.updated_at = ${cc}::timestamptz AND a.id > ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT a.id, a.scheme_id, a.status::text AS status, a.applicant_user_id, u.full_name, u.phone, a.assisted_by, ab.full_name AS assisted_name, a.govt_app_ref,
              a.rejection_reason_code, a.submitted_at, a.decided_at, a.updated_at, a.updated_at::text AS updated_raw,
              CASE WHEN jsonb_typeof(a.form_data) = 'object' THEN (SELECT COALESCE(array_agg(k ORDER BY k), '{}') FROM jsonb_object_keys(a.form_data) AS k) ELSE '{}'::text[] END AS form_fields,
              (SELECT e.note FROM scheme_application_events e WHERE e.tenant_id = a.tenant_id AND e.application_id = a.id AND e.to_status = 'clarification_needed'
                 AND e.created_at >= now() - interval '3 years' ORDER BY e.created_at DESC LIMIT 1) AS clar_note,
              (SELECT b.reason_code FROM dbt_bounces b WHERE b.tenant_id = a.tenant_id AND b.application_id = a.id AND b.resolution = 'open' AND b.deleted_at IS NULL
                 ORDER BY b.created_at DESC LIMIT 1) AS bounce_reason
         FROM scheme_applications a JOIN users u ON u.id = a.applicant_user_id LEFT JOIN users ab ON ab.id = a.assisted_by
        WHERE ${where} ORDER BY a.updated_at ASC, a.id ASC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({ id: x.id, schemeId: x.scheme_id, status: x.status, applicantUserId: x.applicant_user_id, applicantName: x.full_name ?? null, applicantPhone: x.phone ?? '',
      assistedBy: x.assisted_by ?? null, assistedByName: x.assisted_name ?? null, govtAppRef: x.govt_app_ref ?? null, rejectionReasonCode: x.rejection_reason_code ?? null,
      submittedAt: iso(x.submitted_at), decidedAt: iso(x.decided_at), changedAt: new Date(x.updated_at), changedAtRaw: x.updated_raw, clarificationNote: x.clar_note ?? null,
      openBounceReason: x.bounce_reason ?? null, formFields: (x.form_fields ?? []) as string[] }));
  }
  /** The translated fix text per rejection code (seed core/0026 `scheme.rejection.fix.<code>` + `.label.<code>`, en / hi / gu). */
  async rejectionTexts(tenantId: string): Promise<Record<string, { label: Record<string, string>; fix: Record<string, string> }>> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT key, language_code, text FROM ui_messages WHERE key LIKE 'scheme.rejection.%'`);
    const out: Record<string, { label: Record<string, string>; fix: Record<string, string> }> = {};
    for (const x of r.rows as Array<{ key: string; language_code: string; text: string }>) {
      const m = /^scheme\.rejection\.(label|fix)\.([a-z_]+)$/.exec(x.key);
      if (!m) continue;
      out[m[2]] = out[m[2]] ?? { label: {}, fix: {} };
      out[m[2]][m[1] as 'label' | 'fix'][x.language_code] = x.text;
    }
    return out;
  }
  async formValue(tx: TxContext, tenantId: string, applicationId: string): Promise<{ schemeId: string; formData: Record<string, unknown> } | null> {
    const r = await tx.query(`SELECT scheme_id, form_data FROM scheme_applications WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`, [tenantId, applicationId]);
    return r.rows[0] ? { schemeId: r.rows[0].scheme_id, formData: r.rows[0].form_data ?? {} } : null;
  }

  // ---- the sweep ----
  async insertSweep(tx: TxContext, s: { id: string; tenantId: string; schemeId: string; schemeVersion: number; requestedBy: string; reason: string }): Promise<void> {
    await tx.query(`INSERT INTO scheme_eligibility_sweeps (id, tenant_id, scheme_id, scheme_version, requested_by, reason) VALUES ($1,$2,$3,$4,$5,$6)`,
      [s.id, s.tenantId, s.schemeId, s.schemeVersion, s.requestedBy, s.reason]);
  }
  async queuedSweeps(tx: TxContext, tenantId: string): Promise<SweepRow[]> {
    const r = await tx.query(`SELECT ${SWEEP_COLS} FROM scheme_eligibility_sweeps WHERE tenant_id=$1 AND status='queued' ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED`, [tenantId]);
    return r.rows.map(toSweep);
  }
  async markSweep(tx: TxContext, tenantId: string, id: string, p: { status: string; membersEvaluated?: number; eligible?: number; notApplied?: number; failure?: string | null }): Promise<void> {
    await tx.query(
      `UPDATE scheme_eligibility_sweeps SET status=$3::text, members_evaluated=COALESCE($4, members_evaluated), eligible_count=COALESCE($5, eligible_count),
              eligible_not_applied=COALESCE($6, eligible_not_applied), failure=$7,
              started_at=CASE WHEN $3::text='running' THEN now() ELSE started_at END, finished_at=CASE WHEN $3::text IN ('done','failed') THEN now() ELSE finished_at END, updated_at=now()
        WHERE tenant_id=$1 AND id=$2`, [tenantId, id, p.status, p.membersEvaluated ?? null, p.eligible ?? null, p.notApplied ?? null, p.failure ?? null]);
  }
  /** One batch of the tenant's active members (keyset on user id) with what the evaluator reads. */
  async memberBatch(tx: TxContext, tenantId: string, schemeId: string, afterUserId: string | null, limit: number) {
    const r = await tx.query(
      `WITH m AS (SELECT utr.user_id, array_agg(DISTINCT r.code ORDER BY r.code) AS roles FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
                   WHERE utr.tenant_id=$1 AND utr.is_active AND utr.deleted_at IS NULL AND ($3::uuid IS NULL OR utr.user_id > $3::uuid)
                   GROUP BY utr.user_id ORDER BY utr.user_id LIMIT $4)
       SELECT m.user_id, m.roles, u.gender, u.dob::text AS dob,
              COALESCE((SELECT json_agg(json_build_object('value', lp.area_value, 'unit', lp.area_unit)) FROM land_parcels lp
                         WHERE lp.tenant_id=$1 AND lp.owner_user_id = m.user_id AND lp.deleted_at IS NULL), '[]'::json) AS parcels,
              EXISTS (SELECT 1 FROM scheme_applications a WHERE a.tenant_id=$1 AND a.scheme_id=$2 AND a.applicant_user_id = m.user_id AND a.deleted_at IS NULL) AS applied
         FROM m JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL ORDER BY m.user_id`, [tenantId, schemeId, afterUserId, limit]);
    return r.rows.map((x: any) => ({ userId: x.user_id as string, roles: (x.roles ?? []) as string[], gender: x.gender ?? null, dob: x.dob ?? null,
      parcels: (x.parcels ?? []) as Array<{ value: number | string | null; unit: string | null }>, applied: x.applied as boolean }));
  }
  async insertSweepRow(tx: TxContext, r: { tenantId: string; sweepId: string; userId: string; eligible: boolean; reasons: string[]; inputs: Record<string, unknown>; applied: boolean }): Promise<void> {
    await tx.query(`INSERT INTO scheme_eligibility_sweep_rows (tenant_id, sweep_id, user_id, eligible, reasons, inputs, already_applied) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
       ON CONFLICT (sweep_id, user_id) DO NOTHING`, [r.tenantId, r.sweepId, r.userId, r.eligible, JSON.stringify(r.reasons), JSON.stringify(r.inputs), r.applied]);
  }
  async sweep(tenantId: string, id: string): Promise<SweepRow | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${SWEEP_COLS} FROM scheme_eligibility_sweeps WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    return r.rows[0] ? toSweep(r.rows[0]) : null;
  }
  async sweepsFor(tenantId: string, schemeId: string, limit = 10): Promise<SweepRow[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${SWEEP_COLS} FROM scheme_eligibility_sweeps WHERE tenant_id=$1 AND scheme_id=$2 ORDER BY created_at DESC LIMIT $3`, [tenantId, schemeId, limit]);
    return r.rows.map(toSweep);
  }
  /** The call list: eligible members who have NOT applied, µs keyset. */
  async callList(tenantId: string, sweepId: string, q: { cursor?: { c: string; id: string }; limit: number; all?: boolean }) {
    const params: unknown[] = [tenantId, sweepId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `r.tenant_id=$1 AND r.sweep_id=$2`;
    if (!q.all) where += ` AND r.eligible AND NOT r.already_applied`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (r.created_at < ${cc}::timestamptz OR (r.created_at = ${cc}::timestamptz AND r.id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const res = await this.replica.forTenant(tenantId).query(
      `SELECT r.id, r.user_id, r.eligible, r.reasons, r.inputs, r.already_applied, r.created_at::text AS raw, u.full_name, u.phone
         FROM scheme_eligibility_sweep_rows r JOIN users u ON u.id = r.user_id WHERE ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ${lp}`, params);
    return res.rows.map((x: any) => ({ id: x.id as string, userId: x.user_id as string, eligible: x.eligible as boolean, reasons: (x.reasons ?? []) as string[], inputs: x.inputs ?? {},
      alreadyApplied: x.already_applied as boolean, raw: x.raw as string, fullName: x.full_name ?? null, phone: x.phone ?? '' }));
  }
}
