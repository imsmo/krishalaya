// apps/admin-api/src/modules/schemes-registry-ops/depth.service.ts · PC-54 W54-11 slice 2: the cross-tenant
// scheme-applications oversight reads (god-mode realm — tenant-scoped gov tokens can never see this).
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../core/database/admin-pool';

@Injectable()
export class SchemesDepthService {
  constructor(private readonly pool: AdminPool) {}

  async applications(q: { tenantId?: string; status?: string; limit: number }) {
    const r = await this.pool.query(
      `SELECT id, tenant_id, scheme_id, applicant_user_id, status, created_at
         FROM scheme_applications
        WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR tenant_id=$1) AND ($2::text IS NULL OR status=$2::application_status)
        ORDER BY created_at DESC LIMIT $3`, [q.tenantId ?? null, q.status ?? null, Math.min(q.limit, 200)]);
    return r.rows;
  }
  async applicationStats() {
    const r = await this.pool.query(
      `SELECT tenant_id, status::text, COUNT(*)::int AS n FROM scheme_applications WHERE deleted_at IS NULL GROUP BY tenant_id, status ORDER BY tenant_id LIMIT 1000`);
    return r.rows;
  }
}
