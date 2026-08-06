// apps/admin-api/src/modules/catalogue-depth/repositories/eav.repository.ts · the EAV definition plane's data access
// (PC-56 ADMIN-3, canon W020's bindings tab, W024, W025, W026, W027).
//
// WHY THIS MODULE GAINS A REPOSITORY LAYER IT DID NOT HAVE. `catalogue-depth.service.ts` queried the pool directly, which
// was defensible while it was six read methods. It is not defensible now that the module writes: every mutation here has
// to happen in ONE transaction alongside its `catalogue_changes` audit row, and a service holding raw SQL cannot express
// that without the transaction leaking into it. Its sibling `global-catalogue-ops` has had this shape since 0041 — this
// brings the two halves of one domain to one standard, which is the point of the wave.
//
// NO DELETES ANYWHERE. Migration 0102 grants none, and the reason is worth restating: an attribute or option that has
// ever been used is referenced by listing values whose history must stay readable. Deactivation is the mechanism.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';

/** The audit kinds 0102 widened the CHECK to accept. Typed so a typo cannot reach the database and fail there. */
export type CatalogueEntityKind =
  | 'attribute' | 'attribute_option' | 'category_attribute' | 'unit' | 'unit_conversion';
export type CatalogueAction =
  | 'created' | 'updated' | 'activated' | 'deactivated' | 'renamed' | 'bound' | 'unbound';

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : ((v as Date).toISOString?.() ?? String(v));

@Injectable()
export class EavRepository {
  constructor(private readonly pool: AdminPool) {}

  /* ------------------------------------------------------------------ attributes */

