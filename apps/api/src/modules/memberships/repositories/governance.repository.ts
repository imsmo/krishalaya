// modules/memberships/repositories/governance.repository.ts · PC-54 W54-7 `governance-agm`: SQL over
// coop_resolutions + coop_votes (0009 — AGM votes, dividends, patronage bonus, board elections).
// ONE VOTE PER MEMBER is the composite PK — the DB is the ballot box's integrity, not app code.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

/**
 * The roles that make somebody a MEMBER of a co-operative, as opposed to somebody who works for it.
 *
 * **THIS LIST IS THE DIFFERENCE BETWEEN A MEMBER AND A DELIVERY PARTNER, AND BEFORE 0130 NOTHING DREW IT.** Staff roles are
 * deliberately absent: a `tenant_admin` who is not also a farmer-member has no vote, which is exactly the coop principle —
 * running the organisation is not owning it.
 */
export const MEMBER_ROLE_CODES = ['farmer', 'dairy_farmer', 'pashupalak', 'worker', 'sardar', 'vyapari', 'organic_store'];

export interface Resolution { id: string; title: string; body: string | null; resolutionType: string; votingOpens: string | null; votingCloses: string | null; payload: Record<string, unknown>; status: string }
const toRes = (r: any): Resolution => ({ id: r.id, title: r.title, body: r.body, resolutionType: r.resolution_type, votingOpens: r.voting_opens ? new Date(r.voting_opens).toISOString() : null, votingCloses: r.voting_closes ? new Date(r.voting_closes).toISOString() : null, payload: r.payload ?? {}, status: r.status });

