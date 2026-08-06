// apps/admin-api/src/modules/consent-ops/repositories/consent-ops.repository.ts · ALL SQL for the consent plane.
//
// EVERY READ HERE IS CROSS-TENANT AND CARRIES NO TENANT PREDICATE, which is the opposite of Law 1 and is correct: a
// consent purpose is platform-wide (the same notice governs every tenant's farmers) and `consents` has no tenant_id at
// all — it belongs to a PERSON. Stated at the top so the absence reads as a decision.
//
// No `SELECT *` anywhere, and the registry read joins `users` for PII which is masked in the service before anything
// leaves — the raw values exist only between this query and `maskApplicant`.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import type { ConsentVersionRow, NoticeRow } from '../domain/consent-notice';

const V_COLS = `id, purpose_code, version, status, is_mandatory, change_reason, drafted_by, drafted_at,
  published_by, published_at, checker_note, is_backfilled`;

function toVersion(r: any, notices: NoticeRow[] = []): ConsentVersionRow {
  return {
    id: r.id, purposeCode: r.purpose_code, version: r.version, status: r.status,
    isMandatory: r.is_mandatory === true, changeReason: r.change_reason,
    draftedBy: r.drafted_by ?? null,
    draftedAt: r.drafted_at ? new Date(r.drafted_at).toISOString() : null,
    publishedBy: r.published_by ?? null,
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    checkerNote: r.checker_note ?? null, isBackfilled: r.is_backfilled === true,
    notices,
  };
}

@Injectable()
export class ConsentOpsRepository {
  constructor(private readonly pool: AdminPool) {}

  /* ---------------- the active platform languages ----------------
     Coverage is computed against the list IN FORCE, never a hardcoded twelve: the platform launches with three and a
     new language is an INSERT (0001), so a fixed denominator would misreport in both directions.                    */
  async activeLanguages(): Promise<string[]> {
    const r = await this.pool.query(`SELECT code FROM languages WHERE is_active ORDER BY code`);
    return r.rows.map((x: any) => x.code);
  }

  /* ---------------- purposes (W047) ---------------- */

