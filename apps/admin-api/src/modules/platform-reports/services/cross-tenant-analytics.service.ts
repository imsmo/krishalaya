// apps/admin-api/src/modules/platform-reports/services/cross-tenant-analytics.service.ts · the exec OVERVIEW: MRR/
// ARR (subscriptions), active-tenant counts by lifecycle status, active users + login success (windowed), and
// headline GMV (windowed). READ-ONLY, anonymised (aggregates only — no per-user/PII rows). Money is bigint minor
// units as strings; the login success ratio is integer basis points (float-free).
import { Injectable } from '@nestjs/common';
import { PlatformReportsReadModel } from '../read-models/platform-reports.read-model';
import { arrMinor, bps, avgOrderValueMinor } from '../domain/metrics';
import { resolveWindow } from '../domain/window';
import { QueryWindowDto } from '../dto/platform-reports.dto';

@Injectable()
export class CrossTenantAnalyticsService {
  constructor(private readonly reads: PlatformReportsReadModel) {}

  async overview(dto: QueryWindowDto) {
    const w = resolveWindow(dto.from, dto.to);
    const [rev, tenants, users, gmv] = await Promise.all([
      this.reads.revenueRollup(dto.currency),
      this.reads.tenantStatusCounts(),
      this.reads.activeUsers(w.from, w.to),
      this.reads.gmv(w.from, w.to, dto.currency),
    ]);
    return {
      window: { from: w.from.toISOString(), to: w.to.toISOString() },
      currency: dto.currency,
      revenue: { mrrMinor: rev.mrrMinor, arrMinor: arrMinor(BigInt(rev.mrrMinor)).toString(), activeSubscriptions: rev.activeSubscriptions },
      tenants: { activeTotal: tenants.activeTotal, total: tenants.total, byStatus: tenants.byStatus },
      activity: { activeUsers: users.activeUsers, loginAttempts: users.loginAttempts, loginSuccessBps: bps(users.loginSucceeded, users.loginAttempts) },
      commerce: { gmvMinor: gmv.gmvMinor, orders: gmv.orders, platformFeeMinor: gmv.platformFeeMinor, avgOrderValueMinor: avgOrderValueMinor(BigInt(gmv.gmvMinor), gmv.orders).toString() },
    };
  }

  /** PC-54 W54-11 slice 5: report builder v1 (whitelisted metrics; window defaults to the last 30 days). */
  async customSeries(dto: { metric: 'orders' | 'gmv_minor' | 'new_tenants' | 'new_users' | 'dbt_minor'; from?: string; to?: string; bucket: 'day' | 'week' | 'month' }) {
    const to = dto.to ? new Date(dto.to) : new Date();
    const from = dto.from ? new Date(dto.from) : new Date(to.getTime() - 30 * 86400e3);
    const series = await this.reads.customSeries(dto.metric, from, to, dto.bucket);
    return { metric: dto.metric, bucket: dto.bucket, window: { from: from.toISOString(), to: to.toISOString() }, series };
  }
}
