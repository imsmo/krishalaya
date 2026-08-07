// apps/admin-api/src/modules/trust-safety/repositories/trust-safety.repository.ts · ALL SQL for the T&S plane.
//
// EVERY READ HERE IS CROSS-TENANT AND CARRIES NO TENANT PREDICATE. That is the opposite of Law 1 and it is correct
// twice over: `platform_blocklists`, `risk_rules` and `appeals` have no tenant_id at all (0067 — a blocked device is
// blocked everywhere), and the moderation/risk reads are god-mode by definition (Law 11) because a fraud ring's whole
// method is to operate across tenants. Stated at the top so the absence of `tenant_id = $1` reads as a decision
// rather than an omission — which is the one thing that would make it dangerous.
//
// NONE OF THESE QUERIES COULD RUN BEFORE MIGRATION 0110. kv_admin — the role this pool connects as, and the role
// 0067's own header names as sole operator — had no grant on any of the three tables. Every SELECT below would have
// returned 42501.
//
// No `SELECT *`. Person-fields are joined only where a screen masks them (risk profiles), never on the boards.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import type { BlocklistRow, BlockStatus, IdentifierType } from '../domain/blocklist';
import type { RiskRuleRow } from '../domain/risk-rules';
import type { RiskScoreRow } from '../domain/risk-profile';

const BL_COLS = `id, identifier_type, identifier_hash, origin_ref, reason, expires_at, review_at, attempts_blocked,
  status, audit_note, created_by, created_at, checked_by, checked_at, lifted_at, lifted_by, lift_reason`;

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

function toBlock(r: any): BlocklistRow {
  return {
    id: r.id, identifierType: r.identifier_type, identifierHash: r.identifier_hash,
    originRef: r.origin_ref ?? null, reason: r.reason,
    expiresAt: iso(r.expires_at), reviewAt: iso(r.review_at),
    attemptsBlocked: r.attempts_blocked === null || r.attempts_blocked === undefined ? null : Number(r.attempts_blocked),
    status: r.status, auditNote: r.audit_note,
    createdBy: r.created_by ?? null, createdAt: new Date(r.created_at).toISOString(),
    checkedBy: r.checked_by ?? null, checkedAt: iso(r.checked_at),
    liftedAt: iso(r.lifted_at), liftedBy: r.lifted_by ?? null, liftReason: r.lift_reason ?? null,
  };
}

function toRule(r: any): RiskRuleRow {
  return {
    eventCode: r.event_code, weight: Number(r.weight), notes: r.notes ?? null, isActive: r.is_active === true,
    proposedWeight: r.proposed_weight === null || r.proposed_weight === undefined ? null : Number(r.proposed_weight),
    proposedBy: r.proposed_by ?? null, proposedAt: iso(r.proposed_at),
    checkedBy: r.checked_by ?? null, checkedAt: iso(r.checked_at),
    dryRunAt: iso(r.dry_run_at),
    dryRunBandDrops: r.dry_run_band_drops === null || r.dry_run_band_drops === undefined ? null : Number(r.dry_run_band_drops),
    dryRunNewRestricted: r.dry_run_new_restricted === null || r.dry_run_new_restricted === undefined ? null : Number(r.dry_run_new_restricted),
    dryRunPopulation: r.dry_run_population === null || r.dry_run_population === undefined ? null : Number(r.dry_run_population),
  };
}

@Injectable()
export class TrustSafetyRepository {
  constructor(private readonly pool: AdminPool) {}

  /* ============================ BLOCKLIST (W096) ============================ */

  /** Keyset over (created_at, id) — the canon's "Added ▾" ordering, and stable under insertion, which an OFFSET
   *  pager is not: a block added while somebody is on page 2 silently shifts a row onto page 3 unseen. */
  async listBlocks(q: { type?: IdentifierType; status?: string; cursor?: { c: string; id: string }; limit: number }): Promise<BlocklistRow[]> {
    const w: string[] = ['deleted_at IS NULL'];
    const p: unknown[] = [];
    if (q.type) { p.push(q.type); w.push(`identifier_type = $${p.length}`); }
    if (q.status) { p.push(q.status); w.push(`status = $${p.length}`); }
    if (q.cursor) { p.push(q.cursor.c, q.cursor.id); w.push(`(created_at < $${p.length - 1} OR (created_at = $${p.length - 1} AND id < $${p.length}))`); }
    p.push(q.limit);
    const r = await this.pool.query(
      `SELECT ${BL_COLS} FROM platform_blocklists WHERE ${w.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT $${p.length}`, p);
    return r.rows.map(toBlock);
  }

