// modules/tenancy/read-models/plan-compare.read-model.ts · W119's compare table (PC-56 TENANT-1d-2).
//
// "Capability | Starter ₹2,999/mo | Growth ₹8,999/mo (current) | Professional ₹19,999/mo" with rows for Members, Staff
// seats, Auctions & group lots, Dairy module, White-label member app, Custom domain and Support.
//
// **THE ROWS ARE NOT A LIST IN THIS FILE.** They are `plan_limits` and `plan_features` as the platform seeded them, because
// a hard-coded row list is a table that goes stale the first time a plan gains a capability — and a comparison table that
// omits the feature a tenant is upgrading FOR is worse than no table.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';

export interface ComparePlan {
  id: string;
  code: string;
  name: string;
  monthlyPriceMinor: string;
  annualPriceMinor: string;
  currencyCode: string;
  isCurrent: boolean;
  /** limit_code → limit_value as a string. `-1` is 0002's "unlimited" and stays -1: the console decides the word. */
  limits: Record<string, string>;
  /** feature_code → included. Absent means the plan does not carry it. */
  features: Record<string, boolean>;
}

export interface PlanCompareView {
  plans: ComparePlan[];
  /** Every limit code any plan in the table declares, so the console renders one row per capability with no gaps. */
  limitCodes: string[];
  /** Every feature code, with its display name from the platform catalogue. */
  features: Array<{ code: string; name: string }>;
  current: {
    subscriptionId: string;
    planId: string;
    planName: string;
    billingCycle: string;
    /** The NEGOTIATED price actually charged. */
    priceMinor: string;
    currencyCode: string;
    periodStart: string;
    periodEnd: string;
    status: string;
  } | null;
  /** Live counts, the same ones the breach warning uses. */
  usage: Record<string, string>;
  /**
   * W119's "Custom plan in force · Anchor/negotiated terms replace this table — your account manager quote is the source of
   * truth."
   *
   * **DERIVED, NOT A FLAG.** True when the subscription's price differs from its plan's list price for the same cycle —
   * which is exactly what a negotiated deal IS. A boolean column would have to be maintained by whoever agreed the deal,
   * and would say "list price" for an anchor tenant the day somebody forgot.
   */
  customPricing: boolean;
  /** A scheduled downgrade already waiting, in the words the tenant was given. */
  pending: { planId: string; planName: string; priceMinor: string; effectiveDate: string; reason: string | null } | null;
}

@Injectable()
export class PlanCompareReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async view(tenantId: string): Promise<PlanCompareView> {
    const db = this.replica.forTenant(tenantId);

    const [sub, plans, limits, features, featureCatalogue, usage, pending] = await Promise.all([
      db.query<any>(
        `SELECT s.id, s.plan_id, s.billing_cycle, s.price_minor::text AS price, s.currency_code, s.status,
                s.current_period_start, s.current_period_end, p.default_name,
                p.monthly_price_minor::text AS plan_monthly, p.annual_price_minor::text AS plan_annual
           FROM subscriptions s
           LEFT JOIN plans p ON p.id = s.plan_id
          WHERE s.tenant_id = $1 AND s.status IN ('trialing','active','past_due','paused') AND s.deleted_at IS NULL
          ORDER BY s.created_at DESC LIMIT 1`, [tenantId]),
      // **PUBLIC AND ACTIVE ONLY, AND IN THE TENANT'S OWN CURRENCY.** 0002 marks government and enterprise plans
      // `is_public = false` because they are quotes, not shelf prices; listing them would invite a co-operative to click
      // "upgrade" on something that has to be negotiated. The currency filter is what stops a Bangladeshi tenant being
      // shown a table of rupee prices when the platform reaches Dhaka.
      db.query<any>(
        `SELECT p.id, p.code, p.default_name, p.monthly_price_minor::text AS monthly,
                p.annual_price_minor::text AS annual, p.currency_code
           FROM plans p
          WHERE p.is_active = true AND p.is_public = true AND p.deleted_at IS NULL
            AND p.currency_code = COALESCE(
                  (SELECT s2.currency_code FROM subscriptions s2
                    WHERE s2.tenant_id = $1 AND s2.deleted_at IS NULL
                    ORDER BY s2.created_at DESC LIMIT 1),
                  p.currency_code)
          ORDER BY p.monthly_price_minor`, [tenantId]),
      db.query<any>(
        `SELECT pl.plan_id, pl.limit_code, pl.limit_value::text AS limit_value
           FROM plan_limits pl JOIN plans p ON p.id = pl.plan_id
          WHERE p.is_active = true AND p.is_public = true AND p.deleted_at IS NULL`, []),
      db.query<any>(
        `SELECT pf.plan_id, pf.feature_code, pf.is_included
           FROM plan_features pf JOIN plans p ON p.id = pf.plan_id
          WHERE p.is_active = true AND p.is_public = true AND p.deleted_at IS NULL`, []),
      db.query<any>(`SELECT code, default_name FROM features ORDER BY code`, []),
      db.query<{ members: number; staff: number }>(
        `SELECT COUNT(*) FILTER (WHERE ro.code = ANY($2::text[]))::int AS members,
                COUNT(*) FILTER (WHERE ro.code = ANY($3::text[]))::int AS staff
           FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
          WHERE utr.tenant_id = $1 AND utr.is_active = true AND utr.deleted_at IS NULL`,
        [tenantId, MEMBER_ROLES, STAFF_ROLES]),
      db.query<any>(
        `SELECT s.pending_plan_id, s.pending_price_minor::text AS price, s.pending_effective_date, s.pending_reason,
                p.default_name
           FROM subscriptions s LEFT JOIN plans p ON p.id = s.pending_plan_id
          WHERE s.tenant_id = $1 AND s.pending_plan_id IS NOT NULL AND s.deleted_at IS NULL
          ORDER BY s.created_at DESC LIMIT 1`, [tenantId]),
    ]);

