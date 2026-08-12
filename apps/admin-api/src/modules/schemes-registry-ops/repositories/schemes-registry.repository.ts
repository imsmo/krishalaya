// apps/admin-api/src/modules/schemes-registry-ops/repositories/schemes-registry.repository.ts · ALL SQL for
// schemes-registry-ops. Reads + in-tx writes for the god-mode government-scheme master: scheme_authorities, the
// code-keyed versioned schemes catalogue, the scheme_category FK probe (over PLATFORM lookup_values), the
// open-on-date window calendar, and scheme_registry_changes history. Parameterised only; keyset paging (never
// OFFSET); writes take the caller's tx client; concurrency via SELECT … FOR UPDATE. processing_fee_minor is a
// bigint — bound to a STRING param (never a float) and read back as text.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import { SchemeAuthority, AuthorityProps } from '../domain/scheme-authority.entity';
import { Scheme, SchemeProps } from '../domain/scheme.entity';
import { VersionRow, VersionRules, VersionStatus } from '../domain/scheme-version';

const AUTH_COLS = `id, default_name, level, region_id, created_at`;
function toAuthority(r: any): SchemeAuthority {
  const p: AuthorityProps = { id: r.id, defaultName: r.default_name, level: r.level, regionId: r.region_id ?? null, createdAt: r.created_at ?? null };
  return SchemeAuthority.rehydrate(p);
}
const SCHEME_COLS = `id, code, default_name, authority_id, category_id, benefit_summary, eligibility_rules, required_doc_type_ids, application_window, applicable_region_ids, processing_fee_minor::text AS processing_fee_minor, source_url, version, is_active, created_at`;
function toScheme(r: any): Scheme {
  const p: SchemeProps = {
    id: r.id, code: r.code, defaultName: r.default_name, authorityId: r.authority_id, categoryId: r.category_id,
    benefitSummary: r.benefit_summary ?? {}, eligibilityRules: r.eligibility_rules ?? {}, requiredDocTypeIds: r.required_doc_type_ids ?? [],
    applicationWindow: r.application_window ?? null, applicableRegionIds: r.applicable_region_ids ?? [],
    processingFeeMinor: BigInt(r.processing_fee_minor ?? '0'), sourceUrl: r.source_url ?? null, version: r.version, isActive: r.is_active, createdAt: r.created_at ?? null,
  };
  return Scheme.rehydrate(p);
}

const VERSION_COLS = `id, scheme_id, version, status, benefit_summary, eligibility_rules, required_doc_type_ids,
  application_window, applicable_region_ids, processing_fee_minor::text AS processing_fee_minor, change_reason,
  drafted_by, drafted_at, published_by, published_at, checker_note, is_backfilled`;
function toVersion(r: any): VersionRow {
  return {
    id: r.id, schemeId: r.scheme_id, version: r.version, status: r.status as VersionStatus,
    benefitSummary: r.benefit_summary ?? {}, eligibilityRules: r.eligibility_rules ?? {},
    requiredDocTypeIds: r.required_doc_type_ids ?? [], applicationWindow: r.application_window ?? null,
    applicableRegionIds: r.applicable_region_ids ?? [],
    // TEXT in, string out. A bigint that touches a JS number is a bigint that may have lost its last digits.
    processingFeeMinor: String(r.processing_fee_minor ?? '0'),
    changeReason: r.change_reason, draftedBy: r.drafted_by ?? null,
    draftedAt: r.drafted_at ? new Date(r.drafted_at).toISOString() : null,
    publishedBy: r.published_by ?? null,
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    checkerNote: r.checker_note ?? null, isBackfilled: r.is_backfilled === true,
  };
}

/** The audit ledger's object kinds, widened by 0105. A version publish logged as a scheme 'updated' would carry the
 *  same verb as a typo fix in a name — see the migration's reasoning. */
export type RegistryEntityType = 'authority' | 'scheme' | 'scheme_version' | 'authority_portal';

export interface AuthorityListQuery { level?: string; cursor?: { c: string; id: string }; limit: number; }
export interface SchemeListQuery { authorityId?: string; categoryId?: string; isActive?: boolean; cursor?: { c: string; id: string }; limit: number; }
export interface CalendarQuery { onDate: string; cursor?: { c: string; id: string }; limit: number; }
export interface ChangeListQuery { entityType: RegistryEntityType; entityId: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class SchemesRegistryRepository {
  constructor(private readonly pool: AdminPool) {}

