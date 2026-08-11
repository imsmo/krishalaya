// modules/tenancy/read-models/tenant-dashboard.read-model.ts · W117's console home (PC-56 TENANT-1c).
//
// The dashboard was **39 lines and two links** — a greeting and hyperlinks to Listings and Orders. W117 is the screen an FPO
// coordinator opens first every morning, and it makes one promise that decides how this file is written:
//
//   "A quiet day · No approvals, no disputes, payouts on autopilot. **The dashboard stays honest — no manufactured
//    urgency.**"
//
// **SO "NEEDS YOU TODAY" IS EMPTY WHEN NOTHING NEEDS THEM, AND EVERY ITEM ON IT IS A THING SOMEBODY CAN ACT ON.** A tile
// that invents work — "3 listings could use better photos" — trains staff to ignore the panel, and then the panel is useless
// on the day a perishable lot really is sitting in QC.
//
// Every figure here is a real count. What is refused, and why:
//
//   • **"▲ 18% vs June same-day"** — this one IS computable and is built, because a same-day comparison is the only honest
//     month-on-month figure on the 13th: comparing 13 days against a full 30 would show every month collapsing until its
//     final week. The canon chose the harder, correct number and this file keeps it.
//   • **"next batch 18:00"** — `payout_batches` records a batch and its `executed_at`, but nothing schedules a daily run at
//     a fixed hour: there is no cadence row and no cron the console can read. So the tile reports the OPEN batch and its
//     total, and says nothing about when it will go (TENANT-1c-Q2).
//   • **"3 things need you today" in the subtitle** — that is the length of the list below it, so it is derived rather than
//     stored, and it cannot disagree with the list it describes.
//   • **"Members with price alerts on these crops were notified in Gujarati this morning"** — a claim about messages sent,
//     which `notifications` could answer per event, but not scoped to "these crops" without joining alerts to a run that is
//     not recorded. Named, not printed (TENANT-1c-Q3).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';

export interface DashboardMoney { minor: string; currencyCode: string }

export interface DashboardTiles {
  /** GMV so far this calendar month. */
  gmvThisMonthMinor: string;
  /** The SAME number of days into the previous month, so a comparison on the 13th is 13 days against 13 days. */
  gmvPrevMonthSameDayMinor: string;
  /** Basis points of change, integer. null when the previous window was zero — a percentage against nothing is not a fact. */
  gmvChangeBp: number | null;
  payoutsPendingMinor: string;
  payoutsPendingFarmers: number;
  liveListings: number;
  listingsNewToday: number;
  listingsInQc: number;
  openDisputes: number;
  /** Hours since the OLDEST open dispute was raised — W117's "both under 24h old". null when there are none. */
  oldestDisputeHours: number | null;
}

export type ActionKind = 'qc_queue' | 'payout_batch' | 'dispute';

export interface DashboardAction {
  kind: ActionKind;
  /** How many things of this kind. The console renders the count; it never renders an item per row (that is the desk's job). */
  count: number;
  /** Age of the oldest item, in hours — what makes an item urgent rather than merely present. */
  oldestHours: number | null;
  /** Money at stake where the action carries money; null otherwise. */
  amountMinor: string | null;
  /** The deep link the console sends staff to. */
  href: string;
}

export interface PlanHealth {
  planCode: string | null;
  planName: string | null;
  status: string | null;
  /** Members used against the plan's member limit. `limit` is null when the plan does not cap members, and -1 means
   *  unlimited by 0002's convention — the console must not render "1284 of -1". */
  membersUsed: number;
  memberLimit: number | null;
  currentPeriodEnd: string | null;
}

export interface TenantDashboard {
  tiles: DashboardTiles;
  /** **EMPTY ON A QUIET DAY.** The canon's own promise: no manufactured urgency. */
  needsYouToday: DashboardAction[];
  planHealth: PlanHealth;
}

const num = (v: unknown) => Number(v ?? 0);

@Injectable()
export class TenantDashboardReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async get(tenantId: string): Promise<TenantDashboard> {
    const db = this.replica.forTenant(tenantId);

