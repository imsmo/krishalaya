// apps/admin-api/src/modules/global-catalogue-ops/repositories/catalogue.repository.ts · ALL SQL for global-
// catalogue-ops. Owns reads + in-tx writes for the PLATFORM master taxonomy: lookup_types, PLATFORM lookup_values
// (ALWAYS scoped `tenant_id IS NULL` — a tenant's own values are never touched here), the categories tree, and
// the catalogue_changes history. Parameterised only; keyset paging (never OFFSET); writes take the caller's tx
// client; reparent is ONE bounded UPDATE over the ltree subtree (no per-row loop). lookup_types has no audit/
// soft-delete columns (0001); lookup_values + categories do.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import { LookupType, LookupValue, LookupValueProps } from '../domain/lookup.entity';
import { Category, CategoryProps } from '../domain/category.entity';

/* ---- row mappers ---- */
const LV_COLS = `id, type_code, code, default_name, meta, sort_order, is_active, created_at`;
function toLookupValue(r: any): LookupValue {
  const props: LookupValueProps = { id: r.id, typeCode: r.type_code, code: r.code, defaultName: r.default_name, meta: r.meta ?? {}, sortOrder: r.sort_order, isActive: r.is_active, createdAt: r.created_at ?? null };
  return LookupValue.rehydrate(props);
}
const CAT_COLS = `id, parent_id, code, default_name, path::text AS path, depth, commerce_kind, requires_license, requires_certificate, min_age, is_active, sort_order, icon_media_id, created_at`;
function toCategory(r: any): Category {
  const props: CategoryProps = { id: r.id, parentId: r.parent_id ?? null, code: r.code, defaultName: r.default_name, path: r.path, depth: r.depth, commerceKind: r.commerce_kind, requiresLicense: r.requires_license, requiresCertificate: r.requires_certificate, minAge: r.min_age ?? null, isActive: r.is_active, sortOrder: r.sort_order, iconMediaId: r.icon_media_id ?? null, createdAt: r.created_at ?? null };
  return Category.rehydrate(props);
}

export interface LookupValueListQuery { typeCode: string; isActive?: boolean; cursor?: { c: string; id: string }; limit: number; }
export interface CategoryListQuery { parentId?: string; isActive?: boolean; commerceKind?: string; cursor?: { c: string; id: string }; limit: number; }
export interface ChangeListQuery { entityType: 'lookup_type' | 'lookup_value' | 'category'; entityId: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class CatalogueRepository {
  constructor(private readonly pool: AdminPool) {}

