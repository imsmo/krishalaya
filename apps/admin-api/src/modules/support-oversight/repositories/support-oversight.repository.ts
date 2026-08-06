// apps/admin-api/src/modules/support-oversight/repositories/support-oversight.repository.ts · ALL SQL for support-
// oversight. The platform NOC view is CROSS-TENANT: support_tickets is a tenant-scoped table with RLS, and
// admin-api connects as kv_admin (RLS-bypass) so the oversight plane sees every tenant — every read is bounded +
// keyset, every write audited. READS: ticket queue (filters incl. SLA-breach), the breach queue, a single ticket,
// and per-tenant health rollups. WRITE (in the caller's tx): the escalation UPDATE. Parameterised; keyset (never
// OFFSET). Support is money-free.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

/** A timestamp as ISO, or null. Null in null out: a missing timestamp must never become the epoch or "Invalid Date". */
function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return (v as Date).toISOString?.() ?? String(v);
}
import { AdminPool } from '../../../core/database/admin-pool';
import { SupportTicketOversight, TicketProps } from '../domain/ticket.entity';
import { Severity } from '../domain/sla';
import { TicketStatus } from '../domain/ticket.state';

const COLS = `id, tenant_id, ticket_no, requester_user_id, channel, category_id, severity, subject, status, assignee_user_id,
              sla_first_response_due, sla_resolution_due, first_responded_at, resolved_at, created_at`;
// A still-working ticket past an unsatisfied SLA due date.
const BREACH_SQL = `status IN ('open','pending_customer','pending_internal','escalated','reopened') AND (
  (first_responded_at IS NULL AND sla_first_response_due IS NOT NULL AND sla_first_response_due < now())
  OR (resolved_at IS NULL AND sla_resolution_due IS NOT NULL AND sla_resolution_due < now()))`;
const WORKING_SQL = `status IN ('open','pending_customer','pending_internal','escalated','reopened')`;

function toTicket(r: any): SupportTicketOversight {
  const props: TicketProps = {
    id: r.id, tenantId: r.tenant_id ?? null, ticketNo: r.ticket_no, requesterUserId: r.requester_user_id ?? null, channel: r.channel,
    categoryId: r.category_id ?? null, severity: r.severity as Severity, subject: r.subject ?? null, status: r.status as TicketStatus,
    assigneeUserId: r.assignee_user_id ?? null, slaFirstResponseDue: r.sla_first_response_due ?? null, slaResolutionDue: r.sla_resolution_due ?? null,
    firstRespondedAt: r.first_responded_at ?? null, resolvedAt: r.resolved_at ?? null, createdAt: r.created_at,
  };
  return SupportTicketOversight.rehydrate(props);
}

export interface TicketListQuery { tenantId?: string; status?: TicketStatus; severity?: Severity; slaBreached?: boolean; assigned?: boolean; cursor?: { c: string; id: string }; limit: number; }
export interface BreachListQuery { tenantId?: string; severity?: Severity; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class SupportOversightRepository {
  constructor(private readonly pool: AdminPool) {}

