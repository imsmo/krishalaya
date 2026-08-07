// modules/payments/repositories/payout.repository.ts
// All SQL for the payouts aggregate (tenant_id in EVERY query — Law 1; RLS is the net).
// The worker's payout-execution job claims due payouts with FOR UPDATE SKIP LOCKED (next wave).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { servableTranslation } from '../../../core/database/translation-visibility';
import { Payout } from '../domain/payout.entity';
import { PayoutStatus } from '../domain/payout.state';

const COLS = `id, tenant_id, user_id, bank_account_id, purpose_id, reference_type, reference_id, amount_minor,
  currency_code, status, priority, provider_code, gateway_payout_id, idempotency_key, failure_code,
  failure_reason, ledger_txn_id, batch_id, created_at`;
const big = (v: any) => BigInt(v);

function toDomain(r: any): Payout {
  return Payout.rehydrate({
    id: r.id, tenantId: r.tenant_id, userId: r.user_id, bankAccountId: r.bank_account_id, purposeId: r.purpose_id,
    referenceType: r.reference_type, referenceId: r.reference_id, amountMinor: big(r.amount_minor), currencyCode: r.currency_code,
    status: r.status as PayoutStatus, priority: r.priority, providerCode: r.provider_code, gatewayPayoutId: r.gateway_payout_id,
    idempotencyKey: r.idempotency_key, failureCode: r.failure_code, failureReason: r.failure_reason, ledgerTxnId: r.ledger_txn_id,
    batchId: r.batch_id, createdAt: r.created_at,
  });
}

