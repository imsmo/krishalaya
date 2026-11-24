// apps/admin-api/src/modules/platform-pages/repositories/platform-pages.repository.ts · PC-56 LEGAL-1 (migration 0242).
//
// kv_admin over `cms_pages` PLATFORM rows only (`tenant_id IS NULL` — 0177's `cp_admin_realm`), and over `translations` rows of
// `entity_type = 'cms_page'` (0103's admin grants; no DELETE for anybody — a removed translation is soft-deleted). Every write runs inside
// the caller's transaction (the audit row commits with it). `cms_pages` is not partitioned (0177's note); every read is by slug or id.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import { PageStatus } from '../domain/platform-page.state';

export interface VersionSummary {
  id: string; slug: string; version: number; status: PageStatus; pageKind: string; title: string; languageCode: string | null;
  createdByAdminId: string | null; lastEditedByAdminId: string | null; publishedByAdminId: string | null; publishedAt: string | null;
  archivedAt: string | null; archivedReason: string | null; archivedByAdminId: string | null; updatedAt: string;
}
export interface VersionDetail extends VersionSummary {
  body: string;
  translations: { languageCode: string; title: string | null; body: string }[];
}

const COLS = `p.id, p.slug, p.version, p.status, p.page_kind, p.default_title, p.body, p.language_code, p.created_by,
  p.last_edited_by_admin_id, p.published_by_admin_id, p.published_at, p.archived_at, p.archived_reason, p.archived_by_admin_id, p.updated_at`;

const iso = (v: unknown): string | null => (v ? new Date(String(v)).toISOString() : null);
function toSummary(r: Record<string, unknown>): VersionSummary {
  return {
    id: String(r.id), slug: String(r.slug), version: Number(r.version), status: String(r.status) as PageStatus,
    pageKind: String(r.page_kind), title: String(r.default_title), languageCode: (r.language_code as string | null) ?? null,
    createdByAdminId: (r.created_by as string | null) ?? null, lastEditedByAdminId: (r.last_edited_by_admin_id as string | null) ?? null,
    publishedByAdminId: (r.published_by_admin_id as string | null) ?? null, publishedAt: iso(r.published_at),
    archivedAt: iso(r.archived_at), archivedReason: (r.archived_reason as string | null) ?? null,
    archivedByAdminId: (r.archived_by_admin_id as string | null) ?? null, updatedAt: iso(r.updated_at) as string,
  };
}

type Q = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };

@Injectable()
export class PlatformPagesRepository {
  constructor(private readonly pool: AdminPool) {}

  /** Every platform version of the given slugs, newest first (summary only — the list screen). */
  async summaries(slugs: readonly string[]): Promise<VersionSummary[]> {
    const r = await this.pool.query(
      `SELECT ${COLS} FROM cms_pages p
        WHERE p.tenant_id IS NULL AND p.deleted_at IS NULL AND p.slug = ANY($1::varchar[])
        ORDER BY p.slug, p.version DESC`, [slugs]);
    return r.rows.map(toSummary);
  }

  async versionsOf(slug: string, db: Q = this.pool as unknown as Q): Promise<VersionDetail[]> {
    const r = await db.query(
      `SELECT ${COLS},
              COALESCE((SELECT json_agg(json_build_object('languageCode', b.language_code, 'title', tt.text, 'body', b.text)
                                        ORDER BY b.language_code)
                          FROM translations b
                          LEFT JOIN translations tt ON tt.entity_type = 'cms_page' AND tt.entity_id = b.entity_id
                                                   AND tt.field = 'title' AND tt.language_code = b.language_code AND tt.deleted_at IS NULL
                         WHERE b.entity_type = 'cms_page' AND b.entity_id = p.id AND b.field = 'body' AND b.deleted_at IS NULL), '[]'::json) AS translations
         FROM cms_pages p
        WHERE p.tenant_id IS NULL AND p.deleted_at IS NULL AND p.slug = $1
        ORDER BY p.version DESC`, [slug]);
    return r.rows.map((x) => ({ ...toSummary(x), body: String(x.body), translations: (x.translations ?? []) as VersionDetail['translations'] }));
  }

  async detailById(db: Q, id: string): Promise<VersionDetail | null> {
    const r = await db.query(`SELECT p.slug FROM cms_pages p WHERE p.id = $1 AND p.tenant_id IS NULL`, [id]);
    if (!r.rows[0]) return null;
    return (await this.versionsOf(String(r.rows[0].slug), db)).find((v) => v.id === id) ?? null;
  }

  /** Lock one platform version for a write. */
  async lockById(c: PoolClient, id: string): Promise<(VersionSummary & { body: string }) | null> {
    const r = await c.query(`SELECT ${COLS} FROM cms_pages p WHERE p.id = $1 AND p.tenant_id IS NULL AND p.deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? { ...toSummary(r.rows[0]), body: String(r.rows[0].body) } : null;
  }

  /** Serialise every write to one slug (version allocation, the single open draft, the single live version) — 0177's advisory-lock idiom. */
  async lockSlug(c: PoolClient, slug: string): Promise<void> {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('cms_pages:platform:' || $1))`, [slug]);
  }