  /* ============================ lookup_types ============================ */
  async listLookupTypes(q: { cursor?: { code: string }; limit: number }): Promise<LookupType[]> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'TRUE';
    if (q.cursor) where += ` AND code > ${p(q.cursor.code)}`;          // keyset on the PK
    const lp = p(q.limit);
    const r = await this.pool.query(`SELECT code, default_name, is_tenant_extendable FROM lookup_types WHERE ${where} ORDER BY code ASC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => LookupType.rehydrate({ code: x.code, defaultName: x.default_name, isTenantExtendable: x.is_tenant_extendable }));
  }
  async getLookupType(code: string): Promise<LookupType | null> {
    const r = await this.pool.query(`SELECT code, default_name, is_tenant_extendable FROM lookup_types WHERE code=$1`, [code]);
    return r.rows[0] ? LookupType.rehydrate({ code: r.rows[0].code, defaultName: r.rows[0].default_name, isTenantExtendable: r.rows[0].is_tenant_extendable }) : null;
  }
  async getLookupTypeForUpdate(client: PoolClient, code: string): Promise<LookupType | null> {
    const r = await client.query(`SELECT code, default_name, is_tenant_extendable FROM lookup_types WHERE code=$1 FOR UPDATE`, [code]);
    return r.rows[0] ? LookupType.rehydrate({ code: r.rows[0].code, defaultName: r.rows[0].default_name, isTenantExtendable: r.rows[0].is_tenant_extendable }) : null;
  }
  async insertLookupType(client: PoolClient, v: { code: string; defaultName: string; isTenantExtendable: boolean }): Promise<void> {
    await client.query(`INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES ($1,$2,$3)`, [v.code, v.defaultName, v.isTenantExtendable]);
  }
  async updateLookupTypeName(client: PoolClient, code: string, defaultName: string): Promise<void> {
    await client.query(`UPDATE lookup_types SET default_name=$2 WHERE code=$1`, [code, defaultName]);
  }

  /* ============================ lookup_values (PLATFORM: tenant_id IS NULL) ============================ */
  async listLookupValues(q: LookupValueListQuery): Promise<LookupValue[]> {
    const params: unknown[] = [q.typeCode]; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'type_code=$1 AND tenant_id IS NULL AND deleted_at IS NULL';
    if (q.isActive !== undefined) where += ` AND is_active=${p(q.isActive)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(`SELECT ${LV_COLS} FROM lookup_values WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toLookupValue);
  }
  async getLookupValue(id: string): Promise<LookupValue | null> {
    const r = await this.pool.query(`SELECT ${LV_COLS} FROM lookup_values WHERE id=$1 AND tenant_id IS NULL AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toLookupValue(r.rows[0]) : null;
  }
  async getLookupValueForUpdate(client: PoolClient, id: string): Promise<LookupValue | null> {
    const r = await client.query(`SELECT ${LV_COLS} FROM lookup_values WHERE id=$1 AND tenant_id IS NULL AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toLookupValue(r.rows[0]) : null;
  }
  /** True iff a PLATFORM value with (type_code, code) already exists (the UNIQUE(type_code,tenant_id,code) key). */
  async platformValueCodeExists(client: PoolClient, typeCode: string, code: string): Promise<boolean> {
    const r = await client.query(`SELECT 1 FROM lookup_values WHERE type_code=$1 AND tenant_id IS NULL AND code=$2 LIMIT 1`, [typeCode, code]);
    return (r.rowCount ?? 0) > 0;
  }
  async insertLookupValue(client: PoolClient, v: { typeCode: string; code: string; defaultName: string; meta: Record<string, unknown>; sortOrder: number; actorUserId: string }): Promise<{ id: string; createdAt: Date }> {
    const r = await client.query(
      `INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order, is_active, created_by, updated_by)
       VALUES ($1, NULL, $2, $3, $4::jsonb, $5, true, $6, $6) RETURNING id, created_at`,
      [v.typeCode, v.code, v.defaultName, JSON.stringify(v.meta), v.sortOrder, v.actorUserId]);
    return { id: r.rows[0].id, createdAt: r.rows[0].created_at };
  }
  async updateLookupValue(client: PoolClient, id: string, v: { defaultName: string; meta: Record<string, unknown>; sortOrder: number; actorUserId: string }): Promise<void> {
    await client.query(`UPDATE lookup_values SET default_name=$2, meta=$3::jsonb, sort_order=$4, updated_by=$5, updated_at=now() WHERE id=$1 AND tenant_id IS NULL`,
      [id, v.defaultName, JSON.stringify(v.meta), v.sortOrder, v.actorUserId]);
  }
  async setLookupValueActive(client: PoolClient, id: string, isActive: boolean, actorUserId: string): Promise<void> {
    await client.query(`UPDATE lookup_values SET is_active=$2, updated_by=$3, updated_at=now() WHERE id=$1 AND tenant_id IS NULL`, [id, isActive, actorUserId]);
  }

  /* ============================ categories (tree) ============================ */
  async listCategories(q: CategoryListQuery): Promise<Category[]> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'deleted_at IS NULL';
    if (q.parentId !== undefined) where += ` AND parent_id=${p(q.parentId)}`;
    if (q.isActive !== undefined) where += ` AND is_active=${p(q.isActive)}`;
    if (q.commerceKind) where += ` AND commerce_kind=${p(q.commerceKind)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(`SELECT ${CAT_COLS} FROM categories WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toCategory);
  }
  async getCategory(id: string): Promise<Category | null> {
    const r = await this.pool.query(`SELECT ${CAT_COLS} FROM categories WHERE id=$1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toCategory(r.rows[0]) : null;
  }
  async getCategoryForUpdate(client: PoolClient, id: string): Promise<Category | null> {
    const r = await client.query(`SELECT ${CAT_COLS} FROM categories WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toCategory(r.rows[0]) : null;
  }
  async categoryCodeExists(client: PoolClient, code: string): Promise<boolean> {
    const r = await client.query(`SELECT 1 FROM categories WHERE code=$1 LIMIT 1`, [code]);   // code is UNIQUE (incl. soft-deleted)
    return (r.rowCount ?? 0) > 0;
  }
  async countActiveChildren(client: PoolClient, parentId: string): Promise<number> {
    const r = await client.query(`SELECT count(*)::int AS c FROM categories WHERE parent_id=$1 AND is_active AND deleted_at IS NULL`, [parentId]);
    return r.rows[0]?.c ?? 0;
  }
  async insertCategory(client: PoolClient, v: { parentId: string | null; code: string; defaultName: string; depth: number; commerceKind: string; requiresLicense: boolean; requiresCertificate: boolean; minAge: number | null; sortOrder: number; iconMediaId: string | null; actorUserId: string }): Promise<{ id: string; createdAt: Date; path: string }> {
    const r = await client.query(
      `INSERT INTO categories (parent_id, code, default_name, path, depth, commerce_kind, requires_license, requires_certificate, min_age, is_active, sort_order, icon_media_id, created_by, updated_by)
       VALUES ($1,$2,$3,$12::ltree,$4,$5,$6,$7,$8,true,$9,$10,$11,$11) RETURNING id, created_at, path::text AS path`,
      // PC-56 TEST-1: the path is its OWN parameter ($12, the same value as the code). `$2` used both as the varchar `code` and as
      // `$2::ltree` is refused by Postgres — "inconsistent types deduced for parameter $2" — so creating a category in the owner
      // console failed on every real database (the integration spec, never run in CI, was the only caller that reached Postgres).
      [v.parentId, v.code, v.defaultName, v.depth, v.commerceKind, v.requiresLicense, v.requiresCertificate, v.minAge, v.sortOrder, v.iconMediaId, v.actorUserId, v.code]);
    return { id: r.rows[0].id, createdAt: r.rows[0].created_at, path: r.rows[0].path };
  }
  async updateCategory(client: PoolClient, id: string, v: { defaultName: string; commerceKind: string; requiresLicense: boolean; requiresCertificate: boolean; minAge: number | null; sortOrder: number; iconMediaId: string | null; actorUserId: string }): Promise<void> {
    await client.query(
      `UPDATE categories SET default_name=$2, commerce_kind=$3, requires_license=$4, requires_certificate=$5, min_age=$6, sort_order=$7, icon_media_id=$8, updated_by=$9, updated_at=now() WHERE id=$1 AND deleted_at IS NULL`,
      [id, v.defaultName, v.commerceKind, v.requiresLicense, v.requiresCertificate, v.minAge, v.sortOrder, v.iconMediaId, v.actorUserId]);
  }
  async setCategoryActive(client: PoolClient, id: string, isActive: boolean, actorUserId: string): Promise<void> {
    await client.query(`UPDATE categories SET is_active=$2, updated_by=$3, updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, [id, isActive, actorUserId]);
  }
  /** Subtree size + deepest depth (incl. the node), for bounding + depth-limit checks before a move. */
  async subtreeStats(client: PoolClient, path: string): Promise<{ count: number; maxDepth: number }> {
    const r = await client.query(`SELECT count(*)::int AS c, COALESCE(max(depth),0)::int AS d FROM categories WHERE path <@ $1::ltree AND deleted_at IS NULL`, [path]);
    return { count: r.rows[0]?.c ?? 0, maxDepth: r.rows[0]?.d ?? 0 };
  }
  /**
   * Reparent: rewrite path + code + depth for the node AND its whole subtree in ONE bounded UPDATE (ltree splice).
   * For each row, the part of its path AFTER the old prefix is re-hung under newPath; code mirrors path; depth
   * shifts by the delta. The node's own parent_id is then repointed separately (descendants keep their parents).
   */
  async moveSubtree(client: PoolClient, v: { oldPath: string; newPath: string; depthDelta: number; nodeId: string; newParentId: string | null; actorUserId: string }): Promise<void> {
    await client.query(
      // PC-56 TEST-1: the moved node's OWN row has path = oldPath, and `subpath(path, nlevel(path))` (an offset equal to the
      // length) is an ERROR in Postgres ("invalid positions"), not an empty ltree — so every move of every category failed. The
      // node itself takes newPath; only its descendants splice their remainder on.
      `UPDATE categories
          SET path  = CASE WHEN nlevel(path) = nlevel($1::ltree) THEN $2::ltree ELSE ($2::ltree || subpath(path, nlevel($1::ltree))) END,
              code  = (CASE WHEN nlevel(path) = nlevel($1::ltree) THEN $2::ltree ELSE ($2::ltree || subpath(path, nlevel($1::ltree))) END)::text,
              depth = depth + $3,
              updated_by = $4, updated_at = now()
        WHERE path <@ $1::ltree AND deleted_at IS NULL`,
      [v.oldPath, v.newPath, v.depthDelta, v.actorUserId]);
    await client.query(`UPDATE categories SET parent_id=$2 WHERE id=$1 AND deleted_at IS NULL`, [v.nodeId, v.newParentId]);
  }

  /* ============================ catalogue_changes (append-only) ============================ */
  async insertChange(client: PoolClient, c: { entityType: 'lookup_type' | 'lookup_value' | 'category'; entityId: string; action: string; oldValue: unknown; newValue: unknown; reason: string; actorUserId: string }): Promise<void> {
    await client.query(
      `INSERT INTO catalogue_changes (entity_type, entity_id, action, old_value, new_value, reason, actor_user_id) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)`,
      [c.entityType, c.entityId, c.action, c.oldValue != null ? JSON.stringify(c.oldValue) : null, c.newValue != null ? JSON.stringify(c.newValue) : null, c.reason, c.actorUserId]);
  }
  async listChanges(q: ChangeListQuery): Promise<any[]> {
    const params: unknown[] = [q.entityType, q.entityId]; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'entity_type=$1 AND entity_id=$2';
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(
      `SELECT id, entity_type, entity_id, action, old_value, new_value, reason, actor_user_id, created_at FROM catalogue_changes WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({ id: x.id, entityType: x.entity_type, entityId: x.entity_id, action: x.action, oldValue: x.old_value ?? null, newValue: x.new_value ?? null, reason: x.reason, actorUserId: x.actor_user_id, createdAt: x.created_at }));
  }
}
