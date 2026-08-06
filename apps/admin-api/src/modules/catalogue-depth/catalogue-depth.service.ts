// apps/admin-api/src/modules/catalogue-depth/catalogue-depth.service.ts · PC-54 W54-11 slice 1 SQL.
//
// REDUCED TO ONE METHOD BY PC-56 ADMIN-3. This file used to hold the attribute/option/unit reads and the two unit
// writes; all of them now live in `services/eav-admin.service.ts` on top of `repositories/eav.repository.ts`, because
// those writes needed a transaction and an audit row and a service holding raw SQL cannot express either.
//
// The unit writes are NOT left here as a second path. Two write paths for one table is exactly how one of them stays
// unaudited — which is the defect this wave existed to fix, so leaving a copy would have re-created it.
//
// What remains is the CROPS LENS: there is no crops table, crops ARE the `crops.*` category branch. It stays read-only
// here because ADMIN-3's scope is the EAV plane; the lens and its two declared DELTAs (season and mandi-feed mapping
// have no schema home) belong to ADMIN-3c.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../core/database/admin-pool';

@Injectable()
export class CatalogueDepthService {
  constructor(private readonly pool: AdminPool) {}

  async crops() {
    const r = await this.pool.query(
      `SELECT c.id, c.code, c.default_name, c.path::text, c.depth, c.is_active FROM categories c
        WHERE c.deleted_at IS NULL AND c.path <@ (SELECT path FROM categories WHERE code='crops' AND deleted_at IS NULL LIMIT 1)
        ORDER BY c.path LIMIT 1000`);
    return r.rows;
  }
}
