// modules/education/repositories/instructor-earnings.repository.ts · PC-56 TENANT-7d-money · ALL SQL for the royalty
// rule, the agreement and the royalty LINES (0174). Every query binds tenant_id (Law 1); every sum is a SUM over lines
// at read time, per currency, as bigint text (no total is stored anywhere); the month is the COOPERATIVE's month —
// `AT TIME ZONE co.timezone` through `tenants.country_code → countries.timezone` (7c's rule), never the process zone.
import { Inject, Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import type { AgreementStatus, LineState, RuleStatus } from '../domain/royalty-split';

export interface RoyaltyRuleRow {
  id: string; tenantId: string | null; instructorShareBps: number; tenantShareBps: number; platformShareBps: number; status: RuleStatus;
  proposedBy: string | null; proposedAt: Date; decidedBy: string | null; decidedAt: Date | null; decisionNote: string | null; effectiveFrom: Date | null; supersededAt: Date | null;
}
export interface AgreementRow {
  id: string; tenantId: string; instructorId: string; version: number; instructorShareBps: number; tenantShareBps: number; platformShareBps: number; ruleId: string | null;
  status: AgreementStatus; offeredBy: string; offeredAt: Date; acceptedBy: string | null; acceptedAt: Date | null; declinedAt: Date | null; supersededAt: Date | null; termsNote: string | null;
}
export interface RoyaltyLineInsert {
  id: string; tenantId: string; instructorId: string; instructorUserId: string; courseId: string; enrollmentId: string; learnerUserId: string;
  currencyCode: string; minorUnits: number; grossMinor: bigint; instructorMinor: bigint; tenantMinor: bigint; platformMinor: bigint;
  instructorShareBps: number; tenantShareBps: number; platformShareBps: number; ruleId: string | null; agreementId: string | null; ledgerTxnId: string; state: Exclude<LineState, 'released'>;
}
export interface RoyaltyLineRow extends Omit<RoyaltyLineInsert, 'state'> { state: LineState; occurredAt: Date; releasedAt: Date | null; releaseTxnId: string | null; courseTitle: string | null }
export interface CurrencySums { currencyCode: string; minorUnits: number; gross: string; instructor: string; tenant: string; platform: string; held: string; heldLines: number; released: string; purchases: number }
export interface CourseEarningsRow { courseId: string; title: string; status: string; priceMinor: string; currencyCode: string; minorUnits: number | null; enrollments: number; paid: number; gross: string; instructor: string; tenantPlatform: string }
export interface RoyaltyPayoutRow { id: string; status: string; amountMinor: string; currencyCode: string; batchId: string | null; batchStatus: string | null; createdAt: Date; failureCode: string | null }

const RULE_COLS = `id, tenant_id, instructor_share_bps, tenant_share_bps, platform_share_bps, status, proposed_by, proposed_at, decided_by, decided_at, decision_note, effective_from, superseded_at`;
const toRule = (r: any): RoyaltyRuleRow => ({
  id: r.id, tenantId: r.tenant_id, instructorShareBps: Number(r.instructor_share_bps), tenantShareBps: Number(r.tenant_share_bps), platformShareBps: Number(r.platform_share_bps), status: r.status,
  proposedBy: r.proposed_by, proposedAt: r.proposed_at, decidedBy: r.decided_by, decidedAt: r.decided_at, decisionNote: r.decision_note, effectiveFrom: r.effective_from, supersededAt: r.superseded_at,
});
const AGR_COLS = `id, tenant_id, instructor_id, version, instructor_share_bps, tenant_share_bps, platform_share_bps, rule_id, status, offered_by, offered_at, accepted_by, accepted_at, declined_at, superseded_at, terms_note`;
const toAgreement = (r: any): AgreementRow => ({
  id: r.id, tenantId: r.tenant_id, instructorId: r.instructor_id, version: Number(r.version), instructorShareBps: Number(r.instructor_share_bps), tenantShareBps: Number(r.tenant_share_bps), platformShareBps: Number(r.platform_share_bps), ruleId: r.rule_id,
  status: r.status, offeredBy: r.offered_by, offeredAt: r.offered_at, acceptedBy: r.accepted_by, acceptedAt: r.accepted_at, declinedAt: r.declined_at, supersededAt: r.superseded_at, termsNote: r.terms_note,
});
const LINE_COLS = `l.id, l.tenant_id, l.instructor_id, l.instructor_user_id, l.course_id, l.enrollment_id, l.learner_user_id, l.currency_code, l.minor_units, l.gross_minor, l.instructor_minor, l.tenant_minor, l.platform_minor,
  l.instructor_share_bps, l.tenant_share_bps, l.platform_share_bps, l.rule_id, l.agreement_id, l.ledger_txn_id, l.state, l.occurred_at, l.released_at, l.release_txn_id, c.default_title AS course_title`;
const toLine = (r: any): RoyaltyLineRow => ({
  id: r.id, tenantId: r.tenant_id, instructorId: r.instructor_id, instructorUserId: r.instructor_user_id, courseId: r.course_id, enrollmentId: r.enrollment_id, learnerUserId: r.learner_user_id,
  currencyCode: r.currency_code, minorUnits: Number(r.minor_units), grossMinor: BigInt(r.gross_minor), instructorMinor: BigInt(r.instructor_minor), tenantMinor: BigInt(r.tenant_minor), platformMinor: BigInt(r.platform_minor),
  instructorShareBps: Number(r.instructor_share_bps), tenantShareBps: Number(r.tenant_share_bps), platformShareBps: Number(r.platform_share_bps), ruleId: r.rule_id, agreementId: r.agreement_id, ledgerTxnId: r.ledger_txn_id,
  state: r.state, occurredAt: r.occurred_at, releasedAt: r.released_at, releaseTxnId: r.release_txn_id, courseTitle: r.course_title ?? null,
});

@Injectable()
export class InstructorEarningsRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private db(tenantId: string, tx?: TxContext) { return tx ?? this.replica.forTenant(tenantId); }

  /* ---------------------------------------------------------------- the rule ---------------------------------- */

  /** The rule in force for this tenant: its own ACTIVE rule, else the platform default. Null only on a database with no default row. */
  async ruleInForce(tenantId: string, tx?: TxContext): Promise<RoyaltyRuleRow | null> {
    const r = await this.db(tenantId, tx).query(
      `SELECT ${RULE_COLS} FROM course_royalty_rules WHERE status='active' AND (tenant_id=$1 OR tenant_id IS NULL) AND deleted_at IS NULL
        ORDER BY (tenant_id IS NOT NULL) DESC LIMIT 1`, [tenantId]);
    return r.rows[0] ? toRule(r.rows[0]) : null;
  }
  async platformDefaultRule(tenantId: string, tx?: TxContext): Promise<RoyaltyRuleRow | null> {
    const r = await this.db(tenantId, tx).query(`SELECT ${RULE_COLS} FROM course_royalty_rules WHERE status='active' AND tenant_id IS NULL AND deleted_at IS NULL LIMIT 1`);
    return r.rows[0] ? toRule(r.rows[0]) : null;
  }
  async ruleHistory(tenantId: string, tx?: TxContext): Promise<RoyaltyRuleRow[]> {
    const r = await this.db(tenantId, tx).query(`SELECT ${RULE_COLS} FROM course_royalty_rules WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY proposed_at DESC, id DESC LIMIT 50`, [tenantId]);
    return r.rows.map(toRule);
  }
  async getRuleForUpdate(tx: TxContext, tenantId: string, id: string): Promise<RoyaltyRuleRow | null> {
    const r = await tx.query(`SELECT ${RULE_COLS} FROM course_royalty_rules WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toRule(r.rows[0]) : null;
  }
  async insertRuleProposal(tx: TxContext, p: { id: string; tenantId: string; instructorShareBps: number; tenantShareBps: number; platformShareBps: number; proposedBy: string; note: string | null }): Promise<void> {
    await tx.query(
      `INSERT INTO course_royalty_rules (id, tenant_id, instructor_share_bps, tenant_share_bps, platform_share_bps, status, proposed_by, decision_note, created_by)
       VALUES ($1,$2,$3,$4,$5,'proposed',$6,$7,$6)`,
      [p.id, p.tenantId, p.instructorShareBps, p.tenantShareBps, p.platformShareBps, p.proposedBy, p.note]);
  }
  async decideRule(tx: TxContext, tenantId: string, id: string, d: { status: 'active' | 'rejected'; decidedBy: string; note: string | null }): Promise<void> {
    await tx.query(
      `UPDATE course_royalty_rules SET status=$3::varchar, decided_by=$4, decided_at=now(), decision_note=COALESCE($5::varchar, decision_note), effective_from=CASE WHEN $3::varchar='active' THEN now() END, updated_by=$4, updated_at=now()
        WHERE id=$1 AND tenant_id=$2`, [id, tenantId, d.status, d.decidedBy, d.note]);
  }
  async supersedeActiveRule(tx: TxContext, tenantId: string, by: string): Promise<number> {
    const r = await tx.query(`UPDATE course_royalty_rules SET status='superseded', superseded_at=now(), updated_by=$2, updated_at=now() WHERE tenant_id=$1 AND status='active'`, [tenantId, by]);
    return r.rowCount ?? 0;
  }

  /* ---------------------------------------------------------------- the agreement ----------------------------- */

  async acceptedAgreement(tenantId: string, instructorId: string, tx?: TxContext): Promise<AgreementRow | null> {
    const r = await this.db(tenantId, tx).query(`SELECT ${AGR_COLS} FROM instructor_agreements WHERE tenant_id=$1 AND instructor_id=$2 AND status='accepted' AND deleted_at IS NULL LIMIT 1`, [tenantId, instructorId]);
    return r.rows[0] ? toAgreement(r.rows[0]) : null;
  }
  async agreementsOf(tenantId: string, instructorId: string, tx?: TxContext): Promise<AgreementRow[]> {
    const r = await this.db(tenantId, tx).query(`SELECT ${AGR_COLS} FROM instructor_agreements WHERE tenant_id=$1 AND instructor_id=$2 AND deleted_at IS NULL ORDER BY version DESC`, [tenantId, instructorId]);
    return r.rows.map(toAgreement);
  }
  async getAgreementForUpdate(tx: TxContext, tenantId: string, id: string): Promise<AgreementRow | null> {
    const r = await tx.query(`SELECT ${AGR_COLS} FROM instructor_agreements WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toAgreement(r.rows[0]) : null;
  }
  async nextAgreementVersion(tx: TxContext, tenantId: string, instructorId: string): Promise<number> {
    const r = await tx.query<{ v: string }>(`SELECT COALESCE(MAX(version),0)::text AS v FROM instructor_agreements WHERE tenant_id=$1 AND instructor_id=$2`, [tenantId, instructorId]);
    return Number(r.rows[0]?.v ?? 0) + 1;
  }
  async insertAgreement(tx: TxContext, a: { id: string; tenantId: string; instructorId: string; version: number; instructorShareBps: number; tenantShareBps: number; platformShareBps: number; ruleId: string | null; offeredBy: string; termsNote: string | null }): Promise<void> {
    await tx.query(
      `INSERT INTO instructor_agreements (id, tenant_id, instructor_id, version, instructor_share_bps, tenant_share_bps, platform_share_bps, rule_id, status, offered_by, terms_note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'offered',$9,$10,$9)`,
      [a.id, a.tenantId, a.instructorId, a.version, a.instructorShareBps, a.tenantShareBps, a.platformShareBps, a.ruleId, a.offeredBy, a.termsNote]);
  }
  async setAgreementStatus(tx: TxContext, tenantId: string, id: string, s: { status: AgreementStatus; by: string }): Promise<void> {
    await tx.query(
      `UPDATE instructor_agreements
          SET status=$3::varchar,
              accepted_by = CASE WHEN $3::varchar='accepted' THEN $4::uuid ELSE accepted_by END,
              accepted_at = CASE WHEN $3::varchar='accepted' THEN now() ELSE accepted_at END,
              declined_at = CASE WHEN $3::varchar='declined' THEN now() ELSE declined_at END,
              superseded_at = CASE WHEN $3::varchar='superseded' THEN now() ELSE superseded_at END,
              updated_by=$4, updated_at=now()
        WHERE id=$1 AND tenant_id=$2`, [id, tenantId, s.status, s.by]);
  }

  /* ---------------------------------------------------------------- the lines --------------------------------- */

  /** The currency's own scale (6e-1). Null when the platform holds none — the caller REFUSES, never assumes two. */
  async minorUnitsOf(tx: TxContext, currencyCode: string): Promise<number | null> {
    const r = await tx.query<{ minor_units: number }>(`SELECT minor_units FROM currencies WHERE code=$1`, [currencyCode]);
    return r.rows[0] ? Number(r.rows[0].minor_units) : null;
  }
  async insertLine(tx: TxContext, l: RoyaltyLineInsert, createdBy: string): Promise<void> {
    await tx.query(
      `INSERT INTO instructor_royalty_lines (id, tenant_id, instructor_id, instructor_user_id, course_id, enrollment_id, learner_user_id, currency_code, minor_units,
         gross_minor, instructor_minor, tenant_minor, platform_minor, instructor_share_bps, tenant_share_bps, platform_share_bps, rule_id, agreement_id, ledger_txn_id, state, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [l.id, l.tenantId, l.instructorId, l.instructorUserId, l.courseId, l.enrollmentId, l.learnerUserId, l.currencyCode, l.minorUnits,
       l.grossMinor.toString(), l.instructorMinor.toString(), l.tenantMinor.toString(), l.platformMinor.toString(), l.instructorShareBps, l.tenantShareBps, l.platformShareBps, l.ruleId, l.agreementId, l.ledgerTxnId, l.state, createdBy]);
  }
  /** Every HELD line of this instructor, locked, grouped by currency for the release. */
  async heldForUpdate(tx: TxContext, tenantId: string, instructorId: string): Promise<Array<{ id: string; currencyCode: string; instructorMinor: bigint }>> {
    const r = await tx.query(`SELECT id, currency_code, instructor_minor FROM instructor_royalty_lines WHERE tenant_id=$1 AND instructor_id=$2 AND state='held_pending_agreement' ORDER BY id FOR UPDATE`, [tenantId, instructorId]);
    return r.rows.map((x: any) => ({ id: x.id, currencyCode: x.currency_code, instructorMinor: BigInt(x.instructor_minor) }));
  }
  async markReleased(tx: TxContext, tenantId: string, ids: readonly string[], releaseTxnId: string, by: string): Promise<number> {
    if (ids.length === 0) return 0;
    const r = await tx.query(`UPDATE instructor_royalty_lines SET state='released', released_at=now(), release_txn_id=$3, updated_by=$4, updated_at=now() WHERE tenant_id=$1 AND id = ANY($2::uuid[]) AND state='held_pending_agreement'`, [tenantId, ids, releaseTxnId, by]);
    return r.rowCount ?? 0;
  }

  /** The cooperative's own calendar day and zone — resolved by the database, never the server's clock (7c). */
  async tenantToday(tenantId: string, tx?: TxContext): Promise<{ today: string; timezone: string } | null> {
    const r = await this.db(tenantId, tx).query(`SELECT to_char(now() AT TIME ZONE co.timezone, 'YYYY-MM-DD') AS today, co.timezone FROM tenants t JOIN countries co ON co.code=t.country_code WHERE t.id=$1`, [tenantId]);
    return r.rows[0] ? { today: r.rows[0].today, timezone: r.rows[0].timezone } : null;
  }

  /**
   * THE TILES: one row per currency, every figure a SUM over lines. `sinceLocalDay` (a `YYYY-MM-DD` in the tenant's
   * zone, or null for lifetime) becomes an instant `AT TIME ZONE co.timezone` in SQL. `held` and `released` are the
   * instructor leg by state; `instructor` is the leg whatever its state.
   */
  async sumsByCurrency(tenantId: string, instructorId: string, sinceLocalDay: string | null, tx?: TxContext): Promise<CurrencySums[]> {
    const r = await this.db(tenantId, tx).query(
      `WITH zone AS (SELECT co.timezone FROM tenants t JOIN countries co ON co.code=t.country_code WHERE t.id=$1)
       SELECT l.currency_code, l.minor_units,
              SUM(l.gross_minor)::text AS gross, SUM(l.instructor_minor)::text AS instructor, SUM(l.tenant_minor)::text AS tenant, SUM(l.platform_minor)::text AS platform,
              COALESCE(SUM(l.instructor_minor) FILTER (WHERE l.state='held_pending_agreement'),0)::text AS held,
              count(*) FILTER (WHERE l.state='held_pending_agreement')::int AS held_lines,
              COALESCE(SUM(l.instructor_minor) FILTER (WHERE l.state IN ('paid_to_wallet','released')),0)::text AS released,
              count(*)::int AS purchases
         FROM instructor_royalty_lines l, zone z
        WHERE l.tenant_id=$1 AND l.instructor_id=$2
          AND ($3::date IS NULL OR l.occurred_at >= (($3::date)::timestamp AT TIME ZONE z.timezone))
        GROUP BY l.currency_code, l.minor_units
        ORDER BY l.currency_code`, [tenantId, instructorId, sinceLocalDay]);
    return r.rows.map((x: any) => ({ currencyCode: x.currency_code, minorUnits: Number(x.minor_units), gross: x.gross, instructor: x.instructor, tenant: x.tenant, platform: x.platform, held: x.held, heldLines: Number(x.held_lines), released: x.released, purchases: Number(x.purchases) }));
  }

  /** W418's course-by-course table: every course of the instructor (free ones with their learner count), the money from lines. */
  async perCourse(tenantId: string, instructorId: string, tx?: TxContext): Promise<CourseEarningsRow[]> {
    const r = await this.db(tenantId, tx).query(
      `SELECT c.id AS course_id, c.default_title, c.status, c.price_minor::text AS price_minor, c.currency_code, cu.minor_units,
              (SELECT count(*)::int FROM enrollments e WHERE e.course_id=c.id AND e.tenant_id=c.tenant_id AND e.deleted_at IS NULL) AS enrollments,
              (SELECT count(*)::int FROM instructor_royalty_lines l WHERE l.course_id=c.id AND l.tenant_id=c.tenant_id) AS paid,
              COALESCE((SELECT SUM(l.gross_minor) FROM instructor_royalty_lines l WHERE l.course_id=c.id AND l.tenant_id=c.tenant_id),0)::text AS gross,
              COALESCE((SELECT SUM(l.instructor_minor) FROM instructor_royalty_lines l WHERE l.course_id=c.id AND l.tenant_id=c.tenant_id),0)::text AS instructor,
              COALESCE((SELECT SUM(l.tenant_minor + l.platform_minor) FROM instructor_royalty_lines l WHERE l.course_id=c.id AND l.tenant_id=c.tenant_id),0)::text AS tenant_platform
         FROM courses c LEFT JOIN currencies cu ON cu.code=c.currency_code
        WHERE c.tenant_id=$1 AND c.instructor_id=$2 AND c.deleted_at IS NULL
        ORDER BY (c.price_minor > 0) DESC, c.default_title, c.id`, [tenantId, instructorId]);
    return r.rows.map((x: any) => ({ courseId: x.course_id, title: x.default_title, status: x.status, priceMinor: x.price_minor, currencyCode: x.currency_code, minorUnits: x.minor_units == null ? null : Number(x.minor_units), enrollments: Number(x.enrollments), paid: Number(x.paid), gross: x.gross, instructor: x.instructor, tenantPlatform: x.tenant_platform }));
  }

  /** The statement — keyset over (occurred_at DESC, id DESC). */
  async statement(tenantId: string, instructorId: string, q: { cursor?: { c: string; id: string }; limit: number }, tx?: TxContext): Promise<RoyaltyLineRow[]> {
    const r = await this.db(tenantId, tx).query(
      `SELECT ${LINE_COLS} FROM instructor_royalty_lines l LEFT JOIN courses c ON c.id=l.course_id
        WHERE l.tenant_id=$1 AND l.instructor_id=$2
          AND ($3::timestamptz IS NULL OR (l.occurred_at, l.id) < ($3::timestamptz, $4::uuid))
        ORDER BY l.occurred_at DESC, l.id DESC LIMIT $5`, [tenantId, instructorId, q.cursor?.c ?? null, q.cursor?.id ?? null, q.limit]);
    return r.rows.map(toLine);
  }
  async lineByEnrollment(tenantId: string, enrollmentId: string, tx?: TxContext): Promise<RoyaltyLineRow | null> {
    const r = await this.db(tenantId, tx).query(`SELECT ${LINE_COLS} FROM instructor_royalty_lines l LEFT JOIN courses c ON c.id=l.course_id WHERE l.tenant_id=$1 AND l.enrollment_id=$2`, [tenantId, enrollmentId]);
    return r.rows[0] ? toLine(r.rows[0]) : null;
  }

  /* ---------------------------------------------------------------- money out --------------------------------- */

  /** Σ course_royalty payouts by currency that have left or are leaving the wallet (queued · processing · success). Reversed/cancelled money is back in the wallet. */
  async paidOutByCurrency(tenantId: string, userId: string, tx?: TxContext): Promise<Array<{ currencyCode: string; paidOut: string; pending: string }>> {
    const r = await this.db(tenantId, tx).query(
      `SELECT p.currency_code,
              COALESCE(SUM(p.amount_minor) FILTER (WHERE p.status IN ('queued','processing','success')),0)::text AS paid_out,
              COALESCE(SUM(p.amount_minor) FILTER (WHERE p.status IN ('queued','processing')),0)::text AS pending
         FROM payouts p JOIN lookup_values lv ON lv.id=p.purpose_id
        WHERE p.tenant_id=$1 AND p.user_id=$2 AND lv.type_code='payout_purpose' AND lv.code='course_royalty' AND p.deleted_at IS NULL
        GROUP BY p.currency_code ORDER BY p.currency_code`, [tenantId, userId]);
    return r.rows.map((x: any) => ({ currencyCode: x.currency_code, paidOut: x.paid_out, pending: x.pending }));
  }
  async royaltyPayouts(tenantId: string, userId: string, limit = 20, tx?: TxContext): Promise<RoyaltyPayoutRow[]> {
    const r = await this.db(tenantId, tx).query(
      `SELECT p.id, p.status, p.amount_minor::text AS amount_minor, p.currency_code, p.batch_id, b.status AS batch_status, p.created_at, p.failure_code
         FROM payouts p JOIN lookup_values lv ON lv.id=p.purpose_id LEFT JOIN payout_batches b ON b.id=p.batch_id
        WHERE p.tenant_id=$1 AND p.user_id=$2 AND lv.type_code='payout_purpose' AND lv.code='course_royalty' AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC, p.id DESC LIMIT $3`, [tenantId, userId, limit]);
    return r.rows.map((x: any) => ({ id: x.id, status: x.status, amountMinor: x.amount_minor, currencyCode: x.currency_code, batchId: x.batch_id, batchStatus: x.batch_status, createdAt: x.created_at, failureCode: x.failure_code }));
  }
  /** The instructor's bank accounts in this tenant — the payout form's choices (the plane re-checks ownership; a penny-unverified one is named). */
  async bankAccountsOf(tenantId: string, userId: string, tx?: TxContext): Promise<Array<{ id: string; label: string; verified: boolean }>> {
    const r = await this.db(tenantId, tx).query(
      `SELECT id, account_kind, COALESCE(upi_id,'') AS upi_id, COALESCE(account_last4,'') AS last4, COALESCE(ifsc,'') AS ifsc, (penny_verified_at IS NOT NULL) AS verified
         FROM bank_accounts WHERE user_id=$1 AND (tenant_id=$2 OR tenant_id IS NULL) AND deleted_at IS NULL ORDER BY is_primary DESC, created_at`, [userId, tenantId]);
    return r.rows.map((x: any) => ({ id: x.id, label: x.account_kind === 'upi' ? x.upi_id : `${x.ifsc} ····${x.last4}`.trim(), verified: Boolean(x.verified) }));
  }
}