  async getBlock(id: string): Promise<BlocklistRow | null> {
    const r = await this.pool.query(`SELECT ${BL_COLS} FROM platform_blocklists WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toBlock(r.rows[0]) : null;
  }

  async getBlockForUpdate(c: PoolClient, id: string): Promise<BlocklistRow | null> {
    const r = await c.query(`SELECT ${BL_COLS} FROM platform_blocklists WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toBlock(r.rows[0]) : null;
  }

  /** Counts by type, ACTIVE only — the canon's tab badges. */
  async blockTypeCounts(): Promise<{ identifierType: IdentifierType; status: BlockStatus }[]> {
    const r = await this.pool.query(
      `SELECT identifier_type, status FROM platform_blocklists WHERE deleted_at IS NULL AND status = 'active'`);
    return r.rows.map((x: any) => ({ identifierType: x.identifier_type, status: x.status }));
  }

  async insertBlock(c: PoolClient, v: {
    identifierType: IdentifierType; identifierHash: string; originRef: string | null; reason: string;
    expiresAt: Date | null; reviewAt: Date | null; auditNote: string; createdBy: string;
  }): Promise<string> {
    // ON CONFLICT on the partial unique index: re-blocking an already-active identifier is not a new row. Doing
    // nothing and reporting the existing entry is right — a second row would give the same identifier two expiry
    // dates, and lifting one would leave the other standing.
    const r = await c.query(
      `INSERT INTO platform_blocklists (identifier_type, identifier_hash, origin_ref, reason, expires_at, review_at, audit_note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (identifier_type, identifier_hash) WHERE status = 'active' DO NOTHING
       RETURNING id`,
      [v.identifierType, v.identifierHash, v.originRef, v.reason, v.expiresAt, v.reviewAt, v.auditNote, v.createdBy]);
    return r.rows[0]?.id ?? '';
  }

  async findActiveByHash(type: IdentifierType, hash: string): Promise<BlocklistRow | null> {
    const r = await this.pool.query(
      `SELECT ${BL_COLS} FROM platform_blocklists WHERE identifier_type = $1 AND identifier_hash = $2 AND status = 'active' AND deleted_at IS NULL`,
      [type, hash]);
    return r.rows[0] ? toBlock(r.rows[0]) : null;
  }

  async countersignBlock(c: PoolClient, id: string, checkedBy: string): Promise<void> {
    await c.query(
      `UPDATE platform_blocklists SET checked_by = $2, checked_at = now(), updated_by = $2 WHERE id = $1 AND deleted_at IS NULL`,
      [id, checkedBy]);
  }

  async liftBlock(c: PoolClient, id: string, by: string, reason: string): Promise<void> {
    await c.query(
      `UPDATE platform_blocklists SET status = 'lifted', lifted_at = now(), lifted_by = $2, lift_reason = $3, updated_by = $2
       WHERE id = $1 AND status <> 'lifted' AND deleted_at IS NULL`,
      [id, by, reason]);
  }

  /* ============================ RISK RULES (W095) ============================ */

  async listRules(): Promise<RiskRuleRow[]> {
    const r = await this.pool.query(
      `SELECT event_code, weight, notes, is_active, proposed_weight, proposed_by, proposed_at, checked_by, checked_at,
              dry_run_at, dry_run_band_drops, dry_run_new_restricted, dry_run_population
         FROM risk_rules WHERE deleted_at IS NULL ORDER BY event_code`);
    return r.rows.map(toRule);
  }

  async getRuleForUpdate(c: PoolClient, eventCode: string): Promise<RiskRuleRow | null> {
    const r = await c.query(
      `SELECT event_code, weight, notes, is_active, proposed_weight, proposed_by, proposed_at, checked_by, checked_at,
              dry_run_at, dry_run_band_drops, dry_run_new_restricted, dry_run_population
         FROM risk_rules WHERE event_code = $1 AND deleted_at IS NULL FOR UPDATE`, [eventCode]);
    return r.rows[0] ? toRule(r.rows[0]) : null;
  }

  async saveProposal(c: PoolClient, v: {
    eventCode: string; proposedWeight: number; proposedBy: string;
    bandDrops: number; newRestricted: number; population: number; computedAt: Date;
  }): Promise<void> {
    await c.query(
      `UPDATE risk_rules SET proposed_weight = $2, proposed_by = $3, proposed_at = now(),
              dry_run_at = $4, dry_run_band_drops = $5, dry_run_new_restricted = $6, dry_run_population = $7,
              checked_by = NULL, checked_at = NULL, updated_by = $3
         WHERE event_code = $1 AND deleted_at IS NULL`,
      [v.eventCode, v.proposedWeight, v.proposedBy, v.computedAt, v.bandDrops, v.newRestricted, v.population]);
    // checked_by is CLEARED on every new proposal: a signature approves ONE set of figures, and a re-proposal is a
    // different change. Carrying the old signature forward is how a checker's name ends up on a weight they never saw.
  }

  /** Applying a proposal: the proposed weight becomes the live one, and the proposal is retained (not cleared) so the
   *  console can show what was approved and by whom until the next proposal replaces it. */
  async applyProposal(c: PoolClient, eventCode: string, checkedBy: string): Promise<void> {
    await c.query(
      `UPDATE risk_rules SET weight = proposed_weight, checked_by = $2, checked_at = now(), updated_by = $2
         WHERE event_code = $1 AND proposed_weight IS NOT NULL AND deleted_at IS NULL`, [eventCode, checkedBy]);
  }

  async withdrawProposal(c: PoolClient, eventCode: string, by: string): Promise<void> {
    await c.query(
      `UPDATE risk_rules SET proposed_weight = NULL, proposed_by = NULL, proposed_at = NULL,
              dry_run_at = NULL, dry_run_band_drops = NULL, dry_run_new_restricted = NULL, dry_run_population = NULL,
              checked_by = NULL, checked_at = NULL, updated_by = $2
         WHERE event_code = $1 AND checked_by IS NULL AND deleted_at IS NULL`, [eventCode, by]);
  }

  /** How often each configured code has actually fired. Feeds W095's "Fired 30d" column and, more importantly,
   *  `ruleCoverage` — which is how the screen reports that three of the five rules have no producer at all. */
  async eventCounts(days: number): Promise<Map<string, number>> {
    const r = await this.pool.query(
      `SELECT event_code, count(*)::int AS n FROM risk_events
        WHERE created_at > now() - ($1 || ' days')::interval GROUP BY event_code`, [String(days)]);
    return new Map(r.rows.map((x: any) => [x.event_code, Number(x.n)]));
  }

  /* ============================ RISK BOARD + PROFILE (W093/W094) ============================ */

  async bandCensusRows(): Promise<{ band: string | null }[]> {
    const r = await this.pool.query(`SELECT band FROM risk_scores`);
    return r.rows.map((x: any) => ({ band: x.band ?? null }));
  }

  /** The denominator W093 prints its percentages against. Deliberately a separate read from the census: they measure
   *  different populations (everybody vs everybody who has been scored), and combining them in one query would make
   *  it easy to divide by the wrong one. */
  async activeUserCount(): Promise<number | null> {
    const r = await this.pool.query(`SELECT count(*)::int AS n FROM users WHERE status = 'active' AND deleted_at IS NULL`);
    const n = r.rows[0]?.n;
    return Number.isFinite(Number(n)) ? Number(n) : null;
  }

  async listByBand(q: { band?: string; cursor?: { s: number; id: string }; limit: number }): Promise<RiskScoreRow[]> {
    const w: string[] = ['1=1'];
    const p: unknown[] = [];
    if (q.band) { p.push(q.band); w.push(`rs.band = $${p.length}`); }
    if (q.cursor) { p.push(q.cursor.s, q.cursor.id); w.push(`(rs.score > $${p.length - 1} OR (rs.score = $${p.length - 1} AND rs.user_id > $${p.length}))`); }
    p.push(q.limit);
    const r = await this.pool.query(
      `SELECT rs.user_id, rs.tenant_id, rs.score, rs.band, rs.factors, rs.computed_at, u.full_name, u.phone
         FROM risk_scores rs LEFT JOIN users u ON u.id = rs.user_id
        WHERE ${w.join(' AND ')} ORDER BY rs.score ASC, rs.user_id ASC LIMIT $${p.length}`, p);
    return r.rows.map(toScore);
  }

  async getProfile(userId: string): Promise<RiskScoreRow | null> {
    const r = await this.pool.query(
      `SELECT rs.user_id, rs.tenant_id, rs.score, rs.band, rs.factors, rs.computed_at, u.full_name, u.phone
         FROM risk_scores rs LEFT JOIN users u ON u.id = rs.user_id WHERE rs.user_id = $1 LIMIT 1`, [userId]);
    return r.rows[0] ? toScore(r.rows[0]) : null;
  }

  /** The events behind one profile. Bounded and newest-first: an explanation is read from the top, and an unbounded
   *  read on a partitioned hot table is how a console query becomes an incident. */
  async userEvents(userId: string, limit: number): Promise<{ eventCode: string; weight: number; createdAt: string; referenceType: string | null }[]> {
    const r = await this.pool.query(
      `SELECT event_code, weight, created_at, reference_type FROM risk_events
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [userId, limit]);
    return r.rows.map((x: any) => ({
      eventCode: x.event_code, weight: Number(x.weight),
      createdAt: new Date(x.created_at).toISOString(), referenceType: x.reference_type ?? null,
    }));
  }

  async setBand(c: PoolClient, userId: string, band: string, actor: string): Promise<void> {
    // Only the band moves. The SCORE is not touched: it is the output of a computation, and a hand-edited score would
    // be overwritten by the next recompute while leaving no trace that anybody disagreed with it. The band is the
    // operator's decision and the score stays the machine's.
    await c.query(
      `UPDATE risk_scores SET band = $2 WHERE user_id = $1`, [userId, band]);
    void actor;
  }

  /* ============================ OVERVIEW + INSIGHTS (W089/W098) ============================ */

  async openReportStats(): Promise<{ open: number; oldestAt: string | null }> {
    const r = await this.pool.query(
      `SELECT count(*)::int AS n, min(created_at) AS oldest FROM moderation_reports WHERE status = 'open' AND deleted_at IS NULL`);
    return { open: Number(r.rows[0]?.n ?? 0), oldestAt: iso(r.rows[0]?.oldest) };
  }

  async pendingAppealStats(): Promise<{ pending: number; oldestDueAt: string | null }> {
    const r = await this.pool.query(
      `SELECT count(*)::int AS n, min(sla_due_at) AS oldest FROM appeals WHERE status = 'pending' AND deleted_at IS NULL`);
    return { pending: Number(r.rows[0]?.n ?? 0), oldestDueAt: iso(r.rows[0]?.oldest) };
  }

  async appealOutcomes(days: number): Promise<{ overturned: number; decided: number }> {
    const r = await this.pool.query(
      `SELECT count(*) FILTER (WHERE status = 'overturned')::int AS overturned,
              count(*) FILTER (WHERE status <> 'pending')::int AS decided
         FROM appeals WHERE deleted_at IS NULL AND created_at > now() - ($1 || ' days')::interval`, [String(days)]);
    return { overturned: Number(r.rows[0]?.overturned ?? 0), decided: Number(r.rows[0]?.decided ?? 0) };
  }

  async actionedReportCount(days: number): Promise<number> {
    const r = await this.pool.query(
      `SELECT count(*)::int AS n FROM moderation_reports
        WHERE status = 'actioned' AND deleted_at IS NULL AND handled_at > now() - ($1 || ' days')::interval`, [String(days)]);
    return Number(r.rows[0]?.n ?? 0);
  }

  /** Hours from filing to decision, for the median. Bounded — the median of a bounded newest-N is a different figure
   *  from the true median and the service labels it as a sample. */
  async timeToActionHours(days: number, limit: number): Promise<number[]> {
    const r = await this.pool.query(
      `SELECT EXTRACT(EPOCH FROM (handled_at - created_at)) / 3600.0 AS h FROM moderation_reports
        WHERE handled_at IS NOT NULL AND deleted_at IS NULL AND handled_at > now() - ($1 || ' days')::interval
        ORDER BY handled_at DESC LIMIT $2`, [String(days), limit]);
    return r.rows.map((x: any) => Number(x.h)).filter((n: number) => Number.isFinite(n));
  }

  async reportsByReason(days: number): Promise<{ code: string | null; count: number }[]> {
    const r = await this.pool.query(
      `SELECT lv.code AS code, count(*)::int AS n
         FROM moderation_reports mr LEFT JOIN lookup_values lv ON lv.id = mr.reason_id
        WHERE mr.deleted_at IS NULL AND mr.created_at > now() - ($1 || ' days')::interval
        GROUP BY lv.code`, [String(days)]);
    return r.rows.map((x: any) => ({ code: x.code ?? null, count: Number(x.n) }));
  }

  /** W096's read-only user↔user tab. A count only — the two user ids on a chat block are a fact about a private
   *  safety decision, and the platform board has no business listing who blocked whom. */
  async userBlockCount(): Promise<number | null> {
    const r = await this.pool.query(`SELECT count(*)::int AS n FROM user_blocks WHERE deleted_at IS NULL`);
    const n = r.rows[0]?.n;
    return Number.isFinite(Number(n)) ? Number(n) : null;
  }
}

function toScore(r: any): RiskScoreRow {
  return {
    userId: r.user_id, tenantId: r.tenant_id ?? null,
    score: r.score === null || r.score === undefined ? null : Number(r.score),
    band: r.band ?? null, factors: r.factors ?? null,
    computedAt: iso(r.computed_at),
    fullName: r.full_name ?? null, phone: r.phone ?? null,
  };
}