@Injectable()
export class GovernanceRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, r: { id: string; tenantId: string; title: string; body?: string; resolutionType: string; votingOpens?: string; votingCloses?: string; payload?: Record<string, unknown> }): Promise<void> {
    await tx.query(`INSERT INTO coop_resolutions (id, tenant_id, title, body, resolution_type, voting_opens, voting_closes, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [r.id, r.tenantId, r.title, r.body ?? null, r.resolutionType, r.votingOpens ?? null, r.votingCloses ?? null, JSON.stringify(r.payload ?? {})]);
  }
  async list(tenantId: string, status?: string): Promise<Resolution[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT * FROM coop_resolutions WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`, [tenantId, status ?? null]);
    return r.rows.map(toRes);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Resolution | null> {
    const r = await tx.query(`SELECT * FROM coop_resolutions WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toRes(r.rows[0]) : null;
  }
  async get(tenantId: string, id: string): Promise<Resolution | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT * FROM coop_resolutions WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toRes(r.rows[0]) : null;
  }
  async setStatus(tx: TxContext, tenantId: string, id: string, from: string[], to: string): Promise<boolean> {
    const r = await tx.query(`UPDATE coop_resolutions SET status=$4 WHERE id=$1 AND tenant_id=$2 AND status = ANY($3::text[]) AND deleted_at IS NULL`, [id, tenantId, from, to]);
    return (r.rowCount ?? 0) > 0;
  }
  /** Returns false on a duplicate ballot (the PK) — the caller turns that into a 409, never a double vote. */
  /**
   * Everything the eligibility rules need about one voter, in one round trip.
   *
   * **MEMBERSHIP IS A MEMBER-KIND ROLE, NOT ANY ROLE.** A `tenant_staff` or `delivery_partner` grant makes somebody part of
   * the organisation's operation, never part of its membership — and before 0130 the vote path did not distinguish them at
   * all, so a delivery partner could have voted in an AGM.
   */
  async voterFacts(tenantId: string, memberUserId: string): Promise<{ isMember: boolean; memberSince: string | null; sharesHeld: number; suspended: boolean }> {
    const r = await this.replica.forTenant(tenantId).query<{ member_since: string | null; shares_held: number; suspended: boolean }>(
      `SELECT (SELECT MIN(utr.created_at) FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
                WHERE utr.tenant_id = $1 AND utr.user_id = $2 AND utr.is_active = true AND utr.deleted_at IS NULL
                  AND ro.code = ANY($3::text[])) AS member_since,
              COALESCE((SELECT csr.shares_held FROM coop_share_registers csr
                         WHERE csr.tenant_id = $1 AND csr.member_user_id = $2 AND csr.deleted_at IS NULL), 0) AS shares_held,
              EXISTS (SELECT 1 FROM tenant_member_suspensions kvs
                       WHERE kvs.tenant_id = $1 AND kvs.user_id = $2
                         AND kvs.lifted_at IS NULL AND kvs.deleted_at IS NULL) AS suspended`,
      [tenantId, memberUserId, MEMBER_ROLE_CODES]);
    const row = r.rows[0];
    const memberSince = row?.member_since ? new Date(String(row.member_since)).toISOString() : null;
    return {
      isMember: memberSince !== null,
      memberSince,
      sharesHeld: Number(row?.shares_held ?? 0),
      suspended: row?.suspended === true,
    };
  }

  /** The tenant's bylaw settings (0130). Absent keys are the caller's problem — `bylawsFrom` falls back to the published rule. */
  async bylawSettings(tenantId: string): Promise<Record<string, unknown>> {
    const r = await this.replica.forTenant(tenantId).query<{ key: string; value: unknown }>(
      `SELECT key, value FROM tenant_settings
        WHERE tenant_id = $1 AND key IN ('governance.min_shares_to_vote', 'governance.min_membership_months', 'governance.quorum_bp')`,
      [tenantId]);
    return Object.fromEntries(r.rows.map((x) => [String(x.key), x.value]));
  }

  /**
   * How many members are eligible to vote right now — the DENOMINATOR of turnout and quorum.
   *
   * **DELEGATES TO `registerTotals` SO THE RULE IS EXPRESSED IN SQL EXACTLY ONCE.** The first version of this method counted
   * `FROM coop_share_registers`, which is wrong in a case the bylaw setting explicitly allows: 0130 documents that
   * `governance.min_shares_to_vote = 0` is "legitimate for a producer company that votes by membership alone", and a member
   * with no register row has no register row — so every one of them vanished from the denominator and quorum became trivially
   * easy to meet. Counting FROM members with the register LEFT JOINED is the only shape that survives a zero threshold.
   */
  async eligibleCount(tenantId: string, minShares: number, minMonths: number): Promise<number> {
    return (await this.registerTotals(tenantId, minShares, minMonths)).eligible;
  }

  async castVote(tx: TxContext, resolutionId: string, memberUserId: string, choice: string): Promise<boolean> {
    try { await tx.query(`INSERT INTO coop_votes (resolution_id, member_user_id, choice) VALUES ($1,$2,$3)`, [resolutionId, memberUserId, choice]); return true; }
    catch (e: any) { if (e?.code === '23505') return false; throw e; }
  }
  /**
   * Change an existing vote (W198: "changeable until close").
   *
   * **AN UPDATE, NEVER A SECOND ROW** — the composite primary key is the one-member-one-vote guarantee and must not be
   * relaxed. The previous choice and a change counter travel on the row (0130) so a member who disputes a change can be
   * shown that one happened and what it replaced. Returns false when the choice is UNCHANGED, so the service can tell a
   * member "that is already your vote" instead of silently incrementing a counter.
   */
  async changeVote(tx: TxContext, resolutionId: string, memberUserId: string, choice: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE coop_votes
          SET previous_choice = choice, choice = $3, changed_at = now(), change_count = change_count + 1
        WHERE resolution_id = $1 AND member_user_id = $2 AND choice <> $3`,
      [resolutionId, memberUserId, choice]);
    return (r.rowCount ?? 0) === 1;
  }