  async listTickets(q: TicketListQuery): Promise<SupportTicketOversight[]> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'deleted_at IS NULL';
    if (q.tenantId) where += ` AND tenant_id=${p(q.tenantId)}`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.severity) where += ` AND severity=${p(q.severity)}`;
    if (q.assigned !== undefined) where += q.assigned ? ` AND assignee_user_id IS NOT NULL` : ` AND assignee_user_id IS NULL`;
    if (q.slaBreached !== undefined) where += q.slaBreached ? ` AND (${BREACH_SQL})` : ` AND NOT (${BREACH_SQL})`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(`SELECT ${COLS} FROM support_tickets WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toTicket);
  }

  async listBreaches(q: BreachListQuery): Promise<SupportTicketOversight[]> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `deleted_at IS NULL AND (${BREACH_SQL})`;
    if (q.tenantId) where += ` AND tenant_id=${p(q.tenantId)}`;
    if (q.severity) where += ` AND severity=${p(q.severity)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    // Most-urgent-first for the breach queue: highest severity (P0 first), then oldest.
    const r = await this.pool.query(`SELECT ${COLS} FROM support_tickets WHERE ${where} ORDER BY severity ASC, created_at ASC, id ASC LIMIT ${lp}`, params);
    return r.rows.map(toTicket);
  }

  async getTicket(id: string): Promise<SupportTicketOversight | null> {
    const r = await this.pool.query(`SELECT ${COLS} FROM support_tickets WHERE id=$1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toTicket(r.rows[0]) : null;
  }
  async getTicketForUpdate(client: PoolClient, id: string): Promise<SupportTicketOversight | null> {
    const r = await client.query(`SELECT ${COLS} FROM support_tickets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toTicket(r.rows[0]) : null;
  }

  async updateEscalation(client: PoolClient, id: string, u: { severity: Severity; status: TicketStatus; assigneeUserId: string | null; slaFirstResponseDue: Date | null; slaResolutionDue: Date | null }, actorUserId: string): Promise<void> {
    await client.query(
      `UPDATE support_tickets SET severity=$2, status=$3, assignee_user_id=$4, sla_first_response_due=$5, sla_resolution_due=$6, updated_by=$7, updated_at=now() WHERE id=$1`,
      [id, u.severity, u.status, u.assigneeUserId, u.slaFirstResponseDue, u.slaResolutionDue, actorUserId]);
  }

  async userExists(userId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM users WHERE id=$1`, [userId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Per-tenant support health. tenantId set ⇒ that tenant (one row or empty); else the top tenants by open breaches. */
  async tenantHealth(tenantId: string | undefined, limit: number): Promise<{ tenantId: string; openCount: number; breachedCount: number; p0Open: number; oldestOpenAgeSec: number | null }[]> {
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `deleted_at IS NULL AND tenant_id IS NOT NULL`;
    if (tenantId) where += ` AND tenant_id=${p(tenantId)}`;
    const tail = tenantId ? '' : ` HAVING count(*) FILTER (WHERE ${BREACH_SQL}) > 0 ORDER BY count(*) FILTER (WHERE ${BREACH_SQL}) DESC, count(*) FILTER (WHERE ${WORKING_SQL}) DESC LIMIT ${p(limit)}`;
    const r = await this.pool.query(
      `SELECT tenant_id,
              count(*) FILTER (WHERE ${WORKING_SQL})::int AS open_count,
              count(*) FILTER (WHERE ${BREACH_SQL})::int AS breached_count,
              count(*) FILTER (WHERE severity='P0' AND ${WORKING_SQL})::int AS p0_open,
              EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE ${WORKING_SQL})))::bigint AS oldest_open_age_sec
         FROM support_tickets WHERE ${where} GROUP BY tenant_id${tail}`, params);
    return r.rows.map((x: any) => ({ tenantId: x.tenant_id, openCount: x.open_count ?? 0, breachedCount: x.breached_count ?? 0, p0Open: x.p0_open ?? 0, oldestOpenAgeSec: x.oldest_open_age_sec != null ? Number(x.oldest_open_age_sec) : null }));
  }

  /* ================= PC-56 ADMIN-2 · support-desk depth ================= */

  /**
   * AGENT PERFORMANCE (canon W055). Every column is derived from `support_tickets` — no new table, because the ticket
   * already records who handled it, when it was first answered, when it was resolved and what the requester scored it.
   *
   * TWO THINGS THIS READ REFUSES TO DO:
   *   • it does not invent a p50 from an average. First-response time is a DISTRIBUTION with a long tail (one ticket
   *     answered on Monday morning after a weekend would drag a mean into fiction), so the median is computed in SQL
   *     with `percentile_cont`. The canon asks for p50 and it gets a real p50.
   *   • it does not score an agent on tickets that are still open. `handled` counts RESOLVED tickets in the window;
   *     an agent whose queue is full of hard open cases is not a slow agent, and counting them would say so.
   */
  async agentPerformance(fromIso: string, toIso: string, limit = 100): Promise<Array<{
    agentUserId: string; handled: number; firstResponseP50Sec: number | null;
    csatAvgBps: number | null; csatCount: number; reopenedCount: number;
  }>> {
    const r = await this.pool.query(
      `SELECT t.assignee_user_id AS agent,
              count(*) FILTER (WHERE t.resolved_at IS NOT NULL)::int AS handled,
              -- a real median, in seconds; NULL when nobody has been answered yet in the window
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (t.first_responded_at - t.created_at))
              ) FILTER (WHERE t.first_responded_at IS NOT NULL) AS fr_p50_sec,
              -- CSAT as basis points of 5 (integer arithmetic on the way out), and the COUNT beside it: a 5.0 from one
              -- rating is not the same fact as a 4.6 from two hundred, and a bare average hides which one you have
              avg(t.csat_score) FILTER (WHERE t.csat_score IS NOT NULL) AS csat_avg,
              count(*) FILTER (WHERE t.csat_score IS NOT NULL)::int AS csat_count,
              count(*) FILTER (WHERE t.status = 'reopened')::int AS reopened
         FROM support_tickets t
        WHERE t.deleted_at IS NULL AND t.assignee_user_id IS NOT NULL
          AND t.created_at >= $1::timestamptz AND t.created_at < $2::timestamptz
        GROUP BY 1
        ORDER BY handled DESC, agent
        LIMIT $3`, [fromIso, toIso, limit]);
    return r.rows.map((x: any) => ({
      agentUserId: x.agent,
      handled: x.handled ?? 0,
      firstResponseP50Sec: x.fr_p50_sec === null ? null : Math.round(Number(x.fr_p50_sec)),
      // bps of the 5-point scale so the wire carries an integer (4.6 → 9200)
      csatAvgBps: x.csat_avg === null ? null : Math.round((Number(x.csat_avg) / 5) * 10000),
      csatCount: x.csat_count ?? 0,
      reopenedCount: x.reopened ?? 0,
    }));
  }

  /**
   * The rating list — PC-56 ADMIN-2c reads it from the 0099 LEDGER instead of `support_tickets.csat_score`.
   *
   * THAT CHANGE FIXES TWO THINGS THIS METHOD PREVIOUSLY HAD TO APOLOGISE FOR:
   *   1. `ratedAt` IS NOW REAL. It used to be COALESCE(resolved_at, created_at) with a comment admitting the table had
   *      no rating timestamp, and the CSAT page had to caveat the column on screen.
   *   2. THE SAMPLE IS NO LONGER SILENTLY PRUNED. The ticket column is cleared on reopen, so every figure this method
   *      returned was computed over the ratings that happened not to be followed by a reopen — and a reopen is most
   *      likely after a BAD rating. The old numbers were biased upward and nothing said so.
   * It also carries the verbatim, which is what the canon's W056 column asked for and ADMIN-2 had to report as absent.
   */
  async csatScores(q: { fromIso: string; toIso: string; maxScore?: number; withCommentOnly?: boolean; limit: number }): Promise<Array<{
    responseId: string; ticketId: string; ticketNo: string; tenantId: string; tenantSlug: string | null;
    score: number; severity: string; categoryId: string | null; assigneeUserId: string | null;
    ratedAt: string; ratedAtIsEstimated: boolean;
    comment: string | null; commentLanguage: string | null;
    reviewCount: number; latestVerdict: string | null;
  }>> {
    const params: unknown[] = [q.fromIso, q.toIso];
    let where = `r.deleted_at IS NULL AND r.rated_at >= $1::timestamptz AND r.rated_at < $2::timestamptz`;
    if (q.maxScore !== undefined) { params.push(q.maxScore); where += ` AND r.score <= $${params.length}`; }
    if (q.withCommentOnly) { where += ` AND r.comment IS NOT NULL`; }
    params.push(q.limit);
    const r = await this.pool.query(
      `SELECT r.id AS response_id, r.ticket_id, t.ticket_no, r.tenant_id, tn.slug AS tenant_slug,
              r.score, t.severity, t.category_id,
              -- the agent AT THE TIME of the rating (copied into the ledger), not whoever holds the ticket now: a
              -- reassignment must never re-attribute somebody else rating somebody else work
              r.rated_agent_user_id,
              r.rated_at, r.rated_at_is_estimated, r.comment, r.comment_language,
              count(rv.id)::int AS review_count,
              -- the most recent verdict, so the queue can show what has already been judged without a second query
              (SELECT rv2.verdict FROM support_csat_reviews rv2
                WHERE rv2.response_id = r.id AND rv2.deleted_at IS NULL
                ORDER BY rv2.reviewed_at DESC LIMIT 1) AS latest_verdict
         FROM support_csat_responses r
         JOIN support_tickets t ON t.id = r.ticket_id
         LEFT JOIN tenants tn ON tn.id = r.tenant_id
         LEFT JOIN support_csat_reviews rv ON rv.response_id = r.id AND rv.deleted_at IS NULL
        WHERE ${where}
        GROUP BY r.id, t.ticket_no, t.severity, t.category_id
        ORDER BY r.score, r.rated_at DESC
        LIMIT $${params.length}`, params);
    return r.rows.map((x: any) => ({
      responseId: x.response_id, ticketId: x.ticket_id, ticketNo: x.ticket_no,
      tenantId: x.tenant_id, tenantSlug: x.tenant_slug ?? null,
      score: Number(x.score), severity: x.severity, categoryId: x.category_id ?? null,
      assigneeUserId: x.rated_agent_user_id ?? null,
      ratedAt: x.rated_at?.toISOString?.() ?? String(x.rated_at),
      // a backfilled row (0099) has a DERIVED timestamp; the screen must say so rather than presenting it as recorded
      ratedAtIsEstimated: x.rated_at_is_estimated === true,
      comment: x.comment ?? null, commentLanguage: x.comment_language ?? null,
      reviewCount: x.review_count ?? 0, latestVerdict: x.latest_verdict ?? null,
    }));
  }

  /** CSAT distribution (1..5) for the window — the headline beside the review queue. Counts only, so a caller cannot
   *  render an average without also seeing how thin the sample is.
   *
   *  PC-56 ADMIN-2c: reads the 0099 ledger and WINDOWS ON rated_at rather than the ticket's created_at. The old query
   *  bucketed a rating by when the TICKET was opened, so a ticket opened in March and rated in April counted as March —
   *  which makes a month's satisfaction figure depend on how long tickets took to close. */
  async csatDistribution(fromIso: string, toIso: string): Promise<Array<{ score: number; n: number }>> {
    const r = await this.pool.query(
      `SELECT score, count(*)::int AS n
         FROM support_csat_responses
        WHERE deleted_at IS NULL
          AND rated_at >= $1::timestamptz AND rated_at < $2::timestamptz
        GROUP BY 1 ORDER BY 1`, [fromIso, toIso]);
    return r.rows.map((x: any) => ({ score: Number(x.score), n: x.n }));
  }

  /* ---------------- support macros (0096 · canon W053) ---------------- */
  /** The macro list with its per-language bodies, 30-day usage and the CSAT of tickets it was used on. The usage count
   *  is a COUNT over a window (0096 records one row per use) rather than a lifetime counter that can only grow. */
  async listMacros(limit = 100): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT m.id, m.slug, m.title, m.category_id, m.is_active, m.notes, m.created_at,
              COALESCE(b.langs, '{}') AS langs,
              COALESCE(u.uses_30d, 0)::int AS uses_30d,
              u.csat_avg
         FROM support_macros m
         LEFT JOIN (
           SELECT macro_id, array_agg(language_code ORDER BY language_code) AS langs
             FROM support_macro_bodies WHERE deleted_at IS NULL GROUP BY macro_id
         ) b ON b.macro_id = m.id
         LEFT JOIN (
           SELECT mu.macro_id, count(*) AS uses_30d,
                  avg(t.csat_score) FILTER (WHERE t.csat_score IS NOT NULL) AS csat_avg
             FROM support_macro_uses mu
             JOIN support_tickets t ON t.id = mu.ticket_id
            WHERE mu.used_at >= now() - interval '30 days' AND mu.deleted_at IS NULL
            GROUP BY 1
         ) u ON u.macro_id = m.id
        WHERE m.deleted_at IS NULL
        ORDER BY m.slug
        LIMIT $1`, [limit]);
    return r.rows.map((x: any) => ({
      id: x.id, slug: x.slug, title: x.title, categoryId: x.category_id ?? null,
      isActive: x.is_active === true, notes: x.notes ?? null,
      languages: x.langs ?? [],
      uses30d: x.uses_30d ?? 0,
      // NULL when no rated ticket used it — never 0, which would read as "everyone hated it"
      csatAfterUseBps: x.csat_avg === null ? null : Math.round((Number(x.csat_avg) / 5) * 10000),
      createdAt: x.created_at ?? null,
    }));
  }

  async macroBodies(macroId: string): Promise<Array<{ languageCode: string; body: string }>> {
    const r = await this.pool.query(
      `SELECT language_code, body FROM support_macro_bodies
        WHERE macro_id=$1 AND deleted_at IS NULL ORDER BY language_code`, [macroId]);
    return r.rows.map((x: any) => ({ languageCode: x.language_code, body: x.body }));
  }

  async slugTaken(client: PoolClient, slug: string): Promise<boolean> {
    const r = await client.query(`SELECT 1 FROM support_macros WHERE slug=$1`, [slug]);
    return (r.rowCount ?? 0) > 0;
  }

  async insertMacro(client: PoolClient, m: {
    id: string; slug: string; title: string; categoryId: string | null; notes: string | null;
    bodies: Array<{ languageCode: string; body: string }>; actorUserId: string;
  }): Promise<void> {
    await client.query(
      `INSERT INTO support_macros (id, slug, title, category_id, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6)`,
      [m.id, m.slug, m.title, m.categoryId, m.notes, m.actorUserId]);
    for (const b of m.bodies) {
      await client.query(
        `INSERT INTO support_macro_bodies (macro_id, language_code, body, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$4)`, [m.id, b.languageCode, b.body, m.actorUserId]);
    }
  }

  /** Archive or restore. Never a DELETE: a macro used on a ticket must stay readable, or that ticket's history becomes
   *  a reply nobody can account for. */
  async setMacroActive(client: PoolClient, id: string, active: boolean, actorUserId: string): Promise<boolean> {
    const r = await client.query(
      `UPDATE support_macros SET is_active=$2, updated_by=$3, updated_at=now()
        WHERE id=$1 AND deleted_at IS NULL`, [id, active, actorUserId]);
    return (r.rowCount ?? 0) > 0;
  }

  /* ================= PC-56 ADMIN-2b · support policy (0097) + escalation ledger (0098) ================= */

  /** The ACTIVE policy with its SLAs and chain. Null when none is published — a real state the console reports rather
   *  than defaulting, because a platform with no published policy has not decided who to page. */
  async activePolicy(): Promise<{ policy: Record<string, unknown>; slas: Array<Record<string, unknown>>; escalations: Array<Record<string, unknown>> } | null> {
    const p = await this.pool.query(
      `SELECT id, version, name, is_active, effective_from::text AS effective_from,
              open_hour_ist, close_hour_ist, after_hours_severities, routing_strategy, desk_languages,
              ai_assist_mode, ai_excluded_severities, notes, created_at
         FROM support_policies WHERE is_active AND deleted_at IS NULL LIMIT 1`);
    if (!p.rows[0]) return null;
    const id = p.rows[0].id;
    const [slas, esc] = await Promise.all([
      this.pool.query(
        `SELECT severity, first_response_minutes, resolution_minutes
           FROM support_policy_slas WHERE policy_id=$1 AND deleted_at IS NULL
          ORDER BY severity`, [id]),
      this.pool.query(
        `SELECT severity, after_minutes, channel::text AS channel, target_role, notes
           FROM support_policy_escalations WHERE policy_id=$1 AND deleted_at IS NULL
          ORDER BY severity, after_minutes`, [id]),
    ]);
    const x = p.rows[0];
    return {
      policy: {
        id: x.id, version: x.version, name: x.name, isActive: x.is_active === true,
        effectiveFrom: x.effective_from, openHourIst: x.open_hour_ist, closeHourIst: x.close_hour_ist,
        afterHoursSeverities: x.after_hours_severities ?? [], routingStrategy: x.routing_strategy,
        deskLanguages: x.desk_languages ?? [], aiAssistMode: x.ai_assist_mode,
        aiExcludedSeverities: x.ai_excluded_severities ?? [], notes: x.notes ?? null, createdAt: x.created_at ?? null,
      },
      slas: slas.rows.map((r: any) => ({
        severity: r.severity, firstResponseMinutes: r.first_response_minutes, resolutionMinutes: r.resolution_minutes,
      })),
      escalations: esc.rows.map((r: any) => ({
        severity: r.severity, afterMinutes: r.after_minutes, channel: r.channel,
        targetRole: r.target_role, notes: r.notes ?? null,
      })),
    };
  }

  async listPolicyVersions(limit = 30): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT id, version, name, is_active, effective_from::text AS effective_from, created_at
         FROM support_policies WHERE deleted_at IS NULL ORDER BY version DESC LIMIT $1`, [limit]);
    return r.rows.map((x: any) => ({
      id: x.id, version: x.version, name: x.name, isActive: x.is_active === true,
      effectiveFrom: x.effective_from, createdAt: x.created_at ?? null,
    }));
  }

  async nextPolicyVersion(client: PoolClient): Promise<number> {
    const r = await client.query(`SELECT COALESCE(MAX(version), 0) + 1 AS v FROM support_policies`);
    return Number(r.rows[0].v);
  }

  /** Publish a new version and retire the old one, in ONE transaction — there is never a moment with two active
   *  policies (the 0097 partial unique index would refuse it) nor a moment with none. */
  async insertPolicy(client: PoolClient, p: {
    id: string; version: number; actorUserId: string;
    policy: {
      name: string; effectiveFrom: string; openHourIst: number; closeHourIst: number;
      afterHoursSeverities: string[]; routingStrategy: string; deskLanguages: string[];
      aiAssistMode: string; aiExcludedSeverities: string[]; notes: string | null;
      slas: Array<{ severity: string; firstResponseMinutes: number; resolutionMinutes: number }>;
      escalations: Array<{ severity: string; afterMinutes: number; channel: string; targetRole: string; notes: string | null }>;
    };
  }): Promise<void> {
    const v = p.policy;
    await client.query(`UPDATE support_policies SET is_active=false, updated_at=now(), updated_by=$1 WHERE is_active`, [p.actorUserId]);
    await client.query(
      `INSERT INTO support_policies
         (id, version, name, is_active, effective_from, open_hour_ist, close_hour_ist, after_hours_severities,
          routing_strategy, desk_languages, ai_assist_mode, ai_excluded_severities, notes, created_by, updated_by)
       VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
      [p.id, p.version, v.name, v.effectiveFrom, v.openHourIst, v.closeHourIst, v.afterHoursSeverities,
       v.routingStrategy, v.deskLanguages, v.aiAssistMode, v.aiExcludedSeverities, v.notes, p.actorUserId]);
    for (const s of v.slas) {
      await client.query(
        `INSERT INTO support_policy_slas (policy_id, severity, first_response_minutes, resolution_minutes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$5)`, [p.id, s.severity, s.firstResponseMinutes, s.resolutionMinutes, p.actorUserId]);
    }
    for (const e of v.escalations) {
      await client.query(
        `INSERT INTO support_policy_escalations (policy_id, severity, after_minutes, channel, target_role, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4::support_escalation_channel,$5,$6,$7,$7)`,
        [p.id, e.severity, e.afterMinutes, e.channel, e.targetRole, e.notes, p.actorUserId]);
    }
  }

  /** What the chain ACTUALLY did lately — the answer to "was the support head really rung about TKT-8812?". */
  async recentEscalationEvents(limit = 50): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT e.id, e.ticket_id, t.ticket_no, e.severity, e.after_minutes, e.channel::text AS channel,
              e.target_role, e.breach_kind, e.breached_at, e.fired_at, e.status::text AS status, e.detail
         FROM support_escalation_events e
         LEFT JOIN support_tickets t ON t.id = e.ticket_id
        WHERE e.deleted_at IS NULL
        ORDER BY e.fired_at DESC LIMIT $1`, [limit]).catch(() => ({ rows: [] as any[] }));
    return r.rows.map((x: any) => ({
      id: x.id, ticketId: x.ticket_id, ticketNo: x.ticket_no ?? null, severity: x.severity,
      afterMinutes: x.after_minutes, channel: x.channel, targetRole: x.target_role,
      breachKind: x.breach_kind, breachedAt: x.breached_at, firedAt: x.fired_at,
      status: x.status, detail: x.detail ?? null,
    }));
  }

  /* ---------------- ticket counts by status (canon W005 chips) ---------------- */
  /** Cross-tenant counts per status, for the queue's filter chips. ONE grouped query rather than a count per chip —
   *  seven round trips for a header is how a NOC page becomes slow at exactly the moment it is needed. */
  async ticketCountsByStatus(): Promise<Record<string, number>> {
    const r = await this.pool.query(
      `SELECT status::text AS status, count(*)::int AS n
         FROM support_tickets WHERE deleted_at IS NULL GROUP BY 1`);
    const out: Record<string, number> = {};
    for (const x of r.rows as any[]) out[x.status] = x.n;
    return out;
  }

  /** Resolve an oversight ticket. The state machine decides legality; this writes the outcome and the timestamp. */
  async resolveTicket(client: PoolClient, id: string, status: string, actorUserId: string): Promise<void> {
    await client.query(
      `UPDATE support_tickets
          SET status=$2::ticket_status, resolved_at=now(), updated_by=$3, updated_at=now()
        WHERE id=$1`, [id, status, actorUserId]);
  }

  /* ---------------- CSAT reviews + coaching (0099 / 0100 · canon W2019-25, W2121-25) ---------------- */

  /** One rating with everything a lead needs to judge it: the words, the ticket, the agent, and what has already been
   *  concluded about it. Null when the rating does not exist — the caller turns that into a 404. */
  async csatResponse(id: string): Promise<Record<string, unknown> | null> {
    const r = await this.pool.query(
      `SELECT r.id, r.ticket_id, t.ticket_no, t.subject, t.severity, t.status AS ticket_status_now,
              r.tenant_id, tn.slug AS tenant_slug, r.score, r.comment, r.comment_language,
              r.rated_at, r.rated_at_is_estimated, r.ticket_status AS status_when_rated,
              r.rated_agent_user_id, r.respondent_user_id
         FROM support_csat_responses r
         JOIN support_tickets t ON t.id = r.ticket_id
         LEFT JOIN tenants tn ON tn.id = r.tenant_id
        WHERE r.id = $1 AND r.deleted_at IS NULL`, [id]);
    const x = r.rows[0] as any;
    if (!x) return null;
    return {
      id: x.id, ticketId: x.ticket_id, ticketNo: x.ticket_no, subject: x.subject, severity: x.severity,
      ticketStatusNow: x.ticket_status_now, tenantId: x.tenant_id, tenantSlug: x.tenant_slug ?? null,
      score: Number(x.score), comment: x.comment ?? null, commentLanguage: x.comment_language ?? null,
      ratedAt: x.rated_at?.toISOString?.() ?? String(x.rated_at),
      ratedAtIsEstimated: x.rated_at_is_estimated === true,
      // the status when rated vs now: a 1 given on a resolved ticket that has since been reopened tells a different
      // story from a 1 on a ticket nobody touched again
      statusWhenRated: x.status_when_rated,
      ratedAgentUserId: x.rated_agent_user_id ?? null, respondentUserId: x.respondent_user_id ?? null,
    };
  }

  /** Every rating a ticket has ever had. The question 0099 made askable: before it, a reopen deleted the previous one. */
  async csatHistoryForTicket(ticketId: string): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT id, score, comment, comment_language, rated_at, rated_at_is_estimated, ticket_status
         FROM support_csat_responses
        WHERE ticket_id = $1 AND deleted_at IS NULL
        ORDER BY rated_at DESC, id DESC LIMIT 50`, [ticketId]);
    return r.rows.map((x: any) => ({
      id: x.id, score: Number(x.score), comment: x.comment ?? null, commentLanguage: x.comment_language ?? null,
      ratedAt: x.rated_at?.toISOString?.() ?? String(x.rated_at),
      ratedAtIsEstimated: x.rated_at_is_estimated === true, ticketStatus: x.ticket_status,
    }));
  }

  /** The reviews filed against one rating, newest first. */
  async csatReviewsFor(responseId: string): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT id, reviewer_admin_id, verdict, finding, coaching_id, reviewed_at
         FROM support_csat_reviews
        WHERE response_id = $1 AND deleted_at IS NULL
        ORDER BY reviewed_at DESC LIMIT 50`, [responseId]);
    return r.rows.map((x: any) => ({
      id: x.id, reviewerAdminId: x.reviewer_admin_id, verdict: x.verdict, finding: x.finding,
      coachingId: x.coaching_id ?? null,
      reviewedAt: x.reviewed_at?.toISOString?.() ?? String(x.reviewed_at),
    }));
  }

  /** File a verdict. Runs in the caller's transaction so the review and its audit row land together (Law 4).
   *  ON CONFLICT DO NOTHING against uq_csat_review_verdict — a double submit is not two judgements. */
  async insertCsatReview(tx: PoolClient, p: {
    responseId: string; reviewerAdminId: string; verdict: string; finding: string;
  }): Promise<{ id: string } | null> {
    const r = await tx.query(
      `INSERT INTO support_csat_reviews (response_id, reviewer_admin_id, verdict, finding, created_by)
       VALUES ($1,$2,$3,$4,$2) ON CONFLICT DO NOTHING RETURNING id`,
      [p.responseId, p.reviewerAdminId, p.verdict, p.finding]);
    const row = r.rows[0] as { id: string } | undefined;
    return row ? { id: row.id } : null;
  }

  /** VERDICT COUNTS for the window — "how many low scores were actually the desk's fault?" answered from data.
   *  Returns rows only for verdicts that occurred; the caller must not render a zero for one that did not, because
   *  "nobody concluded this" and "concluded zero times" are the same number and different facts only in aggregate. */
  async csatVerdictCounts(fromIso: string, toIso: string): Promise<Array<{ verdict: string; n: number }>> {
    const r = await this.pool.query(
      `SELECT rv.verdict, count(*)::int AS n
         FROM support_csat_reviews rv
        WHERE rv.deleted_at IS NULL
          AND rv.reviewed_at >= $1::timestamptz AND rv.reviewed_at < $2::timestamptz
        GROUP BY 1 ORDER BY 2 DESC`, [fromIso, toIso]);
    return r.rows.map((x: any) => ({ verdict: x.verdict, n: x.n }));
  }

  /** RATINGS AWAITING A JUDGEMENT — the review queue's actual backlog, which is not "all low scores" but "low scores
   *  nobody has looked at". Keyset by (rated_at, id) so the queue pages without repeating or skipping a rating. */
  async csatAwaitingReview(q: { maxScore: number; cursor?: { at: string; id: string }; limit: number }): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [q.maxScore];
    let where = `r.deleted_at IS NULL AND r.score <= $1
                 AND NOT EXISTS (SELECT 1 FROM support_csat_reviews rv WHERE rv.response_id = r.id AND rv.deleted_at IS NULL)`;
    if (q.cursor) {
      params.push(q.cursor.at, q.cursor.id);
      where += ` AND (r.rated_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    params.push(q.limit);
    const r = await this.pool.query(
      `SELECT r.id, r.ticket_id, t.ticket_no, r.tenant_id, tn.slug AS tenant_slug, r.score,
              r.comment, r.comment_language, r.rated_at, r.rated_at_is_estimated, r.rated_agent_user_id
         FROM support_csat_responses r
         JOIN support_tickets t ON t.id = r.ticket_id
         LEFT JOIN tenants tn ON tn.id = r.tenant_id
        WHERE ${where}
        ORDER BY r.rated_at DESC, r.id DESC
        LIMIT $${params.length}`, params);
    return r.rows.map((x: any) => ({
      id: x.id, ticketId: x.ticket_id, ticketNo: x.ticket_no, tenantId: x.tenant_id,
      tenantSlug: x.tenant_slug ?? null, score: Number(x.score),
      comment: x.comment ?? null, commentLanguage: x.comment_language ?? null,
      ratedAt: x.rated_at?.toISOString?.() ?? String(x.rated_at),
      ratedAtIsEstimated: x.rated_at_is_estimated === true,
      agentUserId: x.rated_agent_user_id ?? null,
    }));
  }

  /* ---------------- coaching (0100) ---------------- */

  /** Coaching records, newest first, optionally for one agent. Includes dismissals: a record of the judgements NOT to
   *  intervene is half the point — without them the ledger reads as a lead who ignores signals. */
  async listCoaching(q: { agentUserId?: string; tenantId?: string; limit: number }): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [];
    const conds = ['c.deleted_at IS NULL'];
    if (q.agentUserId) { params.push(q.agentUserId); conds.push(`c.agent_user_id = $${params.length}`); }
    if (q.tenantId) { params.push(q.tenantId); conds.push(`c.tenant_id = $${params.length}`); }
    params.push(q.limit);
    const r = await this.pool.query(
      `SELECT c.id, c.tenant_id, tn.slug AS tenant_slug, c.agent_user_id, c.author_admin_id,
              c.kind::text AS kind, c.status::text AS status, c.rationale, c.signal_note,
              c.csat_response_id, c.csat_review_id, c.scheduled_for, c.held_at, c.outcome, c.created_at,
              cr.score AS signal_score, cr.comment AS signal_comment
         FROM support_coaching_records c
         LEFT JOIN tenants tn ON tn.id = c.tenant_id
         LEFT JOIN support_csat_responses cr ON cr.id = c.csat_response_id
        WHERE ${conds.join(' AND ')}
        ORDER BY c.created_at DESC
        LIMIT $${params.length}`, params);
    return r.rows.map((x: any) => ({
      id: x.id, tenantId: x.tenant_id, tenantSlug: x.tenant_slug ?? null,
      agentUserId: x.agent_user_id, authorAdminId: x.author_admin_id,
      kind: x.kind, status: x.status, rationale: x.rationale, signalNote: x.signal_note ?? null,
      csatResponseId: x.csat_response_id ?? null, csatReviewId: x.csat_review_id ?? null,
      scheduledFor: x.scheduled_for?.toISOString?.() ?? (x.scheduled_for ? String(x.scheduled_for) : null),
      heldAt: x.held_at?.toISOString?.() ?? (x.held_at ? String(x.held_at) : null),
      outcome: x.outcome ?? null,
      createdAt: x.created_at?.toISOString?.() ?? String(x.created_at),
      signalScore: x.signal_score === null || x.signal_score === undefined ? null : Number(x.signal_score),
      signalComment: x.signal_comment ?? null,
    }));
  }

  /** Create a coaching record. In the caller's transaction, with its audit row (Law 4). */
  async insertCoaching(tx: PoolClient, p: {
    tenantId: string; agentUserId: string; authorAdminId: string; kind: string; status: string;
    rationale: string; signalNote: string | null; csatResponseId: string | null; csatReviewId: string | null;
    scheduledFor: string | null;
  }): Promise<{ id: string }> {
    const r = await tx.query(
      `INSERT INTO support_coaching_records
         (tenant_id, agent_user_id, author_admin_id, kind, status, rationale, signal_note,
          csat_response_id, csat_review_id, scheduled_for, created_by)
       VALUES ($1,$2,$3,$4::support_coaching_kind,$5::support_coaching_status,$6,$7,$8,$9,$10,$3)
       RETURNING id`,
      [p.tenantId, p.agentUserId, p.authorAdminId, p.kind, p.status, p.rationale, p.signalNote,
       p.csatResponseId, p.csatReviewId, p.scheduledFor]);
    return { id: (r.rows[0] as any).id };
  }

  /** Point a review at the coaching it produced, so the two cannot disagree about whether anybody followed up. */
  async linkReviewCoaching(tx: PoolClient, reviewId: string, coachingId: string): Promise<void> {
    await tx.query(
      `UPDATE support_csat_reviews SET coaching_id = $2, updated_at = now()
        WHERE id = $1 AND coaching_id IS NULL AND deleted_at IS NULL`, [reviewId, coachingId]);
  }

  /** One coaching record, for the close path's state check. */
  async coachingById(id: string): Promise<Record<string, unknown> | null> {
    const r = await this.pool.query(
      `SELECT id, kind::text AS kind, status::text AS status, outcome, scheduled_for, agent_user_id, tenant_id
         FROM support_coaching_records WHERE id = $1 AND deleted_at IS NULL`, [id]);
    const x = r.rows[0] as any;
    return x ? {
      id: x.id, kind: x.kind, status: x.status, outcome: x.outcome ?? null,
      scheduledFor: x.scheduled_for?.toISOString?.() ?? (x.scheduled_for ? String(x.scheduled_for) : null),
      agentUserId: x.agent_user_id, tenantId: x.tenant_id,
    } : null;
  }

  /**
   * Record what happened to a scheduled session. The ONLY update this table allows, and it is guarded on the row still
   * being `scheduled` — so two leads closing the same session cannot overwrite each other's account of it, and an
   * outcome can never be rewritten once filed (0100's header, point 2).
   */
  async settleCoaching(tx: PoolClient, p: { id: string; status: string; outcome: string | null; heldAt: string | null }): Promise<number> {
    const r = await tx.query(
      `UPDATE support_coaching_records
          SET status = $2::support_coaching_status, outcome = COALESCE($3, outcome), held_at = $4, updated_at = now()
        WHERE id = $1 AND status = 'scheduled' AND deleted_at IS NULL`,
      [p.id, p.status, p.outcome, p.heldAt]);
    return r.rowCount ?? 0;
  }

  /** Coaching COUNTS per agent for the window, for the performance screen's "has anybody acted on this?" column. */
  async coachingCountsByAgent(fromIso: string, toIso: string): Promise<Array<{ agentUserId: string; sessions: number; dismissals: number }>> {
    const r = await this.pool.query(
      `SELECT agent_user_id,
              count(*) FILTER (WHERE kind <> 'signal_dismissed')::int AS sessions,
              count(*) FILTER (WHERE kind = 'signal_dismissed')::int AS dismissals
         FROM support_coaching_records
        WHERE deleted_at IS NULL
          AND created_at >= $1::timestamptz AND created_at < $2::timestamptz
        GROUP BY 1`, [fromIso, toIso]);
    return r.rows.map((x: any) => ({ agentUserId: x.agent_user_id, sessions: x.sessions, dismissals: x.dismissals }));
  }

  /* ---------------- exports (PC-56 ADMIN-2c · canon W1944-45, W2121-22, W2270-71) ---------------- */
  // Each returns rows keyed EXACTLY as domain/support-export.ts declares its columns. A mismatch would render an empty
  // column rather than failing loudly, so the export spec asserts the two agree per report.

  async exportTickets(q: { from: string; to: string; tenantId?: string; limit: number }): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [q.from, q.to];
    let where = `t.deleted_at IS NULL AND t.created_at >= $1::timestamptz AND t.created_at < $2::timestamptz`;
    if (q.tenantId) { params.push(q.tenantId); where += ` AND t.tenant_id = $${params.length}`; }
    params.push(q.limit);
    const r = await this.pool.query(
      `SELECT t.ticket_no, tn.slug AS tenant_slug, t.severity, t.status,
              CASE
                WHEN t.resolved_at IS NULL AND t.sla_resolution_due < now() THEN 'breached'
                WHEN t.first_responded_at IS NULL AND t.sla_first_response_due < now() THEN 'breached'
                ELSE 'within'
              END AS sla,
              t.created_at, t.first_responded_at, t.resolved_at
         FROM support_tickets t
         LEFT JOIN tenants tn ON tn.id = t.tenant_id
        WHERE ${where}
        ORDER BY t.created_at DESC
        LIMIT $${params.length}`, params);
    return r.rows.map((x: any) => ({
      ticketNo: x.ticket_no, tenantSlug: x.tenant_slug ?? null, severity: x.severity, status: x.status, sla: x.sla,
      createdAt: iso(x.created_at), firstRespondedAt: iso(x.first_responded_at), resolvedAt: iso(x.resolved_at),
    }));
  }

  /** Breaches with the TARGET beside the overrun. A tenant may read this in an argument about a missed promise, and an
   *  overrun with no target next to it is a number nobody can check. */
  async exportSlaBreaches(q: { from: string; to: string; tenantId?: string; limit: number }): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [q.from, q.to];
    let scope = `t.deleted_at IS NULL AND t.created_at >= $1::timestamptz AND t.created_at < $2::timestamptz`;
    if (q.tenantId) { params.push(q.tenantId); scope += ` AND t.tenant_id = $${params.length}`; }
    params.push(q.limit);
    const r = await this.pool.query(
      `WITH b AS (
         SELECT t.ticket_no, t.tenant_id, t.severity, t.status, t.created_at,
                'first_response' AS breach_kind, t.sla_first_response_due AS due_at,
                EXTRACT(EPOCH FROM (COALESCE(t.first_responded_at, now()) - t.sla_first_response_due))::int / 60 AS overdue_minutes
           FROM support_tickets t
          WHERE ${scope} AND t.sla_first_response_due IS NOT NULL
            AND (t.first_responded_at IS NULL OR t.first_responded_at > t.sla_first_response_due)
            AND t.sla_first_response_due < now()
         UNION ALL
         SELECT t.ticket_no, t.tenant_id, t.severity, t.status, t.created_at,
                'resolution', t.sla_resolution_due,
                EXTRACT(EPOCH FROM (COALESCE(t.resolved_at, now()) - t.sla_resolution_due))::int / 60
           FROM support_tickets t
          WHERE ${scope} AND t.sla_resolution_due IS NOT NULL
            AND (t.resolved_at IS NULL OR t.resolved_at > t.sla_resolution_due)
            AND t.sla_resolution_due < now()
       )
       SELECT b.*, tn.slug AS tenant_slug
         FROM b LEFT JOIN tenants tn ON tn.id = b.tenant_id
        ORDER BY b.overdue_minutes DESC
        LIMIT $${params.length}`, params);
    return r.rows.map((x: any) => ({
      ticketNo: x.ticket_no, tenantSlug: x.tenant_slug ?? null, severity: x.severity, status: x.status,
      breachKind: x.breach_kind, dueAt: iso(x.due_at), overdueMinutes: Number(x.overdue_minutes),
      createdAt: iso(x.created_at),
    }));
  }

  /** CSAT rows from the 0099 ledger. `withComment` splits the two reports: scores-without-words and words-without-the-
   *  person-who-wrote-them (the asymmetry is deliberate — see domain/support-export.ts). */
  async exportCsat(q: { from: string; to: string; tenantId?: string; maxScore?: number; withComment: boolean; limit: number }): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [q.from, q.to];
    let where = `r.deleted_at IS NULL AND r.rated_at >= $1::timestamptz AND r.rated_at < $2::timestamptz`;
    if (q.tenantId) { params.push(q.tenantId); where += ` AND r.tenant_id = $${params.length}`; }
    if (q.maxScore !== undefined) { params.push(q.maxScore); where += ` AND r.score <= $${params.length}`; }
    if (q.withComment) where += ` AND r.comment IS NOT NULL`;
    params.push(q.limit);
    const r = await this.pool.query(
      `SELECT t.ticket_no, tn.slug AS tenant_slug, r.score, r.rated_at, r.rated_at_is_estimated,
              t.severity, r.rated_agent_user_id, r.comment, r.comment_language,
              (SELECT count(*)::int FROM support_csat_reviews rv WHERE rv.response_id = r.id AND rv.deleted_at IS NULL) AS review_count,
              (SELECT rv2.verdict FROM support_csat_reviews rv2 WHERE rv2.response_id = r.id AND rv2.deleted_at IS NULL
                ORDER BY rv2.reviewed_at DESC LIMIT 1) AS latest_verdict
         FROM support_csat_responses r
         JOIN support_tickets t ON t.id = r.ticket_id
         LEFT JOIN tenants tn ON tn.id = r.tenant_id
        WHERE ${where}
        ORDER BY r.rated_at DESC
        LIMIT $${params.length}`, params);
    return r.rows.map((x: any) => ({
      ticketNo: x.ticket_no, tenantSlug: x.tenant_slug ?? null, score: Number(x.score),
      ratedAt: iso(x.rated_at),
      // exported as a real column, not a footnote: a backfilled timestamp (0099) is derived, and a spreadsheet has no
      // room for a caveat that lives only on a screen
      ratedAtIsEstimated: x.rated_at_is_estimated === true,
      severity: x.severity, agentUserId: x.rated_agent_user_id ?? null,
      comment: x.comment ?? null, commentLanguage: x.comment_language ?? null,
      reviewCount: x.review_count ?? 0, latestVerdict: x.latest_verdict ?? null,
    }));
  }

  /** The platform's own verdicts. The reviewer IS named: the platform is accountable for its judgements, and an
   *  anonymous verdict about somebody's work is exactly what the rest of this wave refuses. */
  async exportCsatReviews(q: { from: string; to: string; tenantId?: string; limit: number }): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [q.from, q.to];
    let where = `rv.deleted_at IS NULL AND rv.reviewed_at >= $1::timestamptz AND rv.reviewed_at < $2::timestamptz`;
    if (q.tenantId) { params.push(q.tenantId); where += ` AND r.tenant_id = $${params.length}`; }
    params.push(q.limit);
    const r = await this.pool.query(
      `SELECT t.ticket_no, tn.slug AS tenant_slug, r.score, rv.verdict, rv.finding,
              rv.reviewer_admin_id, rv.reviewed_at, (rv.coaching_id IS NOT NULL) AS coaching_created
         FROM support_csat_reviews rv
         JOIN support_csat_responses r ON r.id = rv.response_id
         JOIN support_tickets t ON t.id = r.ticket_id
         LEFT JOIN tenants tn ON tn.id = r.tenant_id
        WHERE ${where}
        ORDER BY rv.reviewed_at DESC
        LIMIT $${params.length}`, params);
    return r.rows.map((x: any) => ({
      ticketNo: x.ticket_no, tenantSlug: x.tenant_slug ?? null, score: Number(x.score),
      verdict: x.verdict, finding: x.finding, reviewerAdminId: x.reviewer_admin_id,
      reviewedAt: iso(x.reviewed_at), coachingCreated: x.coaching_created === true,
    }));
  }
}
