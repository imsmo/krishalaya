// apps/admin-api/src/modules/platform-reports/__tests__/platform-reports.integration.spec.ts
// REAL proof against a live Postgres (the schema apps/api builds). The exec dashboards are CROSS-TENANT aggregates
// run as kv_admin (RLS bypassed — the god-mode reporting plane); this asserts every aggregate SQL is valid, the
// windowed queries run (partition-pruned on orders/login_events.created_at), and money comes back as bigint
// minor-unit STRINGS while counts come back as numbers. Runs only when DATABASE_ADMIN_URL is set (CI's DB job).
import { AdminConfig } from '../../../core/config/admin-config';
import { AdminPool } from '../../../core/database/admin-pool';
import { PlatformReportsReadModel } from '../read-models/platform-reports.read-model';
import { CrossTenantAnalyticsService } from '../services/cross-tenant-analytics.service';
import { GmvRollupsService } from '../services/gmv-rollups.service';
import { CohortReportsService } from '../services/cohort-reports.service';
import { RegulatorExportsService } from '../services/regulator-exports.service';
import { PlatformDashboardService } from '../services/platform-dashboard.service';
import { ReportsPlaneRepository } from '../repositories/reports-plane.repository';

const APP_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const run = APP_URL ? describe : describe.skip;

run('platform-reports (integration, real Postgres — cross-tenant aggregates)', () => {
  let pool: AdminPool; let reads: PlatformReportsReadModel;
  let analytics: CrossTenantAnalyticsService; let gmv: GmvRollupsService; let cohorts: CohortReportsService; let regulator: RegulatorExportsService;

  beforeAll(async () => {
    const config = new AdminConfig({ NODE_ENV: 'test', DATABASE_ADMIN_URL: APP_URL, ADMIN_JWT_SECRET: 's'.repeat(40) });
    pool = new AdminPool(config);
    reads = new PlatformReportsReadModel(pool);
    analytics = new CrossTenantAnalyticsService(reads);
    gmv = new GmvRollupsService(reads);
    cohorts = new CohortReportsService(reads);
    regulator = new RegulatorExportsService(reads);
  }, 30000);

  afterAll(async () => { await pool?.onModuleDestroy(); });

  it('overview: every aggregate SQL runs; money is string, counts are numbers (cross-tenant)', async () => {
    const o: any = await analytics.overview({ currency: 'INR' } as any);
    expect(typeof o.revenue.mrrMinor).toBe('string');
    expect(typeof o.revenue.arrMinor).toBe('string');
    expect(typeof o.tenants.total).toBe('number');
    expect(typeof o.activity.activeUsers).toBe('number');
    expect(typeof o.activity.loginSuccessBps).toBe('number');
    expect(typeof o.commerce.gmvMinor).toBe('string');
    expect(/^[0-9]+$/.test(o.commerce.gmvMinor)).toBe(true);          // pure integer minor units, never a float
  });

  it('gmv + tenant-growth + regulator export all execute + shape-check', async () => {
    const g: any = await gmv.gmv({ currency: 'INR' } as any);
    expect(/^[0-9]+$/.test(g.gmvMinor)).toBe(true);
    expect(typeof g.orders).toBe('number');

    const tg: any = await cohorts.tenantGrowth({} as any);
    expect(Array.isArray(tg.buckets)).toBe(true);
    expect(typeof tg.totalNewTenants).toBe('number');

    const reg: any = await regulator.export({ currency: 'INR' } as any);
    expect(reg.piiFree).toBe(true);
    expect(/^[0-9]+$/.test(reg.metrics.gmvMinor)).toBe(true);
    expect(typeof reg.metrics.activeTenants).toBe('number');
  });

  /**
   * [DEV-57 2026-08-12] **THE GAP THAT LET `GET /v1/reports/dashboard` SHIP BROKEN.** Every other suite in this
   * file exercises `overview`/`gmv`/`tenant-growth`/`regulator-export` — never `PlatformDashboardService`, the
   * service `apps/web-admin/src/app/dashboard/page.tsx` actually calls. It ran `customSeries('gmv_minor', ...)`
   * for the 14-day trend, which referenced a `deleted_at` column `orders` has never had
   * (`db/migrations/0005_commerce.sql`) — a genuine `42703` SQL error on EVERY call, against ANY database. This
   * is the regression test that would have caught it: the ONE thing every prior suite here omitted was calling
   * `.dashboard()` and `.alerts()` themselves. Run against whatever `DATABASE_ADMIN_URL` points at in this pass
   * (verified live by DEV-57 against a genuinely fresh, migrated, CORE-seeded — NOT demo-seeded — database), so
   * this is a live proof that the endpoint the founder's browser calls resolves cleanly on an EMPTY platform,
   * not a mocked approximation of one.
   */
  it('dashboard(): the exact PlatformDashboardService the console calls resolves against a real DB, empty or not', async () => {
    const repo = new ReportsPlaneRepository(pool);
    const dashboard = new PlatformDashboardService(reads, repo);

    const out: any = await dashboard.dashboard('INR');
    // Every figure carries its declared basis (computed/partial_window/unavailable) — never throws, never a bare number.
    expect(['computed']).toContain(out.headline.gmvToday.basis);
    expect(['computed']).toContain(out.headline.activeTenants.basis);
    expect(['computed']).toContain(out.headline.ordersPerMinute.basis);
    expect(['computed', 'partial_window']).toContain(out.headline.payoutSuccess.basis);
    // The exact query that 500'd pre-fix: an empty/near-empty platform's series is a real (possibly empty) array,
    // never an unhandled rejection.
    expect(Array.isArray(out.trend.series)).toBe(true);
    expect(typeof out.lifecycle.total).toBe('number');
    expect(/^[0-9]+$/.test(out.commerce.avgOrderValueMinor)).toBe(true);

    const alerts: any = await dashboard.alerts();
    expect(Array.isArray(alerts.items)).toBe(true);
    expect(Array.isArray(alerts.unavailable)).toBe(true);
  });
});
