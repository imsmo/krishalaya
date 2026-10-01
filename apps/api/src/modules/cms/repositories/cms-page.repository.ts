// modules/cms/repositories/cms-page.repository.ts · cms_pages. tenant_id in every query (Law 1) + RLS (0177: the
// platform row is READABLE from the tenant realm and never writable). No optimistic-lock column → mutations lock FOR
// UPDATE, and a version is ALLOCATED under a transaction-scoped advisory lock on (tenant, slug) (F-20).
//
// PC-56 TENANT-8c. What changed and why:
//   • `publishedBySlug` — the TENANT's own published version wins over the platform's REGARDLESS of version (F-14: a
//     platform `about` v5 shadowed the cooperative's `about` v1, ranked by version alone).
//   • `index` — W175 is one row per SLUG (the table is one row per version): the tenant's latest version, its live one,
//     its open draft, and the platform's live version beside it, keyset on the slug.
//   • the columns 0177 added (language, topic, place, publisher, archive facts, last editor) are read and written here.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { CmsPage } from '../domain/cms-page.entity';
import { PageKind, PageStatus } from '../domain/cms.events';
import { FaqEntryPlace } from '../domain/faq-order';

const COLS = `id, tenant_id, slug, page_kind, default_title, body, version, status, published_at, published_by, archived_at, archived_by,
  archived_reason, language_code, topic, sort_order, created_by, last_edited_by, created_at, updated_at`;
function toDomain(r: any): CmsPage {
  return CmsPage.rehydrate({
    id: r.id, tenantId: r.tenant_id, slug: r.slug, pageKind: r.page_kind as PageKind, defaultTitle: r.default_title, body: r.body,
    version: Number(r.version), status: r.status as PageStatus, publishedAt: r.published_at, publishedBy: r.published_by ?? null,
    archivedAt: r.archived_at ?? null, archivedBy: r.archived_by ?? null, archivedReason: r.archived_reason ?? null,
    languageCode: r.language_code ?? null, topic: r.topic ?? null, sortOrder: Number(r.sort_order ?? 0),
    createdBy: r.created_by ?? null, lastEditedBy: r.last_edited_by ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  });
}

export interface PageIndexQuery { pageKind?: string; state?: string; languageCode?: string; cursor?: string; limit: number }

/** One W175 row: a slug as this tenant sees it. */
export interface PageIndexRow {
  slug: string; pageKind: string; title: string; languageCode: string | null; topic: string | null;
  own: { rows: number; latestVersion: number | null; latestStatus: string | null; latestId: string | null; publishedVersion: number | null; publishedId: string | null; draftVersion: number | null; draftId: string | null; updatedAt: Date | null };
  platform: { version: number | null; id: string | null; title: string | null; languageCode: string | null };
}

export interface PageCounts { byKind: Record<string, number>; byState: Record<string, number>; slugs: number; platformOnly: number }

/** A version row with the names the history prints. */
export interface VersionRow {
  page: CmsPage;
  authorName: string | null; publisherName: string | null; archiverName: string | null; editorName: string | null;
}

const WHO = `LEFT JOIN users ua ON ua.id = p.created_by LEFT JOIN users up ON up.id = p.published_by
  LEFT JOIN users ur ON ur.id = p.archived_by LEFT JOIN users ue ON ue.id = p.last_edited_by`;
const PCOLS = COLS.split(',').map((c) => `p.${c.trim()}`).join(', ');

