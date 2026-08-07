// apps/admin-api/src/modules/platform-reports/services/platform-dashboard.service.ts · W001 (PC-56 ADMIN-10).
//
// **THE FIRST SCREEN A PLATFORM OPERATOR SEES, AND IT HAS NEVER HAD ANY NUMBERS ON IT.**
// `apps/web-admin/src/app/dashboard/page.tsx` is twenty-six lines: a title, a lead paragraph and one link to
// `/ai-models`. Meanwhile `platform-reports` has computed MRR, ARR, lifecycle counts, GMV, platform take, active users
// and a login-success ratio since PC-54. Nine waves of this programme have built deep planes behind a front door with
// nothing on it.
//
// Every figure this returns carries its BASIS. Three of W001's four headline tiles are computable; the peak-per-minute
// and the retry count are not, and they come back as `unavailable` with a reason rather than as a plausible number under
// the label the canon used.
import { Injectable } from '@nestjs/common';
import { PlatformReportsReadModel } from '../read-models/platform-reports.read-model';
import { ReportsPlaneRepository } from '../repositories/reports-plane.repository';
import { arrMinor, avgOrderValueMinor } from '../domain/metrics';
import {
  Delta, computed, deltaBps, live, ordersPeakPerMinute, ordersPerMinute, payoutSuccessBps, unavailable,
  ORDERS_RATE_WINDOW_MINUTES,
} from '../domain/dashboard-figures';

const DAY_MS = 86_400_000;

@Injectable()
export class PlatformDashboardService {
  constructor(
    private readonly reads: PlatformReportsReadModel,
    private readonly repo: ReportsPlaneRepository,
  ) {}

  /**
   * The dashboard, in one round of parallel reads.
   *
   * THE DELTA WINDOWS ARE THE SAME LENGTH AS THE FIGURE WINDOWS, and W001's own wording forces the choice: "▲ 8.2% vs
   * last Monday" compares a day with the same day a week earlier, not with yesterday. A day-over-day comparison on an
   * agricultural marketplace would read as growth every Monday and collapse every Sunday — the weekday IS the seasonality
   * at this granularity.
   */
  async dashboard(currency = 'INR', now = new Date()) {
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const lastWeekStart = new Date(todayStart.getTime() - 7 * DAY_MS);
    const lastWeekEnd = new Date(lastWeekStart.getTime() + (now.getTime() - todayStart.getTime()));
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const hourAgo = new Date(now.getTime() - ORDERS_RATE_WINDOW_MINUTES * 60_000);

    const [rev, tenants, gmvToday, gmvLastWeekSameTime, orders1h, payouts24h, series] = await Promise.all([
      this.reads.revenueRollup(currency),
      this.reads.tenantStatusCounts(),
      this.repo.gmvMinorFor(todayStart, now, currency),
      // The SAME ELAPSED FRACTION of the comparison day, not the whole of it: comparing 09:00-today with all of last
      // Monday would show a collapse every morning and a recovery every evening.
      this.repo.gmvMinorFor(lastWeekStart, lastWeekEnd, currency),
      this.repo.orderCount(hourAgo, now),
      this.repo.payoutOutcomes(dayAgo, now),
      this.reads.customSeries('gmv_minor', new Date(now.getTime() - 14 * DAY_MS), now, 'day'),
    ]);

    const gmvDelta: Delta = deltaBps(gmvToday, gmvLastWeekSameTime, 'the same hours last week');

    return {
      asOf: live(now),
      currency,
      headline: {
        gmvToday: { ...computed(gmvToday.toString()), delta: gmvDelta },
        activeTenants: { ...computed(tenants.activeTotal), delta: this.tenantDelta() },
        ordersPerMinute: {
          ...ordersPerMinute(orders1h),
          windowMinutes: ORDERS_RATE_WINDOW_MINUTES,
          // W001 shows "▲ peak 1,190" beside the rate. There is no minute-granularity history to take a maximum over.
          peak: ordersPeakPerMinute(),
        },
        payoutSuccess: {
          ...payoutSuccessBps(payouts24h),
          windowHours: 24,
          counts: payouts24h,
          // W001's "41 retries". `payouts` has no attempt column and there is no attempts table.
          retries: unavailable('nothing on this platform counts payout attempts (ADMIN-10-Q5)'),
        },
      },
      revenue: {
        mrrMinor: rev.mrrMinor,
        arrMinor: arrMinor(BigInt(rev.mrrMinor)).toString(),
        activeSubscriptions: rev.activeSubscriptions,
        // **THE MOST SENSITIVE FIGURES ON THE PAGE, AND THE PERMISSION THAT SHOULD GATE THEM DOES NOT EXIST.** W001's
        // restricted state reads "Your role (Ops · L2) can't view platform revenue. Ask a Platform Owner for the
        // metrics.revenue.read permission." Added in this wave; the flag says whether the caller's grant was the narrow
        // one or `reports.read`, so the console can show the degraded page the canon describes.
        gate: 'metrics.revenue.read',
      },
      lifecycle: {
        byStatus: tenants.byStatus,
        total: tenants.total,
        activeTotal: tenants.activeTotal,
        // W001 labels this band "(live)". It is a point-in-time count, and the payload says so — the word "live" belongs
        // only where a stream feeds a figure (ADMIN-1e built one for revenue and it is a different surface).
        basisNote: 'point-in-time counts as of the asOf timestamp; not a stream',
      },
      trend: {
        metric: 'gmv_minor',
        bucket: 'day',
        days: 14,
        series,
        // W001's chart has no x-axis labels and a fixed 14-day window. The series carries its own buckets so the console
        // can label them — a chart whose axis is undated is a chart nobody can check.
      },
      commerce: {
        avgOrderValueMinor: avgOrderValueMinor(gmvToday, orders1h > 0 ? orders1h : 0).toString(),
        ordersLastHour: orders1h,
      },
    };
  }

