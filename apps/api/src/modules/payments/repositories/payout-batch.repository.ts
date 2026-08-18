// modules/payments/repositories/payout-batch.repository.ts
// SQL for the payout BATCH bookkeeping table + the cross-tenant claim of queued payouts into a batch.
// PC-56 TENANT-4b CORRECTION. The header used to say payout_batches is "outside tenant RLS ... a run can
// span tenants", and the two read methods were written to match: `list` built `WHERE 1=1` and `getById`
// was `WHERE id=$1`, neither taking a tenant id, while the controller exposed both to any holder of
// `payout.approve`. One FPO could list another's payout runs with totals and counts. Two things changed:
// 0143 put RLS on the table (the worker roles hold BYPASSRLS, so the sweep is untouched), and EVERY read
// here now takes `tenantId` and filters on it. Two independent gates, because a policy alone would have
// been invisible in this file and a predicate alone was what we had.
// Writes on the sweep path still run on the PRIVILEGED worker connection; the approval-plane writes run
// as the app role inside a tenant-scoped UnitOfWork. Reads go to the replica (CQRS). Amounts are bigint
// minor units. Claiming uses FOR UPDATE SKIP LOCKED so concurrent workers never grab the same payout.
import { Injectable } from '@nestjs/common';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { PayoutBatch } from '../domain/payout-batch.entity';
import { PayoutBatchStatus } from '../domain/payout-batch.state';

const COLS = `id, tenant_id, batch_type, total_minor, count, status, executed_at, created_at,
  prepared_by, prepared_at, decided_by, decided_at, decision_note, cut_off_at, execute_at,
  checker_threshold_minor, preflight, items_total_minor`;

function toDomain(r: any): PayoutBatch {
  return PayoutBatch.rehydrate({
    id: r.id, tenantId: r.tenant_id, batchType: r.batch_type, totalMinor: BigInt(r.total_minor),
    count: r.count, status: r.status as PayoutBatchStatus, executedAt: r.executed_at, createdAt: r.created_at,
  });
}

/** The approval plane's own view of a batch (0143's columns). Kept as a row shape rather than folded into
 *  the PayoutBatch aggregate: the aggregate's job is the running total during a disbursement, and the
 *  approval is a different lifecycle over the same row. */
export interface PayoutBatchApprovalRow {
  id: string; tenantId: string | null; batchType: string; status: PayoutBatchStatus;
  itemsTotalMinor: bigint; totalMinor: bigint; count: number;
  preparedBy: string | null; preparedAt: Date | null;
  decidedBy: string | null; decidedAt: Date | null; decisionNote: string | null;
  cutOffAt: Date | null; executeAt: Date | null;
  checkerThresholdMinor: bigint | null;
  preflight: unknown;
  createdAt: Date;
}

function toApprovalRow(r: any): PayoutBatchApprovalRow {
  return {
    id: r.id, tenantId: r.tenant_id, batchType: r.batch_type, status: r.status as PayoutBatchStatus,
    itemsTotalMinor: BigInt(r.items_total_minor ?? 0), totalMinor: BigInt(r.total_minor), count: r.count,
    preparedBy: r.prepared_by ?? null, preparedAt: r.prepared_at ?? null,
    decidedBy: r.decided_by ?? null, decidedAt: r.decided_at ?? null, decisionNote: r.decision_note ?? null,
    cutOffAt: r.cut_off_at ?? null, executeAt: r.execute_at ?? null,
    checkerThresholdMinor: r.checker_threshold_minor === null || r.checker_threshold_minor === undefined ? null : BigInt(r.checker_threshold_minor),
    preflight: r.preflight ?? null, createdAt: r.created_at,
  };
}

@Injectable()
export class PayoutBatchRepository {
  constructor(private readonly pools: PgPoolProvider) {}