    const [gmv, payouts, listings, disputes, plan] = await Promise.all([
      /**
       * **THE SAME-DAY COMPARISON, WHICH IS THE ONLY HONEST MONTH-ON-MONTH NUMBER MID-MONTH.**
       *
       * W117 says "▲ 18% vs June same-day" on the 13th of July. Comparing 13 days of July against all of June would show
       * every month "collapsing" until its last week and then leaping — a shape that would have staff chasing a problem
       * that does not exist. Both windows are computed in ONE query so they cannot drift apart across two round trips.
       *
       * Cancelled orders are excluded from both sides: a cancelled order is not merchandise value, and including it would
       * let a month of cancellations look like growth.
       */
      db.query<{ this_month: string; prev_same: string }>(
        `WITH bounds AS (
           SELECT date_trunc('month', now()) AS m_start,
                  now() AS m_now,
                  date_trunc('month', now() - interval '1 month') AS p_start,
                  -- The same ELAPSED interval into the previous month. Using a day-of-month would break on the 31st.
                  date_trunc('month', now() - interval '1 month') + (now() - date_trunc('month', now())) AS p_now
         )
         SELECT
           COALESCE(SUM(o.total_minor) FILTER (WHERE o.created_at >= b.m_start AND o.created_at < b.m_now), 0)::text AS this_month,
           COALESCE(SUM(o.total_minor) FILTER (WHERE o.created_at >= b.p_start AND o.created_at < b.p_now), 0)::text AS prev_same
           FROM bounds b
           LEFT JOIN orders o
             ON o.tenant_id = $1 AND o.deleted_at IS NULL
            AND o.status NOT IN ('cancelled', 'created', 'payment_pending')
            AND o.created_at >= b.p_start`,
        [tenantId]),

      // Money owed and not yet gone out, plus how many FARMERS are waiting — the second number is the one that makes the
      // first one urgent. `queued` and `processing` are the pre-terminal labels of `payout_status` (0006).
      db.query<{ minor: string; farmers: number; batch_minor: string | null; batch_count: number }>(
        `SELECT COALESCE(SUM(p.amount_minor), 0)::text AS minor,
                COUNT(DISTINCT p.user_id)::int AS farmers,
                (SELECT COALESCE(SUM(b.total_minor), 0)::text FROM payout_batches b
                  WHERE b.tenant_id = $1 AND b.status = 'open' AND b.deleted_at IS NULL) AS batch_minor,
                (SELECT COUNT(*)::int FROM payout_batches b2
                  WHERE b2.tenant_id = $1 AND b2.status = 'open' AND b2.deleted_at IS NULL) AS batch_count
           FROM payouts p
          WHERE p.tenant_id = $1 AND p.status IN ('queued', 'processing') AND p.deleted_at IS NULL`,
        [tenantId]),

      db.query<{ live: number; new_today: number; in_qc: number; qc_oldest_hours: number | null }>(
        `SELECT COUNT(*) FILTER (WHERE status = 'published')::int AS live,
                COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS new_today,
                -- The QC queue IS pending_approval. No separate table: a status the state machine already owns.
                COUNT(*) FILTER (WHERE status = 'pending_approval')::int AS in_qc,
                -- **THE AGE IS WHAT MAKES IT URGENT.** W117: "oldest 2.1h; cumin lot is perishable-adjacent, clear before
                -- evening trading." A count alone cannot tell a coordinator whether to act now or after lunch.
                (EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status = 'pending_approval'))) / 3600)::numeric(6,1) AS qc_oldest_hours
           FROM listings WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenantId]),

      db.query<{ open: number; oldest_hours: number | null }>(
        `SELECT COUNT(*)::int AS open,
                (EXTRACT(EPOCH FROM (now() - MIN(created_at))) / 3600)::numeric(6,1) AS oldest_hours
           FROM disputes
          WHERE tenant_id = $1 AND deleted_at IS NULL
            AND status NOT IN ('resolved', 'rejected', 'withdrawn')`,
        [tenantId]),

      // **THE MEMBER CAP LIVES IN `plan_limits`, NOT IN A `limits` COLUMN ON `plans` — AND THE FIRST DRAFT OF THIS QUERY
      // SELECTED `pl.limits`, WHICH DOES NOT EXIST.** Caught before shipping by the same reflex that found the
      // `payouts.status = 'paid'` defect an hour earlier: read the migration, do not trust the shape you remember.
      // `plan_limits.limit_code` is `max_farmers` (0002's own vocabulary), not `max_members` — the platform counts the
      // people an FPO serves as farmers, and a query keyed on the word the SCREEN uses would have found no row and reported
      // "no limit" for every plan on the platform.
      db.query<{ code: string; name: string; status: string; period_end: string; limit_value: string | null; members: number }>(
        `SELECT pl.code, pl.default_name AS name, s.status::text AS status, s.current_period_end::text AS period_end,
                (SELECT lim.limit_value::text FROM plan_limits lim
                  WHERE lim.plan_id = s.plan_id AND lim.limit_code = 'max_farmers') AS limit_value,
                (SELECT COUNT(DISTINCT utr.user_id)::int FROM user_tenant_roles utr
                  WHERE utr.tenant_id = $1 AND utr.is_active = true AND utr.deleted_at IS NULL) AS members
           FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id
          WHERE s.tenant_id = $1 AND s.deleted_at IS NULL
          ORDER BY s.created_at DESC LIMIT 1`,
        [tenantId]),
    ]);

    const g = gmv.rows[0];
    const thisMonth = String(g?.this_month ?? '0');
    const prevSame = String(g?.prev_same ?? '0');

    const p = payouts.rows[0];
    const l = listings.rows[0];
    const d = disputes.rows[0];
    const pl = plan.rows[0];

    const tiles: DashboardTiles = {
      gmvThisMonthMinor: thisMonth,
      gmvPrevMonthSameDayMinor: prevSame,
      gmvChangeBp: changeBp(thisMonth, prevSame),
      payoutsPendingMinor: String(p?.minor ?? '0'),
      payoutsPendingFarmers: num(p?.farmers),
      liveListings: num(l?.live),
      listingsNewToday: num(l?.new_today),
      listingsInQc: num(l?.in_qc),
      openDisputes: num(d?.open),
      oldestDisputeHours: d?.oldest_hours === null || d?.oldest_hours === undefined ? null : Number(d.oldest_hours),
    };

    // **THE LIST IS BUILT FROM WORK THAT EXISTS, IN NO FIXED LENGTH.** Three items is what the canon happens to show, not a
    // target — and on a quiet day the array is empty, which is the whole point of the screen's own promise.
    const needsYouToday: DashboardAction[] = [];
    if (tiles.listingsInQc > 0) {
      needsYouToday.push({
        kind: 'qc_queue', count: tiles.listingsInQc,
        oldestHours: l?.qc_oldest_hours === null || l?.qc_oldest_hours === undefined ? null : Number(l.qc_oldest_hours),
        amountMinor: null, href: '/listings?status=pending_approval',
      });
    }
    if (num(p?.batch_count) > 0) {
      needsYouToday.push({
        kind: 'payout_batch', count: num(p?.batch_count), oldestHours: null,
        amountMinor: String(p?.batch_minor ?? '0'), href: '/payouts',
      });
    }
    if (tiles.openDisputes > 0) {
      needsYouToday.push({
        kind: 'dispute', count: tiles.openDisputes, oldestHours: tiles.oldestDisputeHours,
        amountMinor: null, href: '/disputes',
      });
    }

    return {
      tiles,
      needsYouToday,
      planHealth: {
        planCode: pl?.code ?? null,
        planName: pl?.name ?? null,
        status: pl?.status ?? null,
        membersUsed: num(pl?.members),
        memberLimit: memberLimitOf(pl?.limit_value ?? null),
        currentPeriodEnd: pl?.period_end ?? null,
      },
    };
  }
}

/**
 * Change in basis points, in bigint, floored toward zero.
 *
 * **null WHEN THE PREVIOUS WINDOW WAS ZERO, BECAUSE A PERCENTAGE AGAINST NOTHING IS NOT A FACT.** A federation's first
 * month would otherwise show "▲ ∞%" or a fabricated 100%, and the tile's whole job is to be a number somebody can trust.
 * Integer arithmetic on minor units (Law 2): a float ratio on ₹48,12,600 is a rounding error in a headline figure.
 */
export function changeBp(currentMinor: string, previousMinor: string): number | null {
  const prev = BigInt(previousMinor || '0');
  if (prev <= 0n) return null;
  const cur = BigInt(currentMinor || '0');
  return Number(((cur - prev) * 10_000n) / prev);
}

/**
 * The plan's member cap, from `plan_limits.limit_value` where `limit_code = 'max_farmers'`.
 *
 * **-1 MEANS UNLIMITED (0002's own convention) AND MUST NOT REACH THE SCREEN AS A NUMBER.** "1,284 of -1 members used" is
 * exactly the kind of thing that ships and then gets reported as a bug by a customer. Returned as null so the console renders
 * "no limit" — and a plan with NO row is also null, because an unconfigured limit is unknown rather than zero (a zero cap
 * would tell a working federation it is over its allowance).
 */
export function memberLimitOf(raw: string | number | null): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