  async tally(tenantId: string, resolutionId: string): Promise<Array<{ choice: string; votes: number }>> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT choice, COUNT(*)::int AS votes FROM coop_votes WHERE resolution_id=$1 GROUP BY choice ORDER BY votes DESC`, [resolutionId]);
    return r.rows.map((x: any) => ({ choice: x.choice, votes: x.votes }));
  }

  /**
   * Snapshot the eligible roll onto the resolution as it closes.
   *
   * **A TURNOUT IS A FRACTION AND ONLY THE NUMERATOR SURVIVES.** `coop_votes` rows are permanent; the roll of members who
   * COULD have voted keeps moving as shares transfer and members join, so W197's "Last AGM turnout · 64%" computed against
   * today's roll would change every week for a vote that finished last year. Written once, inside the same transaction as
   * the status change, so a resolution cannot be closed without its denominator (0130 §130.3).
   */
  async recordEligibleAtClose(tx: TxContext, tenantId: string, id: string, eligible: number): Promise<void> {
    await tx.query(`UPDATE coop_resolutions SET eligible_at_close = $3 WHERE id = $1 AND tenant_id = $2 AND eligible_at_close IS NULL`,
      [id, tenantId, eligible]);
  }

  /**
   * W197's four tiles, in one round trip.
   *
   * **SHAREHOLDERS ARE COUNTED BY shares_held > 0, NOT BY THE EXISTENCE OF A REGISTER ROW.** W197: "1,212 of 1,284 members ·
   * 72 pending share allotment". A row with zero shares is a member awaiting allotment, and counting them as a shareholder
   * would make the pending figure — the one number on the tile that tells staff there is work to do — permanently 0.
   */
  async registerTotals(tenantId: string, minShares: number, minMonths: number): Promise<{
    members: number; shareholders: number; totalShares: number; capitalMinor: string; eligible: number;
  }> {
    const r = await this.replica.forTenant(tenantId).query<{ members: number; shareholders: number; total_shares: number; capital_minor: string | null; eligible: number }>(
      `WITH mem AS (
         SELECT utr.user_id,
                MIN(utr.created_at) AS member_since
           FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
          WHERE utr.tenant_id = $1 AND utr.is_active = true AND utr.deleted_at IS NULL
            AND ro.code = ANY($2::text[])
          GROUP BY utr.user_id
       ), reg AS (
         SELECT m.user_id, m.member_since,
                COALESCE(csr.shares_held, 0) AS shares_held,
                COALESCE(csr.share_value_minor, 0) AS share_value_minor,
                EXISTS (SELECT 1 FROM tenant_member_suspensions s
                         WHERE s.tenant_id = $1 AND s.user_id = m.user_id AND s.lifted_at IS NULL AND s.deleted_at IS NULL) AS suspended
           FROM mem m
           LEFT JOIN coop_share_registers csr
                  ON csr.tenant_id = $1 AND csr.member_user_id = m.user_id AND csr.deleted_at IS NULL
       )
       SELECT COUNT(*)::int AS members,
              COUNT(*) FILTER (WHERE shares_held > 0)::int AS shareholders,
              COALESCE(SUM(shares_held), 0)::bigint AS total_shares,
              -- Only a real holding contributes capital: a zero-share row's value column is meaningless.
              COALESCE(SUM(share_value_minor) FILTER (WHERE shares_held > 0), 0)::text AS capital_minor,
              -- **THE ELIGIBILITY RULE, EXPRESSED ONCE MORE IN SQL BECAUSE A COUNT CANNOT BE DONE IN TYPESCRIPT.** It must
              -- agree with domain/voting-eligibility.ts exactly; a test asserts the two answers match over a fact matrix.
              COUNT(*) FILTER (
                WHERE shares_held >= $3
                  AND suspended = false
                  -- **ADDITIVE, NOT SUBTRACTIVE, AND THAT IS NOT A STYLE CHOICE.** domain/voting-eligibility.ts computes the
                  -- eligible date by adding months to the join date and clamping a short month (31 Aug + 6 = 28 Feb).
                  -- Postgres clamps the same way on ADDITION, and differs by up to three days on subtraction from now() —
                  -- which would make the register table and the vote gate disagree for anybody who joined at a month end.
                  AND (member_since + make_interval(months => $4::int)) <= now()
              )::int AS eligible
         FROM reg`,
      [tenantId, MEMBER_ROLE_CODES, minShares, minMonths]);
    const x = r.rows[0];
    return {
      members: Number(x?.members ?? 0),
      shareholders: Number(x?.shareholders ?? 0),
      totalShares: Number(x?.total_shares ?? 0),
      capitalMinor: String(x?.capital_minor ?? '0'),
      eligible: Number(x?.eligible ?? 0),
    };
  }

  /**
   * One page of the register.
   *
   * Keyset on (shares_held DESC, user_id) — W197's table is sorted by shares with a `▾`, and a 1,212-row register on page 49
   * is exactly where OFFSET stops being acceptable. The per-row verdict is NOT computed here: the facts come back and
   * `eligibility()` decides, so the register table and the vote gate cannot disagree.
   */
  async registerPage(tenantId: string, limit: number, after?: { shares: number; userId: string }): Promise<Array<{
    userId: string; fullName: string | null; phone: string | null; sharesHeld: number; valueMinor: string;
    memberSince: string | null; suspended: boolean;
  }>> {
    const params: unknown[] = [tenantId, MEMBER_ROLE_CODES, limit];
    let keyset = '';
    if (after) {
      params.push(after.shares, after.userId);
      keyset = ` AND (shares_held, user_id) < ($4::int, $5::uuid)`;
    }
    const r = await this.replica.forTenant(tenantId).query<any>(
      `WITH reg AS (
         SELECT u.id AS user_id, u.full_name, u.phone,
                COALESCE(csr.shares_held, 0) AS shares_held,
                COALESCE(csr.share_value_minor, 0) AS share_value_minor,
                (SELECT MIN(utr.created_at) FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
                  WHERE utr.tenant_id = $1 AND utr.user_id = u.id AND utr.is_active = true AND utr.deleted_at IS NULL
                    AND ro.code = ANY($2::text[])) AS member_since,
                EXISTS (SELECT 1 FROM tenant_member_suspensions s
                         WHERE s.tenant_id = $1 AND s.user_id = u.id AND s.lifted_at IS NULL AND s.deleted_at IS NULL) AS suspended
           FROM users u
           LEFT JOIN coop_share_registers csr
                  ON csr.tenant_id = $1 AND csr.member_user_id = u.id AND csr.deleted_at IS NULL
          WHERE u.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
                         WHERE utr.tenant_id = $1 AND utr.user_id = u.id AND utr.is_active = true AND utr.deleted_at IS NULL
                           AND ro.code = ANY($2::text[]))
       )
       SELECT * FROM reg WHERE true${keyset}
        ORDER BY shares_held DESC, user_id DESC
        LIMIT $3`,
      params);
    return r.rows.map((x: any) => ({
      userId: x.user_id,
      fullName: x.full_name ?? null,
      phone: x.phone ?? null,
      sharesHeld: Number(x.shares_held ?? 0),
      valueMinor: String(x.share_value_minor ?? '0'),
      memberSince: x.member_since ? new Date(x.member_since).toISOString() : null,
      suspended: Boolean(x.suspended),
    }));
  }

  /**
   * The most recently closed resolution, for W197's turnout tile.
   *
   * Returns `eligibleAtClose: null` for anything closed before 0130 — **unknown, not zero**. A tile reading "0%" for a
   * well-attended 2024 AGM is a worse answer than one reading "not recorded".
   */
  async lastClosed(tenantId: string): Promise<{ id: string; title: string; closedAt: string | null; cast: number; eligibleAtClose: number | null } | null> {
    const r = await this.replica.forTenant(tenantId).query<any>(
      `SELECT r.id, r.title, r.updated_at AS closed_at, r.eligible_at_close,
              (SELECT COUNT(*)::int FROM coop_votes v WHERE v.resolution_id = r.id) AS cast
         FROM coop_resolutions r
        WHERE r.tenant_id = $1 AND r.status = 'closed' AND r.deleted_at IS NULL
        ORDER BY r.updated_at DESC NULLS LAST LIMIT 1`, [tenantId]);
    const x = r.rows[0];
    if (!x) return null;
    return {
      id: x.id, title: x.title,
      closedAt: x.closed_at ? new Date(x.closed_at).toISOString() : null,
      cast: Number(x.cast ?? 0),
      eligibleAtClose: x.eligible_at_close === null || x.eligible_at_close === undefined ? null : Number(x.eligible_at_close),
    };
  }
}