  /** Insert an OPEN batch (privileged worker tx). */
  async insert(tx: TxContext, b: PayoutBatch): Promise<void> {
    const v = b.toProps();
    await tx.query(
      `INSERT INTO payout_batches (id, tenant_id, batch_type, total_minor, count, status, executed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [v.id, v.tenantId, v.batchType, v.totalMinor.toString(), v.count, v.status, v.executedAt]);
  }

  async getForUpdate(tx: TxContext, id: string): Promise<PayoutBatch | null> {
    const r = await tx.query(`SELECT ${COLS} FROM payout_batches WHERE id=$1 FOR UPDATE`, [id]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Persist the running total + status after a transition (privileged worker tx). */
  async update(tx: TxContext, b: PayoutBatch): Promise<void> {
    const v = b.toProps();
    await tx.query(
      `UPDATE payout_batches SET total_minor=$2, count=$3, status=$4, executed_at=$5, updated_at=now() WHERE id=$1`,
      [v.id, v.totalMinor.toString(), v.count, v.status, v.executedAt]);
  }

  /** Atomically claim up to `limit` QUEUED payouts into a batch (set batch_id; keep status 'queued').
   *  Lower priority number = more urgent (wage lane first). `maxPriority` (when set) restricts the lane.
   *  FOR UPDATE SKIP LOCKED so two concurrent runs never claim the same payout. Returns (id, tenantId). */
  async claimQueuedIntoBatch(tx: TxContext, batchId: string, opts: { limit: number; maxPriority: number | null }): Promise<Array<{ id: string; tenantId: string; amountMinor: bigint }>> {
    const r = await tx.query<{ id: string; tenant_id: string; amount_minor: string }>(
      `UPDATE payouts SET batch_id=$1, updated_at=now()
        WHERE id IN (
          SELECT id FROM payouts
           WHERE status='queued' AND batch_id IS NULL AND ($3::int IS NULL OR priority <= $3)
                 AND (next_retry_at IS NULL OR next_retry_at <= now())   -- 0143: respect the backoff
           ORDER BY priority ASC, created_at ASC
           FOR UPDATE SKIP LOCKED LIMIT $2)
        RETURNING id, tenant_id, amount_minor`,
      [batchId, opts.limit, opts.maxPriority]);
    return r.rows.map((x) => ({ id: x.id, tenantId: x.tenant_id, amountMinor: BigInt(x.amount_minor) }));
  }

  /* ---------------- the approval plane (PC-56 TENANT-4b) ---------------- */

  /** Prepare: open a batch in `pending_approval` for ONE tenant and claim that tenant's queued payouts
   *  into it. Runs inside the caller's tenant-scoped tx, so 0143's WITH CHECK policy applies. */
  async insertPending(tx: TxContext, b: {
    id: string; tenantId: string; batchType: string; preparedBy: string;
    cutOffAt: Date; executeAt: Date; checkerThresholdMinor: bigint;
  }): Promise<void> {
    await tx.query(
      `INSERT INTO payout_batches (id, tenant_id, batch_type, total_minor, count, status,
                                   prepared_by, prepared_at, cut_off_at, execute_at, checker_threshold_minor, items_total_minor)
       VALUES ($1,$2,$3,0,0,'pending_approval',$4, now(), $5,$6,$7,0)`,
      [b.id, b.tenantId, b.batchType, b.preparedBy, b.cutOffAt.toISOString(), b.executeAt.toISOString(), b.checkerThresholdMinor.toString()]);
  }

  /** Claim THIS TENANT's queued payouts into a pending batch. Unlike the sweep's claim, the tenant is a
   *  hard predicate: a maker prepares their own organisation's queue and nobody else's. */
  async claimTenantQueuedIntoBatch(tx: TxContext, tenantId: string, batchId: string, opts: { limit: number; maxPriority: number | null }): Promise<Array<{ id: string; amountMinor: bigint; priority: number }>> {
    const r = await tx.query<{ id: string; amount_minor: string; priority: number }>(
      `UPDATE payouts SET batch_id=$2, updated_at=now()
        WHERE id IN (
          SELECT id FROM payouts
           WHERE tenant_id=$1 AND status='queued' AND batch_id IS NULL
                 AND ($4::int IS NULL OR priority <= $4)
                 -- 0143: a payout waiting out its backoff is NOT claimable yet. Without this a requeued
                 -- payout is retried by the next tick, which is a loop, not a backoff.
                 AND (next_retry_at IS NULL OR next_retry_at <= now())
           ORDER BY priority ASC, created_at ASC
           FOR UPDATE SKIP LOCKED LIMIT $3)
        RETURNING id, amount_minor, priority`,
      [tenantId, batchId, opts.limit, opts.maxPriority]);
    return r.rows.map((x) => ({ id: x.id, amountMinor: BigInt(x.amount_minor), priority: Number(x.priority) }));
  }

  /** THE SERVER'S OWN SUM over the claimed rows (W146: "server-verified, not UI math"). Deliberately a
   *  separate query from the claim's RETURNING, so the pre-flight compares two independently-derived
   *  figures rather than one figure with itself. */
  async sumClaimed(tx: TxContext, tenantId: string, batchId: string): Promise<{ sumMinor: bigint; count: number }> {
    const r = await tx.query<{ s: string; n: string }>(
      `SELECT COALESCE(SUM(amount_minor),0)::text AS s, count(*)::text AS n
         FROM payouts WHERE tenant_id=$1 AND batch_id=$2`, [tenantId, batchId]);
    return { sumMinor: BigInt(r.rows[0]?.s ?? '0'), count: Number(r.rows[0]?.n ?? 0) };
  }

  async setItemsTotal(tx: TxContext, tenantId: string, batchId: string, itemsTotalMinor: bigint, count: number): Promise<void> {
    await tx.query(
      `UPDATE payout_batches SET items_total_minor=$3, count=$4, updated_at=now() WHERE id=$2 AND tenant_id=$1`,
      [tenantId, batchId, itemsTotalMinor.toString(), count]);
  }

  async getPendingForUpdate(tx: TxContext, tenantId: string, id: string): Promise<PayoutBatchApprovalRow | null> {
    const r = await tx.query(`SELECT ${COLS} FROM payout_batches WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toApprovalRow(r.rows[0]) : null;
  }

  /** Record the decision. The status guard in the WHERE is the last line of defence against two checkers
   *  deciding the same batch concurrently — the row lock above is the first. */
  async recordDecision(tx: TxContext, tenantId: string, id: string, d: {
    status: 'approved' | 'rejected'; decidedBy: string; note: string | null; preflight: unknown;
  }): Promise<boolean> {
    const r = await tx.query(
      `UPDATE payout_batches
          SET status=$3, decided_by=$4, decided_at=now(), decision_note=$5, preflight=$6::jsonb, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND status='pending_approval'`,
      [id, tenantId, d.status, d.decidedBy, d.note, JSON.stringify(d.preflight ?? null)]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Release a batch's claimed payouts back to the free queue (a rejection or an expiry must not leave a
   *  farmer's money pinned to a run that will never execute). */
  async releaseClaims(tx: TxContext, tenantId: string, batchId: string): Promise<number> {
    const r = await tx.query(
      `UPDATE payouts SET batch_id=NULL, updated_at=now()
        WHERE tenant_id=$1 AND batch_id=$2 AND status='queued'`, [tenantId, batchId]);
    return r.rowCount ?? 0;
  }

  /** The payouts already claimed into a batch (the approved run's item list). */
  async claimedPayouts(tx: TxContext, tenantId: string, batchId: string): Promise<Array<{ id: string; amountMinor: bigint }>> {
    const r = await tx.query<{ id: string; amount_minor: string }>(
      `SELECT id::text AS id, amount_minor::text AS amount_minor
         FROM payouts WHERE tenant_id=$1 AND batch_id=$2 AND status='queued'
        ORDER BY priority ASC, created_at ASC`, [tenantId, batchId]);
    return r.rows.map((x) => ({ id: x.id, amountMinor: BigInt(x.amount_minor) }));
  }

  /** A tenant setting, raw (the shape 0139's refund gate reads its threshold with — one dialect, not two). */
  async settingValue(tx: TxContext, tenantId: string, key: string): Promise<unknown | null> {
    const r = await tx.query(`SELECT value FROM tenant_settings WHERE tenant_id=$1 AND key=$2`, [tenantId, key]);
    return r.rows[0] ? r.rows[0].value : null;
  }

  /** THE BATCH'S PAYEES, with everything the PER-PAYOUT gate already decides — purpose code, that person's
   *  roles with the KYC status of EACH role, whether the destination passed penny verification, and whether
   *  their wallet is frozen. The pre-flight then maps `kycVerdictFor` (domain/payout-kyc.ts) over these rows
   *  rather than re-deciding eligibility in SQL: TENANT-1 established that KYC is per ROLE, not per person,
   *  and a second implementation of that rule in a WHERE clause is how the first one drifts. */
  async batchPayeeGateRows(tx: TxContext, tenantId: string, batchId: string): Promise<Array<{
    payoutId: string; userId: string | null; purposeCode: string; bankVerified: boolean; walletFrozen: boolean;
    roles: Array<{ roleCode: string; kycStatus: string; isActive: boolean }>;
  }>> {
    const r = await tx.query<{
      payout_id: string; user_id: string | null; purpose_code: string;
      bank_verified: boolean; wallet_frozen: boolean; roles: unknown;
    }>(
      `SELECT p.id::text AS payout_id, p.user_id::text AS user_id, lv.code AS purpose_code,
              (ba.penny_verified_at IS NOT NULL) AS bank_verified,
              COALESCE(EXISTS (SELECT 1 FROM wallet_accounts wa
                                WHERE wa.owner_kind='user' AND wa.owner_user_id = p.user_id AND wa.is_frozen = true), false) AS wallet_frozen,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object('roleCode', r2.code, 'kycStatus', utr.kyc_status, 'isActive', utr.is_active))
                  FROM user_tenant_roles utr JOIN roles r2 ON r2.id = utr.role_id
                 WHERE utr.tenant_id = p.tenant_id AND utr.user_id = p.user_id AND utr.deleted_at IS NULL
              ), '[]'::jsonb) AS roles
         FROM payouts p
         JOIN bank_accounts ba ON ba.id = p.bank_account_id
         LEFT JOIN lookup_values lv ON lv.id = p.purpose_id
        WHERE p.tenant_id = $1 AND p.batch_id = $2
        ORDER BY p.priority ASC, p.created_at ASC`,
      [tenantId, batchId]);
    return r.rows.map((x) => ({
      payoutId: x.payout_id, userId: x.user_id, purposeCode: String(x.purpose_code ?? ''),
      bankVerified: Boolean(x.bank_verified), walletFrozen: Boolean(x.wallet_frozen),
      roles: Array.isArray(x.roles) ? (x.roles as Array<{ roleCode: string; kycStatus: string; isActive: boolean }>) : [],
    }));
  }

  /** Which roles may receive money for each purpose present in this batch (0125's declared map). */
  async purposeRoles(tx: TxContext, purposeCodes: string[]): Promise<Record<string, string[]>> {
    if (purposeCodes.length === 0) return {};
    const r = await tx.query<{ purpose_code: string; role_code: string }>(
      `SELECT purpose_code, role_code FROM payout_purpose_roles
        WHERE purpose_code = ANY($1::text[]) AND deleted_at IS NULL ORDER BY purpose_code, role_code`,
      [purposeCodes]);
    return r.rows.reduce<Record<string, string[]>>((acc, x) => {
      (acc[x.purpose_code] ??= []).push(x.role_code);
      return acc;
    }, {});
  }

  /** W145's queue, keyset — the FPO's outbound payouts with everything the row prints. */
  async listTenantPayouts(opts: {
    tenantId: string; statuses?: string[]; cursor?: { c: string; id: string }; limit: number;
  }): Promise<Array<{
    id: string; userId: string | null; purposeCode: string; referenceType: string | null; referenceId: string | null;
    amountMinor: string; currencyCode: string; status: string; priority: number;
    failureCode: string | null; failureReason: string | null; autoAttempts: number; nextRetryAt: Date | null;
    bankLast4: string | null; bankVerified: boolean; payeeName: string | null; payeePhone: string | null;
    batchId: string | null; createdAt: Date;
  }>> {
    const params: unknown[] = [opts.tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `p.tenant_id = $1`;
    if (opts.statuses?.length) where += ` AND p.status::text = ANY(${p(opts.statuses)}::text[])`;
    if (opts.cursor) { const cc = p(opts.cursor.c), ci = p(opts.cursor.id); where += ` AND (p.created_at < ${cc} OR (p.created_at = ${cc} AND p.id < ${ci}))`; }
    const lp = p(opts.limit);
    const r = await this.pools.replica(0).query<any>(
      `SELECT p.id::text AS id, p.user_id::text AS user_id, lv.code AS purpose_code, p.reference_type,
              p.reference_id::text AS reference_id, p.amount_minor::text AS amount_minor, p.currency_code,
              p.status::text AS status, p.priority, p.failure_code, p.failure_reason,
              p.auto_attempts, p.next_retry_at, ba.account_last4 AS bank_last4,
              (ba.penny_verified_at IS NOT NULL) AS bank_verified,
              u.full_name AS payee_name, u.phone AS payee_phone, p.batch_id::text AS batch_id, p.created_at
         FROM payouts p
         LEFT JOIN bank_accounts ba ON ba.id = p.bank_account_id
         LEFT JOIN lookup_values lv ON lv.id = p.purpose_id
         LEFT JOIN users u ON u.id = p.user_id
        WHERE ${where}
        ORDER BY p.created_at DESC, p.id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({
      id: x.id, userId: x.user_id, purposeCode: String(x.purpose_code ?? ''), referenceType: x.reference_type ?? null,
      referenceId: x.reference_id ?? null, amountMinor: x.amount_minor, currencyCode: x.currency_code,
      status: x.status, priority: Number(x.priority), failureCode: x.failure_code ?? null,
      failureReason: x.failure_reason ?? null, autoAttempts: Number(x.auto_attempts ?? 0),
      nextRetryAt: x.next_retry_at ?? null, bankLast4: x.bank_last4 ?? null, bankVerified: Boolean(x.bank_verified),
      payeeName: x.payee_name ?? null, payeePhone: x.payee_phone ?? null, batchId: x.batch_id ?? null, createdAt: x.created_at,
    }));
  }

  /** W145's tab counts, one query, tenant-scoped. */
  async countsByStatus(tenantId: string): Promise<Record<string, number>> {
    const r = await this.pools.replica(0).query<{ status: string; n: string }>(
      `SELECT status::text AS status, count(*)::text AS n FROM payouts WHERE tenant_id=$1 GROUP BY 1`, [tenantId]);
    return r.rows.reduce<Record<string, number>>((a, x) => { a[x.status] = Number(x.n); return a; }, {});
  }

  /** W145's "Retry" (W2443–W2445's chain): requeue ONE failed payout with its backoff recorded. The status
   *  move is the state machine's `failed -> queued` edge; the attempt counter and the next-attempt time are
   *  0143's columns, without which "auto-retry with backoff" could not exist. */
  async requeueFailed(tx: TxContext, tenantId: string, payoutId: string, nextRetryAt: Date): Promise<boolean> {
    const r = await tx.query(
      `UPDATE payouts
          SET status='queued', batch_id=NULL, auto_attempts = auto_attempts + 1,
              next_retry_at=$3, updated_at=now()
        WHERE id=$2 AND tenant_id=$1 AND status='failed'`,
      [tenantId, payoutId, nextRetryAt.toISOString()]);
    return (r.rowCount ?? 0) > 0;
  }

  async getPayoutForRetry(tx: TxContext, tenantId: string, payoutId: string): Promise<{ id: string; status: string; failureCode: string | null; autoAttempts: number; updatedAt: Date } | null> {
    const r = await tx.query<{ id: string; status: string; failure_code: string | null; auto_attempts: number; updated_at: Date }>(
      `SELECT id::text AS id, status::text AS status, failure_code, auto_attempts, updated_at
         FROM payouts WHERE id=$2 AND tenant_id=$1 FOR UPDATE`, [tenantId, payoutId]);
    const x = r.rows[0];
    return x ? { id: x.id, status: x.status, failureCode: x.failure_code ?? null, autoAttempts: Number(x.auto_attempts ?? 0), updatedAt: x.updated_at } : null;
  }

  // --- reads (replica, CQRS) — tenant-scoped since PC-56 TENANT-4b ---
  async getById(tenantId: string, id: string): Promise<PayoutBatch | null> {
    const r = await this.pools.replica(0).query(`SELECT ${COLS} FROM payout_batches WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async getApprovalById(tenantId: string, id: string): Promise<PayoutBatchApprovalRow | null> {
    const r = await this.pools.replica(0).query(`SELECT ${COLS} FROM payout_batches WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toApprovalRow(r.rows[0]) : null;
  }

  async list(opts: { tenantId: string; status?: PayoutBatchStatus; batchType?: string; cursor?: { c: string; id: string }; limit: number }): Promise<PayoutBatch[]> {
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `tenant_id=${p(opts.tenantId)}`;
    if (opts.status) where += ` AND status=${p(opts.status)}`;
    if (opts.batchType) where += ` AND batch_type=${p(opts.batchType)}`;
    if (opts.cursor) { const cc = p(opts.cursor.c), ci = p(opts.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(opts.limit);
    const r = await this.pools.replica(0).query(`SELECT ${COLS} FROM payout_batches WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