  async slugState(c: PoolClient, slug: string): Promise<{ maxVersion: number; openDraft: number | null; latestLanguage: string | null }> {
    const r = await c.query(
      `SELECT COALESCE(max(version), 0) AS max_version,
              max(version) FILTER (WHERE status = 'draft' AND deleted_at IS NULL) AS open_draft,
              (SELECT language_code FROM cms_pages WHERE tenant_id IS NULL AND slug = $1 ORDER BY version DESC LIMIT 1) AS latest_language
         FROM cms_pages WHERE tenant_id IS NULL AND slug = $1`, [slug]);
    const x = r.rows[0] ?? {};
    return { maxVersion: Number(x.max_version ?? 0), openDraft: x.open_draft == null ? null : Number(x.open_draft), latestLanguage: x.latest_language ?? null };
  }

  /** The `languages` table's active codes (Law 6 — never a list in code). */
  async activeLanguages(): Promise<string[]> {
    const r = await this.pool.query(`SELECT code FROM languages WHERE is_active = true AND deleted_at IS NULL ORDER BY sort_order, code`);
    return r.rows.map((x) => String(x.code));
  }

  /** 0177's `cms_page_archive_reason` vocabulary — the codes an operator may CHOOSE (not `superseded` / `unrecorded`). */
  async archiveReasons(): Promise<{ code: string; name: string }[]> {
    const r = await this.pool.query(
      `SELECT code, default_name FROM lookup_values
        WHERE type_code = 'cms_page_archive_reason' AND tenant_id IS NULL AND is_active AND deleted_at IS NULL
          AND COALESCE((meta->>'chosen')::boolean, false)
        ORDER BY sort_order, code`);
    return r.rows.map((x) => ({ code: String(x.code), name: String(x.default_name) }));
  }

  async insertDraft(c: PoolClient, v: { slug: string; version: number; title: string; body: string; languageCode: string; adminId: string }): Promise<string> {
    const r = await c.query(
      `INSERT INTO cms_pages (tenant_id, slug, page_kind, default_title, body, version, status, language_code,
                              created_by, updated_by, last_edited_by_admin_id)
       VALUES (NULL, $1, 'policy', $2, $3, $4, 'draft', $5, $6, $6, $6) RETURNING id`,
      [v.slug, v.title, v.body, v.version, v.languageCode, v.adminId]);
    return String(r.rows[0].id);
  }

  /** Save a draft's words; ALWAYS stamps the saver as last editor (saving a loaded draft unchanged is how an operator adopts it). */
  async updateDraft(c: PoolClient, id: string, w: { title: string; body: string; adminId: string }): Promise<void> {
    await c.query(
      `UPDATE cms_pages SET default_title = $2, body = $3, last_edited_by_admin_id = $4, updated_by = $4, updated_at = now()
        WHERE id = $1 AND tenant_id IS NULL AND status = 'draft'`, [id, w.title, w.body, w.adminId]);
  }

  /** Replace the version's translation set: upsert the given languages (reviving a soft-deleted row), soft-delete the rest. Human-authored,
   *  so live on insert (0103: only a machine row waits for review). 0242's trigger refuses this on a version that left draft. */
  async replaceTranslations(c: PoolClient, pageId: string, set: { languageCode: string; title: string | null; body: string }[], adminId: string): Promise<void> {
    const keep: string[] = [];
    for (const t of set) {
      const fields: [string, string | null][] = [['body', t.body], ['title', t.title]];
      for (const [field, text] of fields) {
        if (text === null) continue;
        keep.push(`${field}:${t.languageCode}`);
        await c.query(
          `INSERT INTO translations (entity_type, entity_id, field, language_code, text, is_machine, created_by, updated_by)
           VALUES ('cms_page', $1, $2, $3, $4, false, $5, $5)
           ON CONFLICT (entity_type, entity_id, field, language_code)
           DO UPDATE SET text = EXCLUDED.text, is_machine = false, deleted_at = NULL, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [pageId, field, t.languageCode, text, adminId]);
      }
    }
    await c.query(
      `UPDATE translations SET deleted_at = now(), updated_by = $3, updated_at = now()
        WHERE entity_type = 'cms_page' AND entity_id = $1 AND deleted_at IS NULL
          AND NOT ((field || ':' || language_code) = ANY($2::text[]))`, [pageId, keep, adminId]);
  }

  /** Archive the slug's live version as `superseded` by the publisher — the same statement set as the publish (one live version, always). */
  async supersedeLive(c: PoolClient, slug: string, adminId: string): Promise<{ id: string; version: number } | null> {
    const r = await c.query(
      `UPDATE cms_pages SET status = 'archived', archived_reason = 'superseded', archived_at = now(), archived_by_admin_id = $2,
                            updated_by = $2, updated_at = now()
        WHERE tenant_id IS NULL AND slug = $1 AND status = 'published' AND deleted_at IS NULL
        RETURNING id, version`, [slug, adminId]);
    return r.rows[0] ? { id: String(r.rows[0].id), version: Number(r.rows[0].version) } : null;
  }

  async markPublished(c: PoolClient, id: string, adminId: string): Promise<void> {
    await c.query(
      `UPDATE cms_pages SET status = 'published', published_at = now(), published_by_admin_id = $2, updated_by = $2, updated_at = now()
        WHERE id = $1 AND tenant_id IS NULL AND status = 'draft'`, [id, adminId]);
  }

  async markArchived(c: PoolClient, id: string, reasonCode: string, adminId: string): Promise<void> {
    await c.query(
      `UPDATE cms_pages SET status = 'archived', archived_reason = $2, archived_at = now(), archived_by_admin_id = $3,
                            updated_by = $3, updated_at = now()
        WHERE id = $1 AND tenant_id IS NULL AND status IN ('draft', 'published')`, [id, reasonCode, adminId]);
  }
}
