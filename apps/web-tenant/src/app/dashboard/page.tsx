// apps/web-tenant/src/app/dashboard/page.tsx · W117, the console home (PC-56 TENANT-1c).
//
// **THIS PAGE WAS 39 LINES AND TWO LINKS** — a greeting and hyperlinks to Listings and Orders — on the screen an FPO
// coordinator opens first every morning.
//
// W117 makes one promise that shapes everything here: "A quiet day · No approvals, no disputes, payouts on autopilot. **The
// dashboard stays honest — no manufactured urgency.**" So "Needs you today" is genuinely empty when nothing needs them, and
// it is ordered by what goes wrong if it waits rather than by how large the number is — the payout batch is the biggest
// figure on the screen and it is deliberately last, because a batch waits without harm while produce in QC is perishable and
// a dispute has a clock the platform will judge the tenant against.
//
// Server component. Every figure is a real count; the two the canon prints that have no source are named on the screen.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import type { TenantDashboard, GoLiveState } from '@krishalaya/sdk-js';
import {
  gmvTrend, isQuietDay, orderedActions, ageLabel, planUsagePct, planNearLimit, showChecklistFirst,
} from '../../features/console/home';

export const dynamic = 'force-dynamic'; // per-request (session-scoped); never statically cached

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dashboard.title'), robots: { index: false, follow: false } };
}