  /** Every purpose with its current published version, its notice coverage and its live opt-in rate. */
  async listPurposes(): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT p.code, p.default_name, p.is_mandatory, p.current_version,
              v.id AS version_id, v.status AS version_status, v.is_backfilled,
              (SELECT count(*)::int FROM consent_purpose_notices n WHERE n.version_id = v.id) AS notice_count,
              d.id AS draft_id, d.version AS draft_version,
              -- The opt-in rate over LATEST decisions per user, not over every event: counting events would let one
              -- person who toggled twelve times outvote eleven who decided once.
              (SELECT count(*)::int FROM (
                 SELECT DISTINCT ON (c.user_id) c.granted
                   FROM consents c WHERE c.purpose_code = p.code
                  ORDER BY c.user_id, c.created_at DESC
               ) latest WHERE latest.granted) AS granted_principals,
              (SELECT count(DISTINCT c.user_id)::int FROM consents c WHERE c.purpose_code = p.code) AS decided_principals
         FROM consent_purposes p
         LEFT JOIN consent_purpose_versions v ON v.purpose_code = p.code AND v.status = 'published' AND v.deleted_at IS NULL
         LEFT JOIN consent_purpose_versions d ON d.purpose_code = p.code AND d.status = 'draft' AND d.deleted_at IS NULL
        WHERE p.deleted_at IS NULL
        ORDER BY p.is_mandatory DESC, p.code`);
    return r.rows;
  }

  async getPurpose(code: string): Promise<{ code: string; defaultName: string; isMandatory: boolean; currentVersion: string } | null> {
    const r = await this.pool.query(
      `SELECT code, default_name, is_mandatory, current_version FROM consent_purposes WHERE code=$1 AND deleted_at IS NULL`, [code]);
    const x = r.rows[0];
    return x ? { code: x.code, defaultName: x.default_name, isMandatory: x.is_mandatory === true, currentVersion: x.current_version } : null;
  }

  /* ---------------- versions + notices ---------------- */

  async listVersions(purposeCode: string): Promise<ConsentVersionRow[]> {
    const r = await this.pool.query(
      `SELECT ${V_COLS} FROM consent_purpose_versions WHERE purpose_code=$1 AND deleted_at IS NULL ORDER BY drafted_at DESC`, [purposeCode]);
    const rows = r.rows.map((x: any) => toVersion(x));
    if (rows.length === 0) return rows;
    const n = await this.pool.query(
      `SELECT version_id, language_code, notice_text, toggle_label FROM consent_purpose_notices
        WHERE version_id = ANY($1::uuid[]) ORDER BY language_code`, [rows.map((x) => x.id)]);
    const byVersion = new Map<string, NoticeRow[]>();
    for (const x of n.rows as any[]) {
      const list = byVersion.get(x.version_id) ?? [];
      list.push({ languageCode: x.language_code, noticeText: x.notice_text, toggleLabel: x.toggle_label });
      byVersion.set(x.version_id, list);
    }
    return rows.map((v) => ({ ...v, notices: byVersion.get(v.id) ?? [] }));
  }

  /** Every version label EVER used for this purpose, including discarded drafts — a discarded label is burned, because
   *  two notice texts sharing a label would make every consent stamped with it ambiguous. */
  async versionLabelsEverUsed(client: PoolClient, purposeCode: string): Promise<string[]> {
    const r = await client.query(`SELECT version FROM consent_purpose_versions WHERE purpose_code=$1`, [purposeCode]);
    return r.rows.map((x: any) => x.version);
  }

  async getVersionForUpdate(client: PoolClient, id: string): Promise<ConsentVersionRow | null> {
    const r = await client.query(`SELECT ${V_COLS} FROM consent_purpose_versions WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toVersion(r.rows[0]) : null;
  }
  async getPublishedForUpdate(client: PoolClient, purposeCode: string): Promise<ConsentVersionRow | null> {
    const r = await client.query(
      `SELECT ${V_COLS} FROM consent_purpose_versions WHERE purpose_code=$1 AND status='published' AND deleted_at IS NULL FOR UPDATE`, [purposeCode]);
    return r.rows[0] ? toVersion(r.rows[0]) : null;
  }
  async versionsFor(client: PoolClient, purposeCode: string): Promise<Array<{ id: string; status: string; version: string }>> {
    const r = await client.query(`SELECT id, status, version FROM consent_purpose_versions WHERE purpose_code=$1 AND deleted_at IS NULL`, [purposeCode]);
    return r.rows.map((x: any) => ({ id: x.id, status: x.status, version: x.version }));
  }
  async noticesFor(client: PoolClient, versionId: string): Promise<NoticeRow[]> {
    const r = await client.query(
      `SELECT language_code, notice_text, toggle_label FROM consent_purpose_notices WHERE version_id=$1 ORDER BY language_code`, [versionId]);
    return r.rows.map((x: any) => ({ languageCode: x.language_code, noticeText: x.notice_text, toggleLabel: x.toggle_label }));
  }

  async insertVersion(client: PoolClient, v: { purposeCode: string; version: string; isMandatory: boolean; changeReason: string; draftedBy: string }): Promise<{ id: string }> {
    const r = await client.query(
      `INSERT INTO consent_purpose_versions (purpose_code, version, status, is_mandatory, change_reason, drafted_by, created_by, updated_by)
       VALUES ($1,$2,'draft',$3,$4,$5,$5,$5) RETURNING id`,
      [v.purposeCode, v.version, v.isMandatory, v.changeReason, v.draftedBy]);
    return { id: r.rows[0].id };
  }

  /** Upsert one language's notice on a DRAFT. The trigger in 0108 refuses any write once the version is published, so
   *  this method cannot corrupt a published notice even if a future caller passes the wrong id. */
  async upsertNotice(client: PoolClient, v: { versionId: string; languageCode: string; noticeText: string; toggleLabel: string; actorUserId: string }): Promise<void> {
    await client.query(
      `INSERT INTO consent_purpose_notices (version_id, language_code, notice_text, toggle_label, created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (version_id, language_code)
       DO UPDATE SET notice_text=EXCLUDED.notice_text, toggle_label=EXCLUDED.toggle_label, created_by=EXCLUDED.created_by`,
      [v.versionId, v.languageCode, v.noticeText, v.toggleLabel, v.actorUserId]);
  }
  async deleteNotice(client: PoolClient, versionId: string, languageCode: string): Promise<number> {
    const r = await client.query(`DELETE FROM consent_purpose_notices WHERE version_id=$1 AND language_code=$2`, [versionId, languageCode]);
    return r.rowCount ?? 0;
  }

  async publishVersion(client: PoolClient, id: string, publishedBy: string, checkerNote: string | null): Promise<void> {
    await client.query(
      `UPDATE consent_purpose_versions SET status='published', published_by=$2, published_at=now(), checker_note=$3, updated_by=$2, updated_at=now()
        WHERE id=$1 AND status='draft' AND deleted_at IS NULL`, [id, publishedBy, checkerNote]);
  }
  async supersedeVersion(client: PoolClient, id: string, actorUserId: string): Promise<void> {
    await client.query(
      `UPDATE consent_purpose_versions SET status='superseded', updated_by=$2, updated_at=now() WHERE id=$1 AND status='published'`, [id, actorUserId]);
  }
  async discardDraft(client: PoolClient, id: string, actorUserId: string): Promise<void> {
    await client.query(
      `UPDATE consent_purpose_versions SET deleted_at=now(), updated_by=$2, updated_at=now() WHERE id=$1 AND status='draft' AND deleted_at IS NULL`, [id, actorUserId]);
  }

  /** THE PROJECTION (Law 5). `consent_purposes.current_version` becomes a reflection of the published version row, in
   *  the publish transaction. Before 0108 it was the only record of the version and it was mutable — which is exactly
   *  how the words of every superseded version were lost. */
  async projectCurrentVersion(client: PoolClient, purposeCode: string, version: string, isMandatory: boolean, actorUserId: string): Promise<void> {
    await client.query(
      `UPDATE consent_purposes SET current_version=$2, is_mandatory=$3, updated_by=$4, updated_at=now() WHERE code=$1 AND deleted_at IS NULL`,
      [purposeCode, version, isMandatory, actorUserId]);
  }

  /* ---------------- the registry (W046) ---------------- */

  /** Consent EVENTS, newest first, keyset on (created_at, id). The canon's own header says 8,42,196 events, so this
   *  never counts and never offsets. */
  async listConsents(f: { purposeCode?: string; channel?: string; withdrawnOnly?: boolean }, cursor: { c: string; id: string } | undefined, limit: number): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'TRUE';
    if (f.purposeCode) where += ` AND c.purpose_code = ${p(f.purposeCode)}`;
    if (f.channel) where += ` AND c.channel = ${p(f.channel)}`;
    if (f.withdrawnOnly) where += ' AND c.granted = false';
    if (cursor) { const cc = p(cursor.c), ci = p(cursor.id); where += ` AND (c.created_at < ${cc} OR (c.created_at = ${cc} AND c.id < ${ci}))`; }
    const lp = p(limit);
    const r = await this.pool.query(
      `SELECT c.id, c.user_id, c.purpose_code, c.version, c.granted, c.channel, c.assisted_by, c.created_at,
              c.consent_purpose_version_id,
              u.full_name AS principal_name, u.phone AS principal_phone,
              -- Was there an EARLIER grant for this person+purpose? W046's display rule: "withdrawn" is a granted:false
              -- event SUPERSEDING a prior grant. A granted:false with no prior grant is a REFUSAL, and counting it as a
              -- withdrawal would inflate every withdrawal number with people who simply said no the first time.
              EXISTS (SELECT 1 FROM consents pr
                       WHERE pr.user_id = c.user_id AND pr.purpose_code = c.purpose_code
                         AND pr.granted = true AND pr.created_at < c.created_at) AS had_prior_grant
         FROM consents c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE ${where}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ${lp}`, params);
    return r.rows;
  }

  /** W046's tiles: principals with any consent, and the assisted share — over LATEST decisions, not events. */
  async registryTiles(): Promise<{ principals: number; assistedEvents: number; totalEvents: number }> {
    const r = await this.pool.query(
      `SELECT count(DISTINCT user_id)::int AS principals,
              count(*) FILTER (WHERE channel = 'ambassador_assisted')::int AS assisted_events,
              count(*)::int AS total_events
         FROM consents`);
    const x = r.rows[0] ?? {};
    return { principals: x.principals ?? 0, assistedEvents: x.assisted_events ?? 0, totalEvents: x.total_events ?? 0 };
  }

  /** How many principals hold a superseded version — the size of the re-consent job W047 promises and nothing performs. */
  async reConsentRows(purposeCode: string): Promise<Array<{ status: string | null; resolvable: boolean; n: number }>> {
    const r = await this.pool.query(
      `SELECT v.status::text AS status, (l.consent_purpose_version_id IS NOT NULL) AS resolvable, count(*)::int AS n
         FROM (SELECT DISTINCT ON (c.user_id) c.user_id, c.granted, c.consent_purpose_version_id
                 FROM consents c WHERE c.purpose_code = $1
                ORDER BY c.user_id, c.created_at DESC) l
         LEFT JOIN consent_purpose_versions v ON v.id = l.consent_purpose_version_id
        WHERE l.granted
        GROUP BY v.status, (l.consent_purpose_version_id IS NOT NULL)`, [purposeCode]);
    return r.rows.map((x: any) => ({ status: x.status ?? null, resolvable: x.resolvable === true, n: x.n }));
  }
}
