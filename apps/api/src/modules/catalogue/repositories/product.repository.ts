// modules/catalogue/repositories/product.repository.ts
// Products are HYBRID: tenant_id NULL = platform master (read-only here, managed in
// admin-api), tenant_id set = the tenant's private product. RLS enforces
// (tenant_id IS NULL OR tenant_id = current_tenant_id()); we also bind it in SQL (Law 1).
// Writes here only ever touch the caller's OWN (tenant-private) products.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Product, ProductProps } from '../domain/product.entity';
import { ProductAttr } from '../dto/dto-attr';

const COLS = `id, category_id, code, default_name, brand_id, default_unit, gst_rate_pct, hsn_code, is_perishable, shelf_life_days, tenant_id, is_active`;
const toDomain = (r: any): Product => Product.rehydrate({ id: r.id, categoryId: r.category_id, code: r.code, defaultName: r.default_name, brandId: r.brand_id, defaultUnit: r.default_unit, gstRatePct: r.gst_rate_pct != null ? Number(r.gst_rate_pct) : null, hsnCode: r.hsn_code, isPerishable: r.is_perishable, shelfLifeDays: r.shelf_life_days, tenantId: r.tenant_id, isActive: r.is_active });

@Injectable()
export class ProductRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Visible to this tenant = platform master OR own private. (RLS also enforces.) */
  async getVisibleById(tenantId: string, id: string): Promise<Product | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM products WHERE id=$1 AND (tenant_id IS NULL OR tenant_id=$2) AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** For mutation — ONLY the tenant's own product (never platform master). */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Product | null> {
    const r = await tx.query(`SELECT ${COLS} FROM products WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async insert(tx: TxContext, p: Product): Promise<void> {
    const v = p.toProps();
    await tx.query(
      `INSERT INTO products (id, category_id, code, default_name, brand_id, default_unit, gst_rate_pct, hsn_code, is_perishable, shelf_life_days, tenant_id, is_active, search_tsv)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, to_tsvector('simple', $4::varchar))`,
      // `$4::varchar`, not `$4`: one parameter deduced as varchar (default_name) AND as to_tsvector's text is refused by Postgres
      // ("inconsistent types deduced for parameter $4") — every tenant product create and edit failed. PC-56 TEST-1, found by the
      // catalogue integration spec; the unit specs mock the repository.
      [v.id, v.categoryId, v.code, v.defaultName, v.brandId, v.defaultUnit, v.gstRatePct, v.hsnCode, v.isPerishable, v.shelfLifeDays, v.tenantId, v.isActive]);
  }
  async update(tx: TxContext, p: Product): Promise<void> {
    const v = p.toProps();
    await tx.query(
      `UPDATE products SET category_id=$3, default_name=$4, brand_id=$5, default_unit=$6, gst_rate_pct=$7, hsn_code=$8,
         is_perishable=$9, shelf_life_days=$10, is_active=$11, search_tsv=to_tsvector('simple',$4::varchar), updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [v.id, v.tenantId, v.categoryId, v.defaultName, v.brandId, v.defaultUnit, v.gstRatePct, v.hsnCode, v.isPerishable, v.shelfLifeDays, v.isActive]);
  }
  async upsertAttrs(tx: TxContext, productId: string, attrs: ProductAttr[]): Promise<void> {
    for (const a of attrs) {
      await tx.query(
        `INSERT INTO product_attribute_values (id, product_id, attribute_id, value_text, value_number, value_bool, value_date, option_id)
         VALUES (uuid_generate_v7(), $1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (product_id, attribute_id) DO UPDATE SET
           value_text=EXCLUDED.value_text, value_number=EXCLUDED.value_number, value_bool=EXCLUDED.value_bool,
           value_date=EXCLUDED.value_date, option_id=EXCLUDED.option_id`,
        [productId, a.attributeId,
         a.kind === 'text' ? a.text : null, a.kind === 'number' ? a.number : null,
         a.kind === 'bool' ? a.bool : null, a.kind === 'date' ? a.date : null,
         a.kind === 'option' ? a.optionId : null]);
    }
  }
}