export default async function DashboardPage() {
  await requireSession('/dashboard');
  const t = getTranslator();
  const lang = getLang();

  let d: TenantDashboard | null = null;
  let setup: GoLiveState | null = null;
  let restricted = false;
  let failed = false;
  try {
    const client = tenantClient();
    // The checklist is allowed to fail softly (Law 12): a dashboard that will not render because the setup read hiccuped is
    // worse than a dashboard with one banner missing. The dashboard read is the one that must succeed.
    const [dash, live] = await Promise.all([
      client.consoleHome.dashboard(),
      client.consoleHome.goLive().catch(() => null),
    ]);
    d = dash;
    setup = live;
  } catch (e) {
    // W117's restricted state: "Staff see only the desks their role grants — this complete view (GMV, plan health, revenue)
    // is tenant_admin scope." A staff member without it needs to be told which grant, not shown a retry that fails again.
    if ((e as { status?: number })?.status === 403) restricted = true;
    else failed = true;
  }

  if (restricted) {
    return (
      <section>
        <h1>{t.t('dashboard.title')}</h1>
        <p className="kv-notice" role="status">{t.t('home.restricted')}</p>
        <div className="kv-cards">
          <Link href="/listings" className="kv-card">{t.t('dashboard.manageListings')} →</Link>
          <Link href="/orders" className="kv-card">{t.t('dashboard.viewOrders')} →</Link>
        </div>
      </section>
    );
  }
  if (failed || !d) {
    return (
      <section>
        <h1>{t.t('dashboard.title')}</h1>
        {/* W117: "Your operations continue server-side; only this summary view failed." */}
        <p className="kv-error" role="alert">{t.t('home.loadError')}</p>
        <div className="kv-cards">
          <Link href="/listings" className="kv-card">{t.t('dashboard.manageListings')} →</Link>
          <Link href="/orders" className="kv-card">{t.t('dashboard.viewOrders')} →</Link>
        </div>
      </section>
    );
  }

  const trend = gmvTrend(d.tiles);
  const actions = orderedActions(d.needsYouToday);
  const quiet = isQuietDay(actions);
  const usage = planUsagePct(d.planHealth);

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('dashboard.title')}</h1>
        {/* The subtitle's count is the LENGTH OF THE LIST BELOW IT, so the two can never disagree. */}
        <p className="kv-muted">
          {quiet ? t.t('home.subtitleQuiet') : t.t('home.subtitle', { n: actions.length })}
        </p>
      </div>

      {/* --- The go-live banner, while the federation is not yet live. W116 stays reachable either way. --- */}
      {setup && showChecklistFirst(setup) && (
        <p className="kv-notice" role="status">
          {t.t('home.setupBanner', { done: setup.progress.done, total: setup.progress.total })}{' '}
          <Link href="/get-started" className="kv-link">{t.t('home.setupLink')}</Link>
        </p>
      )}

      {/* --- W117's four tiles --- */}
      <div className="kv-cards">
        <div className="kv-card">
          <span className="kv-card__title">{t.t('home.tile.gmv')}</span>
          <strong>{formatMoneyMinor(d.tiles.gmvThisMonthMinor, 'INR', lang)}</strong>
          {/* **A COMPARISON AGAINST THE SAME ELAPSED INTERVAL, OR NO COMPARISON AT ALL.** A first month has no previous
              window, and "▲ 0%" would read as flat trade rather than as new trade. */}
          <span className="kv-fine">
            {trend.dir === 'unknown'
              ? t.t('home.tile.gmvNoPrev')
              : t.t(`home.tile.gmv.${trend.dir}`, { pct: Math.abs(trend.pct ?? 0) })}
          </span>
        </div>

        <div className="kv-card">
          <span className="kv-card__title">{t.t('home.tile.payouts')}</span>
          <strong>{formatMoneyMinor(d.tiles.payoutsPendingMinor, 'INR', lang)}</strong>
          <span className="kv-fine">{t.t('home.tile.payoutsNote', { n: d.tiles.payoutsPendingFarmers })}</span>
          {/* The canon prints "next batch 18:00". Nothing schedules a run at a fixed hour — no cadence row, no cron the
              console can read — so the tile says what it knows and not what it would like to. */}
          <span className="kv-fine">{t.t('home.tile.payoutsNoSchedule')}</span>
        </div>

        <div className="kv-card">
          <span className="kv-card__title">{t.t('home.tile.listings')}</span>
          <strong>{d.tiles.liveListings.toLocaleString(lang)}</strong>
          <span className="kv-fine">
            {t.t('home.tile.listingsNote', { today: d.tiles.listingsNewToday, qc: d.tiles.listingsInQc })}
          </span>
        </div>

        <div className="kv-card">
          <span className="kv-card__title">{t.t('home.tile.disputes')}</span>
          <strong>{d.tiles.openDisputes.toLocaleString(lang)}</strong>
          <span className="kv-fine">
            {d.tiles.openDisputes === 0
              ? t.t('home.tile.disputesNone')
              : (ageLabel(d.tiles.oldestDisputeHours, t) ?? t.t('common.dash'))}
          </span>
        </div>
      </div>

      {/* --- "Needs you today" --- */}
      <h2 className="kv-section-title">{t.t('home.needsYou')}</h2>
      {quiet ? (
        /* **THE QUIET DAY IS A SENTENCE, NOT A BLANK.** A blank panel looks like a failed load; being told there is nothing
           to do is information — and it is the canon's own promise about not inventing work. */
        <p className="kv-empty-state">{t.t('home.quietDay')}</p>
      ) : (
        <ul className="kv-notif-list">
          {actions.map((a) => {
            const age = ageLabel(a.oldestHours, t);
            return (
              <li key={a.kind} className="kv-notif-item">
                <span className="kv-notif-title">{t.t(`home.action.${a.kind}`, { n: a.count })}</span>
                <span className="kv-notif-meta">
                  {age ? `${t.t('home.oldest', { age })} · ` : ''}
                  {a.amountMinor ? `${formatMoneyMinor(a.amountMinor, 'INR', lang)} · ` : ''}
                  <Link href={a.href} className="kv-link">{t.t(`home.actionCta.${a.kind}`)}</Link>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* --- Plan health --- */}
      <h2 className="kv-section-title">{t.t('home.planHealth')}</h2>
      <p className="kv-fine">
        {d.planHealth.planName ?? t.t('home.noPlan')}
        {d.planHealth.status ? ` · ${d.planHealth.status}` : ''}
        {' · '}
        {/* **"1,284 of no limit" RATHER THAN "1,284 of -1".** An unlimited plan has no denominator, and -1 on a screen is a
            bug report waiting to happen. */}
        {d.planHealth.memberLimit === null
          ? t.t('home.membersNoLimit', { used: d.planHealth.membersUsed })
          : t.t('home.membersUsed', { used: d.planHealth.membersUsed, limit: d.planHealth.memberLimit, pct: usage ?? 0 })}
        {d.planHealth.currentPeriodEnd
          ? ` · ${t.t('home.renews', { date: formatDate(d.planHealth.currentPeriodEnd, lang) })}`
          : ''}
        {' · '}<Link href="/billing" className="kv-link">{t.t('home.planLink')}</Link>
      </p>
      {planNearLimit(d.planHealth) && (
        <p className="kv-notice" role="status">{t.t('home.nearLimit', { pct: usage ?? 0 })}</p>
      )}

      {/* The two panels the canon draws that have no source, named rather than drawn. */}
      <p className="kv-fine kv-note">{t.t('home.absentPanels')}</p>
    </section>
  );
}
