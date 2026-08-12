// apps/admin-api/src/modules/comm-hub/repositories/comm-hub.repository.ts · W050 SQL (PC-56 ADMIN-SWEEP-b2).
//
// EVERY PRINCIPAL READ JOINS ON users.id AND ONLY ON users.id — the 0133 channel-identity decision, enforced here
// by there being no other join written. Phones leave this file only through domain/principalView's masking.
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';

export interface PrincipalRow {
  userId: string; fullName: string | null; phone: string | null; languageCode: string | null;
  openTickets: number; tenants: number; channels: string[]; worstSeverity: string | null;
  worstDueAt: string | null; latestTicketId: string; latestSubject: string | null; latestChannel: string;
  waitingSince: string;
}

@Injectable()
export class CommHubRepository {
  constructor(private readonly pool: AdminPool) {}

  /** The unified inbox: OPEN tickets grouped one row per PRINCIPAL, worst first-response deadline first, cross-
   *  tenant by nature (this console's whole point). Keyset on (worstDueAt, userId); nulls sort last so an unset
   *  clock cannot render as comfortably on-time. */
  async principals(q: { cursor?: { k: string; id: string }; limit: number }): Promise<PrincipalRow[]> {
    const p: unknown[] = [];
    let having = '';
    if (q.cursor) {
      p.push(q.cursor.k, q.cursor.id);
      // NULLS-LAST keyset: a non-null cursor admits later deadlines, ties by id, and the whole null tail; a null
      // cursor (we are IN the tail) admits only later ids among the null-due rows.
      having = `HAVING (min(t.sla_first_response_due) > $1::timestamptz
                OR (min(t.sla_first_response_due) = $1::timestamptz AND t.requester_user_id > $2::uuid)
                OR (min(t.sla_first_response_due) IS NULL AND $1::timestamptz IS NOT NULL)
                OR (min(t.sla_first_response_due) IS NULL AND $1::timestamptz IS NULL AND t.requester_user_id > $2::uuid))`;
    }
    p.push(q.limit);
    const r = await this.pool.query(
      `SELECT t.requester_user_id AS "userId", u.full_name AS "fullName", u.phone, u.language_code AS "languageCode",
              count(*)::int AS "openTickets",
              count(DISTINCT t.tenant_id)::int AS tenants,
              array_agg(DISTINCT t.channel) AS channels,
              min(t.severity) AS "worstSeverity",
              min(t.sla_first_response_due)::text AS "worstDueAt",
              (array_agg(t.id ORDER BY t.created_at DESC))[1] AS "latestTicketId",
              (array_agg(t.subject ORDER BY t.created_at DESC))[1] AS "latestSubject",
              (array_agg(t.channel ORDER BY t.created_at DESC))[1] AS "latestChannel",
              min(t.created_at)::text AS "waitingSince"
         FROM support_tickets t JOIN users u ON u.id = t.requester_user_id
        WHERE t.status NOT IN ('resolved', 'closed') AND t.deleted_at IS NULL
        GROUP BY t.requester_user_id, u.full_name, u.phone, u.language_code
        ${having}
        ORDER BY min(t.sla_first_response_due) ASC NULLS LAST, t.requester_user_id ASC
        LIMIT $${p.length}`, p);
    return r.rows;
  }

  /** Tickets whose requester was never recorded (autoOpen allows null). Counted and SAID, not silently dropped —
   *  a person-grouped inbox that quietly hides ownerless tickets is an inbox with a hole in it. */
  async orphanCount(): Promise<number> {
    const r = await this.pool.query(
      `SELECT count(*)::int AS n FROM support_tickets
        WHERE status NOT IN ('resolved', 'closed') AND deleted_at IS NULL AND requester_user_id IS NULL`);
    return Number(r.rows[0]?.n ?? 0);
  }

  /** One principal's live tickets, every tenant, for the thread panel. */
  async ticketsForPrincipal(userId: string): Promise<any[]> {
    const r = await this.pool.query(
      `SELECT t.id, t.tenant_id AS "tenantId", t.ticket_no AS "ticketNo", t.channel, t.severity, t.status,
              t.subject, t.sla_first_response_due AS "slaFirstResponseDue", t.created_at AS "createdAt",
              t.assignee_user_id AS "assigneeUserId", t.claimed_by_admin_id AS "claimedByAdminId"
         FROM support_tickets t
        WHERE t.requester_user_id = $1 AND t.deleted_at IS NULL
        ORDER BY (t.status IN ('resolved','closed')), t.created_at DESC
        LIMIT 50`, [userId]);
    return r.rows;
  }

  async principalIdentity(userId: string): Promise<{ userId: string; fullName: string | null; phone: string | null; languageCode: string | null } | null> {
    const r = await this.pool.query(
      `SELECT id AS "userId", full_name AS "fullName", phone, language_code AS "languageCode" FROM users WHERE id = $1`, [userId]);
    return r.rows[0] ?? null;
  }

  /* ---------------- claim ---------------- */

  /** "Next in queue": the worst first-response deadline nobody owns in either realm, claimed atomically. SKIP
   *  LOCKED so two agents clicking together get two tickets; served by idx_tickets_hub_queue (0133). */
  async claimNext(c: PoolClient, adminId: string): Promise<{ id: string; requesterUserId: string | null } | null> {
    const r = await c.query(
      `UPDATE support_tickets SET claimed_by_admin_id = $1, claimed_at = now(), updated_at = now()
        WHERE id = (SELECT id FROM support_tickets
                     WHERE status NOT IN ('resolved', 'closed') AND deleted_at IS NULL
                       AND claimed_by_admin_id IS NULL AND assignee_user_id IS NULL
                     ORDER BY sla_first_response_due ASC NULLS LAST, created_at ASC, id ASC
                     LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, requester_user_id AS "requesterUserId"`, [adminId]);
    return r.rows[0] ?? null;
  }

  async myLoad(adminId: string): Promise<number> {
    const r = await this.pool.query(
      `SELECT count(*)::int AS n FROM support_tickets
        WHERE claimed_by_admin_id = $1 AND status NOT IN ('resolved', 'closed') AND deleted_at IS NULL`, [adminId]);
    return Number(r.rows[0]?.n ?? 0);
  }

  async unclaimedCount(): Promise<number> {
    const r = await this.pool.query(
      `SELECT count(*)::int AS n FROM support_tickets
        WHERE status NOT IN ('resolved', 'closed') AND deleted_at IS NULL
          AND claimed_by_admin_id IS NULL AND assignee_user_id IS NULL`);
    return Number(r.rows[0]?.n ?? 0);
  }

  /* ---------------- presence ---------------- */

  async presence(adminId: string): Promise<{ status: string; since: string } | null> {
    const r = await this.pool.query(
      `SELECT status, since::text FROM support_hub_presence WHERE admin_id = $1 AND deleted_at IS NULL`, [adminId]);
    return r.rows[0] ?? null;
  }

  async setPresence(c: PoolClient, adminId: string, status: 'available' | 'break'): Promise<void> {
    await c.query(
      `INSERT INTO support_hub_presence (admin_id, status, since, created_by)
       VALUES ($1, $2, now(), $1)
       ON CONFLICT (admin_id) DO UPDATE SET status = $2, since = now(), updated_at = now(), updated_by = $1, deleted_at = NULL`,
      [adminId, status]);
  }
}
