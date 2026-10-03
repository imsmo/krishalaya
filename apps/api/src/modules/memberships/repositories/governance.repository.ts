// modules/memberships/repositories/governance.repository.ts · PC-54 W54-7 `governance-agm`: SQL over
// coop_resolutions + coop_votes (0009 — AGM votes, dividends, patronage bonus, board elections).
// ONE VOTE PER MEMBER is the composite PK — the DB is the ballot box's integrity, not app code.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { US_SQL, KeysetCursor } from '../../../shared/pagination/us-keyset';
import type { GovernanceCatalogue } from '../domain/resolution-rules';

/**
 * The roles that make somebody a MEMBER of a co-operative, as opposed to somebody who works for it.
 *
 * **THIS LIST IS THE DIFFERENCE BETWEEN A MEMBER AND A DELIVERY PARTNER, AND BEFORE 0130 NOTHING DREW IT.** Staff roles are
 * deliberately absent: a `tenant_admin` who is not also a farmer-member has no vote, which is exactly the coop principle —
 * running the organisation is not owning it.
 */
export const MEMBER_ROLE_CODES = ['farmer', 'dairy_farmer', 'pashupalak', 'worker', 'sardar', 'vyapari', 'organic_store'];

export interface Resolution {
  id: string; title: string; body: string | null; resolutionType: string; votingOpens: string | null; votingCloses: string | null;
  payload: Record<string, unknown>; status: string;
  // [PC-56 TENANT-9b] the lifecycle 0182 records, and the snapshot a closed result is read from (never today's roll).
  majority: string; createdAt: string | null; createdBy: string | null;
  openedAt: string | null; openedBy: string | null; closedAt: string | null; closedBy: string | null; closeReason: string | null;
  withdrawnAt: string | null; withdrawnBy: string | null; withdrawReason: string | null;
  eligibleAtClose: number | null; quorumBp: number | null; passNum: number | null; passDen: number | null; passStrict: boolean | null;
  ruleFixedAt: 'open' | 'close' | null; outcome: string | null;
  /** PC-56 TENANT-12 (0190, F-14): the twin run a proposal came from — {kind:'twin_run', id} of a DONE run; NULL today (no run to cite). */
  sourceRef: { kind: 'twin_run'; id: string } | null;
}
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const intOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const toRes = (r: any): Resolution => ({
  id: r.id, title: r.title, body: r.body, resolutionType: r.resolution_type, votingOpens: iso(r.voting_opens), votingCloses: iso(r.voting_closes),
  payload: r.payload ?? {}, status: r.status,
  majority: r.majority ?? 'ordinary', createdAt: iso(r.created_at), createdBy: r.created_by ?? null,
  openedAt: iso(r.opened_at), openedBy: r.opened_by ?? null, closedAt: iso(r.closed_at), closedBy: r.closed_by ?? null, closeReason: r.close_reason ?? null,
  withdrawnAt: iso(r.withdrawn_at), withdrawnBy: r.withdrawn_by ?? null, withdrawReason: r.withdraw_reason ?? null,
  eligibleAtClose: intOrNull(r.eligible_at_close), quorumBp: intOrNull(r.quorum_bp), passNum: intOrNull(r.pass_num), passDen: intOrNull(r.pass_den),
  passStrict: r.pass_strict === null || r.pass_strict === undefined ? null : Boolean(r.pass_strict),
  ruleFixedAt: r.rule_fixed_at ?? null, outcome: r.outcome ?? null,
  sourceRef: r.source_ref && r.source_ref.kind === 'twin_run' && typeof r.source_ref.id === 'string' ? { kind: 'twin_run', id: r.source_ref.id } : null,
});

