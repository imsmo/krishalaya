// apps/admin-api/src/modules/safety-desk/repositories/safety-desk.repository.ts · W058 SQL (PC-56 ADMIN-SWEEP-b3).
//
// WHAT THIS FILE NEVER TOUCHES: `messages` and `conversations`. W058's restricted state — "even platform owner sees
// case metadata only, not thread content" — is enforced by absence: no query here (or anywhere in admin-api) reads
// a thread body, and the spec pins that with a grep. District is the TENANT's home district (tenants.region_id,
// 0002's own comment) — the requester's own address is not walked, deliberately: a women_safety case does not need
// this console resolving where a woman lives.
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';

const CASE_COLS = `t.id, t.tenant_id AS "tenantId", t.ticket_no AS "ticketNo", lv.code AS "categoryCode",
       t.channel, t.severity, t.status, t.subject, t.created_at AS "createdAt",
       t.requester_user_id AS "requesterUserId",
       reg.name AS "tenantDistrict"`;

const CASE_FROM = `FROM support_tickets t
       JOIN lookup_values lv ON lv.id = t.category_id AND lv.type_code = 'ticket_category'
       JOIN tenants tn ON tn.id = t.tenant_id
       LEFT JOIN admin_regions reg ON reg.id = tn.region_id`;

const ACTIVE = `t.status NOT IN ('resolved', 'closed') AND t.deleted_at IS NULL
       AND lv.code IN ('women_safety', 'emergency_vet', 'safety')`;

@Injectable()
export class SafetyDeskRepository {
  constructor(private readonly pool: AdminPool) {}

  /** Active protected-category cases, newest first (a fresh P0 needs eyes now), keyset. */
  async activeCases(q: { cursor?: { c: string; id: string }; limit: number }): Promise<any[]> {
    const p: unknown[] = [];
    let w = ACTIVE;
    if (q.cursor) {
      p.push(q.cursor.c, q.cursor.id);
      w += ` AND (t.created_at < $1 OR (t.created_at = $1 AND t.id < $2))`;
    }
    p.push(q.limit);
    const r = await this.pool.query(
      `SELECT ${CASE_COLS},
              (SELECT count(*)::int FROM safety_case_responders scr WHERE scr.ticket_id = t.id AND scr.deleted_at IS NULL) AS responders,
              (SELECT s.step_code FROM safety_case_steps s WHERE s.ticket_id = t.id AND s.deleted_at IS NULL
                ORDER BY s.created_at DESC LIMIT 1) AS "latestStepCode",
              (SELECT s.status::text FROM safety_case_steps s WHERE s.ticket_id = t.id AND s.deleted_at IS NULL
                ORDER BY s.created_at DESC LIMIT 1) AS "latestStepStatus"
         ${CASE_FROM}
        WHERE ${w}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $${p.length}`, p);
    return r.rows;
  }

  async getCase(id: string): Promise<any | null> {
    const r = await this.pool.query(
      `SELECT ${CASE_COLS} ${CASE_FROM} WHERE t.id = $1 AND t.deleted_at IS NULL
          AND lv.code IN ('women_safety', 'emergency_vet', 'safety')`, [id]);
    return r.rows[0] ?? null;
  }

  async requester(userId: string): Promise<{ userId: string; fullName: string | null; phone: string | null; languageCode: string | null; gender: string | null } | null> {
    const r = await this.pool.query(
      `SELECT id AS "userId", full_name AS "fullName", phone, language_code AS "languageCode", gender
         FROM users WHERE id = $1`, [userId]);
    return r.rows[0] ?? null;
  }

  async steps(ticketId: string): Promise<any[]> {
    const r = await this.pool.query(
      `SELECT id, step_code AS "stepCode", status::text, detail, actor_admin_id AS "actorAdminId",
              vet_profile_id AS "vetProfileId", created_at AS "createdAt"
         FROM safety_case_steps WHERE ticket_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`, [ticketId]);
    return r.rows;
  }

  async responders(ticketId: string): Promise<{ adminId: string; joinedAt: string }[]> {
    const r = await this.pool.query(
      `SELECT admin_id AS "adminId", created_at AS "joinedAt" FROM safety_case_responders
        WHERE ticket_id = $1 AND deleted_at IS NULL ORDER BY created_at`, [ticketId]);
    return r.rows;
  }

  /** Join is INSERT-if-absent: the UNIQUE makes a double click one presence, and rowCount tells the caller which. */
  async join(c: PoolClient, ticketId: string, adminId: string): Promise<boolean> {
    const r = await c.query(
      `INSERT INTO safety_case_responders (ticket_id, admin_id, created_by)
       VALUES ($1, $2, $2) ON CONFLICT (ticket_id, admin_id) DO NOTHING`, [ticketId, adminId]);
    return (r.rowCount ?? 0) > 0;
  }

  async insertStep(c: PoolClient, v: { ticketId: string; categoryCode: string; stepCode: string; status: string; detail: string; actorAdminId: string; vetProfileId: string | null }): Promise<void> {
    await c.query(
      `INSERT INTO safety_case_steps (ticket_id, category_code, step_code, status, detail, actor_admin_id, vet_profile_id, created_by)
       VALUES ($1, $2, $3, $4::support_escalation_status, $5, $6, $7, $6)`,
      [v.ticketId, v.categoryCode, v.stepCode, v.status, v.detail, v.actorAdminId, v.vetProfileId]);
  }

  /** Emergency-available vets near the case's TENANT region — region match, not distance: no lat/lng exists on
   *  vet_profiles and no SQL distance exists anywhere (0134's header), so the desk shows region + the vet's own
   *  service radius and NEVER prints a kilometre figure it cannot compute. The phone is shown because
   *  `is_emergency_available` is the vet's PUBLISHED standing offer to be called out — surfacing it to the safety
   *  desk is the offer working, and the panel read is audited by the service. */
  async emergencyVets(tenantRegionId: string | null, limit: number): Promise<any[]> {
    const r = await this.pool.query(
      `SELECT vp.id, u.full_name AS "fullName", u.phone, u.language_code AS "languageCode",
              vp.registration_no AS "registrationNo", vp.service_radius_km AS "serviceRadiusKm",
              vp.rating_avg AS "ratingAvg", reg.name AS region,
              (vp.base_region_id IS NOT DISTINCT FROM $1) AS "sameRegion"
         FROM vet_profiles vp
         JOIN users u ON u.id = vp.user_id
         LEFT JOIN admin_regions reg ON reg.id = vp.base_region_id
        WHERE vp.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM vet_services vs
                       WHERE vs.vet_profile_id = vp.id AND vs.is_emergency_available AND vs.deleted_at IS NULL)
        ORDER BY (vp.base_region_id IS NOT DISTINCT FROM $1) DESC, vp.rating_avg DESC NULLS LAST
        LIMIT $2`, [tenantRegionId, limit]);
    return r.rows;
  }

  async tenantRegionId(tenantId: string): Promise<string | null> {
    const r = await this.pool.query(`SELECT region_id FROM tenants WHERE id = $1`, [tenantId]);
    return r.rows[0]?.region_id ?? null;
  }
}
