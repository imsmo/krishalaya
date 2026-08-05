// apps/admin-api/src/modules/catalogue-depth/catalogue-depth.service.ts · PC-54 W54-11 slice 1 SQL.
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { AdminPool } from '../../core/database/admin-pool';

@Injectable()
export class CatalogueDepthService {
  constructor(private readonly pool: AdminPool) {}

  async attributes(q: string | undefined, limit: number) {
    const r = await this.pool.query(
      `SELECT id, code, default_name, data_type, unit_code, is_active FROM attribute_definitions
        WHERE deleted_at IS NULL AND ($1::text IS NULL OR code ILIKE '%'||$1||'%' OR default_name ILIKE '%'||$1||'%')
        ORDER BY code ASC LIMIT $2`, [q ?? null, Math.min(limit, 200)]);
    return r.rows;
  }
  async options(attributeId: string) {
    const r = await this.pool.query(`SELECT id, code, default_name, sort_order, is_active FROM attribute_options WHERE attribute_id=$1 AND deleted_at IS NULL ORDER BY sort_order ASC, code ASC LIMIT 500`, [attributeId]);
    return r.rows;
  }
  async units(activeOnly: boolean) {
    const r = await this.pool.query(`SELECT code, default_name, unit_class, is_active FROM units WHERE deleted_at IS NULL AND ($1 = false OR is_active = true) ORDER BY unit_class, code`, [activeOnly]);
    return r.rows;
  }
  async createUnit(dto: { code: string; defaultName: string; unitClass: string }) {
    try {
      await this.pool.query(`INSERT INTO units (code, default_name, unit_class) VALUES ($1,$2,$3)`, [dto.code, dto.defaultName, dto.unitClass]);
      return { code: dto.code };
    } catch (e: any) { if (e?.code === '23505') throw new ConflictException('unit code already exists'); throw e; }
  }
  async setUnitActive(code: string, isActive: boolean) {
    const r = await this.pool.query(`UPDATE units SET is_active=$2 WHERE code=$1 AND deleted_at IS NULL`, [code, isActive]);
    if ((r.rowCount ?? 0) === 0) throw new NotFoundException('unit not found');
    return { code, isActive };
  }
  async crops() {
    const r = await this.pool.query(
      `SELECT c.id, c.code, c.default_name, c.path::text, c.depth, c.is_active FROM categories c
        WHERE c.deleted_at IS NULL AND c.path <@ (SELECT path FROM categories WHERE code='crops' AND deleted_at IS NULL LIMIT 1)
        ORDER BY c.path LIMIT 1000`);
    return r.rows;
  }
}