export interface ResolutionListRow extends Resolution { cast: number; cursorTs: string; votingOpensCivil: string | null; votingClosesCivil: string | null }
export interface ResolutionFilters { status?: string; type?: string; year?: number }
export interface GovClock { zone: string; currency: { code: string; minorUnits: number } | null; fyMonth: number | null }
@Injectable()
export class GovernanceRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, r: { id: string; tenantId: string; title: string; body?: string | null; resolutionType: string; majority?: string; votingOpens?: string | null; votingCloses?: string | null; payload?: Record<string, unknown> | null; createdBy?: string }): Promise<void> {
    await tx.query(`INSERT INTO coop_resolutions (id, tenant_id, title, body, resolution_type, majority, voting_opens, voting_closes, payload, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
      [r.id, r.tenantId, r.title, r.body ?? null, r.resolutionType, r.majority ?? 'ordinary', r.votingOpens ?? null, r.votingCloses ?? null, JSON.stringify(r.payload ?? {}), r.createdBy ?? null]);
  }
  /** Edit a DRAFT — the WHERE is the state machine's half here; 0182's guard is the other half (a non-draft → 23514). */
  async updateDraft(tx: TxContext, tenantId: string, id: string, r: { title: string; body: string | null; resolutionType: string; majority: string; votingOpens: string | null; votingCloses: string | null; payload: Record<string, unknown> | null; userId: string }): Promise<Resolution | null> {
    const q = await tx.query(`UPDATE coop_resolutions SET title=$3, body=$4, resolution_type=$5, majority=$6, voting_opens=$7, voting_closes=$8, payload=$9, updated_by=$10
                               WHERE id=$1 AND tenant_id=$2 AND status='draft' AND deleted_at IS NULL RETURNING *`,
      [id, tenantId, r.title, r.body, r.resolutionType, r.majority, r.votingOpens, r.votingCloses, JSON.stringify(r.payload ?? {}), r.userId]);
    return q.rows[0] ? toRes(q.rows[0]) : null;
  }
  /** Open: who, when, and the rule fixed now (0182: the rule members vote under). */
  async open(tx: TxContext, tenantId: string, id: string, userId: string, rule: { quorumBp: number; num: number; den: number; strict: boolean }): Promise<Resolution | null> {
    const q = await tx.query(`UPDATE coop_resolutions SET status='open', opened_at=now(), opened_by=$3, quorum_bp=$4, pass_num=$5, pass_den=$6, pass_strict=$7, rule_fixed_at='open', updated_by=$3
                               WHERE id=$1 AND tenant_id=$2 AND status='draft' AND deleted_at IS NULL RETURNING *`,
      [id, tenantId, userId, rule.quorumBp, rule.num, rule.den, rule.strict]);
    return q.rows[0] ? toRes(q.rows[0]) : null;
  }
  /**
   * Close: who, when, why, and the eligible roll AT THIS INSTANT — in ONE statement, so a resolution cannot be closed without
   * its denominator (0130 §130.3). The OUTCOME is written by 0182's trigger from the frozen ballot box; it is read back, not
   * supplied. `legacyRule` is only for a resolution opened before 0182 (no rule fixed at open): the rule in force now is
   * recorded and marked `rule_fixed_at = 'close'`.
   */
  async closeWithSnapshot(tx: TxContext, tenantId: string, id: string, userId: string, reasonCode: string, eligible: number, legacyRule: { quorumBp: number; num: number; den: number; strict: boolean } | null): Promise<Resolution | null> {
    const q = await tx.query(`UPDATE coop_resolutions SET status='closed', closed_at=now(), closed_by=$3, close_reason=$4, eligible_at_close=$5,
                                     quorum_bp=COALESCE(quorum_bp, $6), pass_num=COALESCE(pass_num, $7), pass_den=COALESCE(pass_den, $8),
                                     pass_strict=COALESCE(pass_strict, $9), rule_fixed_at=COALESCE(rule_fixed_at, CASE WHEN $6::int IS NULL THEN NULL ELSE 'close' END),
                                     updated_by=$3
                               WHERE id=$1 AND tenant_id=$2 AND status='open' AND eligible_at_close IS NULL AND deleted_at IS NULL RETURNING *`,
      [id, tenantId, userId, reasonCode, eligible, legacyRule?.quorumBp ?? null, legacyRule?.num ?? null, legacyRule?.den ?? null, legacyRule?.strict ?? null]);
    return q.rows[0] ? toRes(q.rows[0]) : null;
  }
  async withdraw(tx: TxContext, tenantId: string, id: string, userId: string, reasonCode: string): Promise<Resolution | null> {
    const q = await tx.query(`UPDATE coop_resolutions SET status='withdrawn', withdrawn_at=now(), withdrawn_by=$3, withdraw_reason=$4, updated_by=$3
                               WHERE id=$1 AND tenant_id=$2 AND status IN ('draft','open') AND deleted_at IS NULL RETURNING *`,
      [id, tenantId, userId, reasonCode]);
    return q.rows[0] ? toRes(q.rows[0]) : null;
  }

  /** 0182's vocabularies — the types (dividend-class, modelled), the declared ballot choices per type, the act reasons. */
  async catalogue(tenantId: string): Promise<GovernanceCatalogue> {
    const r = await this.replica.forTenant(tenantId).query<{ type_code: string; code: string; meta: any }>(
      `SELECT type_code, code, meta FROM lookup_values
        WHERE tenant_id IS NULL AND is_active AND deleted_at IS NULL
          AND type_code IN ('resolution_type','resolution_choice','resolution_close_reason','resolution_withdraw_reason')
        ORDER BY type_code, sort_order, code`);
    const of = (t: string) => r.rows.filter((x) => x.type_code === t);
    return {
      types: of('resolution_type').map((x) => ({ code: x.code, dividendClass: x.meta?.dividend_class === true, modelled: x.meta?.modelled !== false })),
      choices: of('resolution_choice').map((x) => ({ code: x.code, types: Array.isArray(x.meta?.types) ? x.meta.types.map(String) : [], inFavour: x.meta?.in_favour === true })),
      closeReasons: of('resolution_close_reason').map((x) => x.code),
      withdrawReasons: of('resolution_withdraw_reason').map((x) => x.code),
    };
  }

  /** The cooperative's zone, currency (with its scale) and declared fiscal year — data, never compiled in (F-17). */
  async clockOf(tenantId: string): Promise<GovClock> {
    const r = await this.replica.forTenant(tenantId).query<{ zone: string; code: string | null; minor_units: number | null; fy_month: number | null }>(
      `SELECT c.timezone AS zone, cu.code, cu.minor_units, tenant_fiscal_year_start_month(t.id) AS fy_month
         FROM tenants t JOIN countries c ON c.code = t.country_code LEFT JOIN currencies cu ON cu.code = c.currency_code
        WHERE t.id = $1`, [tenantId]);
    const x = r.rows[0];
    if (!x) return { zone: 'UTC', currency: null, fyMonth: null };
    return {
      zone: x.zone,
      currency: x.code && x.minor_units !== null ? { code: String(x.code).trim(), minorUnits: Number(x.minor_units) } : null,
      fyMonth: x.fy_month === null ? null : Number(x.fy_month),
    };
  }

  /** A civil `YYYY-MM-DDTHH:MM` in the cooperative's zone → the instant, BY THE DATABASE (no JavaScript offset guess). */
  async civilToInstant(tenantId: string, zone: string, civil: string): Promise<string | null> {
    const r = await this.replica.forTenant(tenantId).query<{ at: string }>(
      `SELECT to_char((($1::timestamp) AT TIME ZONE $2) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`, [civil, zone]);
    return r.rows[0]?.at ?? null;
  }
  /** An instant → its civil `YYYY-MM-DDTHH:MM` in the zone (the edit form's prefill). */
  async instantToCivil(tenantId: string, zone: string, at: string | null): Promise<string | null> {
    if (!at) return null;
    const r = await this.replica.forTenant(tenantId).query<{ c: string }>(
      `SELECT to_char(($1::timestamptz) AT TIME ZONE $2, 'YYYY-MM-DD"T"HH24:MI') AS c`, [at, zone]);
    return r.rows[0]?.c ?? null;
  }

  /**
   * W198's list — keyset on the MICROSECOND creation instant + id (F-7 class: the cursor is the database's own printing,
   * never a JS Date), filters as GET-forms: status, type, and YEAR — the civil year, in the cooperative's zone, of the close
   * (or the planned close, or the drafting). `cast` is the ballot-box count; for a closed resolution that box is frozen.
   */
  async page(tenantId: string, zone: string, f: ResolutionFilters, limit: number, after?: KeysetCursor): Promise<ResolutionListRow[]> {
    const params: unknown[] = [tenantId, f.status ?? null, f.type ?? null, f.year ?? null, zone, limit];
    let keyset = '';
    if (after) { params.push(after.ts, after.id); keyset = ` AND (r.created_at, r.id) < ($7::timestamptz, $8::uuid)`; }
    const q = await this.replica.forTenant(tenantId).query<any>(
      `SELECT r.*, ${US_SQL('r.created_at')} AS cursor_ts,
              (SELECT COUNT(*)::int FROM coop_votes v WHERE v.resolution_id = r.id AND v.tenant_id = $1) AS cast_count,
              to_char(r.voting_opens AT TIME ZONE $5, 'YYYY-MM-DD"T"HH24:MI') AS opens_civil,
              to_char(r.voting_closes AT TIME ZONE $5, 'YYYY-MM-DD"T"HH24:MI') AS closes_civil
         FROM coop_resolutions r
        WHERE r.tenant_id = $1 AND r.deleted_at IS NULL
          AND ($2::text IS NULL OR r.status = $2) AND ($3::text IS NULL OR r.resolution_type = $3)
          AND ($4::int IS NULL OR EXTRACT(YEAR FROM (COALESCE(r.closed_at, r.voting_closes, r.created_at) AT TIME ZONE $5))::int = $4)${keyset}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $6`, params);
    return q.rows.map((x: any) => ({ ...toRes(x), cast: Number(x.cast_count ?? 0), cursorTs: x.cursor_ts, votingOpensCivil: x.opens_civil ?? null, votingClosesCivil: x.closes_civil ?? null }));
  }

  /** Every active MEMBER of the cooperative — the notice's recipients (W198: "Notice in-app … results published to all members"). */
  async memberUserIds(tx: TxContext, tenantId: string): Promise<string[]> {
    const r = await tx.query<{ user_id: string }>(
      `SELECT DISTINCT utr.user_id FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
        WHERE utr.tenant_id = $1 AND utr.is_active = true AND utr.deleted_at IS NULL AND ro.code = ANY($2::text[])
        ORDER BY utr.user_id LIMIT 50000`, [tenantId, MEMBER_ROLE_CODES]);
    return r.rows.map((x) => x.user_id);
  }

  /** The ballot box inside a transaction (the close reads the box it is freezing). */
  async tallyTx(tx: TxContext, tenantId: string, resolutionId: string): Promise<Array<{ choice: string; votes: number }>> {
    const r = await tx.query(`SELECT choice, COUNT(*)::int AS votes FROM coop_votes WHERE resolution_id=$1 AND tenant_id=$2 GROUP BY choice ORDER BY votes DESC`, [resolutionId, tenantId]);
    return r.rows.map((x: any) => ({ choice: x.choice, votes: x.votes }));
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Resolution | null> {
    const r = await tx.query(`SELECT * FROM coop_resolutions WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toRes(r.rows[0]) : null;
  }
  async get(tenantId: string, id: string): Promise<Resolution | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT * FROM coop_resolutions WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toRes(r.rows[0]) : null;
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

  /**
   * Returns false when the member already has a ballot (the PK) — the caller then CHANGES it, never a second row.
   *
   * [PC-56 TENANT-9b · FOUND ON THE WAY] **THIS WAS `INSERT` + `catch (23505)`, AND A CHANGED VOTE COULD NEVER BE WRITTEN.**
   * A unique violation ABORTS the transaction it happens in, so the `changeVote` that followed in the same unit of work
   * failed with "current transaction is aborted" — TENANT-1e's "changeable until close" answered every change with a 500
   * (proven at d8543fa; the wave report quotes it). `ON CONFLICT DO NOTHING` asks the same question without poisoning the
   * transaction.
   */
  async castVote(tx: TxContext, resolutionId: string, memberUserId: string, choice: string): Promise<boolean> {
    // [9b] tenant_id is the RESOLUTION's (0182's trigger forces it; the RLS policy checks it against the context).
    const r = await tx.query(
      `INSERT INTO coop_votes (resolution_id, member_user_id, choice, tenant_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (resolution_id, member_user_id) DO NOTHING RETURNING resolution_id`,
      [resolutionId, memberUserId, choice, tx.tenantId]);
    return (r.rowCount ?? 0) === 1;
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
        WHERE resolution_id = $1 AND member_user_id = $2 AND choice <> $3 AND tenant_id = $4`,
      [resolutionId, memberUserId, choice, tx.tenantId]);
    return (r.rowCount ?? 0) === 1;
  }

  async tally(tenantId: string, resolutionId: string): Promise<Array<{ choice: string; votes: number }>> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT choice, COUNT(*)::int AS votes FROM coop_votes WHERE resolution_id=$1 AND tenant_id=$2 GROUP BY choice ORDER BY votes DESC`, [resolutionId, tenantId]);
    return r.rows.map((x: any) => ({ choice: x.choice, votes: x.votes }));
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
      // [9b] `closed_at` is recorded since 0182 (it was `updated_at` — the last write, not the close); a resolution closed
      // before 0182 has none and prints "not recorded" — it still sorts, by its last write, behind every recorded close.
      `SELECT r.id, r.title, r.closed_at, r.eligible_at_close,
              (SELECT COUNT(*)::int FROM coop_votes v WHERE v.resolution_id = r.id AND v.tenant_id = $1) AS cast
         FROM coop_resolutions r
        WHERE r.tenant_id = $1 AND r.status = 'closed' AND r.deleted_at IS NULL
        ORDER BY r.closed_at DESC NULLS LAST, r.updated_at DESC LIMIT 1`, [tenantId]);
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
