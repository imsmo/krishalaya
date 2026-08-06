// apps/admin-api/src/modules/translations/repositories/translations.repository.ts · the TRANSLATIONS plane's data access
// (PC-56 ADMIN-3b, canon W028).
//
// THIS IS THE FIRST CODE IN THE MONOREPO THAT WRITES TO `translations`. The table has existed since migration 0001 and
// `grep "INSERT INTO translations"` across apps/ and db/ returned nothing at all — so every locale-resolved read in the
// product has silently fallen back to the English canonical name since the platform was built.
//
// TWO PREDICATES MATTER HERE AND THEY ARE NOT THE SAME:
//   • SERVABLE — what a farmer may see. Human-authored, or machine-authored AND reviewed. Enforced in apps/api by
//     `servableTranslation()`; used here only to LABEL a row, never to hide one from an operator.
//   • VISIBLE TO AN OPERATOR — everything not soft-deleted, drafts included. A review queue that hid drafts would have
//     nothing in it.
// Conflating them is how a console starts showing an operator only what a farmer already sees, which is the opposite of
// the job.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : ((v as Date).toISOString?.() ?? String(v));

/** The kinds 0103 widened `catalogue_changes` to accept for this plane. */
export type TranslationEntityKind = 'translation' | 'translation_reviewer' | 'translation_run';
export type TranslationAction =
  | 'created' | 'updated' | 'approved' | 'rejected' | 'deactivated' | 'granted' | 'revoked' | 'requested';

@Injectable()
export class TranslationsRepository {
  constructor(private readonly pool: AdminPool) {}

  /* ------------------------------------------------------------------ the review queue (W028) */