@Injectable()
export class CmsPageRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private on(tenantId: string, tx?: TxContext): SqlExecutor { return tx ?? this.replica.forTenant(tenantId); }

  /** F-20: every allocation of a version for (tenant, slug) is serialised for the rest of the transaction. */
  async lockSlug(tx: TxContext, tenantId: string, slug: string): Promise<void> {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`cms_pages|${tenantId}|${slug}`]);
  }

  async insert(tx: TxContext, p: CmsPage, tenantId: string | null, createdBy: string): Promise<void> {
    const v = p.toProps();
    await tx.query(
      `INSERT INTO cms_pages (id, tenant_id, slug, page_kind, default_title, body, version, status, language_code, topic, sort_order, created_by, updated_by, last_edited_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$12)`,
      [v.id, tenantId, v.slug, v.pageKind, v.defaultTitle, v.body, v.version, v.status, v.languageCode ?? null, v.topic ?? null, v.sortOrder ?? 0, createdBy]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<CmsPage | null> {
    const r = await tx.query(`SELECT ${COLS} FROM cms_pages WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** A version this tenant can see — its own or the platform's. */
  async getById(tenantId: string, id: string, tx?: TxContext): Promise<CmsPage | null> {
    const r = await this.on(tenantId, tx).query(`SELECT ${COLS} FROM cms_pages WHERE id=$1 AND (tenant_id=$2 OR tenant_id IS NULL) AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Highest existing version for a slug in this tenant (0 if none). Callers allocate under `lockSlug`. */
  async maxVersion(tx: TxContext, tenantId: string, slug: string): Promise<number> {
    const r = await tx.query(`SELECT COALESCE(MAX(version),0) v FROM cms_pages WHERE tenant_id=$1 AND slug=$2`, [tenantId, slug]);
    return Number(r.rows[0]?.v ?? 0);
  }
  /** The tenant's own versions of a slug, newest first, with the names W176's history prints. */
  async versionsOf(tenantId: string, slug: string, tx?: TxContext): Promise<VersionRow[]> {
    const r = await this.on(tenantId, tx).query(
      `SELECT ${PCOLS}, ua.full_name AS author_name, up.full_name AS publisher_name, ur.full_name AS archiver_name, ue.full_name AS editor_name
         FROM cms_pages p ${WHO}
        WHERE p.tenant_id=$1 AND p.slug=$2 AND p.deleted_at IS NULL ORDER BY p.version DESC`, [tenantId, slug]);
    return r.rows.map((x: any) => ({ page: toDomain(x), authorName: x.author_name ?? null, publisherName: x.publisher_name ?? null, archiverName: x.archiver_name ?? null, editorName: x.editor_name ?? null }));
  }
  /** The platform's live version of a slug, when there is one. */
  async platformLive(tenantId: string, slug: string, tx?: TxContext): Promise<CmsPage | null> {
    const r = await this.on(tenantId, tx).query(
      `SELECT ${COLS} FROM cms_pages WHERE tenant_id IS NULL AND slug=$1 AND status='published' AND deleted_at IS NULL ORDER BY version DESC LIMIT 1`, [slug]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** The slug's currently-published OWN versions other than `exceptId`, locked (to archive `superseded` on a publish). */
  async publishedForUpdate(tx: TxContext, tenantId: string, slug: string, exceptId: string): Promise<CmsPage[]> {
    const r = await tx.query(`SELECT ${COLS} FROM cms_pages WHERE tenant_id=$1 AND slug=$2 AND status='published' AND id<>$3 AND deleted_at IS NULL FOR UPDATE`, [tenantId, slug, exceptId]);
    return r.rows.map(toDomain);
  }
  /** A draft's words (the trigger stamps `last_edited_by` from the session's user). One row or it throws upstream. */
  async updateDraft(tx: TxContext, p: CmsPage, tenantId: string, editorId: string): Promise<number> {
    const v = p.toProps();
    const r = await tx.query(
      `UPDATE cms_pages SET page_kind=$3, default_title=$4, body=$5, language_code=$6, topic=$7, sort_order=$8, last_edited_by=$9, updated_by=$9, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND status='draft' AND deleted_at IS NULL`,
      [v.id, tenantId, v.pageKind, v.defaultTitle, v.body, v.languageCode ?? null, v.topic ?? null, v.sortOrder ?? 0, editorId]);
    return r.rowCount ?? 0;
  }
  /** The state columns only — the words of a version that leaves draft are history (0177's guard). */
  async updateState(tx: TxContext, p: CmsPage, tenantId: string, actorId: string): Promise<number> {
    const v = p.toProps();
    const r = await tx.query(
      `UPDATE cms_pages SET status=$3, published_at=$4, published_by=$5, archived_at=$6, archived_by=$7, archived_reason=$8, updated_by=$9, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [v.id, tenantId, v.status, v.publishedAt, v.publishedBy ?? null, v.archivedAt ?? null, v.archivedBy ?? null, v.archivedReason ?? null, actorId]);
    return r.rowCount ?? 0;
  }
  /**
   * The live page for a slug, as a member would be served it. F-14: the TENANT's own published version wins, whatever its
   * number; the platform's answers only when the tenant has none published. Public read; includes platform pages.
   */
  async publishedBySlug(tenantId: string, slug: string): Promise<CmsPage | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM cms_pages WHERE (tenant_id=$1 OR tenant_id IS NULL) AND slug=$2 AND status='published' AND deleted_at IS NULL
        ORDER BY (tenant_id IS NULL) ASC, version DESC LIMIT 1`, [tenantId, slug]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* W175 — one row per slug                                                                                     */
  /* ---------------------------------------------------------------------------------------------------------- */

  private static readonly SLUGS = `
    WITH own AS (
      SELECT DISTINCT ON (slug) slug, id, version, status, page_kind, default_title, language_code, topic, updated_at
        FROM cms_pages WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY slug, version DESC),
    own_n AS (SELECT slug, count(*)::int n FROM cms_pages WHERE tenant_id = $1 AND deleted_at IS NULL GROUP BY slug),
    own_pub AS (SELECT slug, id, version FROM cms_pages WHERE tenant_id = $1 AND status = 'published' AND deleted_at IS NULL),
    own_draft AS (SELECT slug, id, version FROM cms_pages WHERE tenant_id = $1 AND status = 'draft' AND deleted_at IS NULL),
    plat AS (
      SELECT DISTINCT ON (slug) slug, id, version, page_kind, default_title, language_code
        FROM cms_pages WHERE tenant_id IS NULL AND status = 'published' AND deleted_at IS NULL ORDER BY slug, version DESC),
    s AS (SELECT slug FROM own UNION SELECT slug FROM plat),
    slug_rows AS (
      SELECT s.slug,
             COALESCE(o.page_kind, p.page_kind) AS page_kind,
             COALESCE(o.default_title, p.default_title) AS title,
             COALESCE(o.language_code, p.language_code) AS language_code,
             o.topic, COALESCE(n.n, 0) AS own_rows,
             o.version AS latest_version, o.status AS latest_status, o.id AS latest_id, o.updated_at,
             op.version AS published_version, op.id AS published_id, od.version AS draft_version, od.id AS draft_id,
             p.version AS platform_version, p.id AS platform_id, p.default_title AS platform_title, p.language_code AS platform_language,
             CASE WHEN COALESCE(n.n, 0) = 0 THEN 'platform' WHEN op.version IS NOT NULL THEN 'published'
                  WHEN od.version IS NOT NULL THEN 'draft' ELSE 'archived' END AS state
        FROM s LEFT JOIN own o ON o.slug = s.slug LEFT JOIN own_n n ON n.slug = s.slug LEFT JOIN own_pub op ON op.slug = s.slug
               LEFT JOIN own_draft od ON od.slug = s.slug LEFT JOIN plat p ON p.slug = s.slug)`;

  async index(tenantId: string, q: PageIndexQuery): Promise<PageIndexRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const where: string[] = [];
    if (q.pageKind) where.push(`page_kind = ${p(q.pageKind)}`);
    if (q.languageCode) where.push(`language_code = ${p(q.languageCode)}`);
    // `draft` matches every slug with an open draft — a live page being re-written included.
    if (q.state === 'draft') where.push(`draft_version IS NOT NULL`);
    else if (q.state) where.push(`state = ${p(q.state)}`);
    if (q.cursor) where.push(`slug > ${p(q.cursor)}`);
    const sql = `${CmsPageRepository.SLUGS} SELECT * FROM slug_rows ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY slug LIMIT ${p(q.limit)}`;
    const r = await this.replica.forTenant(tenantId).query(sql, params);
    return r.rows.map((x: any) => ({
      slug: x.slug, pageKind: x.page_kind, title: x.title, languageCode: x.language_code ?? null, topic: x.topic ?? null,
      own: {
        rows: Number(x.own_rows), latestVersion: x.latest_version === null ? null : Number(x.latest_version), latestStatus: x.latest_status ?? null, latestId: x.latest_id ?? null,
        publishedVersion: x.published_version === null ? null : Number(x.published_version), publishedId: x.published_id ?? null,
        draftVersion: x.draft_version === null ? null : Number(x.draft_version), draftId: x.draft_id ?? null, updatedAt: x.updated_at ?? null,
      },
      platform: { version: x.platform_version === null ? null : Number(x.platform_version), id: x.platform_id ?? null, title: x.platform_title ?? null, languageCode: x.platform_language ?? null },
    }));
  }

  /** W175's chips: slugs per kind and per state (a GROUP BY over the same one-row-per-slug read — never a literal). */
  async counts(tenantId: string): Promise<PageCounts> {
    const r = await this.replica.forTenant(tenantId).query(
      `${CmsPageRepository.SLUGS}
       SELECT 'kind' AS axis, page_kind AS k, count(*)::int n FROM slug_rows GROUP BY page_kind
       UNION ALL SELECT 'state', state, count(*)::int FROM slug_rows GROUP BY state
       UNION ALL SELECT 'state', 'draft_open', count(*)::int FROM slug_rows WHERE draft_version IS NOT NULL`, [tenantId]);
    const byKind: Record<string, number> = {}; const byState: Record<string, number> = {};
    for (const x of r.rows as any[]) (x.axis === 'kind' ? byKind : byState)[x.k] = Number(x.n);
    const slugs = Object.values(byKind).reduce((a, b) => a + b, 0);
    return { byKind, byState, slugs, platformOnly: byState.platform ?? 0 };
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* W177 — FAQ entries                                                                                          */
  /* ---------------------------------------------------------------------------------------------------------- */

  /** The tenant's FAQ slugs: the latest version of each, its live and draft versions, its place. Bounded (300). */
  async faqEntries(tenantId: string, topic?: string, tx?: TxContext): Promise<Array<PageIndexRow & { sortOrder: number }>> {
    const params: unknown[] = [tenantId];
    let extra = '';
    if (topic) { params.push(topic); extra = ` AND o.topic = $2`; }
    const r = await this.on(tenantId, tx).query(
      `WITH o AS (SELECT DISTINCT ON (slug) slug, id, version, status, page_kind, default_title, language_code, topic, sort_order, updated_at
                    FROM cms_pages WHERE tenant_id = $1 AND page_kind = 'faq' AND deleted_at IS NULL ORDER BY slug, version DESC),
            n AS (SELECT slug, count(*)::int n FROM cms_pages WHERE tenant_id = $1 AND page_kind = 'faq' AND deleted_at IS NULL GROUP BY slug),
            op AS (SELECT slug, id, version FROM cms_pages WHERE tenant_id = $1 AND page_kind = 'faq' AND status = 'published' AND deleted_at IS NULL),
            od AS (SELECT slug, id, version FROM cms_pages WHERE tenant_id = $1 AND page_kind = 'faq' AND status = 'draft' AND deleted_at IS NULL)
       SELECT o.*, n.n AS own_rows, op.version AS published_version, op.id AS published_id, od.version AS draft_version, od.id AS draft_id,
              COALESCE(lv.sort_order, 1000) AS topic_order
         FROM o JOIN n ON n.slug = o.slug LEFT JOIN op ON op.slug = o.slug LEFT JOIN od ON od.slug = o.slug
         LEFT JOIN lookup_values lv ON lv.type_code = 'cms_faq_topic' AND lv.tenant_id IS NULL AND lv.code = o.topic
        WHERE true${extra}
        ORDER BY topic_order, o.topic, o.sort_order, o.slug LIMIT 300`, params);
    return r.rows.map((x: any) => ({
      slug: x.slug, pageKind: x.page_kind, title: x.default_title, languageCode: x.language_code ?? null, topic: x.topic ?? null, sortOrder: Number(x.sort_order),
      own: {
        rows: Number(x.own_rows), latestVersion: Number(x.version), latestStatus: x.status, latestId: x.id,
        publishedVersion: x.published_version === null ? null : Number(x.published_version), publishedId: x.published_id ?? null,
        draftVersion: x.draft_version === null ? null : Number(x.draft_version), draftId: x.draft_id ?? null, updatedAt: x.updated_at ?? null,
      },
      platform: { version: null, id: null, title: null, languageCode: null },
    }));
  }

  /** The places of a topic's entries, every version row LOCKED (the reorder act's object). */
  async faqTopicForUpdate(tx: TxContext, tenantId: string, topic: string): Promise<FaqEntryPlace[]> {
    const r = await tx.query(
      `SELECT slug, version, sort_order FROM cms_pages WHERE tenant_id=$1 AND page_kind='faq' AND topic=$2 AND deleted_at IS NULL ORDER BY slug, version DESC FOR UPDATE`,
      [tenantId, topic]);
    const seen = new Map<string, number>();
    for (const x of r.rows as any[]) if (!seen.has(x.slug)) seen.set(x.slug, Number(x.sort_order));   // the latest version's place
    return [...seen.entries()].map(([slug, sortOrder]) => ({ slug, sortOrder }));
  }
  /** The places of a topic's entries (unlocked — a review's read). */
  async faqTopicPlaces(tenantId: string, topic: string, tx?: TxContext): Promise<FaqEntryPlace[]> {
    const r = await this.on(tenantId, tx).query(
      `SELECT DISTINCT ON (slug) slug, sort_order FROM cms_pages WHERE tenant_id=$1 AND page_kind='faq' AND topic=$2 AND deleted_at IS NULL ORDER BY slug, version DESC`,
      [tenantId, topic]);
    return r.rows.map((x: any) => ({ slug: x.slug, sortOrder: Number(x.sort_order) }));
  }
  /** An entry's place, on every version of its slug. */
  async setFaqPlace(tx: TxContext, tenantId: string, slug: string, place: number, actorId: string): Promise<number> {
    const r = await tx.query(`UPDATE cms_pages SET sort_order=$3, updated_by=$4, updated_at=now() WHERE tenant_id=$1 AND slug=$2 AND page_kind='faq' AND deleted_at IS NULL`, [tenantId, slug, place, actorId]);
    return r.rowCount ?? 0;
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE VOCABULARIES AND THE LANGUAGES (Law 6)                                                                  */
  /* ---------------------------------------------------------------------------------------------------------- */

  async vocabulary(tenantId: string, type: 'cms_faq_topic' | 'cms_page_archive_reason', tx?: TxContext): Promise<Array<{ code: string; name: string; chosen: boolean; sortOrder: number }>> {
    const r = await this.on(tenantId, tx).query(
      `SELECT code, default_name, meta, sort_order FROM lookup_values WHERE type_code=$1 AND tenant_id IS NULL AND is_active AND deleted_at IS NULL ORDER BY sort_order, code`, [type]);
    return r.rows.map((x: any) => ({ code: String(x.code), name: String(x.default_name), chosen: (x.meta?.chosen ?? true) !== false, sortOrder: Number(x.sort_order) }));
  }
  /** The languages this tenant writes in (default first); empty when it declared none. */
  async tenantLanguageOrder(tenantId: string, tx?: TxContext): Promise<string[]> {
    const r = await this.on(tenantId, tx).query(
      `SELECT tl.language_code FROM tenant_languages tl JOIN languages lg ON lg.code = tl.language_code
        WHERE tl.tenant_id = $1 AND lg.deleted_at IS NULL ORDER BY tl.is_default DESC, lg.sort_order, tl.language_code`, [tenantId]);
    return r.rows.map((x: any) => String(x.language_code));
  }
  async activeLanguages(tenantId: string, tx?: TxContext): Promise<Array<{ code: string; nameEnglish: string; nameNative: string }>> {
    const r = await this.on(tenantId, tx).query(`SELECT code, name_english, name_native FROM languages WHERE is_active AND deleted_at IS NULL ORDER BY sort_order, code`);
    return r.rows.map((x: any) => ({ code: String(x.code), nameEnglish: String(x.name_english), nameNative: String(x.name_native) }));
  }
}
