// modules/tenancy/repositories/plan-change.repository.ts · the SQL 0126 was written for (PC-56 TENANT-1d-2).
//
// 0126 created `subscription_plan_changes`, four `pending_*` columns on `subscriptions`, and `billing.tax_bp`. **NOTHING IN
// THE CODEBASE TOUCHED ANY OF IT** — `grep -rn "prorate("` returned the proration test and nothing else, so every upgrade
// still ran through `SubscriptionService.changePlan`, which swaps the price and bills nothing. This file is the missing half.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { ChangeDirection, ProrationLines } from '../domain/proration';
import { pgDate } from '../../../core/database/pg-date';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date. The shape this file used —
// `String(row.some_date).slice(0, 10)` — yields "Mon Jul 13" for the JS Date node-pg hands back for a `date`
// (oid 1082), in EVERY timezone. Verified against the live schema: every column it was applied to here is a
// `date`. `pgDate` returns the calendar day PostgreSQL holds and passes an already-formatted string through.

/** Role codes that count against `max_staff` — the desks that operate a console. Mirrors TENANT-1c's go-live list. */
export const STAFF_ROLE_CODES = ['tenant_admin', 'tenant_staff', 'fpo_coordinator', 'support_agent', 'auditor'];
/** Role codes that count against `max_farmers` — the people the organisation serves. */
export const MEMBER_ROLE_CODES = ['farmer', 'dairy_farmer', 'pashupalak', 'worker', 'sardar', 'vyapari', 'organic_store'];

export interface PlanChangeRow {
  id: string;
  subscriptionId: string;
  fromPlanId: string;
  toPlanId: string;
  direction: ChangeDirection;
  effectiveDate: string;
  appliedAt: string | null;
  daysInPeriod: number;
  daysRemaining: number;
  newPlanChargeMinor: string;
  unusedCreditMinor: string;
  netDueMinor: string;
  taxBp: number;
  taxMinor: string;
  totalDueMinor: string;
  currencyCode: string;
  invoiceId: string | null;
  idempotencyKey: string;
  limitBreaches: unknown;
  reason: string | null;
  createdAt: string;
}

const toRow = (r: any): PlanChangeRow => ({
  id: r.id, subscriptionId: r.subscription_id, fromPlanId: r.from_plan_id, toPlanId: r.to_plan_id,
  direction: r.direction, effectiveDate: pgDate(r.effective_date),
  appliedAt: r.applied_at ? new Date(r.applied_at).toISOString() : null,
  daysInPeriod: Number(r.days_in_period), daysRemaining: Number(r.days_remaining),
  newPlanChargeMinor: String(r.new_plan_charge_minor), unusedCreditMinor: String(r.unused_credit_minor),
  netDueMinor: String(r.net_due_minor), taxBp: Number(r.tax_bp), taxMinor: String(r.tax_minor),
  totalDueMinor: String(r.total_due_minor), currencyCode: r.currency_code,
  invoiceId: r.invoice_id ?? null, idempotencyKey: r.idempotency_key,
  limitBreaches: r.limit_breaches ?? [], reason: r.reason ?? null,
  createdAt: new Date(r.created_at).toISOString(),
});