  /**
   * Machine drafts awaiting a human, OLDEST FIRST, optionally narrowed to one language.
   *
   * Oldest first is deliberate and is the opposite of most queues in this console: a translation nobody has looked at for
   * three weeks is the queue quietly failing, and newest-first would bury it for ever under fresh machine output.
   *
   * Keyset on (created_at, id) rather than OFFSET, because rows arrive while somebody works through the list and an
   * OFFSET page would repeat and skip — a skipped row here is a farmer reading unreviewed AI for ever, since nothing
   * else would ever surface it again.
   */
  async reviewQueue(q: { languageCode?: string; entityType?: string; cursor?: { at: string; id: string }; limit: number }) {
    const params: unknown[] = [];
    const conds = [`t.is_machine`, `t.reviewed_at IS NULL`, `t.deleted_at IS NULL`];
    if (q.languageCode) { params.push(q.languageCode); conds.push(`t.language_code = $${params.length}`); }
    if (q.entityType) { params.push(q.entityType); conds.push(`t.entity_type = $${params.length}`); }
    if (q.cursor) {
      params.push(q.cursor.at, q.cursor.id);
      conds.push(`(t.created_at, t.id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(q.limit);
    const r = await this.pool.query(
      `SELECT t.id, t.entity_type, t.entity_id, t.field, t.language_code, t.text, t.is_machine, t.source,
              t.reviewed_by, t.reviewed_at, t.review_note, t.created_at,
              -- the CANONICAL text this row is a translation OF. Without it a reviewer is judging Gujarati against
              -- nothing, which is not a review — it is a spelling check.
              CASE t.entity_type
                WHEN 'category'         THEN (SELECT c.default_name FROM categories c WHERE c.id = t.entity_id)
                WHEN 'attribute'        THEN (SELECT a.default_name FROM attribute_definitions a WHERE a.id = t.entity_id)
                WHEN 'attribute_option' THEN (SELECT o.default_name FROM attribute_options o WHERE o.id = t.entity_id)
                WHEN 'lookup_value'     THEN (SELECT lv.default_name FROM lookup_values lv WHERE lv.id = t.entity_id)
                WHEN 'region'           THEN (SELECT ar.default_name FROM admin_regions ar WHERE ar.id = t.entity_id)
                -- ADMIN-4 found this branch MISSING. 'scheme' has been in TRANSLATABLE_ENTITIES since ADMIN-3b, so a
                -- scheme translation could be queued for review — and arrived with source_text NULL, i.e. the reviewer
                -- judging Gujarati against nothing, which is the precise failure the comment above says this column
                -- exists to prevent. 'listing' and 'insurance_claim' are still absent and are named as debt rather than
                -- guessed at: both are TENANT-scoped, so their canonical text needs a tenant predicate this
                -- cross-tenant query does not carry. (NB: no backticks in a comment inside a template literal.)
                WHEN 'scheme'           THEN (SELECT sc.default_name FROM schemes sc WHERE sc.id = t.entity_id)
              END AS source_text
         FROM translations t
        WHERE ${conds.join(' AND ')}
        ORDER BY t.created_at, t.id
        LIMIT $${params.length}`, params);
    return r.rows.map((x: any) => this.toRow(x));
  }

  /** One translation, whatever its state. */
  async getById(id: string) {
    const r = await this.pool.query(
      `SELECT id, entity_type, entity_id, field, language_code, text, is_machine, source,
              reviewed_by, reviewed_at, review_note, created_at, NULL::text AS source_text
         FROM translations WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? this.toRow(r.rows[0]) : null;
  }

  /** Locked read for a review. The reviewed_at check happens INSIDE this lock, so two reviewers cannot both approve. */
  async getForUpdate(client: PoolClient, id: string) {
    const r = await client.query(
      `SELECT id, entity_type, entity_id, field, language_code, text, is_machine, source,
              reviewed_by, reviewed_at, review_note, created_at, NULL::text AS source_text
         FROM translations WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? this.toRow(r.rows[0]) : null;
  }

  /** Every translation of one entity+field, across languages — the drill-in behind a coverage cell. */
  async forEntity(entityType: string, entityId: string) {
    const r = await this.pool.query(
      `SELECT id, entity_type, entity_id, field, language_code, text, is_machine, source,
              reviewed_by, reviewed_at, review_note, created_at, NULL::text AS source_text
         FROM translations
        WHERE entity_type = $1 AND entity_id = $2 AND deleted_at IS NULL
        ORDER BY field, language_code
        LIMIT 200`, [entityType, entityId]);
    return r.rows.map((x: any) => this.toRow(x));
  }

  private toRow(x: any) {
    return {
      id: x.id, entityType: x.entity_type, entityId: x.entity_id, field: x.field,
      languageCode: x.language_code, text: x.text, isMachine: x.is_machine === true,
      source: x.source ?? null,
      reviewedBy: x.reviewed_by ?? null, reviewedAt: iso(x.reviewed_at), reviewNote: x.review_note ?? null,
      createdAt: iso(x.created_at),
      sourceText: x.source_text ?? null,
    };
  }

  /* ------------------------------------------------------------------ writes */

  async exists(entityType: string, entityId: string, field: string, languageCode: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM translations
        WHERE entity_type=$1 AND entity_id=$2 AND field=$3 AND language_code=$4 AND deleted_at IS NULL LIMIT 1`,
      [entityType, entityId, field, languageCode]);
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * Insert a translation. A HUMAN one is reviewed on arrival — the author is a person who holds that language, and asking
   * them to approve themselves is ceremony. A MACHINE one lands as a draft with reviewed_at NULL, which is what keeps it
   * away from farmers via the read predicate.
   *
   * ON CONFLICT on 0001's unique key resurrects a soft-deleted row rather than failing: a translation that was revoked
   * and is being re-supplied is the same fact about the same entity, and a second row would make the unique index a
   * liar.
   */
  async upsert(client: PoolClient, p: {
    entityType: string; entityId: string; field: string; languageCode: string; text: string;
    isMachine: boolean; source: string | null; actorUserId: string; reviewedOnInsert: boolean;
  }): Promise<{ id: string; wasUpdate: boolean }> {
    const r = await client.query(
      `INSERT INTO translations
         (entity_type, entity_id, field, language_code, text, is_machine, source,
          reviewed_by, reviewed_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,
               CASE WHEN $9 THEN $8::uuid ELSE NULL END,
               CASE WHEN $9 THEN now() ELSE NULL END,
               $8)
       ON CONFLICT (entity_type, entity_id, field, language_code) DO UPDATE
         SET text = $5, is_machine = $6, source = $7,
             reviewed_by = CASE WHEN $9 THEN $8::uuid ELSE NULL END,
             reviewed_at = CASE WHEN $9 THEN now() ELSE NULL END,
             review_note = NULL,
             deleted_at = NULL, updated_by = $8, updated_at = now()
       RETURNING id, (created_at <> updated_at) AS was_update`,
      [p.entityType, p.entityId, p.field, p.languageCode, p.text, p.isMachine, p.source,
       p.actorUserId, p.reviewedOnInsert]);
    const row = r.rows[0] as any;
    return { id: row.id, wasUpdate: row.was_update === true };
  }

  /**
   * Record a review. Guarded on `reviewed_at IS NULL`, so a zero row count means somebody reviewed it first — reported
   * as a conflict rather than silently overwriting another reviewer's judgement.
   */
  async review(client: PoolClient, p: {
    id: string; reviewerId: string; text: string | null; note: string | null;
  }): Promise<number> {
    const r = await client.query(
      `UPDATE translations
          SET text = COALESCE($3, text),
              reviewed_by = $2, reviewed_at = now(), review_note = $4,
              updated_by = $2, updated_at = now()
        WHERE id = $1 AND reviewed_at IS NULL AND deleted_at IS NULL`,
      [p.id, p.reviewerId, p.text, p.note]);
    return r.rowCount ?? 0;
  }

  /** A rejection SOFT-DELETES the draft. It is not kept as a live row with a "rejected" flag, because the read predicate
   *  keys on reviewed_at and a rejected row carrying a reviewed_at would become SERVABLE — the exact opposite of the
   *  decision. Soft, so the ledger and the note survive. */
  async reject(client: PoolClient, p: { id: string; reviewerId: string; note: string }): Promise<number> {
    const r = await client.query(
      `UPDATE translations
          SET review_note = $3, reviewed_by = $2, reviewed_at = now(),
              deleted_at = now(), updated_by = $2, updated_at = now()
        WHERE id = $1 AND reviewed_at IS NULL AND deleted_at IS NULL`,
      [p.id, p.reviewerId, p.note]);
    return r.rowCount ?? 0;
  }

  /** Revoke a live translation — the entity falls back to its canonical name. */
  async revoke(client: PoolClient, p: { id: string; actorUserId: string }): Promise<number> {
    const r = await client.query(
      `UPDATE translations SET deleted_at = now(), updated_by = $2, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL`, [p.id, p.actorUserId]);
    return r.rowCount ?? 0;
  }

  /* ------------------------------------------------------------------ coverage (W028's matrix) */

  /** How many KEYS each translatable kind has. The denominator — without it a percentage is meaningless. */
  async keyCounts(): Promise<Array<{ entityType: string; keys: number }>> {
    const r = await this.pool.query(
      `SELECT 'category' AS entity_type, count(*)::int AS keys FROM categories WHERE deleted_at IS NULL
       UNION ALL SELECT 'attribute', count(*)::int FROM attribute_definitions WHERE deleted_at IS NULL
       UNION ALL SELECT 'attribute_option', count(*)::int FROM attribute_options WHERE deleted_at IS NULL
       UNION ALL SELECT 'lookup_value', count(*)::int FROM lookup_values WHERE deleted_at IS NULL AND tenant_id IS NULL
       UNION ALL SELECT 'region', count(*)::int FROM admin_regions WHERE deleted_at IS NULL`);
    return r.rows.map((x: any) => ({ entityType: x.entity_type, keys: x.keys }));
  }

  /**
   * Translated counts per (kind, language). COUNTS ONLY SERVABLE ROWS — a coverage figure that included unreviewed
   * machine drafts would tell a founder the platform speaks Tamil when nothing Tamil has reached a farmer. That is the
   * single most misleading number this screen could show.
   */
  async coverage(): Promise<Array<{ entityType: string; languageCode: string; translated: number }>> {
    const r = await this.pool.query(
      `SELECT entity_type, language_code, count(*)::int AS translated
         FROM translations
        WHERE deleted_at IS NULL AND (is_machine = false OR reviewed_at IS NOT NULL)
        GROUP BY 1, 2`);
    return r.rows.map((x: any) => ({ entityType: x.entity_type, languageCode: x.language_code, translated: x.translated }));
  }

  /** Drafts pending per language — shown BESIDE coverage so the two are never confused. */
  async pendingByLanguage(): Promise<Array<{ languageCode: string; pending: number }>> {
    const r = await this.pool.query(
      `SELECT language_code, count(*)::int AS pending
         FROM translations
        WHERE is_machine AND reviewed_at IS NULL AND deleted_at IS NULL
        GROUP BY 1 ORDER BY 2 DESC`);
    return r.rows.map((x: any) => ({ languageCode: x.language_code, pending: x.pending }));
  }

  async activeLanguages(): Promise<Array<{ code: string; nameNative: string; nameEnglish: string }>> {
    const r = await this.pool.query(
      `SELECT code, name_native, name_english FROM languages
        WHERE is_active AND deleted_at IS NULL ORDER BY sort_order, code`);
    return r.rows.map((x: any) => ({ code: x.code, nameNative: x.name_native, nameEnglish: x.name_english }));
  }

  /* ------------------------------------------------------------------ reviewer scopes */

  /** A reviewer's LIVE language grants. */
  async scopesFor(adminUserId: string): Promise<string[]> {
    const r = await this.pool.query(
      `SELECT language_code FROM translation_reviewers
        WHERE admin_user_id = $1 AND revoked_at IS NULL AND deleted_at IS NULL
        ORDER BY language_code`, [adminUserId]);
    return r.rows.map((x: any) => x.language_code);
  }

  async listReviewers(): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT id, admin_user_id, language_code, granted_by, granted_at, revoked_at, revoked_by, note
         FROM translation_reviewers
        WHERE deleted_at IS NULL
        ORDER BY language_code, granted_at DESC
        LIMIT 500`);
    return r.rows.map((x: any) => ({
      id: x.id, adminUserId: x.admin_user_id, languageCode: x.language_code,
      grantedBy: x.granted_by, grantedAt: iso(x.granted_at),
      revokedAt: iso(x.revoked_at), revokedBy: x.revoked_by ?? null, note: x.note ?? null,
      isLive: x.revoked_at === null,
    }));
  }

  async grantExists(adminUserId: string, languageCode: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM translation_reviewers
        WHERE admin_user_id=$1 AND language_code=$2 AND revoked_at IS NULL AND deleted_at IS NULL LIMIT 1`,
      [adminUserId, languageCode]);
    return (r.rowCount ?? 0) > 0;
  }

  async grantReviewer(client: PoolClient, p: {
    adminUserId: string; languageCode: string; grantedBy: string; note: string | null;
  }): Promise<{ id: string }> {
    const r = await client.query(
      `INSERT INTO translation_reviewers (admin_user_id, language_code, granted_by, note, created_by)
       VALUES ($1,$2,$3,$4,$3) RETURNING id`,
      [p.adminUserId, p.languageCode, p.grantedBy, p.note]);
    return { id: (r.rows[0] as any).id };
  }

  /** REVOKED, never deleted: a translation approved last year was approved by somebody who held the scope THEN, and
   *  removing the grant would make that approval unexplainable. */
  async revokeReviewer(client: PoolClient, p: { id: string; revokedBy: string }): Promise<number> {
    const r = await client.query(
      `UPDATE translation_reviewers SET revoked_at = now(), revoked_by = $2, updated_by = $2, updated_at = now()
        WHERE id = $1 AND revoked_at IS NULL AND deleted_at IS NULL`, [p.id, p.revokedBy]);
    return r.rowCount ?? 0;
  }

  /* ------------------------------------------------------------------ machine-translation runs */

  async insertRun(client: PoolClient, p: {
    requestedBy: string; entityTypes: string[]; languageCodes: string[]; gapCount: number; reason: string;
    status: string; detail: string | null;
  }): Promise<{ id: string }> {
    const r = await client.query(
      `INSERT INTO translation_runs
         (requested_by, entity_types, language_codes, gap_count, reason, status, detail, settled_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::translation_run_status,$7,
               CASE WHEN $6 = 'queued' THEN NULL ELSE now() END, $1)
       RETURNING id`,
      [p.requestedBy, p.entityTypes, p.languageCodes, p.gapCount, p.reason, p.status, p.detail]);
    return { id: (r.rows[0] as any).id };
  }

  async listRuns(limit = 50): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT id, requested_by, entity_types, language_codes, gap_count, status::text AS status,
              produced_count, detail, requested_at, settled_at, reason
         FROM translation_runs
        WHERE deleted_at IS NULL
        ORDER BY requested_at DESC LIMIT $1`, [limit]);
    return r.rows.map((x: any) => ({
      id: x.id, requestedBy: x.requested_by, entityTypes: x.entity_types, languageCodes: x.language_codes,
      gapCount: x.gap_count, status: x.status,
      // NULL, never 0 — "not run yet" is not "produced nothing"
      producedCount: x.produced_count === null || x.produced_count === undefined ? null : Number(x.produced_count),
      detail: x.detail ?? null, requestedAt: iso(x.requested_at), settledAt: iso(x.settled_at), reason: x.reason,
    }));
  }

  /** How many gaps a run WOULD cover, counted before it is recorded so the row carries a real denominator. */
  async countGaps(entityTypes: string[], languageCodes: string[]): Promise<number> {
    // Counted from the key totals minus what is already SERVABLE, per requested pair. A gap is a key with no usable
    // translation — an unreviewed draft is still a gap, because nobody can read it.
    const keys = await this.keyCounts();
    const cov = await this.coverage();
    const byPair = new Map(cov.map((c) => [`${c.entityType}|${c.languageCode}`, c.translated]));
    let gaps = 0;
    for (const { entityType, keys: n } of keys) {
      if (!entityTypes.includes(entityType)) continue;
      for (const lc of languageCodes) gaps += Math.max(0, n - (byPair.get(`${entityType}|${lc}`) ?? 0));
    }
    return gaps;
  }

  /* ------------------------------------------------------------------ audit */

  async insertChange(client: PoolClient, c: {
    entityType: TranslationEntityKind; entityId: string; action: TranslationAction;
    oldValue: unknown; newValue: unknown; reason: string; actorUserId: string;
  }): Promise<void> {
    await client.query(
      `INSERT INTO catalogue_changes (entity_type, entity_id, action, old_value, new_value, reason, actor_user_id)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)`,
      [c.entityType, c.entityId, c.action,
       c.oldValue != null ? JSON.stringify(c.oldValue) : null,
       c.newValue != null ? JSON.stringify(c.newValue) : null,
       c.reason, c.actorUserId]);
  }

  async listChanges(entityId: string, limit = 50): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT id, action, old_value, new_value, reason, actor_user_id, created_at
         FROM catalogue_changes
        WHERE entity_type = 'translation' AND entity_id = $1
        ORDER BY created_at DESC, id DESC LIMIT $2`, [entityId, limit]);
    return r.rows.map((x: any) => ({
      id: String(x.id), action: x.action, oldValue: x.old_value ?? null, newValue: x.new_value ?? null,
      reason: x.reason, actorUserId: x.actor_user_id, createdAt: iso(x.created_at),
    }));
  }

  /* ------------------------------------------------------------------ taxonomy exports (ADMIN-3-Q2) */
  // Row keys match domain/taxonomy-export.ts's declared columns exactly; the spec asserts the two agree per report,
  // because a mismatch renders an EMPTY COLUMN — header right, data gone.

  async exportCategoryTree(limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT code, path::text AS path, depth, default_name, commerce_kind, is_active,
              requires_license, requires_certificate
         FROM categories WHERE deleted_at IS NULL ORDER BY path LIMIT $1`, [limit]);
    return r.rows.map((x: any) => ({
      code: x.code, path: x.path, depth: x.depth, defaultName: x.default_name,
      commerceKind: x.commerce_kind, isActive: x.is_active,
      requiresLicense: x.requires_license, requiresCertificate: x.requires_certificate,
    }));
  }

  async exportAttributes(limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT a.code, a.default_name, a.data_type, a.unit_code, a.validation, a.is_active,
              (SELECT count(*)::int FROM category_attributes ca WHERE ca.attribute_id = a.id AND ca.deleted_at IS NULL) AS bound_to,
              (SELECT count(*)::int FROM attribute_options o WHERE o.attribute_id = a.id AND o.deleted_at IS NULL) AS option_count
         FROM attribute_definitions a WHERE a.deleted_at IS NULL ORDER BY a.code LIMIT $1`, [limit]);
    return r.rows.map((x: any) => ({
      code: x.code, defaultName: x.default_name, dataType: x.data_type, unitCode: x.unit_code ?? null,
      // stringified so a CSV cell holds the JSON rather than "[object Object]"
      validation: x.validation && Object.keys(x.validation).length > 0 ? JSON.stringify(x.validation) : null,
      boundTo: x.bound_to ?? 0, optionCount: x.option_count ?? 0, isActive: x.is_active,
    }));
  }

  async exportLookupValues(limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT type_code, code, default_name, sort_order, is_active
         FROM lookup_values
        WHERE deleted_at IS NULL AND tenant_id IS NULL
        ORDER BY type_code, sort_order, code LIMIT $1`, [limit]);
    return r.rows.map((x: any) => ({
      typeCode: x.type_code, code: x.code, defaultName: x.default_name,
      sortOrder: Number(x.sort_order), isActive: x.is_active,
    }));
  }

  /**
   * THE FILE A TRANSLATOR ACTUALLY WANTS: every key with no SERVABLE translation in the target language, carrying the
   * canonical English text and an EMPTY column to fill in.
   *
   * "No servable translation" rather than "no row": a key whose only translation is an unreviewed machine draft is still
   * missing as far as any farmer is concerned, and omitting it would hide the gap behind work nobody has accepted.
   */
  async exportMissingTranslations(languageCode: string, limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `WITH keys AS (
         SELECT 'category'::text AS entity_type, c.id AS entity_id, 'name'::text AS field, c.default_name AS source_text
           FROM categories c WHERE c.deleted_at IS NULL
         UNION ALL
         SELECT 'attribute', a.id, 'name', a.default_name
           FROM attribute_definitions a WHERE a.deleted_at IS NULL
         UNION ALL
         SELECT 'attribute_option', o.id, 'name', o.default_name
           FROM attribute_options o WHERE o.deleted_at IS NULL
         UNION ALL
         SELECT 'lookup_value', lv.id, 'name', lv.default_name
           FROM lookup_values lv WHERE lv.deleted_at IS NULL AND lv.tenant_id IS NULL
       )
       SELECT k.entity_type, k.entity_id, k.field, k.source_text
         FROM keys k
        WHERE NOT EXISTS (
          SELECT 1 FROM translations t
           WHERE t.entity_type = k.entity_type AND t.entity_id = k.entity_id AND t.field = k.field
             AND t.language_code = $1 AND t.deleted_at IS NULL
             AND (t.is_machine = false OR t.reviewed_at IS NOT NULL)
        )
        ORDER BY k.entity_type, k.source_text
        LIMIT $2`, [languageCode, limit]);
    return r.rows.map((x: any) => ({
      entityType: x.entity_type, entityId: x.entity_id, field: x.field,
      sourceText: x.source_text, languageCode,
      // the column the translator fills in. Empty by design — a pre-filled guess is what this whole plane refuses.
      translation: null,
    }));
  }
}
