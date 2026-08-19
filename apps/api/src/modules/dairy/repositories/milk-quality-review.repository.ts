// modules/dairy/repositories/milk-quality-review.repository.ts · all SQL for milk_quality_reviews (PC-56 TENANT-6b-1).
// tenant_id in EVERY query (Law 1) + RLS. Every read of a review can reach its pour without scanning the partitioned
// table, because `collected_on` is carried on the review row itself.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { MilkQualityReview } from '../domain/milk-quality-review.entity';
import { MilkShift } from '../domain/dairy.events';
import { ReviewStatus, COMMITTEE_REVIEW_WINDOW_DAYS } from '../domain/milk-quality.state';
import { pgDate } from '../../../core/database/pg-date';

const COLS = `id, tenant_id, collection_id, collected_on, membership_id, mcc_id, shift, water_flag, reasons,
  density_at_flag, fat_pct_at_flag, snf_pct_at_flag, amount_withheld_minor, currency_code, sample_sealed,
  status, opened_at, opened_by, retest_at, retest_by, member_present, outcome_note, decided_at, decided_by,
  prior_reviews_90d, committee_review_required`;

const num = (v: unknown): string | null => (v == null ? null : String(v));

function toDomain(r: any): MilkQualityReview {
  return MilkQualityReview.rehydrate({
    id: r.id, tenantId: r.tenant_id, collectionId: r.collection_id, collectedOn: pgDate(r.collected_on),
    membershipId: r.membership_id, mccId: r.mcc_id, shift: r.shift as MilkShift,
    waterFlag: r.water_flag === true, reasons: Array.isArray(r.reasons) ? r.reasons.map(String) : [],
    densityAtFlag: num(r.density_at_flag), fatPctAtFlag: num(r.fat_pct_at_flag), snfPctAtFlag: num(r.snf_pct_at_flag),
    amountWithheldMinor: BigInt(r.amount_withheld_minor ?? 0), currencyCode: String(r.currency_code),
    sampleSealed: r.sample_sealed === true, status: r.status as ReviewStatus,
    openedAt: r.opened_at ?? undefined, openedBy: r.opened_by ?? null,
    retestAt: r.retest_at ?? null, retestBy: r.retest_by ?? null,
    memberPresent: r.member_present == null ? null : r.member_present === true,
    outcomeNote: r.outcome_note ?? null, decidedAt: r.decided_at ?? null, decidedBy: r.decided_by ?? null,
    priorReviews90d: Number(r.prior_reviews_90d ?? 0), committeeReviewRequired: r.committee_review_required === true,
  });
}