  /** W026's list. `boundTo` and `optionCount` are the two columns the canon shows and neither is stored — both are
   *  counted here rather than denormalised, because a counter that can drift from its source is worse than a join. */
  async listAttributes(q: { search?: string; dataType?: string; withUnit?: boolean; limit: number }): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [q.search ?? null];
    let where = `a.deleted_at IS NULL
                 AND ($1::text IS NULL OR a.code ILIKE '%'||$1||'%' OR a.default_name ILIKE '%'||$1||'%')`;
    if (q.dataType) { params.push(q.dataType); where += ` AND a.data_type = $${params.length}`; }
    if (q.withUnit === true) where += ` AND a.unit_code IS NOT NULL`;
    params.push(q.limit);
    const r = await this.pool.query(
      `SELECT a.id, a.code, a.default_name, a.data_type, a.unit_code, a.validation, a.is_active,
              (SELECT count(*)::int FROM category_attributes ca WHERE ca.attribute_id = a.id AND ca.deleted_at IS NULL) AS bound_to,
              (SELECT count(*)::int FROM attribute_options o WHERE o.attribute_id = a.id AND o.deleted_at IS NULL) AS option_count,
              -- the unit the canon flags as "unit missing" on W026: a numeric attribute with no unit measures nothing
              (a.unit_code IS NULL AND a.data_type IN ('number','decimal','range')) AS unit_missing
         FROM attribute_definitions a
        WHERE ${where}
        ORDER BY a.code
        LIMIT $${params.length}`, params);
    return r.rows.map((x: any) => ({
      id: x.id, code: x.code, defaultName: x.default_name, dataType: x.data_type,
      unitCode: x.unit_code ?? null, validation: x.validation ?? {}, isActive: x.is_active,
      boundTo: x.bound_to ?? 0, optionCount: x.option_count ?? 0, unitMissing: x.unit_missing === true,
    }));
  }

  async getAttribute(id: string): Promise<Record<string, unknown> | null> {
    const r = await this.pool.query(
      `SELECT a.id, a.code, a.default_name, a.data_type, a.unit_code, a.validation, a.is_active,
              (SELECT count(*)::int FROM category_attributes ca WHERE ca.attribute_id = a.id AND ca.deleted_at IS NULL) AS bound_to,
              (SELECT count(*)::int FROM attribute_options o WHERE o.attribute_id = a.id AND o.deleted_at IS NULL) AS option_count
         FROM attribute_definitions a
        WHERE a.id = $1 AND a.deleted_at IS NULL`, [id]);
    const x = r.rows[0] as any;
    if (!x) return null;
    return {
      id: x.id, code: x.code, defaultName: x.default_name, dataType: x.data_type,
      unitCode: x.unit_code ?? null, validation: x.validation ?? {}, isActive: x.is_active,
      boundTo: x.bound_to ?? 0, optionCount: x.option_count ?? 0,
    };
  }

  /** Locked read for an edit. The binding count comes back INSIDE the lock because it decides whether the edit needs a
   *  checker — reading it outside would let a binding land between the check and the write. */
  async getAttributeForUpdate(client: PoolClient, id: string): Promise<Record<string, unknown> | null> {
    const r = await client.query(
      `SELECT a.id, a.code, a.default_name, a.data_type, a.unit_code, a.validation, a.is_active,
              (SELECT count(*)::int FROM category_attributes ca WHERE ca.attribute_id = a.id AND ca.deleted_at IS NULL) AS bound_to
         FROM attribute_definitions a
        WHERE a.id = $1 AND a.deleted_at IS NULL
        FOR UPDATE OF a`, [id]);
    const x = r.rows[0] as any;
    if (!x) return null;
    return {
      id: x.id, code: x.code, defaultName: x.default_name, dataType: x.data_type,
      unitCode: x.unit_code ?? null, validation: x.validation ?? {}, isActive: x.is_active, boundTo: x.bound_to ?? 0,
    };
  }

  async attributeCodeExists(code: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM attribute_definitions WHERE code = $1 AND deleted_at IS NULL LIMIT 1`, [code]);
    return (r.rowCount ?? 0) > 0;
  }

  async insertAttribute(client: PoolClient, p: {
    code: string; defaultName: string; dataType: string; unitCode: string | null;
    validation: Record<string, unknown>; actorUserId: string;
  }): Promise<{ id: string }> {
    const r = await client.query(
      `INSERT INTO attribute_definitions (code, default_name, data_type, unit_code, validation, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING id`,
      [p.code, p.defaultName, p.dataType, p.unitCode, JSON.stringify(p.validation), p.actorUserId]);
    return { id: (r.rows[0] as any).id };
  }

  /** COALESCE per field so a partial edit does not blank the fields it did not mention. `code` is absent by design —
   *  there is no path in this repository that can change it (the canon's "immutable after first binding"). */
  async updateAttribute(client: PoolClient, p: {
    id: string; defaultName?: string; dataType?: string; unitCode?: string | null;
    validation?: Record<string, unknown>; actorUserId: string;
  }): Promise<void> {
    await client.query(
      `UPDATE attribute_definitions
          SET default_name = COALESCE($2, default_name),
              data_type    = COALESCE($3, data_type),
              -- unitCode is three-state: undefined = leave, null = clear, string = set. $5 carries the intent.
              unit_code    = CASE WHEN $5 THEN $4 ELSE unit_code END,
              validation   = COALESCE($6::jsonb, validation),
              updated_by = $7, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [p.id, p.defaultName ?? null, p.dataType ?? null, p.unitCode ?? null,
       p.unitCode !== undefined, p.validation ? JSON.stringify(p.validation) : null, p.actorUserId]);
  }

  async setAttributeActive(client: PoolClient, id: string, isActive: boolean, actorUserId: string): Promise<number> {
    const r = await client.query(
      `UPDATE attribute_definitions SET is_active = $2, updated_by = $3, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL AND is_active <> $2`, [id, isActive, actorUserId]);
    return r.rowCount ?? 0;
  }

  /* ------------------------------------------------------------------ options (W024) */

  /** Options for an attribute. `categoryId` filters to a branch's own options PLUS the global ones, because that is what
   *  a farmer filling the listing form actually sees — 0102's scoping means "global unless narrowed". */
  async listOptions(q: { attributeId: string; categoryId?: string; limit: number }): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [q.attributeId];
    let where = `o.attribute_id = $1 AND o.deleted_at IS NULL`;
    if (q.categoryId) {
      params.push(q.categoryId);
      where += ` AND (o.category_id IS NULL OR o.category_id = $${params.length})`;
    }
    params.push(q.limit);
    const r = await this.pool.query(
      `SELECT o.id, o.code, o.default_name, o.sort_order, o.is_active, o.category_id,
              c.code AS category_code
         FROM attribute_options o
         LEFT JOIN categories c ON c.id = o.category_id
        WHERE ${where}
        ORDER BY o.sort_order, o.code
        LIMIT $${params.length}`, params);
    return r.rows.map((x: any) => ({
      id: x.id, code: x.code, defaultName: x.default_name, sortOrder: Number(x.sort_order),
      isActive: x.is_active, categoryId: x.category_id ?? null, categoryCode: x.category_code ?? null,
      // named so a screen can say "shared across every crop" rather than leaving a blank cell
      scope: x.category_id ? 'category' : 'global',
    }));
  }

  async optionCodeExists(attributeId: string, code: string, categoryId: string | null): Promise<boolean> {
    const r = await this.pool.query(
      categoryId
        ? `SELECT 1 FROM attribute_options WHERE attribute_id=$1 AND code=$2 AND category_id=$3 AND deleted_at IS NULL LIMIT 1`
        : `SELECT 1 FROM attribute_options WHERE attribute_id=$1 AND code=$2 AND category_id IS NULL AND deleted_at IS NULL LIMIT 1`,
      categoryId ? [attributeId, code, categoryId] : [attributeId, code]);
    return (r.rowCount ?? 0) > 0;
  }

  async insertOption(client: PoolClient, p: {
    attributeId: string; code: string; defaultName: string; sortOrder: number;
    categoryId: string | null; actorUserId: string;
  }): Promise<{ id: string }> {
    const r = await client.query(
      `INSERT INTO attribute_options (attribute_id, code, default_name, sort_order, category_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [p.attributeId, p.code, p.defaultName, p.sortOrder, p.categoryId, p.actorUserId]);
    return { id: (r.rows[0] as any).id };
  }

  async getOptionForUpdate(client: PoolClient, id: string): Promise<Record<string, unknown> | null> {
    const r = await client.query(
      `SELECT id, attribute_id, code, default_name, sort_order, is_active, category_id
         FROM attribute_options WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    const x = r.rows[0] as any;
    return x ? {
      id: x.id, attributeId: x.attribute_id, code: x.code, defaultName: x.default_name,
      sortOrder: Number(x.sort_order), isActive: x.is_active, categoryId: x.category_id ?? null,
    } : null;
  }

  async setOptionActive(client: PoolClient, id: string, isActive: boolean, actorUserId: string): Promise<number> {
    const r = await client.query(
      `UPDATE attribute_options SET is_active = $2, updated_by = $3, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL AND is_active <> $2`, [id, isActive, actorUserId]);
    return r.rowCount ?? 0;
  }

  async updateOption(client: PoolClient, p: { id: string; defaultName?: string; sortOrder?: number; actorUserId: string }): Promise<void> {
    await client.query(
      `UPDATE attribute_options
          SET default_name = COALESCE($2, default_name), sort_order = COALESCE($3, sort_order),
              updated_by = $4, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [p.id, p.defaultName ?? null, p.sortOrder ?? null, p.actorUserId]);
  }

  /* ------------------------------------------------------------------ bindings (W020's tab) */

  /**
   * A category's bindings, INCLUDING INHERITED ONES. The canon's W020 shows exactly this — `harvest_date` marked
   * "inherited: crops" — and it is the only honest way to render the tab: a listing form applies the ancestors' bindings
   * too, so a screen showing only the locally-bound rows would understate what a farmer is actually asked for.
   *
   * The ltree `@>` operator does the ancestry in one query rather than walking parents in a loop.
   */
  async listBindings(categoryId: string): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `WITH target AS (
         SELECT id, path FROM categories WHERE id = $1 AND deleted_at IS NULL
       )
       SELECT ca.id, ca.category_id, ca.attribute_id, ca.is_required, ca.show_in_filters, ca.show_on_card,
              ca.condition, ca.sort_order,
              a.code AS attribute_code, a.default_name AS attribute_name, a.data_type, a.unit_code,
              src.code AS source_code,
              (ca.category_id = (SELECT id FROM target)) AS is_local
         FROM target t
         JOIN categories src ON src.path @> t.path AND src.deleted_at IS NULL
         JOIN category_attributes ca ON ca.category_id = src.id AND ca.deleted_at IS NULL
         JOIN attribute_definitions a ON a.id = ca.attribute_id AND a.deleted_at IS NULL
        ORDER BY (ca.category_id = (SELECT id FROM target)) DESC, ca.sort_order, a.code`, [categoryId]);
    return r.rows.map((x: any) => ({
      id: x.id, categoryId: x.category_id, attributeId: x.attribute_id,
      attributeCode: x.attribute_code, attributeName: x.attribute_name,
      dataType: x.data_type, unitCode: x.unit_code ?? null,
      isRequired: x.is_required, showInFilters: x.show_in_filters, showOnCard: x.show_on_card,
      condition: x.condition ?? null, sortOrder: Number(x.sort_order),
      // "bound here" vs "inherited: crops" — the canon's own Source column
      isLocal: x.is_local === true,
      source: x.is_local === true ? 'bound here' : `inherited: ${x.source_code}`,
      // an inherited binding cannot be edited on this screen; it belongs to the ancestor that owns it
      editableHere: x.is_local === true,
    }));
  }

  async bindingExists(categoryId: string, attributeId: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM category_attributes WHERE category_id=$1 AND attribute_id=$2 AND deleted_at IS NULL LIMIT 1`,
      [categoryId, attributeId]);
    return (r.rowCount ?? 0) > 0;
  }

  async insertBinding(client: PoolClient, p: {
    categoryId: string; attributeId: string; isRequired: boolean; showInFilters: boolean; showOnCard: boolean;
    condition: Record<string, unknown> | null; sortOrder: number; actorUserId: string;
  }): Promise<{ id: string }> {
    const r = await client.query(
      `INSERT INTO category_attributes
         (category_id, attribute_id, is_required, show_in_filters, show_on_card, condition, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id`,
      [p.categoryId, p.attributeId, p.isRequired, p.showInFilters, p.showOnCard,
       p.condition ? JSON.stringify(p.condition) : null, p.sortOrder, p.actorUserId]);
    return { id: (r.rows[0] as any).id };
  }

  async getBindingForUpdate(client: PoolClient, id: string): Promise<Record<string, unknown> | null> {
    const r = await client.query(
      `SELECT ca.id, ca.category_id, ca.attribute_id, ca.is_required, ca.show_in_filters, ca.show_on_card,
              ca.condition, ca.sort_order, a.code AS attribute_code, c.code AS category_code
         FROM category_attributes ca
         JOIN attribute_definitions a ON a.id = ca.attribute_id
         JOIN categories c ON c.id = ca.category_id
        WHERE ca.id = $1 AND ca.deleted_at IS NULL FOR UPDATE OF ca`, [id]);
    const x = r.rows[0] as any;
    return x ? {
      id: x.id, categoryId: x.category_id, attributeId: x.attribute_id, isRequired: x.is_required,
      showInFilters: x.show_in_filters, showOnCard: x.show_on_card, condition: x.condition ?? null,
      sortOrder: Number(x.sort_order), attributeCode: x.attribute_code, categoryCode: x.category_code,
    } : null;
  }

  async updateBinding(client: PoolClient, p: {
    id: string; isRequired: boolean; showInFilters: boolean; showOnCard: boolean;
    condition: Record<string, unknown> | null; sortOrder: number; actorUserId: string;
  }): Promise<void> {
    await client.query(
      `UPDATE category_attributes
          SET is_required = $2, show_in_filters = $3, show_on_card = $4,
              condition = $5::jsonb, sort_order = $6, updated_by = $7, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [p.id, p.isRequired, p.showInFilters, p.showOnCard,
       p.condition ? JSON.stringify(p.condition) : null, p.sortOrder, p.actorUserId]);
  }

  /** UNBINDING IS A SOFT DELETE. The binding described how listings were validated while it existed, and a hard delete
   *  would make an old listing's stored values unexplainable. */
  async softDeleteBinding(client: PoolClient, id: string, actorUserId: string): Promise<number> {
    const r = await client.query(
      `UPDATE category_attributes SET deleted_at = now(), updated_by = $2, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL`, [id, actorUserId]);
    return r.rowCount ?? 0;
  }

  /* ------------------------------------------------------------------ units (W025) */

  async listUnits(q: { activeOnly?: boolean; unitClass?: string; limit: number }): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [q.activeOnly === true];
    let where = `u.deleted_at IS NULL AND ($1 = false OR u.is_active = true)`;
    if (q.unitClass) { params.push(q.unitClass); where += ` AND u.unit_class = $${params.length}`; }
    params.push(q.limit);
    const r = await this.pool.query(
      `SELECT u.code, u.default_name, u.unit_class, u.is_active,
              (SELECT count(*)::int FROM attribute_definitions a WHERE a.unit_code = u.code AND a.deleted_at IS NULL) AS used_by_attrs
         FROM units u
        WHERE ${where}
        ORDER BY u.unit_class, u.code
        LIMIT $${params.length}`, params);
    return r.rows.map((x: any) => ({
      code: x.code, defaultName: x.default_name, unitClass: x.unit_class,
      isActive: x.is_active, usedByAttrs: x.used_by_attrs ?? 0,
    }));
  }

  async getUnit(code: string): Promise<Record<string, unknown> | null> {
    const r = await this.pool.query(
      `SELECT code, default_name, unit_class, is_active FROM units WHERE code = $1 AND deleted_at IS NULL`, [code]);
    const x = r.rows[0] as any;
    return x ? { code: x.code, defaultName: x.default_name, unitClass: x.unit_class, isActive: x.is_active } : null;
  }

  async insertUnit(client: PoolClient, p: { code: string; defaultName: string; unitClass: string; actorUserId: string }): Promise<void> {
    await client.query(
      `INSERT INTO units (code, default_name, unit_class, created_by) VALUES ($1,$2,$3,$4)`,
      [p.code, p.defaultName, p.unitClass, p.actorUserId]);
  }

  async setUnitActive(client: PoolClient, code: string, isActive: boolean, actorUserId: string): Promise<number> {
    const r = await client.query(
      `UPDATE units SET is_active = $2, updated_by = $3, updated_at = now()
        WHERE code = $1 AND deleted_at IS NULL AND is_active <> $2`, [code, isActive, actorUserId]);
    return r.rowCount ?? 0;
  }

  /** `factor::text` — NEVER a float. numeric(20,10) does not survive a round trip through a JS number (0.4 is not
   *  representable in binary), and this number multiplies every quoted quantity on the platform. Law 2's reasoning for
   *  money, applied to quantities. */
  async listConversions(unitClass?: string): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [unitClass ?? null];
    const r = await this.pool.query(
      `SELECT uc.from_unit, uc.to_unit, uc.factor::text AS factor,
              fu.unit_class, fu.default_name AS from_name, tu.default_name AS to_name
         FROM unit_conversions uc
         JOIN units fu ON fu.code = uc.from_unit
         JOIN units tu ON tu.code = uc.to_unit
        WHERE uc.deleted_at IS NULL AND ($1::text IS NULL OR fu.unit_class = $1)
        ORDER BY fu.unit_class, uc.from_unit, uc.to_unit`, params);
    return r.rows.map((x: any) => ({
      fromUnit: x.from_unit, toUnit: x.to_unit, factor: x.factor,
      unitClass: x.unit_class, fromName: x.from_name, toName: x.to_name,
    }));
  }

  async getConversionForUpdate(client: PoolClient, fromUnit: string, toUnit: string): Promise<Record<string, unknown> | null> {
    const r = await client.query(
      `SELECT from_unit, to_unit, factor::text AS factor FROM unit_conversions
        WHERE from_unit=$1 AND to_unit=$2 AND deleted_at IS NULL FOR UPDATE`, [fromUnit, toUnit]);
    const x = r.rows[0] as any;
    return x ? { fromUnit: x.from_unit, toUnit: x.to_unit, factor: x.factor } : null;
  }

  /** Factor passed as TEXT and cast in SQL, for the reason in listConversions. */
  async upsertConversion(client: PoolClient, p: { fromUnit: string; toUnit: string; factor: string; actorUserId: string }): Promise<void> {
    await client.query(
      `INSERT INTO unit_conversions (from_unit, to_unit, factor, created_by)
       VALUES ($1,$2,$3::numeric,$4)
       ON CONFLICT (from_unit, to_unit) DO UPDATE
         SET factor = $3::numeric, deleted_at = NULL, updated_by = $4, updated_at = now()`,
      [p.fromUnit, p.toUnit, p.factor, p.actorUserId]);
  }

  /* ------------------------------------------------------------------ the audit row */

  /**
   * ONE audit row, in the caller's transaction. This is the method whose absence was the defect: before 0102 the CHECK
   * on `catalogue_changes.entity_type` would have REJECTED every kind this repository writes, so the existing unit write
   * path simply did not attempt one.
   */
  async insertChange(client: PoolClient, c: {
    entityType: CatalogueEntityKind; entityId: string; action: CatalogueAction;
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

  /** The history of one entity, newest first — the same shape global-catalogue-ops serves, so a console can render
   *  either without branching. */
  async listChanges(entityType: CatalogueEntityKind, entityId: string, limit = 50): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT id, entity_type, entity_id, action, old_value, new_value, reason, actor_user_id, created_at
         FROM catalogue_changes
        WHERE entity_type = $1 AND entity_id = $2
        ORDER BY created_at DESC, id DESC LIMIT $3`, [entityType, entityId, limit]);
    return r.rows.map((x: any) => ({
      id: String(x.id), entityType: x.entity_type, entityId: x.entity_id, action: x.action,
      oldValue: x.old_value ?? null, newValue: x.new_value ?? null, reason: x.reason,
      actorUserId: x.actor_user_id, createdAt: iso(x.created_at),
    }));
  }
}