@Injectable()
export class PayoutRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Bank account must belong to the user (and tenant). Prevents paying out to someone else's bank. */
  async bankAccountBelongsTo(tx: TxContext, tenantId: string, userId: string, bankAccountId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM bank_accounts WHERE id=$1 AND user_id=$2 AND (tenant_id=$3 OR tenant_id IS NULL)`, [bankAccountId, userId, tenantId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** S3 review finding: money-out KYC gate. Payout is user-level (not role-specific), so this passes
   *  as soon as the caller has kyc_status='verified' on ANY of their active roles in this tenant —
   *  'none'/'pending'/'rejected'/'expired' all fail closed. `user_tenant_roles` is a shared core table
   *  (communication's broadcast.repository reads it the same cross-module way) so payments queries it
   *  directly rather than reaching into modules/identity. Read-only, tenant-scoped (Law 1); run inside
   *  the caller's tx so the check and the debit that follows see the same snapshot. */
  async callerKycVerified(tx: TxContext, tenantId: string, userId: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM user_tenant_roles WHERE tenant_id=$1 AND user_id=$2 AND is_active=true AND kyc_status='verified' AND deleted_at IS NULL LIMIT 1`,
      [tenantId, userId]);
    return (r.rowCount ?? 0) > 0;
  }

  async resolvePurposeId(tx: TxContext, code: string): Promise<string | null> {
    const r = await tx.query<{ id: string }>(`SELECT id FROM lookup_values WHERE type_code='payout_purpose' AND tenant_id IS NULL AND code=$1 AND is_active=true`, [code]);
    return r.rows[0]?.id ?? null;
  }

  /** KV-BL-023: locale-resolved labels for the (tiny, ~5-row) `payout_failure_reason` lookup_values vocabulary —
   *  bucket code → display name, platform + this tenant's own values (a tenant row shadows a platform row of the
   *  same code), same COALESCE(translations.text, default_name) resolution LookupsService.values() uses — including,
   *  since PC-56 ADMIN-3b, the same `servableTranslation()` predicate, so an unreviewed machine draft never becomes the
   *  label on somebody's failed payout. Loaded
   *  once per list()/getById() call (the vocabulary is tiny and bounded — no per-row query, no cache needed). */
  async failureReasonLabels(tenantId: string, lang: string): Promise<Map<string, string>> {
    const lc = (lang || 'en').trim().toLowerCase().split(/[-_]/)[0] || 'en';
    const r = await this.replica.forTenant(tenantId).query<{ code: string; name: string }>(
      `WITH v AS (
         SELECT DISTINCT ON (lv.code) lv.id, lv.code, lv.default_name
           FROM lookup_values lv
          WHERE lv.type_code = 'payout_failure_reason' AND lv.is_active = true AND (lv.tenant_id IS NULL OR lv.tenant_id = $1)
          ORDER BY lv.code, (lv.tenant_id IS NULL)
       )
       SELECT v.code, COALESCE(t.text, v.default_name) AS name
         FROM v
         LEFT JOIN translations t
           ON t.entity_type = 'lookup_value' AND t.entity_id = v.id AND t.field = 'name' AND t.language_code = $2
           AND ${servableTranslation('t')}`,
      [tenantId, lc]);
    return new Map(r.rows.map((x) => [x.code, x.name]));
  }

  /** Insert a queued payout. Idempotent at the unique idempotency_key (returns existing id on replay). */
  async insertIdempotent(tx: TxContext, p: Payout): Promise<{ id: string; replayed: boolean }> {
    const v = p.toProps();
    const ins = await tx.query<{ id: string }>(
      `INSERT INTO payouts (id, tenant_id, user_id, bank_account_id, purpose_id, reference_type, reference_id, amount_minor,
        currency_code, status, priority, provider_code, idempotency_key, ledger_txn_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [v.id, v.tenantId, v.userId, v.bankAccountId, v.purposeId, v.referenceType, v.referenceId, v.amountMinor.toString(),
       v.currencyCode, v.status, v.priority, v.providerCode, v.idempotencyKey, v.ledgerTxnId]);
    if (ins.rows[0]) return { id: ins.rows[0].id, replayed: false };
    const prior = await tx.query<{ id: string }>(`SELECT id FROM payouts WHERE idempotency_key=$1`, [v.idempotencyKey]);
    return { id: prior.rows[0].id, replayed: true };
  }

  /** The gateway fund-account token for a payout's bank account (never raw bank details). */
  /** The last four digits of the payee's bank account, for the `payout.credited` notification body.
   *
   *  PC-56 ADMIN-6b. Four digits and nothing else — a notification payload is read by every handler subscribed to the
   *  event and persisted in `notifications`, so it is the last place a full account number should appear. Returns null
   *  rather than throwing when the account is a UPI id with no `account_last4`: a message that says "sent to your bank
   *  account ending —" is worse than one that omits the clause, and the template's `{{last4}}` renders empty. */
  async bankLast4(tx: TxContext, tenantId: string, bankAccountId: string): Promise<string | null> {
    const r = await tx.query<{ account_last4: string | null }>(
      `SELECT account_last4 FROM bank_accounts WHERE id=$1 AND (tenant_id=$2 OR tenant_id IS NULL)`,
      [bankAccountId, tenantId]);
    return r.rows[0]?.account_last4 ?? null;
  }

  async fundAccountRef(tx: TxContext, tenantId: string, bankAccountId: string): Promise<string | null> {
    const r = await tx.query<{ vault_ref: string }>(`SELECT vault_ref FROM bank_accounts WHERE id=$1 AND (tenant_id=$2 OR tenant_id IS NULL)`, [bankAccountId, tenantId]);
    return r.rows[0]?.vault_ref ?? null;
  }

  /** Atomically claim up to `limit` QUEUED payouts (any tenant) → mark 'processing' so no other
   *  worker re-executes them. Runs on the privileged relay/worker connection. Highest priority first.
   *
   *  PC-56 ADMIN-6b — **THE BATCH APPROVAL GATE, AND UNTIL NOW THIS QUERY DID NOT KNOW BATCHES EXISTED.**
   *  It was `WHERE status='queued'` and nothing else. W066's subtitle is "every batch checker-approved before
   *  execution" and W067 renders "Approve & execute" with maker ≠ checker enforced — over a claim that would already
   *  have disbursed every payout in the batch on whichever 5-minute tick came first. An operator pressing Approve
   *  would have believed they were the gate.
   *
   *  AN UNBATCHED PAYOUT IS STILL CLAIMED, and that is a deliberate line rather than an omission. A farmer requesting
   *  their own wallet withdrawal is instructing us about their own money — KYC-gated at request, funded from their own
   *  reserved balance. Requiring a Krishalaya employee to approve a labourer's own wages leaving their own wallet is a
   *  control that protects nobody and blocks the thing the platform is for. What needs two people is a BATCH: money
   *  the platform moves on many people's behalf in one act.
   *
   *  THE `EXISTS` IS THE SECOND LINE OF DEFENCE, NOT THE ONLY ONE. 0114 puts the same rule in a BEFORE UPDATE trigger
   *  on `payouts`, because a money gate living in one repository method is one careless query away from being gone and
   *  no CHECK constraint can reach another table. This clause exists so the claim SKIPS an unapproved payout quietly
   *  (leaving it queued for the next tick) instead of the trigger raising and aborting the whole claim transaction —
   *  which would take every other payout in the tick down with it. The trigger is the guarantee; this is the manners.
   *
   *  'executing' passes as well as 'approved' because `PayoutBatchService.runBatch` marks the batch executing BEFORE
   *  disbursing its payouts. Accepting only 'approved' would refuse every payout in a run that had correctly announced
   *  itself. */
  async claimQueued(systemTx: TxContext, limit: number): Promise<Array<{ id: string; tenantId: string }>> {
    const r = await systemTx.query<{ id: string; tenant_id: string }>(
      `UPDATE payouts SET status='processing', updated_at=now()
        WHERE id IN (
          SELECT p.id FROM payouts p
           WHERE p.status='queued'
             AND (p.batch_id IS NULL
                  OR EXISTS (SELECT 1 FROM payout_batches b
                              WHERE b.id = p.batch_id AND b.status IN ('approved','executing')))
           ORDER BY p.priority ASC, p.created_at ASC
           FOR UPDATE SKIP LOCKED LIMIT $1)
        RETURNING id, tenant_id`, [limit]);
    return r.rows.map((x) => ({ id: x.id, tenantId: x.tenant_id }));
  }

  /** How many queued payouts are sitting behind an unapproved batch, and how much money that is.
   *
   *  PC-56 ADMIN-6b. The gate above is silent by design — it skips rather than raising — and a silent gate needs a
   *  number somewhere or it becomes indistinguishable from a stalled queue. This feeds the `kv_payouts_awaiting_
   *  approval` gauge, which is the lesson 0113 taught: the recon staleness alarm could never fire because its gauge
   *  was hardcoded, so a gate that holds money must publish the size of what it is holding. */
  async awaitingApproval(systemTx: TxContext): Promise<{ count: number; totalMinor: string }> {
    const r = await systemTx.query<{ n: string; total: string }>(
      `SELECT count(*)::text AS n, COALESCE(SUM(p.amount_minor), 0)::text AS total
         FROM payouts p
         JOIN payout_batches b ON b.id = p.batch_id
        WHERE p.status='queued' AND b.status NOT IN ('approved','executing')`);
    return { count: Number(r.rows[0]?.n ?? '0'), totalMinor: r.rows[0]?.total ?? '0' };
  }

  /** Promote a labour booking's still-QUEUED payouts into the wage priority lane (lower number =
   *  disbursed first). In-module table only (Law 11 — payments never reads labour's tables); scoped
   *  to the tenant + booking reference. Idempotent: only lowers priority still above the lane.
   *  Returns the number of payouts promoted. */
  async promoteToWageLane(tx: TxContext, tenantId: string, bookingId: string, lanePriority: number): Promise<number> {
    const r = await tx.query(
      `UPDATE payouts SET priority=$3, updated_at=now()
        WHERE tenant_id=$1 AND reference_type='labour_booking' AND reference_id=$2 AND status='queued' AND priority > $3`,
      [tenantId, bookingId, lanePriority]);
    return r.rowCount ?? 0;
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Payout | null> {
    const r = await tx.query(`SELECT ${COLS} FROM payouts WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Lock a payout by its gateway (RazorpayX) id within the signed-notes tenant — used by the async
   *  payout webhook to confirm processing→success/reverse. tenant_id scoped (the webhook runs in the
   *  signature-verified tenant context). */
  async getByGatewayIdForUpdate(tx: TxContext, tenantId: string, gatewayPayoutId: string): Promise<Payout | null> {
    const r = await tx.query(`SELECT ${COLS} FROM payouts WHERE gateway_payout_id=$1 AND tenant_id=$2 FOR UPDATE`, [gatewayPayoutId, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Persist mutable payout fields after a transition (status/gateway id/failure/ledger link). */
  async update(tx: TxContext, p: Payout): Promise<void> {
    const v = p.toProps();
    await tx.query(
      `UPDATE payouts SET status=$3, gateway_payout_id=$4, failure_code=$5, failure_reason=$6, ledger_txn_id=$7, updated_at=now()
        WHERE id=$1 AND tenant_id=$2`,
      [v.id, v.tenantId, v.status, v.gatewayPayoutId, v.failureCode, v.failureReason, v.ledgerTxnId]);
  }

  async getVisible(tenantId: string, id: string, viewerUserId: string, canModerate: boolean): Promise<Payout | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM payouts WHERE id=$1 AND tenant_id=$2 AND ($3=true OR user_id=$4)`, [id, tenantId, canModerate, viewerUserId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async listForUser(tenantId: string, userId: string, opts: { cursor?: { c: string; id: string }; limit: number }): Promise<Payout[]> {
    const params: unknown[] = [tenantId, userId];
    let where = `tenant_id=$1 AND user_id=$2`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (opts.cursor) { const cc = p(opts.cursor.c), ci = p(opts.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(opts.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM payouts WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
