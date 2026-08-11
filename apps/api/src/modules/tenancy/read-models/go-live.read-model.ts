// modules/tenancy/read-models/go-live.read-model.ts · W116's checklist, read from facts (PC-56 TENANT-1c).
//
// Six queries, no new table. See `domain/go-live.ts` for why deriving beats recording — in one line: a checklist table can
// say "KYC done" after a rejection, and a setup screen that lies about readiness lets a federation go live believing money
// can move.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { GoLiveFacts } from '../domain/go-live';

/** Role codes that count as STAFF for W116's "invite your team" — the desks that operate the console. */
const STAFF_ROLES = ['tenant_admin', 'tenant_staff', 'fpo_coordinator', 'support_agent', 'auditor'];
/** Role codes that count as a MEMBER for "add your first members" — the people the organisation serves. */
const MEMBER_ROLES = ['farmer', 'dairy_farmer', 'pashupalak', 'worker', 'sardar', 'vyapari'];

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

@Injectable()
export class GoLiveReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async facts(tenantId: string): Promise<GoLiveFacts | null> {
    const db = this.replica.forTenant(tenantId);

    const [org, plan, kyc, roles, bank] = await Promise.all([
      db.query<{ display_name: string | null; created_at: string }>(
        `SELECT display_name, created_at FROM tenants WHERE id = $1 AND deleted_at IS NULL`, [tenantId]),
      // A subscription in ANY state counts as "a plan was chosen" — including `trialing`, which is exactly the state W116
      // renders ("Growth, trialing — converts 27 Jul unless changed"). Requiring `active` would leave a trialing federation
      // looking as though it had skipped the step it is currently living inside.
      db.query<{ created_at: string }>(
        `SELECT created_at FROM subscriptions
          WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [tenantId]),
      // **VERIFIED, NOT SUBMITTED.** W116: "required before money moves". `reviewed_at` is when somebody decided, which is
      // the honest timestamp for the step — `created_at` would be when the tenant uploaded a certificate.
      db.query<{ reviewed_at: string | null; created_at: string }>(
        `SELECT reviewed_at, created_at FROM business_kyc_profiles
          WHERE tenant_id = $1 AND status = 'verified' AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 1`, [tenantId]),
      // Staff and members in ONE query: both are `user_tenant_roles` rows and splitting them would be two round trips for
      // one shape. `MIN(created_at)` per side gives the step's timestamp — when the SECOND staff member arrived is what
      // "invite your team" actually completed on, so the console reads the count and the domain decides.
      db.query<{ kind: string; n: number; first_at: string; second_at: string | null }>(
        `SELECT kind, COUNT(*)::int AS n, MIN(created_at) AS first_at,
                -- The moment the threshold was crossed, not the moment the first person arrived.
                (ARRAY_AGG(created_at ORDER BY created_at))[2] AS second_at
           FROM (
             SELECT CASE WHEN r.code = ANY($2::text[]) THEN 'staff'
                         WHEN r.code = ANY($3::text[]) THEN 'member' END AS kind,
                    utr.created_at
               FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
              WHERE utr.tenant_id = $1 AND utr.is_active = true AND utr.deleted_at IS NULL
           ) x
          WHERE kind IS NOT NULL
          GROUP BY kind`,
        [tenantId, STAFF_ROLES, MEMBER_ROLES]),
      // **A PENNY-VERIFIED ACCOUNT, BECAUSE AN UNVERIFIED ONE CANNOT RECEIVE MONEY.** Ticking this step on an account that
      // has never had a rupee land in it is how a federation discovers on payout day that its bank details were wrong.
      db.query<{ penny_verified_at: string }>(
        `SELECT b.penny_verified_at
           FROM bank_accounts b
          WHERE b.tenant_id = $1 AND b.penny_verified_at IS NOT NULL AND b.deleted_at IS NULL
          ORDER BY b.penny_verified_at LIMIT 1`, [tenantId]),
    ]);

    const o = org.rows[0];
    if (!o) return null;   // no such tenant in this context — the caller 404s

    const staff = roles.rows.find((r) => r.kind === 'staff');
    const member = roles.rows.find((r) => r.kind === 'member');
    const k = kyc.rows[0];

    return {
      organisationNamed: Boolean(o.display_name && String(o.display_name).trim()),
      organisationAt: iso(o.created_at),
      planChosen: plan.rows.length > 0,
      planAt: iso(plan.rows[0]?.created_at),
      kycVerified: Boolean(k),
      // `reviewed_at` when the reviewer recorded a decision; the row's own creation only as a fallback, because a verified
      // profile with no `reviewed_at` is a data oddity rather than a reason to show nothing.
      kycAt: iso(k?.reviewed_at ?? k?.created_at),
      staffCount: Number(staff?.n ?? 0),
      staffAt: iso(staff?.second_at),
      memberCount: Number(member?.n ?? 0),
      membersAt: iso(member?.first_at),
      payoutReady: bank.rows.length > 0,
      payoutAt: iso(bank.rows[0]?.penny_verified_at),
    };
  }
}
