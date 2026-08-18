// modules/tenancy/repositories/tenant-signup.repository.ts · the four rows a signup creates (PC-56 TENANT-1d-3a).
//
// There is no `signups` table (0131 §131.3): a signup IS a `users` row, a `tenants` row, a `tenant_admin` grant and a
// `trialing` subscription. This file writes those and answers the two questions the route asks first.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export interface OwnedTenant { tenantId: string; slug: string; displayName: string; status: string }

@Injectable()
export class TenantSignupRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * Does this user already administer an organisation?
   *
   * W113: "one active storefront per verified phone number — a second attempt from the same number RESUMES the first".
   *
   * **DECIDED FROM THE `tenant_admin` GRANT, NOT FROM `tenants.owner_phone`.** That column is a contact field: editable,
   * sometimes a shared office line, and never kept in step with who actually administers the console. The grant is the same
   * fact that decides what the person can DO, so the rule and the permissions can never disagree.
   *
   * Archived and terminated tenants are excluded, because "one ACTIVE storefront" is the promise — somebody whose old
   * co-operative was wound up two years ago must be able to start again.
   *
   * The read runs on the WRITER inside the caller's transaction when one is supplied, so the resume check and the insert
   * cannot straddle replica lag: two taps on a slow connection would otherwise both see "no tenant" and create two.
   */
  async findAdministeredTenant(tx: TxContext | null, userId: string): Promise<OwnedTenant | null> {
    const sql = `SELECT t.id, t.slug, t.display_name, t.status::text AS status
                   FROM user_tenant_roles utr
                   JOIN roles r ON r.id = utr.role_id
                   JOIN tenants t ON t.id = utr.tenant_id
                  WHERE utr.user_id = $1
                    AND r.code = 'tenant_admin'
                    AND utr.is_active = true AND utr.deleted_at IS NULL
                    AND t.deleted_at IS NULL
                    AND t.status NOT IN ('archived', 'terminated')
                  ORDER BY t.created_at
                  LIMIT 1`;
    const r = tx ? await tx.query(sql, [userId]) : await this.replica.forTenant(null as never).query(sql, [userId]);
    const x = r.rows[0];
    return x ? { tenantId: x.id, slug: x.slug, displayName: x.display_name, status: x.status } : null;
  }

  /** The trial policy from platform settings (0131). Same two-column resolve as every other platform setting. */
  async signupSettings(tx: TxContext): Promise<Record<string, unknown>> {
    const r = await tx.query(
      `SELECT d.key, COALESCE(v.value, d.default_value) AS value
         FROM setting_definitions d
         LEFT JOIN platform_setting_values v ON v.key = d.key AND v.deleted_at IS NULL
        WHERE d.key IN ('signup.trial_plan_code', 'signup.trial_days')`, []);
    return Object.fromEntries(r.rows.map((x: any) => [String(x.key), x.value]));
  }

  /**
   * The trial plan, by code, for this country.
   *
   * **PUBLIC AND ACTIVE ONLY.** An enterprise or government plan is a quote, not a trial, and putting a self-serve signup
   * on one would hand a co-operative capability nobody priced. Returns null rather than a fallback: the route REFUSES
   * instead of guessing which plan somebody should be billed for.
   */
  /** W115's three cards, as codes: public, active plans for this country. The signup service validates a
   *  chosen code against THIS list rather than trusting the client (PC-56 TENANT-4d-1). */
  async publicPlanCodes(tx: TxContext, countryCode: string): Promise<string[]> {
    const r = await tx.query<{ code: string }>(
      `SELECT DISTINCT code FROM plans
        WHERE is_public = true AND is_active = true AND country_code = $1 AND deleted_at IS NULL
        ORDER BY code`, [countryCode]);
    return r.rows.map((x) => x.code);
  }

  async trialPlan(tx: TxContext, code: string, countryCode: string): Promise<{ id: string; currencyCode: string; monthlyPriceMinor: string } | null> {
    const r = await tx.query(
      `SELECT id, currency_code, monthly_price_minor::text AS monthly
         FROM plans
        WHERE code = $1 AND country_code = $2 AND is_active = true AND is_public = true AND deleted_at IS NULL
        ORDER BY version DESC
        LIMIT 1`, [code, countryCode]);
    const x = r.rows[0];
    return x ? { id: x.id, currencyCode: x.currency_code, monthlyPriceMinor: String(x.monthly) } : null;
  }

  /** The `tenant_type` lookup value the applicant chose. Validated, because a bad id would fail the FK mid-transaction. */
  async tenantTypeExists(tx: TxContext, lookupValueId: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM lookup_values lv
         JOIN lookup_types lt ON lt.id = lv.lookup_type_id
        WHERE lv.id = $1 AND lt.code = 'tenant_type' AND lv.is_active = true AND lv.deleted_at IS NULL`, [lookupValueId]);
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * Insert the tenant, taking the first slug candidate that is free.
   *
   * **THE UNIQUE CONSTRAINT DECIDES, NOT A PRE-CHECK.** A `SELECT … WHERE slug = $1` followed by an INSERT is a race two
   * simultaneous signups of "Kisan Producer Company" will lose; `ON CONFLICT (slug) DO NOTHING` and a retry cannot.
   *
   * `status` is hard-coded to `'trial'` here, and that is the Law 11 boundary in one line: this route cannot set `active`,
   * cannot suspend, cannot archive. Going properly live still passes through the operator plane.
   */
  async insertTenant(tx: TxContext, input: {
    id: string; slugCandidates: string[]; legalName: string; displayName: string;
    tenantTypeId: string; countryCode: string; ownerName: string | null; ownerPhone: string;
  }): Promise<{ id: string; slug: string } | null> {
    for (const slug of input.slugCandidates) {
      const r = await tx.query(
        `INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code, owner_name, owner_phone, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'trial')
         ON CONFLICT (slug) DO NOTHING
         RETURNING id, slug`,
        [input.id, slug, input.legalName, input.displayName, input.tenantTypeId, input.countryCode, input.ownerName, input.ownerPhone]);
      if (r.rows[0]) return { id: r.rows[0].id, slug: r.rows[0].slug };
    }
    return null;
  }

  /** The `tenant_admin` role id. Missing means the role seed did not run, which the route reports rather than working around. */
  async roleIdByCode(tx: TxContext, code: string): Promise<string | null> {
    const r = await tx.query(`SELECT id FROM roles WHERE code = $1 AND is_active = true AND deleted_at IS NULL`, [code]);
    return r.rows[0]?.id ?? null;
  }

  /**
   * The owner's grant.
   *
   * `requires_approval` is irrelevant here and `is_active` is true immediately: **the person who created the organisation
   * cannot be waiting for somebody inside it to approve them.** `kyc_status` stays at its default, because business KYC is
   * a later step on the go-live checklist (TENANT-1c) and pretending otherwise would tick a box money depends on.
   */
  async grantOwnerRole(tx: TxContext, input: { id: string; userId: string; tenantId: string; roleId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, is_active)
       VALUES ($1,$2,$3,$4,true)
       ON CONFLICT DO NOTHING`,
      [input.id, input.userId, input.tenantId, input.roleId]);
  }

  /**
   * The trial subscription.
   *
   * `status = 'trialing'` (0002's enum) with the period running from today to the trial's end. **The price is the plan's
   * list price, recorded now**, because `subscriptions.price_minor` is the negotiated price and a trial that stored 0 would
   * make TENANT-1d-2's proration read the change to a paid plan as an upgrade from free — inflating the first invoice.
   */
  async insertTrialSubscription(tx: TxContext, input: {
    id: string; tenantId: string; planId: string; priceMinor: string; currencyCode: string;
    periodStart: string; periodEnd: string;
  }): Promise<void> {
    await tx.query(
      `INSERT INTO subscriptions (id, tenant_id, plan_id, status, billing_cycle, price_minor, currency_code,
                                  current_period_start, current_period_end, cancel_at_period_end)
       VALUES ($1,$2,$3,'trialing','monthly',$4,$5,$6::date,$7::date,false)`,
      [input.id, input.tenantId, input.planId, input.priceMinor, input.currencyCode, input.periodStart, input.periodEnd]);
  }
}