  /* ============================ scheme_authorities ============================ */
  async listAuthorities(q: AuthorityListQuery): Promise<SchemeAuthority[]> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'deleted_at IS NULL';
    if (q.level) where += ` AND level=${p(q.level)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(`SELECT ${AUTH_COLS} FROM scheme_authorities WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toAuthority);
  }
  async getAuthority(id: string): Promise<SchemeAuthority | null> {
    const r = await this.pool.query(`SELECT ${AUTH_COLS} FROM scheme_authorities WHERE id=$1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toAuthority(r.rows[0]) : null;
  }
  async getAuthorityForUpdate(client: PoolClient, id: string): Promise<SchemeAuthority | null> {
    const r = await client.query(`SELECT ${AUTH_COLS} FROM scheme_authorities WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toAuthority(r.rows[0]) : null;
  }
  async insertAuthority(client: PoolClient, v: { defaultName: string; level: string; regionId: string | null; actorUserId: string }): Promise<{ id: string; createdAt: Date }> {
    const r = await client.query(
      `INSERT INTO scheme_authorities (default_name, level, region_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$4) RETURNING id, created_at`,
      [v.defaultName, v.level, v.regionId, v.actorUserId]);
    return { id: r.rows[0].id, createdAt: r.rows[0].created_at };
  }
  async updateAuthority(client: PoolClient, id: string, v: { defaultName: string; level: string; regionId: string | null; actorUserId: string }): Promise<void> {
    await client.query(`UPDATE scheme_authorities SET default_name=$2, level=$3, region_id=$4, updated_by=$5, updated_at=now() WHERE id=$1 AND deleted_at IS NULL`,
      [id, v.defaultName, v.level, v.regionId, v.actorUserId]);
  }

  /* ============================ schemes ============================ */
  async listSchemes(q: SchemeListQuery): Promise<Scheme[]> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'deleted_at IS NULL';
    if (q.authorityId) where += ` AND authority_id=${p(q.authorityId)}`;
    if (q.categoryId) where += ` AND category_id=${p(q.categoryId)}`;
    if (q.isActive !== undefined) where += ` AND is_active=${p(q.isActive)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(`SELECT ${SCHEME_COLS} FROM schemes WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toScheme);
  }
  async getScheme(id: string): Promise<Scheme | null> {
    const r = await this.pool.query(`SELECT ${SCHEME_COLS} FROM schemes WHERE id=$1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toScheme(r.rows[0]) : null;
  }
  async getSchemeForUpdate(client: PoolClient, id: string): Promise<Scheme | null> {
    const r = await client.query(`SELECT ${SCHEME_COLS} FROM schemes WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toScheme(r.rows[0]) : null;
  }
  async schemeCodeExists(client: PoolClient, code: string): Promise<boolean> {
    const r = await client.query(`SELECT 1 FROM schemes WHERE code=$1 LIMIT 1`, [code]);   // code is UNIQUE (incl. soft-deleted)
    return (r.rowCount ?? 0) > 0;
  }
  /** category_id must be an ACTIVE PLATFORM lookup_value of type 'scheme_category'. */
  async isValidCategory(client: PoolClient, categoryId: string): Promise<boolean> {
    const r = await client.query(
      `SELECT 1 FROM lookup_values WHERE id=$1 AND type_code='scheme_category' AND tenant_id IS NULL AND is_active AND deleted_at IS NULL LIMIT 1`, [categoryId]);
    return (r.rowCount ?? 0) > 0;
  }
  async insertScheme(client: PoolClient, v: { code: string; defaultName: string; authorityId: string; categoryId: string; benefitSummary: unknown; eligibilityRules: unknown; requiredDocTypeIds: unknown; applicationWindow: unknown; applicableRegionIds: unknown; processingFeeMinor: string; sourceUrl: string | null; actorUserId: string }): Promise<{ id: string; createdAt: Date }> {
    const r = await client.query(
      `INSERT INTO schemes (code, default_name, authority_id, category_id, benefit_summary, eligibility_rules, required_doc_type_ids, application_window, applicable_region_ids, processing_fee_minor, source_url, version, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,1,false,$12,$12) RETURNING id, created_at`,
      [v.code, v.defaultName, v.authorityId, v.categoryId, JSON.stringify(v.benefitSummary), JSON.stringify(v.eligibilityRules), JSON.stringify(v.requiredDocTypeIds), v.applicationWindow != null ? JSON.stringify(v.applicationWindow) : null, JSON.stringify(v.applicableRegionIds), v.processingFeeMinor, v.sourceUrl, v.actorUserId]);
    return { id: r.rows[0].id, createdAt: r.rows[0].created_at };
  }
  async updateSchemeMeta(client: PoolClient, id: string, v: { defaultName: string; authorityId: string; categoryId: string; sourceUrl: string | null; actorUserId: string }): Promise<void> {
    await client.query(`UPDATE schemes SET default_name=$2, authority_id=$3, category_id=$4, source_url=$5, updated_by=$6, updated_at=now() WHERE id=$1 AND deleted_at IS NULL`,
      [id, v.defaultName, v.authorityId, v.categoryId, v.sourceUrl, v.actorUserId]);
  }
  async updateSchemeRules(client: PoolClient, id: string, v: { benefitSummary: unknown; eligibilityRules: unknown; requiredDocTypeIds: unknown; applicableRegionIds: unknown; processingFeeMinor: string; version: number; actorUserId: string }): Promise<void> {
    await client.query(
      `UPDATE schemes SET benefit_summary=$2::jsonb, eligibility_rules=$3::jsonb, required_doc_type_ids=$4::jsonb, applicable_region_ids=$5::jsonb, processing_fee_minor=$6, version=$7, updated_by=$8, updated_at=now() WHERE id=$1 AND deleted_at IS NULL`,
      [id, JSON.stringify(v.benefitSummary), JSON.stringify(v.eligibilityRules), JSON.stringify(v.requiredDocTypeIds), JSON.stringify(v.applicableRegionIds), v.processingFeeMinor, v.version, v.actorUserId]);
  }
  async updateSchemeWindow(client: PoolClient, id: string, window: unknown, actorUserId: string): Promise<void> {
    await client.query(`UPDATE schemes SET application_window=$2::jsonb, updated_by=$3, updated_at=now() WHERE id=$1 AND deleted_at IS NULL`,
      [id, window != null ? JSON.stringify(window) : null, actorUserId]);
  }
  async setSchemeActive(client: PoolClient, id: string, isActive: boolean, actorUserId: string): Promise<void> {
    await client.query(`UPDATE schemes SET is_active=$2, updated_by=$3, updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, [id, isActive, actorUserId]);
  }
  /** Active schemes whose application_window contains onDate ('MM-DD'); handles year-wrapping windows (opens>closes). */
  async schemesOpenOn(q: CalendarQuery): Promise<Scheme[]> {
    const params: unknown[] = [q.onDate]; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `is_active AND deleted_at IS NULL AND application_window ? 'opens' AND application_window ? 'closes'
      AND ((application_window->>'opens' <= application_window->>'closes' AND $1 BETWEEN application_window->>'opens' AND application_window->>'closes')
        OR (application_window->>'opens' > application_window->>'closes' AND ($1 >= application_window->>'opens' OR $1 <= application_window->>'closes')))`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(`SELECT ${SCHEME_COLS} FROM schemes WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toScheme);
  }

  /* ============================ scheme_registry_changes (append-only) ============================ */
  async insertChange(client: PoolClient, c: { entityType: RegistryEntityType; entityId: string; action: string; oldValue: unknown; newValue: unknown; reason: string; actorUserId: string }): Promise<void> {
    await client.query(
      `INSERT INTO scheme_registry_changes (entity_type, entity_id, action, old_value, new_value, reason, actor_user_id) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)`,
      [c.entityType, c.entityId, c.action, c.oldValue != null ? JSON.stringify(c.oldValue) : null, c.newValue != null ? JSON.stringify(c.newValue) : null, c.reason, c.actorUserId]);
  }
  /* ============================ scheme_versions (0105) ============================
     The rule set per version, published-never-edited. `processing_fee_minor` is read back as TEXT for the same
     reason it is everywhere else in this file: a bigint that passes through a JS number loses precision silently.  */

  async listVersions(schemeId: string, limit: number): Promise<VersionRow[]> {
    const r = await this.pool.query(
      `SELECT ${VERSION_COLS} FROM scheme_versions WHERE scheme_id=$1 AND deleted_at IS NULL ORDER BY version DESC LIMIT $2`, [schemeId, limit]);
    return r.rows.map(toVersion);
  }
  async getVersion(id: string): Promise<VersionRow | null> {
    const r = await this.pool.query(`SELECT ${VERSION_COLS} FROM scheme_versions WHERE id=$1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toVersion(r.rows[0]) : null;
  }
  async getVersionForUpdate(client: PoolClient, id: string): Promise<VersionRow | null> {
    const r = await client.query(`SELECT ${VERSION_COLS} FROM scheme_versions WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toVersion(r.rows[0]) : null;
  }
  /** The open draft, if any. Locked, because the open-draft check and the insert that depends on it must not race. */
  async getDraftForUpdate(client: PoolClient, schemeId: string): Promise<VersionRow | null> {
    const r = await client.query(`SELECT ${VERSION_COLS} FROM scheme_versions WHERE scheme_id=$1 AND status='draft' AND deleted_at IS NULL FOR UPDATE`, [schemeId]);
    return r.rows[0] ? toVersion(r.rows[0]) : null;
  }
  /** The version the live `schemes` row is currently a projection of. */
  async getPublishedForUpdate(client: PoolClient, schemeId: string): Promise<VersionRow | null> {
    const r = await client.query(`SELECT ${VERSION_COLS} FROM scheme_versions WHERE scheme_id=$1 AND status='published' AND deleted_at IS NULL FOR UPDATE`, [schemeId]);
    return r.rows[0] ? toVersion(r.rows[0]) : null;
  }
  /** The highest version number EVER used for this scheme — including superseded and soft-deleted drafts.
   *  Deliberately ignores deleted_at: a discarded draft still burned its number. Reusing v7 after discarding a v7
   *  would make two different rule sets share a number, and an application stamped v7 would be ambiguous forever. */
  async maxVersionEverUsed(client: PoolClient, schemeId: string): Promise<number> {
    const r = await client.query(`SELECT COALESCE(MAX(version), 0)::int AS v FROM scheme_versions WHERE scheme_id=$1`, [schemeId]);
    return r.rows[0]?.v ?? 0;
  }
  async insertVersion(client: PoolClient, v: { schemeId: string; version: number; rules: VersionRules; changeReason: string; draftedBy: string }): Promise<{ id: string }> {
    const r = await client.query(
      `INSERT INTO scheme_versions (scheme_id, version, status, benefit_summary, eligibility_rules, required_doc_type_ids,
                                    application_window, applicable_region_ids, processing_fee_minor, change_reason, drafted_by, created_by, updated_by)
       VALUES ($1,$2,'draft',$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$10,$10) RETURNING id`,
      [v.schemeId, v.version, JSON.stringify(v.rules.benefitSummary), JSON.stringify(v.rules.eligibilityRules), JSON.stringify(v.rules.requiredDocTypeIds),
       v.rules.applicationWindow != null ? JSON.stringify(v.rules.applicationWindow) : null, JSON.stringify(v.rules.applicableRegionIds),
       v.rules.processingFeeMinor, v.changeReason, v.draftedBy]);
    return { id: r.rows[0].id };
  }
  async updateDraft(client: PoolClient, id: string, rules: VersionRules, changeReason: string, actorUserId: string): Promise<void> {
    await client.query(
      `UPDATE scheme_versions SET benefit_summary=$2::jsonb, eligibility_rules=$3::jsonb, required_doc_type_ids=$4::jsonb,
              application_window=$5::jsonb, applicable_region_ids=$6::jsonb, processing_fee_minor=$7, change_reason=$8,
              updated_by=$9, updated_at=now()
        WHERE id=$1 AND status='draft' AND deleted_at IS NULL`,
      [id, JSON.stringify(rules.benefitSummary), JSON.stringify(rules.eligibilityRules), JSON.stringify(rules.requiredDocTypeIds),
       rules.applicationWindow != null ? JSON.stringify(rules.applicationWindow) : null, JSON.stringify(rules.applicableRegionIds),
       rules.processingFeeMinor, changeReason, actorUserId]);
  }
  /** Discard = soft delete. The row stays for the audit trail and its version NUMBER stays burned (see
   *  maxVersionEverUsed); only the unique partial indexes are freed so the next draft can open. */
  async discardDraft(client: PoolClient, id: string, actorUserId: string): Promise<void> {
    await client.query(`UPDATE scheme_versions SET deleted_at=now(), updated_by=$2, updated_at=now() WHERE id=$1 AND status='draft' AND deleted_at IS NULL`, [id, actorUserId]);
  }
  async publishVersion(client: PoolClient, id: string, publishedBy: string, checkerNote: string | null): Promise<void> {
    await client.query(
      `UPDATE scheme_versions SET status='published', published_by=$2, published_at=now(), checker_note=$3, updated_by=$2, updated_at=now()
        WHERE id=$1 AND status='draft' AND deleted_at IS NULL`, [id, publishedBy, checkerNote]);
  }
  async supersedeVersion(client: PoolClient, id: string, actorUserId: string): Promise<void> {
    await client.query(`UPDATE scheme_versions SET status='superseded', updated_by=$2, updated_at=now() WHERE id=$1 AND status='published'`, [id, actorUserId]);
  }
  /** THE PROJECTION (Law 5). The live `schemes` row is made to reflect the version just published — all six rule
   *  columns plus the version number, in the publish transaction. Nothing else in this module writes these columns
   *  any more, which is the property that makes the live row trustworthy as a cache of the published version. */
  async projectVersionOntoScheme(client: PoolClient, schemeId: string, version: number, rules: VersionRules, actorUserId: string): Promise<void> {
    await client.query(
      `UPDATE schemes SET benefit_summary=$2::jsonb, eligibility_rules=$3::jsonb, required_doc_type_ids=$4::jsonb,
              application_window=$5::jsonb, applicable_region_ids=$6::jsonb, processing_fee_minor=$7, version=$8,
              updated_by=$9, updated_at=now()
        WHERE id=$1 AND deleted_at IS NULL`,
      [schemeId, JSON.stringify(rules.benefitSummary), JSON.stringify(rules.eligibilityRules), JSON.stringify(rules.requiredDocTypeIds),
       rules.applicationWindow != null ? JSON.stringify(rules.applicationWindow) : null, JSON.stringify(rules.applicableRegionIds),
       rules.processingFeeMinor, version, actorUserId]);
  }
  /** How many applications were filed under each of these versions — W070's "4,206 applications filed on v6".
   *  Cross-tenant (kv_admin bypasses RLS, Law 11) and an AGGREGATE ONLY: no applicant, no tenant, no PII. Counts
   *  the resolved pointer, not the integer, so a legacy row whose version cannot be resolved is not miscredited. */
  async applicationCountsByVersion(versionIds: string[]): Promise<Map<string, number>> {
    if (versionIds.length === 0) return new Map();
    const r = await this.pool.query(
      `SELECT scheme_version_id AS vid, count(*)::int AS n FROM scheme_applications
        WHERE scheme_version_id = ANY($1::uuid[]) AND deleted_at IS NULL GROUP BY scheme_version_id`, [versionIds]);
    return new Map(r.rows.map((x: any) => [x.vid as string, x.n as number]));
  }

  /* ============================ registry rollups (W069 / W072) ============================ */

  /** Applications filed per scheme in the last 30 days — W069's "Apps 30d" column. Aggregate, cross-tenant. */
  async applicationCounts30d(schemeIds: string[]): Promise<Map<string, number>> {
    if (schemeIds.length === 0) return new Map();
    const r = await this.pool.query(
      `SELECT scheme_id, count(*)::int AS n FROM scheme_applications
        WHERE scheme_id = ANY($1::uuid[]) AND created_at >= now() - interval '30 days' AND deleted_at IS NULL
        GROUP BY scheme_id`, [schemeIds]);
    return new Map(r.rows.map((x: any) => [x.scheme_id as string, x.n as number]));
  }
  /** Live schemes per authority — W072's "Schemes" column. Counts ACTIVE ones only: an authority credited with 84
   *  schemes of which 40 are retired reads as far busier than it is. */
  async activeSchemeCountsByAuthority(authorityIds: string[]): Promise<Map<string, number>> {
    if (authorityIds.length === 0) return new Map();
    const r = await this.pool.query(
      `SELECT authority_id, count(*)::int AS n FROM schemes
        WHERE authority_id = ANY($1::uuid[]) AND is_active AND deleted_at IS NULL GROUP BY authority_id`, [authorityIds]);
    return new Map(r.rows.map((x: any) => [x.authority_id as string, x.n as number]));
  }

  /* ============================ DELTA-018: authority portal mapping ============================
     `external_entity_refs` (0015) with entity_type='scheme_authority'. No new table — the same answer DELTA-008
     got in 0104, for the same reason: this table already models internal-entity → provider → external-id with
     UNIQUE both ways, and the second UNIQUE is the constraint a bespoke table forgets.                            */

  async portalRefsByAuthority(authorityIds: string[]): Promise<Map<string, { providerCode: string; externalId: string; endpointLabel: string | null }>> {
    if (authorityIds.length === 0) return new Map();
    const r = await this.pool.query(
      `SELECT x.entity_id, x.provider_code, x.external_id, x.payload->>'endpointLabel' AS endpoint_label
         FROM external_entity_refs x
        WHERE x.entity_type='scheme_authority' AND x.entity_id = ANY($1::uuid[]) AND x.deleted_at IS NULL`, [authorityIds]);
    return new Map(r.rows.map((x: any) => [x.entity_id as string, { providerCode: x.provider_code, externalId: x.external_id, endpointLabel: x.endpoint_label ?? null }]));
  }
  /** Who already holds this (provider, external_id)? Checked BEFORE the insert so the 409 can name the authority,
   *  rather than surfacing the unique violation as a 500 that names an index. */
  async portalExternalIdOwner(client: PoolClient, providerCode: string, externalId: string): Promise<string | null> {
    const r = await client.query(
      `SELECT entity_id FROM external_entity_refs
        WHERE entity_type='scheme_authority' AND provider_code=$1 AND external_id=$2 AND deleted_at IS NULL LIMIT 1`, [providerCode, externalId]);
    return r.rows[0]?.entity_id ?? null;
  }
  /** sync_status is 'pending', never 'synced' — nothing in this monorepo has ever called these portals, and a row
   *  claiming 'synced' would be the table asserting a successful exchange that never happened. */
  async upsertPortalRef(client: PoolClient, v: { authorityId: string; providerCode: string; externalId: string; endpointLabel: string | null; actorUserId: string }): Promise<void> {
    await client.query(
      `INSERT INTO external_entity_refs (provider_code, entity_type, entity_id, external_id, sync_status, payload, created_by, updated_by)
       VALUES ($1,'scheme_authority',$2,$3,'pending',$4::jsonb,$5,$5)
       ON CONFLICT (provider_code, entity_type, entity_id)
       DO UPDATE SET external_id=EXCLUDED.external_id, payload=EXCLUDED.payload, sync_status='pending',
                     deleted_at=NULL, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [v.providerCode, v.authorityId, v.externalId, JSON.stringify(v.endpointLabel ? { endpointLabel: v.endpointLabel } : {}), v.actorUserId]);
  }
  async deletePortalRef(client: PoolClient, authorityId: string, providerCode: string, actorUserId: string): Promise<number> {
    const r = await client.query(
      `UPDATE external_entity_refs SET deleted_at=now(), updated_by=$3, updated_at=now()
        WHERE entity_type='scheme_authority' AND entity_id=$1 AND provider_code=$2 AND deleted_at IS NULL`, [authorityId, providerCode, actorUserId]);
    return r.rowCount ?? 0;
  }

  /* ============================ W070: what languages this scheme speaks ============================
     READ-ONLY over `translations` (ADMIN-3b owns the write path). The review state travels with each row because a
     machine draft is NOT a language the platform speaks — the same distinction the read predicate enforces.        */
  async schemeTranslations(schemeId: string): Promise<Array<{ languageCode: string; field: string; text: string; isMachine: boolean; reviewedAt: Date | null }>> {
    const r = await this.pool.query(
      `SELECT language_code, field, text, is_machine, reviewed_at FROM translations
        WHERE entity_type='scheme' AND entity_id=$1 AND deleted_at IS NULL ORDER BY language_code, field`, [schemeId]);
    return r.rows.map((x: any) => ({ languageCode: x.language_code, field: x.field, text: x.text, isMachine: x.is_machine, reviewedAt: x.reviewed_at ?? null }));
  }

  /* ============================ export reads (W2251 / W2252) ============================
     Bounded, deterministic ORDER BY so a receipt's row count means something, and no PII in any of them — this
     plane is global registry data. The applications and DBT reports are NOT here (see domain/scheme-export.ts).  */

  async exportSchemeRows(limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT s.code, s.default_name, a.default_name AS authority_name, a.level AS authority_level,
              lv.default_name AS category_name, s.version, s.is_active,
              s.processing_fee_minor::text AS processing_fee_minor,
              s.application_window->>'opens' AS window_opens, s.application_window->>'closes' AS window_closes,
              s.application_window->>'season' AS window_season,
              jsonb_array_length(s.required_doc_type_ids) AS required_doc_count,
              jsonb_array_length(s.applicable_region_ids) AS region_count,
              s.source_url, s.created_at
         FROM schemes s
         JOIN scheme_authorities a ON a.id = s.authority_id
         LEFT JOIN lookup_values lv ON lv.id = s.category_id
        WHERE s.deleted_at IS NULL
        ORDER BY s.code
        LIMIT $1`, [limit]);
    return r.rows;
  }
  async exportAuthorityRows(limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT a.default_name, a.level, ar.default_name AS region_name,
              (SELECT count(*)::int FROM schemes s WHERE s.authority_id = a.id AND s.is_active AND s.deleted_at IS NULL) AS active_schemes,
              x.provider_code AS portal_provider, x.external_id AS portal_external_id, a.created_at
         FROM scheme_authorities a
         LEFT JOIN admin_regions ar ON ar.id = a.region_id
         LEFT JOIN external_entity_refs x ON x.entity_type='scheme_authority' AND x.entity_id = a.id AND x.deleted_at IS NULL
        WHERE a.deleted_at IS NULL
        ORDER BY a.level, a.default_name
        LIMIT $1`, [limit]);
    return r.rows;
  }
  /** The version ledger. `is_backfilled` travels with every row because a downstream reader must be able to tell a
   *  version a human signed from one migration 0105 recorded on the platform's behalf. */
  async exportVersionRows(limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT s.code AS scheme_code, v.version, v.status, v.is_backfilled,
              v.processing_fee_minor::text AS processing_fee_minor,
              v.application_window->>'opens' AS window_opens, v.application_window->>'closes' AS window_closes,
              v.change_reason, v.checker_note, v.drafted_at, v.published_at,
              (v.drafted_by IS NOT NULL) AS has_maker, (v.published_by IS NOT NULL) AS has_checker
         FROM scheme_versions v
         JOIN schemes s ON s.id = v.scheme_id
        WHERE v.deleted_at IS NULL
        ORDER BY s.code, v.version DESC
        LIMIT $1`, [limit]);
    return r.rows;
  }
  async exportCalendarRows(limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT s.code, s.default_name, s.application_window->>'season' AS season,
              s.application_window->>'opens' AS opens, s.application_window->>'closes' AS closes,
              (s.application_window->>'opens' > s.application_window->>'closes') AS wraps_year, s.version
         FROM schemes s
        WHERE s.is_active AND s.deleted_at IS NULL
          AND s.application_window ? 'opens' AND s.application_window ? 'closes'
        ORDER BY s.application_window->>'opens', s.code
        LIMIT $1`, [limit]);
    return r.rows;
  }

  async listChanges(q: ChangeListQuery): Promise<any[]> {
    const params: unknown[] = [q.entityType, q.entityId]; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'entity_type=$1 AND entity_id=$2';
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(
      `SELECT id, entity_type, entity_id, action, old_value, new_value, reason, actor_user_id, created_at FROM scheme_registry_changes WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({ id: x.id, entityType: x.entity_type, entityId: x.entity_id, action: x.action, oldValue: x.old_value ?? null, newValue: x.new_value ?? null, reason: x.reason, actorUserId: x.actor_user_id, createdAt: x.created_at }));
  }

  /* ============================ ADMIN-SWEEP-c1: the portal sync REGISTRY reads (W077) ============================
     Everything below is read-only truth over what exists: mapped portals (rows above), REAL pending-push counts
     (submitted applications with no portal acknowledgement, through schemes.authority_id), and ack lag over the
     rows 0136's clock has actually stamped. No read here can say 'synced' or 'healthy' — no pull has ever run,
     and the domain words the health column accordingly.                                                          */

  /** Every mapped portal with its authority, plus the two real figures per authority. */
  async portalRegistry(): Promise<any[]> {
    const r = await this.pool.query(
      `SELECT x.entity_id AS "authorityId", a.default_name AS "authorityName", a.level,
              x.provider_code AS "providerCode", x.external_id AS "externalId",
              x.payload->>'endpointLabel' AS "endpointLabel",
              x.sync_status AS "syncStatus", x.last_synced_at AS "lastSyncedAt", x.created_at AS "mappedAt",
              agg.pending_pushes AS "pendingPushes", agg.acked_n AS "ackedN", agg.ack_lag_p50_hours AS "ackLagP50Hours"
         FROM external_entity_refs x
         JOIN scheme_authorities a ON a.id = x.entity_id
         LEFT JOIN LATERAL (
           SELECT count(*) FILTER (WHERE sa.submitted_at IS NOT NULL AND sa.govt_app_ref IS NULL)::int AS pending_pushes,
                  count(*) FILTER (WHERE sa.govt_acked_at IS NOT NULL)::int AS acked_n,
                  round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (sa.govt_acked_at - sa.submitted_at)))
                        FILTER (WHERE sa.govt_acked_at IS NOT NULL AND sa.submitted_at IS NOT NULL) / 3600.0)::numeric, 1) AS ack_lag_p50_hours
             FROM scheme_applications sa
             JOIN schemes s ON s.id = sa.scheme_id
            WHERE s.authority_id = x.entity_id AND sa.deleted_at IS NULL
         ) agg ON true
        WHERE x.entity_type = 'scheme_authority' AND x.deleted_at IS NULL
        ORDER BY a.default_name`);
    return r.rows;
  }

  /** Authorities with NO portal mapping — W077's own footer: 'manual-mode authorities file via ambassador console'. */
  async manualAuthorityCount(): Promise<number> {
    const r = await this.pool.query(
      `SELECT count(*)::int AS n FROM scheme_authorities a
        WHERE a.deleted_at IS NULL AND NOT EXISTS (
          SELECT 1 FROM external_entity_refs x
           WHERE x.entity_type = 'scheme_authority' AND x.entity_id = a.id AND x.deleted_at IS NULL)`);
    return Number(r.rows[0]?.n ?? 0);
  }

  /* ============================ ADMIN-SWEEP-c2: the cohort dry run (W071) ============================
     A COUNT over the live population, mirroring the apps/api evaluator's semantics EXACTLY — including its
     forgiveness: a null profile value passes the constraint that reads it (the evaluator skips the check), so a
     farmer with no recorded gender is not silently excluded by a gender rule. The rules arrive PRE-VALIDATED
     against the closed vocabulary (domain/eligibility-fields.ts), which is what makes this SQL safe to compose:
     every branch below is keyed to a known field and every value is a bind parameter.                            */

  /** The published version's rules, or null when none exists (a first draft has nothing to lose against). */
  async publishedRules(schemeId: string): Promise<Record<string, unknown> | null> {
    const r = await this.pool.query(
      `SELECT eligibility_rules FROM scheme_versions
        WHERE scheme_id = $1 AND status = 'published' AND deleted_at IS NULL
        ORDER BY version DESC LIMIT 1`, [schemeId]);
    return r.rows[0]?.eligibility_rules ?? null;
  }

  /** Eligible-user COUNT for one rule set, and the LOSERS count against a second (published) rule set. */
  async cohortDiff(draft: Record<string, unknown>, published: Record<string, unknown> | null): Promise<{ draftEligible: number; publishedEligible: number | null; gained: number; lost: number; unconvertibleParcels: number }> {
    const build = (rules: Record<string, unknown>, p: unknown[]) => {
      // population: active users holding at least one active tenant role — the platform's working definition of a
      // person a scheme could reach.
      const conds: string[] = [`u.deleted_at IS NULL AND u.status = 'active'`];
      if (Array.isArray(rules.roles) && rules.roles.length > 0) {
        p.push(rules.roles);
        conds.push(`EXISTS (SELECT 1 FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
                     WHERE utr.user_id = u.id AND utr.is_active AND utr.deleted_at IS NULL AND ro.code = ANY($${p.length}::text[]))`);
      } else {
        conds.push(`EXISTS (SELECT 1 FROM user_tenant_roles utr WHERE utr.user_id = u.id AND utr.is_active AND utr.deleted_at IS NULL)`);
      }
      if (typeof rules.landholding_max_acres === 'number') {
        p.push(rules.landholding_max_acres);
        // evaluator semantics: the check applies only when a landholding NUMBER exists — a farmer with no acre-unit
        // parcels has an unknown landholding and PASSES (unknown ≠ over the limit).
        conds.push(`(NOT EXISTS (SELECT 1 FROM land_parcels lp WHERE lp.owner_user_id = u.id AND lp.area_unit = 'acre' AND lp.deleted_at IS NULL)
                     OR (SELECT COALESCE(SUM(lp.area_value), 0) FROM land_parcels lp
                          WHERE lp.owner_user_id = u.id AND lp.area_unit = 'acre' AND lp.deleted_at IS NULL) <= $${p.length}::numeric)`);
      }
      if (typeof rules.gender === 'string') {
        p.push(rules.gender);
        conds.push(`(u.gender IS NULL OR u.gender = $${p.length})`);
      }
      if (typeof rules.age_min === 'number') {
        p.push(rules.age_min);
        conds.push(`(u.dob IS NULL OR date_part('year', age(u.dob)) >= $${p.length}::int)`);
      }
      if (typeof rules.age_max === 'number') {
        p.push(rules.age_max);
        conds.push(`(u.dob IS NULL OR date_part('year', age(u.dob)) <= $${p.length}::int)`);
      }
      return conds.join(' AND ');
    };

    const p: unknown[] = [];
    const draftWhere = build(draft, p);
    if (published === null) {
      const r = await this.pool.query(
        `SELECT count(*)::int AS n FROM users u WHERE ${draftWhere}`, p);
      const uc = await this.pool.query(
        `SELECT count(*)::int AS n FROM land_parcels WHERE area_unit <> 'acre' AND deleted_at IS NULL`);
      return { draftEligible: Number(r.rows[0]?.n ?? 0), publishedEligible: null, gained: 0, lost: 0,
               unconvertibleParcels: Number(uc.rows[0]?.n ?? 0) };
    }
    const pubWhere = build(published, p);
    const r = await this.pool.query(
      `WITH draft_ok AS (SELECT u.id FROM users u WHERE ${draftWhere}),
            pub_ok   AS (SELECT u.id FROM users u WHERE ${pubWhere})
       SELECT (SELECT count(*) FROM draft_ok)::int AS draft_n,
              (SELECT count(*) FROM pub_ok)::int AS pub_n,
              (SELECT count(*) FROM draft_ok d WHERE NOT EXISTS (SELECT 1 FROM pub_ok x WHERE x.id = d.id))::int AS gained,
              (SELECT count(*) FROM pub_ok x WHERE NOT EXISTS (SELECT 1 FROM draft_ok d WHERE d.id = x.id))::int AS lost`, p);
    const uc = await this.pool.query(
      `SELECT count(*)::int AS n FROM land_parcels WHERE area_unit <> 'acre' AND deleted_at IS NULL`);
    const row = r.rows[0] ?? {};
    return { draftEligible: Number(row.draft_n ?? 0), publishedEligible: Number(row.pub_n ?? 0),
             gained: Number(row.gained ?? 0), lost: Number(row.lost ?? 0),
             unconvertibleParcels: Number(uc.rows[0]?.n ?? 0) };
  }
}
