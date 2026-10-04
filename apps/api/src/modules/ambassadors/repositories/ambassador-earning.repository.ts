// modules/ambassadors/repositories/ambassador-earning.repository.ts · ambassador_earnings (PARTITIONED by
// created_at; append-only). tenant_id in every query (Law 1) + RLS. Accrual idempotency is enforced in-service
// via existsFor (the table's UNIQUE includes created_at — the partition key — so it can't dedupe on its own).
// payout settle stamps payout_id; updates bind (id, created_at) so PG prunes to the row's partition (Law 8).
//
// PC-56 TENANT-10a · F-1 (DEV-55) — THE STAMP NOW MATCHES WHAT IT LOCKED. `markPaid` used to bind a JS `Date`
// (milliseconds) against a microsecond column: zero rows matched, the wallet had already paid, and the next payout paid
// the same rows again. `created_at` is now selected as TEXT (`created_at::text AS created_at_raw`, every digit) and bound
// back as `$::timestamptz`, which round-trips exactly; the stamp is ONE statement over the locked set and returns how many
// rows it stamped, so the service can refuse (and roll the wallet leg back) when that is not every locked row.
// F-17: the list cursor is minted from the same raw text and compared as `timestamptz`.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { AmbassadorEarning } from '../domain/ambassador-earning.entity';

const COLS = `id, tenant_id, ambassador_id, plan_id, event_code, reference_type, reference_id, amount_minor, payout_id, subject_user_id, created_at, created_at::text AS created_at_raw`;
function toDomain(r: any): AmbassadorEarning {
  return AmbassadorEarning.rehydrate({ id: r.id, tenantId: r.tenant_id, ambassadorId: r.ambassador_id, planId: r.plan_id, eventCode: r.event_code,
    referenceType: r.reference_type, referenceId: r.reference_id, amountMinor: BigInt(r.amount_minor), payoutId: r.payout_id,
    subjectUserId: r.subject_user_id ?? null, createdAt: r.created_at, createdAtRaw: r.created_at_raw });
}
export interface EarningListQuery { unpaidOnly?: boolean; cursor?: { c: string; id: string }; limit: number; }
export interface LockedEarningKey { id: string; createdAtRaw: string }

@Injectable()
export class AmbassadorEarningRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, e: AmbassadorEarning): Promise<void> {
    const p = e.toProps();
    await tx.query(
      `INSERT INTO ambassador_earnings (id, tenant_id, ambassador_id, plan_id, event_code, reference_type, reference_id, amount_minor, subject_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.id, p.tenantId, p.ambassadorId, p.planId, p.eventCode, p.referenceType, p.referenceId, p.amountMinor.toString(), p.subjectUserId ?? null]);
  }
  /** Idempotency guard for accrual: has this (ambassador, event, reference) already been credited? */
  async existsFor(tx: TxContext, ambassadorId: string, eventCode: string, referenceId: string | null): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM ambassador_earnings WHERE ambassador_id=$1 AND event_code=$2 AND reference_id IS NOT DISTINCT FROM $3 LIMIT 1`, [ambassadorId, eventCode, referenceId]);
    return (r.rowCount ?? 0) > 0;
  }
  /** F-5: how many earnings of this event this ambassador has already accrued on this farmer (the per-farmer cap). */
  async countForSubject(tx: TxContext, tenantId: string, ambassadorId: string, eventCode: string, subjectUserId: string): Promise<number> {
    const r = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ambassador_earnings WHERE tenant_id=$1 AND ambassador_id=$2 AND event_code=$3 AND subject_user_id=$4`,
      [tenantId, ambassadorId, eventCode, subjectUserId]);
    return Number(r.rows[0]?.n ?? 0);
  }
  /** Unpaid earnings for an ambassador, locked for a payout batch (FOR UPDATE SKIP LOCKED, bounded). */
  async lockUnpaid(tx: TxContext, tenantId: string, ambassadorId: string, max = 1000): Promise<AmbassadorEarning[]> {
    const r = await tx.query(`SELECT ${COLS} FROM ambassador_earnings WHERE tenant_id=$1 AND ambassador_id=$2 AND payout_id IS NULL ORDER BY created_at, id LIMIT ${max} FOR UPDATE SKIP LOCKED`, [tenantId, ambassadorId]);
    return r.rows.map(toDomain);
  }
  /** PC-56 TENANT-SW-b: the unpaid earnings a run line covers — created at or before the run's period end — locked (a run line
   *  pays exactly these and nothing earned after its Thursday sweep: "events earned after Thursday roll to next Friday"). */
  async lockUnpaidUpTo(tx: TxContext, tenantId: string, ambassadorId: string, periodEnd: Date, max = 5000): Promise<AmbassadorEarning[]> {
    const r = await tx.query(`SELECT ${COLS} FROM ambassador_earnings WHERE tenant_id=$1 AND ambassador_id=$2 AND payout_id IS NULL AND created_at <= $3
       ORDER BY created_at, id LIMIT ${max} FOR UPDATE`, [tenantId, ambassadorId, periodEnd]);
    return r.rows.map(toDomain);
  }
  /**
   * Stamp `payout_id` on exactly the locked set. Returns the number of rows stamped — the service compares it with the
   * number it locked and throws inside the transaction when they differ (the wallet leg rolls back with it).
   * Matching is by `(id, created_at = raw::timestamptz)` — the partition key, at full precision — and `payout_id IS NULL`.
   */
  async markPaid(tx: TxContext, tenantId: string, keys: LockedEarningKey[], payoutId: string): Promise<number> {
    if (keys.length === 0) return 0;
    const r = await tx.query(
      `UPDATE ambassador_earnings e SET payout_id = $4
         FROM unnest($2::uuid[], $3::text[]) AS k(id, created_at_raw)
        WHERE e.tenant_id = $1 AND e.id = k.id AND e.created_at = k.created_at_raw::timestamptz AND e.payout_id IS NULL`,
      [tenantId, keys.map((k) => k.id), keys.map((k) => k.createdAtRaw), payoutId]);
    return r.rowCount ?? 0;
  }
  /** A13: the active ambassadors in this tenant with at least one unpaid earning (the weekly run's worklist). */
  async ambassadorsWithUnpaid(tenantId: string): Promise<string[]> {
    const r = await this.replica.forTenant(tenantId).query<{ id: string }>(
      `SELECT a.id FROM ambassador_profiles a
        WHERE a.tenant_id=$1 AND a.is_active AND a.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM ambassador_earnings e WHERE e.tenant_id=$1 AND e.ambassador_id=a.id AND e.payout_id IS NULL)
        ORDER BY a.id`, [tenantId]);
    return r.rows.map((x) => x.id);
  }
  async listForAmbassador(tenantId: string, ambassadorId: string, q: EarningListQuery): Promise<AmbassadorEarning[]> {
    const params: unknown[] = [tenantId, ambassadorId]; let where = `tenant_id=$1 AND ambassador_id=$2`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.unpaidOnly) where += ` AND payout_id IS NULL`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc}::timestamptz OR (created_at = ${cc}::timestamptz AND id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM ambassador_earnings WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