  /**
   * **THE ACTIVE-TENANT DELTA IS NOT BUILT, AND THIS IS THE HONEST REASON.** W001 shows "▲ 31 this week", which needs
   * the lifecycle counts AS THEY WERE seven days ago. `tenants.status` is a current-state column: it records what a
   * tenant IS, not what it was, and nothing snapshots it. `tenant_growth` counts tenants CREATED in a window, which is a
   * different figure — a tenant that moved from trial to active this week is growth on the tile and invisible to that
   * query.
   *
   * Returning the created-count under a label meaning "net change in active tenants" would be the defect shape this
   * programme has found six times. ADMIN-10-Q6 owns the daily lifecycle snapshot.
   */
  private tenantDelta(): Delta & { unavailableReason?: string } {
    return {
      kind: 'no_baseline',
      comparedWith: 'a week ago',
      unavailableReason: 'tenants.status is current-state and nothing snapshots it, so the change in ACTIVE tenants over '
        + 'a week cannot be computed; new-tenant counts are a different figure and are on the growth report (ADMIN-10-Q6)',
    };
  }

  /** The alert stack W001 renders. Each row is a real read or it is absent — and two of the three are absent, which is
   *  worth seeing on the payload rather than discovering by reading the console's markup. */
  async alerts() {
    return {
      items: [] as { kind: string; text: string; href: string }[],
      unavailable: [
        {
          alert: 'SLA-breaching P0 tickets',
          reason: 'the support oversight plane computes breach counts (ADMIN-2b) and this payload does not join them yet '
            + '— the count belongs to that plane and a second query for it would be a second answer (ADMIN-10-Q7)',
        },
        {
          alert: 'recon mismatch',
          reason: 'reconciliation_runs is written by the worker ADMIN-6 repaired; the dashboard join is ADMIN-10-Q7',
        },
        {
          alert: 'provider latency (MSG91 p95)',
          reason: 'no latency metric is stored on this platform — the figure would have to come from an observability '
            + 'system that is not wired (the standing gap)',
        },
      ],
    };
  }
}
