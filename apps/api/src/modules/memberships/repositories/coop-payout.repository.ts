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
    // [9b] `outcome` is the database's recorded result (0182) — the payability rule asks what the vote DECIDED.
    const r = await tx.query<{ id: string; status: string; resolution_type: string; payload: Record<string, unknown>; title: string; outcome: string | null }>(
      `SELECT id, status, resolution_type, payload, title, outcome FROM coop_resolutions
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ?? null;
  }

  /** Members eligible for a co-op payout, with their PRIMARY penny-verified bank account (payouts.bank_account_id
   *  is NOT NULL, so a member without one cannot be queued — the service records them as skipped, by name).
   *  `basisMinor` depends on the formula (PC-56 TENANT-9b):
   *    • equal_split / patronage_pro_rata — the dairy members, basis = paid milk bills in the last 365 days (PC-55 A8's
   *      basis, unchanged and NAMED: a rolling year, not the fiscal year);
   *    • per_share_rate — the SHARE REGISTER's holders (shares_held > 0), basis = the total value of the holding
   *      (`share_value_minor`, 0130's stated meaning) — W198's "Dividend 8%";
   *    • patronage_pct — the dairy members, basis = paid milk bills whose period ENDS inside the cooperative's declared
   *      fiscal year [fyFrom, fyToExclusive) — W198's "1.2% of member's FY sales". The window is civil days the service
   *      computed from 0181's declared fiscal-year month; nothing here assumes April. */
  async payableMembers(tenantId: string, basis: { kind: 'rolling_365' } | { kind: 'share_register' } | { kind: 'fiscal_year'; from: string; toExclusive: string } = { kind: 'rolling_365' }): Promise<PayableMember[]> {
    const bank = `(SELECT b.id FROM bank_accounts b
                WHERE b.user_id = %U% AND b.deleted_at IS NULL AND b.penny_verified_at IS NOT NULL
                ORDER BY b.is_primary DESC, b.created_at ASC LIMIT 1)`;
    if (basis.kind === 'share_register') {
      const r = await this.replica.forTenant(tenantId).query(
        `SELECT csr.member_user_id AS user_id, ${bank.replace('%U%', 'csr.member_user_id')} AS bank_account_id,
                csr.share_value_minor::text AS basis_minor
           FROM coop_share_registers csr
          WHERE csr.tenant_id = $1 AND csr.deleted_at IS NULL AND csr.shares_held > 0
          ORDER BY csr.member_user_id ASC LIMIT 20000`, [tenantId]);
      return r.rows.map((x: any) => ({ userId: x.user_id, bankAccountId: x.bank_account_id, basisMinor: String(x.basis_minor) }));
    }
    const window = basis.kind === 'fiscal_year'
      ? `mb.period_end >= $2::date AND mb.period_end < $3::date`
      : `mb.period_end >= CURRENT_DATE - 365`;
    const params: unknown[] = basis.kind === 'fiscal_year' ? [tenantId, basis.from, basis.toExclusive] : [tenantId];
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT m.farmer_user_id AS user_id, ${bank.replace('%U%', 'm.farmer_user_id')} AS bank_account_id,
              COALESCE((SELECT SUM(mb.net_minor) FROM milk_bills mb
                         WHERE mb.tenant_id = $1 AND mb.membership_id = m.id AND mb.status = 'paid'
                           AND ${window}), 0)::text AS basis_minor
         FROM dairy_memberships m
        WHERE m.tenant_id = $1 AND m.is_active = true AND m.deleted_at IS NULL
        ORDER BY m.farmer_user_id ASC LIMIT 20000`, params);
    return r.rows.map((x: any) => ({ userId: x.user_id, bankAccountId: x.bank_account_id, basisMinor: String(x.basis_minor) }));
  }

  /** The currency the run pays in and the declared fiscal-year month — the tenant's country's, never 'INR' (F-17). */
  async moneyClock(tenantId: string): Promise<{ currency: string | null; fyMonth: number | null }> {
    const r = await this.replica.forTenant(tenantId).query<{ currency: string | null; fy_month: number | null }>(
      `SELECT c.currency_code AS currency, tenant_fiscal_year_start_month(t.id) AS fy_month
         FROM tenants t JOIN countries c ON c.code = t.country_code WHERE t.id = $1`, [tenantId]);
    const x = r.rows[0];
    return { currency: x?.currency ? String(x.currency).trim() : null, fyMonth: x?.fy_month === null || x?.fy_month === undefined ? null : Number(x.fy_month) };
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

  /** The MAKER's act (PC-56 TENANT-9b): a `prepared` run — the formula, the computed total, the members — and NO batch
   *  and NO payout row. 0182's trigger refuses it unless the resolution is payable; its checks keep money off a prepared run. */
  async insertPreparedRun(tx: TxContext, r0: { id: string; tenantId: string; resolutionId: string; purposeCode: string; formulaSnapshot: Record<string, unknown>; totalMinor: string; memberCount: number; skippedCount: number; skippedDetail: unknown[]; currencyCode: string; preparedBy: string; idempotencyKey: string }): Promise<{ ok: true } | { ok: false; conflict: 'already_run' | 'replay' }> {
    try {
      await tx.query(
        `INSERT INTO coop_payout_runs (id, tenant_id, resolution_id, batch_id, purpose_code, formula_snapshot,
             total_minor, member_count, skipped_count, skipped_detail, currency_code, status,
             prepared_by, prepared_at, idempotency_key, created_by, updated_by)
         VALUES ($1,$2,$3,NULL,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,'prepared',$11,now(),$12,$11,$11)`,
        [r0.id, r0.tenantId, r0.resolutionId, r0.purposeCode, JSON.stringify(r0.formulaSnapshot),
         r0.totalMinor, r0.memberCount, r0.skippedCount, JSON.stringify(r0.skippedDetail), r0.currencyCode,
         r0.preparedBy, r0.idempotencyKey]);
      return { ok: true };
    } catch (e: unknown) {
      const err = e as { code?: string; constraint?: string };
      if (err?.code === '23505') {
        return { ok: false, conflict: err.constraint === 'uq_coop_payout_runs_idem' ? 'replay' : 'already_run' };
      }
      throw e;
    }
  }

  async lockRun(tx: TxContext, tenantId: string, runId: string): Promise<Record<string, any> | null> {
    const r = await tx.query(`SELECT * FROM coop_payout_runs WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [runId, tenantId]);
    return r.rows[0] ?? null;
  }

  /** The CHECKER's act: the batch exists, the run is queued, and the confirming caller is recorded as the checker. */
  async confirmRun(tx: TxContext, tenantId: string, runId: string, checker: string, batchId: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE coop_payout_runs SET status='queued', batch_id=$4, confirmed_by=$3, confirmed_at=now(), updated_by=$3
        WHERE id=$1 AND tenant_id=$2 AND status='prepared' AND prepared_by <> $3`, [runId, tenantId, checker, batchId]);
    return (r.rowCount ?? 0) === 1;
  }

  async cancelPreparedRun(tx: TxContext, tenantId: string, runId: string, by: string, reason: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE coop_payout_runs SET status='cancelled', cancel_reason=$4, cancelled_by=$3, updated_by=$3
        WHERE id=$1 AND tenant_id=$2 AND status='prepared'`, [runId, tenantId, by, reason]);
    return (r.rowCount ?? 0) === 1;
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
    preparedAt: x.prepared_at ? new Date(x.prepared_at).toISOString() : null, cancelledBy: x.cancelled_by ?? null, cancelReason: x.cancel_reason ?? null,
  });
}
