// modules/memberships/repositories/coop-payout.repository.ts · PC-55 A8 (0088). tenant_id in EVERY query (Law 1).
// Writes per-member rows into the EXISTING payouts/payout_batches tables — no new money primitive.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export interface PayableMember { userId: string; bankAccountId: string | null; basisMinor: string }

@Injectable()
export class CoopPayoutRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async lockResolution(tx: TxContext, tenantId: string, id: string) {
    const r = await tx.query<{ id: string; status: string; resolution_type: string; payload: Record<string, unknown>; title: string }>(
      `SELECT id, status, resolution_type, payload, title FROM coop_resolutions
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ?? null;
  }

  /** Members eligible for a co-op payout, with their PRIMARY penny-verified bank account (payouts.bank_account_id
   *  is NOT NULL, so a member without one cannot be queued — the service records them as skipped, by name).
   *  `basisMinor` is the patronage basis: the member's own dairy business in the last 12 months, from the
   *  ledgered milk bills. Equal-split ignores it. */
  async payableMembers(tenantId: string): Promise<PayableMember[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT m.farmer_user_id AS user_id,
              (SELECT b.id FROM bank_accounts b
                WHERE b.user_id = m.farmer_user_id AND b.deleted_at IS NULL AND b.penny_verified_at IS NOT NULL
                ORDER BY b.is_primary DESC, b.created_at ASC LIMIT 1) AS bank_account_id,
              COALESCE((SELECT SUM(mb.net_minor) FROM milk_bills mb
                         WHERE mb.tenant_id = $1 AND mb.membership_id = m.id AND mb.status = 'paid'
                           AND mb.period_end >= CURRENT_DATE - 365), 0)::text AS basis_minor
         FROM dairy_memberships m
        WHERE m.tenant_id = $1 AND m.is_active = true AND m.deleted_at IS NULL
        ORDER BY m.farmer_user_id ASC LIMIT 20000`, [tenantId]);
    return r.rows.map((x: any) => ({ userId: x.user_id, bankAccountId: x.bank_account_id, basisMinor: String(x.basis_minor) }));
  }

  async insertBatch(tx: TxContext, b: { id: string; tenantId: string; batchType: string; totalMinor: string; count: number }): Promise<void> {
    await tx.query(
      `INSERT INTO payout_batches (id, tenant_id, batch_type, total_minor, count, status) VALUES ($1,$2,$3,$4,$5,'open')`,
      [b.id, b.tenantId, b.batchType, b.totalMinor, b.count]);
  }
  /** One queued payout per member. idempotency_key is UNIQUE on payouts (0006), so the run id + user id makes a
   *  replay physically impossible even if the request is retried. */
  async insertPayout(tx: TxContext, p: { id: string; tenantId: string; userId: string; bankAccountId: string; purposeCode: string; runId: string; amountMinor: string; currencyCode: string; batchId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO payouts (id, tenant_id, user_id, bank_account_id, purpose_id, reference_type, reference_id,
            amount_minor, currency_code, status, provider_code, idempotency_key, batch_id)
       VALUES ($1,$2,$3,$4,
               (SELECT id FROM lookup_values WHERE type_code='payout_purpose' AND code=$5 AND tenant_id IS NULL LIMIT 1),
               'coop_payout_run', $6, $7, $8, 'queued', 'razorpayx', $9, $10)`,
      [p.id, p.tenantId, p.userId, p.bankAccountId, p.purposeCode, p.runId, p.amountMinor, p.currencyCode,
       `coop-run:${p.runId}:${p.userId}`, p.batchId]);
  }

  async insertRun(tx: TxContext, r0: { id: string; tenantId: string; resolutionId: string; batchId: string; purposeCode: string; formulaSnapshot: Record<string, unknown>; totalMinor: string; memberCount: number; skippedCount: number; skippedDetail: unknown[]; currencyCode: string; preparedBy: string; confirmedBy: string; idempotencyKey: string }): Promise<{ ok: true } | { ok: false; conflict: 'already_run' | 'replay' }> {
    try {
      await tx.query(
        `INSERT INTO coop_payout_runs (id, tenant_id, resolution_id, batch_id, purpose_code, formula_snapshot,
             total_minor, member_count, skipped_count, skipped_detail, currency_code, status,
             prepared_by, confirmed_by, confirmed_at, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11,'queued',$12,$13,now(),$14)`,
        [r0.id, r0.tenantId, r0.resolutionId, r0.batchId, r0.purposeCode, JSON.stringify(r0.formulaSnapshot),
         r0.totalMinor, r0.memberCount, r0.skippedCount, JSON.stringify(r0.skippedDetail), r0.currencyCode,
         r0.preparedBy, r0.confirmedBy, r0.idempotencyKey]);
      return { ok: true };
    } catch (e: unknown) {
      const err = e as { code?: string; constraint?: string };
      if (err?.code === '23505') {
        return { ok: false, conflict: err.constraint === 'uq_coop_payout_runs_idem' ? 'replay' : 'already_run' };
      }
      throw e;
    }
  }

  async listRuns(tenantId: string, limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT r.*, res.title AS resolution_title, b.status AS batch_status, b.executed_at
         FROM coop_payout_runs r
         LEFT JOIN coop_resolutions res ON res.id = r.resolution_id
         LEFT JOIN payout_batches b ON b.id = r.batch_id
        WHERE r.tenant_id=$1 AND r.deleted_at IS NULL ORDER BY r.created_at DESC LIMIT $2`, [tenantId, Math.min(limit, 100)]);
    return r.rows.map(this.toRun);
  }
  async getRun(tenantId: string, id: string): Promise<Record<string, unknown> | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT r.*, res.title AS resolution_title, b.status AS batch_status, b.executed_at
         FROM coop_payout_runs r
         LEFT JOIN coop_resolutions res ON res.id = r.resolution_id
         LEFT JOIN payout_batches b ON b.id = r.batch_id
        WHERE r.id=$1 AND r.tenant_id=$2 AND r.deleted_at IS NULL`, [id, tenantId]);
    if (!r.rows[0]) return null;
    const run = this.toRun(r.rows[0]);
    const lines = await this.replica.forTenant(tenantId).query(
      `SELECT user_id, amount_minor::text AS amount_minor, status, gateway_payout_id, failure_reason
         FROM payouts WHERE tenant_id=$1 AND reference_type='coop_payout_run' AND reference_id=$2
        ORDER BY amount_minor DESC LIMIT 20000`, [tenantId, id]);
    return { ...run, lines: lines.rows.map((x: any) => ({ userId: x.user_id, amountMinor: x.amount_minor, status: x.status, gatewayPayoutId: x.gateway_payout_id, failureReason: x.failure_reason })) };
  }
  private toRun = (x: any) => ({
    id: x.id, resolutionId: x.resolution_id, resolutionTitle: x.resolution_title, batchId: x.batch_id,
    purposeCode: x.purpose_code, formulaSnapshot: x.formula_snapshot, totalMinor: String(x.total_minor),
    memberCount: x.member_count, skippedCount: x.skipped_count, skippedDetail: x.skipped_detail,
    currencyCode: x.currency_code, status: x.status, preparedBy: x.prepared_by, confirmedBy: x.confirmed_by,
    confirmedAt: x.confirmed_at ? new Date(x.confirmed_at).toISOString() : null,
    batchStatus: x.batch_status, executedAt: x.executed_at ? new Date(x.executed_at).toISOString() : null,
    createdAt: new Date(x.created_at).toISOString(),
  });
}