    const s = sub.rows[0];
    const limitsByPlan = new Map<string, Record<string, string>>();
    for (const r of limits.rows) {
      const m = limitsByPlan.get(r.plan_id) ?? {};
      m[r.limit_code] = String(r.limit_value);
      limitsByPlan.set(r.plan_id, m);
    }
    const featsByPlan = new Map<string, Record<string, boolean>>();
    for (const r of features.rows) {
      const m = featsByPlan.get(r.plan_id) ?? {};
      m[r.feature_code] = Boolean(r.is_included);
      featsByPlan.set(r.plan_id, m);
    }

    const rows: ComparePlan[] = plans.rows.map((p: any) => ({
      id: p.id, code: p.code, name: p.default_name,
      monthlyPriceMinor: String(p.monthly), annualPriceMinor: String(p.annual), currencyCode: p.currency_code,
      isCurrent: Boolean(s && s.plan_id === p.id),
      limits: limitsByPlan.get(p.id) ?? {},
      features: featsByPlan.get(p.id) ?? {},
    }));

    // Union of codes across the table, ordered so the two the canon leads with come first and the rest stay stable.
    const codeSet = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r.limits)) codeSet.add(k);
    const limitCodes = [...codeSet].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

    const usedFeature = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r.features)) usedFeature.add(k);

    const cycle = s?.billing_cycle ?? 'monthly';
    const listPrice = cycle === 'annual' ? s?.plan_annual : s?.plan_monthly;

    const pend = pending.rows[0];

    return {
      plans: rows,
      limitCodes,
      // Only features some plan in the table actually declares — the whole platform catalogue would render dozens of rows
      // a tenant has no decision to make about.
      features: featureCatalogue.rows
        .filter((f: any) => usedFeature.has(f.code))
        .map((f: any) => ({ code: f.code, name: f.default_name })),
      current: s
        ? {
            subscriptionId: s.id, planId: s.plan_id, planName: s.default_name ?? '', billingCycle: cycle,
            priceMinor: String(s.price), currencyCode: s.currency_code,
            periodStart: String(s.current_period_start).slice(0, 10),
            periodEnd: String(s.current_period_end).slice(0, 10),
            status: s.status,
          }
        : null,
      usage: { max_farmers: String(usage.rows[0]?.members ?? 0), max_staff: String(usage.rows[0]?.staff ?? 0) },
      customPricing: Boolean(s && listPrice !== undefined && listPrice !== null && String(s.price) !== String(listPrice)),
      pending: pend
        ? {
            planId: pend.pending_plan_id, planName: pend.default_name ?? '', priceMinor: String(pend.price),
            effectiveDate: String(pend.pending_effective_date).slice(0, 10), reason: pend.pending_reason ?? null,
          }
        : null,
    };
  }
}

const MEMBER_ROLES = ['farmer', 'dairy_farmer', 'pashupalak', 'worker', 'sardar', 'vyapari', 'organic_store'];
const STAFF_ROLES = ['tenant_admin', 'tenant_staff', 'fpo_coordinator', 'support_agent', 'auditor'];

/** W119 leads with Members then Staff seats; everything else follows alphabetically so the table never reshuffles. */
function rank(code: string): number {
  if (code === 'max_farmers') return 0;
  if (code === 'max_staff') return 1;
  return 2;
}