@Injectable()
export class MilkQualityReviewRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, r: MilkQualityReview): Promise<void> {
    const p = r.toProps();
    await tx.query(
      `INSERT INTO milk_quality_reviews (id, tenant_id, collection_id, collected_on, membership_id, mcc_id, shift,
         water_flag, reasons, density_at_flag, fat_pct_at_flag, snf_pct_at_flag, amount_withheld_minor, currency_code,
         sample_sealed, status, opened_by, prior_reviews_90d, committee_review_required)
       VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [p.id, p.tenantId, p.collectionId, p.collectedOn, p.membershipId, p.mccId, p.shift,
       p.waterFlag, JSON.stringify(p.reasons), p.densityAtFlag, p.fatPctAtFlag, p.snfPctAtFlag,
       p.amountWithheldMinor.toString(), p.currencyCode, p.sampleSealed, p.status, p.openedBy,
       p.priorReviews90d, p.committeeReviewRequired]);
  }

  /**
   * W168 step 3: *"Repeat pattern (3+ in 90d) → dairy committee review."*
   *
   * Counts the member's EARLIER reviews inside the window — opened, not rejected: three flags in three weeks is a
   * pattern worth a conversation even if two were cleared, and a committee that only ever sees confirmed cases cannot
   * notice a centre whose analyzer is drifting. The interval is a parameter of the query rather than a JS date so the
   * window is the DATABASE's 90 days (the same reason TENANT-6a takes `current_date` from PostgreSQL).
   */
  async priorReviews90d(tx: TxContext, tenantId: string, membershipId: string): Promise<number> {
    const r = await tx.query(
      `SELECT count(*)::int AS n FROM milk_quality_reviews
        WHERE tenant_id=$1 AND membership_id=$2 AND deleted_at IS NULL
          AND opened_at >= now() - ($3 || ' days')::interval`,
      [tenantId, membershipId, String(COMMITTEE_REVIEW_WINDOW_DAYS)]);
    return Number((r.rows[0] as any)?.n ?? 0);
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<MilkQualityReview | null> {
    const r = await tx.query(`SELECT ${COLS} FROM milk_quality_reviews WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async getById(tenantId: string, id: string): Promise<MilkQualityReview | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM milk_quality_reviews WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /**
   * The re-test and the decision, written together with the status — one UPDATE, so a decision can never land without
   * its decider. FAILS CLOSED on a zero-row update: the caller read the row `FOR UPDATE` in this same transaction, so
   * no rows means the predicate is wrong, not that the row is gone.
   */
  async update(tx: TxContext, tenantId: string, r: MilkQualityReview): Promise<void> {
    const p = r.toProps();
    const res = await tx.query(
      `UPDATE milk_quality_reviews
          SET status=$3, sample_sealed=$4, retest_at=$5, retest_by=$6, member_present=$7,
              outcome_note=$8, decided_at=$9, decided_by=$10
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, tenantId, p.status, p.sampleSealed, p.retestAt, p.retestBy, p.memberPresent,
       p.outcomeNote, p.decidedAt, p.decidedBy]);
    if (res.rowCount === 0) throw new Error(`quality review ${p.id} vanished mid-transaction`);
  }

  /** Keyset page of a tenant's reviews, newest first — the desk's list (TENANT-6b-2 draws it). */
  async listFor(tenantId: string, q: { status?: ReviewStatus | 'open_any'; membershipId?: string; from?: string; to?: string; cursor?: { at: string; id: string }; limit: number }): Promise<MilkQualityReview[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    if (q.status === 'open_any') where += ` AND status IN ('open','retested')`;
    else if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.membershipId) where += ` AND membership_id=${p(q.membershipId)}`;
    if (q.from) where += ` AND collected_on >= ${p(q.from)}::date`;
    if (q.to) where += ` AND collected_on <= ${p(q.to)}::date`;
    if (q.cursor) { const ca = p(q.cursor.at), ci = p(q.cursor.id); where += ` AND (opened_at < ${ca}::timestamptz OR (opened_at = ${ca}::timestamptz AND id < ${ci}))`; }
    const lp = p(Math.max(1, Math.min(100, Math.trunc(q.limit))));
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM milk_quality_reviews WHERE ${where} ORDER BY opened_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /** The cycle's flag counts by outcome — the desk's *"Flags this cycle · 4 · 3 water_flag · 1 starch"* tile. */
  async countsForWindow(tenantId: string, from: string, to: string): Promise<{ total: number; byStatus: Record<string, number>; byReason: Record<string, number>; withheldMinor: bigint }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT status, count(*)::int AS n,
              coalesce(sum(amount_withheld_minor) FILTER (WHERE status IN ('open','retested')), 0)::bigint AS withheld
         FROM milk_quality_reviews
        WHERE tenant_id=$1 AND deleted_at IS NULL AND collected_on >= $2::date AND collected_on <= $3::date
        GROUP BY status`, [tenantId, from, to]);
    const byStatus: Record<string, number> = {};
    let total = 0; let withheldMinor = 0n;
    for (const row of r.rows as any[]) {
      byStatus[String(row.status)] = Number(row.n);
      total += Number(row.n);
      withheldMinor += BigInt(row.withheld ?? 0);
    }
    // Reasons live in a jsonb array, so they are counted by unnesting rather than by grouping a column — and water is
    // counted separately from the named adulterants, the same split TENANT-6a's board makes.
    const rr = await this.replica.forTenant(tenantId).query(
      `SELECT r.reason, count(*)::int AS n
         FROM milk_quality_reviews q, jsonb_array_elements_text(q.reasons) AS r(reason)
        WHERE q.tenant_id=$1 AND q.deleted_at IS NULL AND q.collected_on >= $2::date AND q.collected_on <= $3::date
        GROUP BY r.reason ORDER BY n DESC, r.reason LIMIT 20`, [tenantId, from, to]);
    const byReason: Record<string, number> = {};
    for (const row of rr.rows as any[]) byReason[String(row.reason)] = Number(row.n);
    const water = await this.replica.forTenant(tenantId).query(
      `SELECT count(*)::int AS n FROM milk_quality_reviews
        WHERE tenant_id=$1 AND deleted_at IS NULL AND water_flag = true AND collected_on >= $2::date AND collected_on <= $3::date`,
      [tenantId, from, to]);
    const w = Number((water.rows[0] as any)?.n ?? 0);
    if (w > 0) byReason['water_flag'] = w;
    return { total, byStatus, byReason, withheldMinor };
  }
}