@Injectable()
export class PlanChangeRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * What the tenant is actually using, counted LIVE.
   *
   * **THE OBVIOUS SOURCE — `usage_counters` — WOULD HAVE MADE W119's WARNING PRINT NOTHING, EVER.** `SubscriptionService`
   * already has `readUsage()` reading that table, and it was the natural thing to pass to `limitBreaches`. But nothing in
   * the codebase calls `QuotaService.increment` for `max_farmers` or `max_staff` — only `warehouses`, scheme applications
   * and farming contracts consume quota — so those counters have no rows, `readUsage` returns `{}`, and every breach check
   * would come back clean. W119's heads-up ("you have 1,284 members and 7 staff — over Starter's limits") would be a
   * sentence the code could never produce.
   *
   * **AND THE DIRECTION OF THAT MISTAKE IS THE DANGEROUS ONE**: unknown read as zero means NO WARNING, so a co-operative
   * downgrades to save money and only discovers the cap when its next import fails. So the counts come from
   * `user_tenant_roles`, the same place TENANT-1c's go-live checklist counts them — one query, two grouped filters.
   */
  async liveUsage(tenantId: string): Promise<Record<string, string>> {
    const r = await this.replica.forTenant(tenantId).query<{ members: number; staff: number }>(
      `SELECT COUNT(*) FILTER (WHERE ro.code = ANY($2::text[]))::int AS members,
              COUNT(*) FILTER (WHERE ro.code = ANY($3::text[]))::int AS staff
         FROM user_tenant_roles utr
         JOIN roles ro ON ro.id = utr.role_id
        WHERE utr.tenant_id = $1 AND utr.is_active = true AND utr.deleted_at IS NULL`,
      [tenantId, MEMBER_ROLE_CODES, STAFF_ROLE_CODES]);
    const x = r.rows[0];
    return { max_farmers: String(x?.members ?? 0), max_staff: String(x?.staff ?? 0) };
  }

  /** The target plan's limits, as the string map `limitBreaches` compares against. */
  async planLimits(tenantId: string, planId: string): Promise<Record<string, string>> {
    const r = await this.replica.forTenant(tenantId).query<{ limit_code: string; limit_value: string }>(
      `SELECT limit_code, limit_value::text FROM plan_limits WHERE plan_id = $1`, [planId]);
    return Object.fromEntries(r.rows.map((x) => [x.limit_code, String(x.limit_value)]));
  }

  /**
   * Insert the change record. Returns null when this exact change was already recorded.
   *
   * **THE IDEMPOTENCY IS THE UNIQUE INDEX, NOT THE `ON CONFLICT`.** W119 promises "idempotent — a double click cannot
   * charge twice", and the index `(tenant_id, idempotency_key)` is what makes that true even for two requests racing in
   * separate transactions; `DO NOTHING` is how this caller learns which one lost.
   */
  async insertChange(tx: TxContext, input: {
    id: string; tenantId: string; subscriptionId: string; fromPlanId: string; toPlanId: string;
    lines: ProrationLines; fromPriceMinor: bigint; toPriceMinor: bigint;
    taxBp: number; currencyCode: string; invoiceId: string | null;
    idempotencyKey: string; limitBreaches: unknown; actorUserId: string; reason: string | null;
    appliedAt: Date | null;
  }): Promise<PlanChangeRow | null> {
    const l = input.lines;
    const r = await tx.query(
      `INSERT INTO subscription_plan_changes
         (id, tenant_id, subscription_id, from_plan_id, to_plan_id, direction, effective_date, applied_at,
          days_in_period, days_remaining, from_price_minor, to_price_minor,
          new_plan_charge_minor, unused_credit_minor, net_due_minor, tax_bp, tax_minor, total_due_minor,
          currency_code, invoice_id, idempotency_key, limit_breaches, actor_user_id, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23,$24)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [input.id, input.tenantId, input.subscriptionId, input.fromPlanId, input.toPlanId, l.direction, l.effectiveDate,
        input.appliedAt, l.daysInPeriod, l.daysRemaining, input.fromPriceMinor.toString(), input.toPriceMinor.toString(),
        l.newPlanChargeMinor.toString(), l.unusedCreditMinor.toString(), l.netDueMinor.toString(),
        input.taxBp, l.taxMinor.toString(), l.totalDueMinor.toString(), input.currencyCode, input.invoiceId,
        input.idempotencyKey, JSON.stringify(input.limitBreaches ?? []), input.actorUserId, input.reason]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /** The change already recorded under this key — what a second click is shown instead of a second invoice. */
  async findByIdempotencyKey(tx: TxContext, tenantId: string, key: string): Promise<PlanChangeRow | null> {
    const r = await tx.query(`SELECT * FROM subscription_plan_changes WHERE tenant_id = $1 AND idempotency_key = $2`, [tenantId, key]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /**
   * Park a scheduled downgrade on the subscription.
   *
   * The four columns move together — 0126's `ck_sub_pending_complete` refuses a half-scheduled change, because a pending
   * plan with no date never applies and a date with no plan applies nothing, and either is a change a tenant discovers did
   * not happen when their bill does not move.
   */
  async setPending(tx: TxContext, tenantId: string, subscriptionId: string, p: {
    planId: string; priceMinor: bigint; effectiveDate: string; reason: string;
  }): Promise<void> {
    await tx.query(
      `UPDATE subscriptions
          SET pending_plan_id = $3, pending_price_minor = $4, pending_effective_date = $5, pending_reason = $6, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [subscriptionId, tenantId, p.planId, p.priceMinor.toString(), p.effectiveDate, p.reason.slice(0, 300)]);
  }

  async clearPending(tx: TxContext, tenantId: string, subscriptionId: string): Promise<void> {
    await tx.query(
      `UPDATE subscriptions
          SET pending_plan_id = NULL, pending_price_minor = NULL, pending_effective_date = NULL, pending_reason = NULL, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`, [subscriptionId, tenantId]);
  }

  /** What the console shows above the compare table: a change already waiting, in the words the tenant was given. */
  async readPending(tenantId: string, subscriptionId: string): Promise<{ planId: string; planName: string; priceMinor: string; effectiveDate: string; reason: string | null } | null> {
    const r = await this.replica.forTenant(tenantId).query<any>(
      `SELECT s.pending_plan_id, s.pending_price_minor::text AS price, s.pending_effective_date, s.pending_reason, p.default_name
         FROM subscriptions s
         LEFT JOIN plans p ON p.id = s.pending_plan_id
        WHERE s.id = $1 AND s.tenant_id = $2 AND s.pending_plan_id IS NOT NULL`, [subscriptionId, tenantId]);
    const x = r.rows[0];
    if (!x) return null;
    return {
      planId: x.pending_plan_id, planName: x.default_name ?? '', priceMinor: String(x.price),
      effectiveDate: pgDate(x.pending_effective_date), reason: x.pending_reason ?? null,
    };
  }

  /** The change history for one subscription — W2809's "View audit trail" has somewhere real to point. */
  async history(tenantId: string, subscriptionId: string, limit = 20): Promise<PlanChangeRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT * FROM subscription_plan_changes
        WHERE tenant_id = $1 AND subscription_id = $2 AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT $3`, [tenantId, subscriptionId, limit]);
    return r.rows.map(toRow);
  }

  /**
   * The worker's sweep: scheduled changes whose day has come. Cross-tenant, so it runs on the relay pool inside the job's
   * own transaction rather than through the tenant replica.
   */
  async findDuePending(tx: TxContext, today: string, limit: number): Promise<Array<{
    tenantId: string; subscriptionId: string; pendingPlanId: string; pendingPriceMinor: string; effectiveDate: string;
  }>> {
    const r = await tx.query(
      `SELECT tenant_id, id, pending_plan_id, pending_price_minor::text AS price, pending_effective_date
         FROM subscriptions
        WHERE pending_plan_id IS NOT NULL
          AND pending_effective_date <= $1::date
          AND deleted_at IS NULL
        ORDER BY pending_effective_date
        LIMIT $2`, [today, limit]);
    return r.rows.map((x: any) => ({
      tenantId: x.tenant_id, subscriptionId: x.id, pendingPlanId: x.pending_plan_id,
      pendingPriceMinor: String(x.price), effectiveDate: pgDate(x.pending_effective_date),
    }));
  }

  /** Stamp the pending change as applied. Scoped by `applied_at IS NULL` so a re-run cannot re-stamp it. */
  async markApplied(tx: TxContext, tenantId: string, subscriptionId: string, at: Date): Promise<void> {
    await tx.query(
      `UPDATE subscription_plan_changes
          SET applied_at = $3
        WHERE tenant_id = $1 AND subscription_id = $2 AND applied_at IS NULL AND direction = 'downgrade'`,
      [tenantId, subscriptionId, at]);
  }
}
