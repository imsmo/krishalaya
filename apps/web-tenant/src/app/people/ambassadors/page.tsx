// apps/web-tenant/src/app/people/ambassadors/page.tsx · W159 · AMBASSADORS · PC-56 TENANT-10a.
// (canon slug `people/ambassadors`; the old `/ambassadors` route is kept and redirects here, the sidebar entry stays.)
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • the lede — TRUE clauses only; exclusivity, the 60-day reassignment and training progress are "not recorded" by name;
//   • "Weekly earnings run" → the mutate chain (/people/ambassadors/run) → POST /ambassadors/payouts/run (ambassador.payout,
//     reason, Idempotency-Key). There is NO automatic Friday run — founder question F-23 (who funds the commission) is open;
//   • "Recruit ambassador" → the form chain W2481–W2484 (/people/ambassadors/new) — a member found by PHONE, never a UUID;
//   • four KPI tiles from GET /ambassadors/summary — "uncovered villages" is refused by name (no village set is recorded);
//   • the tier tabs are REAL filters (`tier`), plus "inactive 60d" (no recorded act in 60 days — the writer exists now);
//   • the roster — short name + MASKED phone (drill-in to the detail), tier, cluster regions, onboarded (30d), Owed ▾ (a
//     real sort), last active; "Showing N of M"; keyset pages; row acts → the mutate chain (suspend / reinstate / pay out)
//     and the edit form chain;
//   • six states: content, Loading (loading.tsx), Flagged off (the canon's own words, never a 404), Restricted, Couldn't
//     load (Retry = a page load), and the empty state with "Recruit ambassador".
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { AmbassadorRosterRow, AmbassadorSummary } from '@krishalaya/sdk-js';
import { formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { env } from '../../../lib/env';
import {
  AMBASSADORS_HREF, AMB_TIERS, NEW_AMBASSADOR_HREF, RUN_HREF, MEMBERS_HREF, REFERRALS_HREF, actHref, actKey, actsFor, consoleState, detailHref, editHref,
  lastActive, personKey, rosterFilters, rosterHref, tierKey,
} from '../../../features/ambassadors/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('amb.title'), robots: { index: false, follow: false } };
}

const PAGE = 25;

export default async function AmbassadorsRosterPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(AMBASSADORS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const f = rosterFilters(searchParams);
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const n = (v: number) => formatNumber(v, lang);

  const crumbs = (
    <nav className="kv-breadcrumb" aria-label={t.t('amb.breadcrumb')}>
      <Link href={MEMBERS_HREF}>{t.t('amb.breadcrumb.people')}</Link> / <span aria-current="page">{t.t('amb.title')}</span>
    </nav>
  );
  if (!env.featureAmbassadors) {
    return (
      <section>
        {crumbs}
        <h1>{t.t('amb.title')}</h1>
        <div className="kv-card kv-card--notice" role="status"><strong>{t.t('amb.state.flaggedOff.title')}</strong><p>{t.t('amb.state.flaggedOff.body')}</p></div>
      </section>
    );
  }

  const a = tenantClient().ambassadors;
  let state: 'flaggedOff' | 'restricted' | 'notFound' | 'error' | null = null;
  let page: { items: AmbassadorRosterRow[]; nextCursor: string | null; total?: number | null } = { items: [], nextCursor: null, total: 0 };
  let sum: AmbassadorSummary | null = null;
  try {
    [page, sum] = await Promise.all([
      a.list({ tier: f.tier, inactive: f.inactive, sort: f.sort, cursor: f.cursor, limit: PAGE }),
      a.summary(),
    ]);
  } catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status, true); }
  const now = Date.now();
  const filtered = !!f.tier || !!f.inactive;

  return (
    <section>
      {crumbs}
      <div className="kv-page-head">
        <h1>{t.t('amb.title')}</h1>
        <p className="kv-actions">
          <Link href={REFERRALS_HREF} className="kv-btn--link">{t.t('amb.toReferrals')}</Link>{' '}
          <Link href={`${RUN_HREF}?step=confirm`} className="kv-btn kv-btn--muted">{t.t('amb.run')}</Link>{' '}
          <Link href={`${NEW_AMBASSADOR_HREF}?step=edit`} className="kv-btn kv-btn--primary">{t.t('amb.recruit')}</Link>
        </p>
      </div>
      <p className="kv-field__hint">{t.t('amb.lede')}</p>
      <p className="kv-field__hint">{t.t('amb.refused.exclusivity')} {t.t('amb.refused.reassignment')}</p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <strong>{t.t(`amb.state.${state}.title`)}</strong>
          <p>{t.t(`amb.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={rosterHref(f)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('amb.retry')}</Link> <span className="kv-field__hint">{t.t('amb.refused.retry')}</span></p>}
        </div>
      )}

      {!state && sum && (
        <>
          <dl className="kv-tiles">
            <div className="kv-tile"><dt>{t.t('amb.kpi.active')}</dt><dd><strong>{n(sum.activeCount)}</strong></dd>
              <dd className="kv-field__hint">{t.t('amb.kpi.activeSub', { regions: n(sum.villagesCovered) })} · {t.t('amb.refused.uncoveredVillages')}</dd></div>
            <div className="kv-tile"><dt>{t.t('amb.kpi.onboarded')}</dt><dd><strong>{n(sum.onboarded30d)}</strong></dd>
              <dd className="kv-field__hint">{t.t('amb.kpi.onboardedSub', { members: n(sum.newMembers30d) })}</dd></div>
            <div className="kv-tile"><dt>{t.t('amb.kpi.owed')}</dt><dd><strong>{money(sum.owedThisWeekMinor)}</strong></dd>
              <dd className="kv-field__hint">{t.t('amb.refused.fridayRun')}</dd></div>
            <div className="kv-tile"><dt>{t.t('amb.kpi.kioskAeps')}</dt><dd><strong>{n(sum.kioskCount)} / {n(sum.aepsCount)}</strong></dd>
              <dd className="kv-field__hint">{t.t('amb.kpi.kioskAepsSub')}</dd></div>
          </dl>

          <nav className="kv-tabs" aria-label={t.t('amb.tabs')}>
            <Link href={rosterHref({ sort: f.sort })} className={`kv-tab${!filtered ? ' kv-tab--active' : ''}`} aria-current={!filtered ? 'page' : undefined}>{t.t('amb.tab.all', { n: n(sum.total) })}</Link>
            {AMB_TIERS.map((code) => (
              <Link key={code} href={rosterHref({ tier: code, sort: f.sort })} className={`kv-tab${f.tier === code ? ' kv-tab--active' : ''}`} aria-current={f.tier === code ? 'page' : undefined}>
                {t.t(tierKey(code))} {n(sum.tierCounts[code] ?? 0)}
              </Link>
            ))}
            <Link href={rosterHref({ inactive: true, sort: f.sort })} className={`kv-tab${f.inactive ? ' kv-tab--active' : ''}`} aria-current={f.inactive ? 'page' : undefined}>{t.t('amb.tab.inactive', { n: n(sum.inactive60d) })}</Link>
          </nav>

          {page.items.length === 0 ? (
            <div className="kv-card">
              <strong>{t.t(filtered ? 'amb.empty.filtered.title' : 'amb.empty.title')}</strong>
              <p className="kv-detail__muted">{t.t(filtered ? 'amb.empty.filtered.body' : 'amb.empty.body')}</p>
              {!filtered && <Link href={`${NEW_AMBASSADOR_HREF}?step=edit`} className="kv-btn kv-btn--sm">{t.t('amb.recruit')}</Link>}
            </div>
          ) : (
            <table className="kv-table">
              <caption className="kv-detail__muted">{t.t('amb.showing', { n: n(page.items.length), m: n(page.total ?? page.items.length) })}</caption>
              <thead><tr>
                <th scope="col">{t.t('amb.col.ambassador')}</th><th scope="col">{t.t('amb.col.tier')}</th><th scope="col">{t.t('amb.col.cluster')}</th>
                <th scope="col">{t.t('amb.col.onboarded')}</th>
                <th scope="col" aria-sort={f.sort === 'owed' ? 'descending' : 'none'}>
                  <Link href={rosterHref({ tier: f.tier, inactive: f.inactive, sort: f.sort === 'owed' ? 'recent' : 'owed' })}>{t.t('amb.col.owed')}{f.sort === 'owed' ? ' ▾' : ''}</Link>
                </th>
                <th scope="col">{t.t('amb.col.lastActive')}</th><th scope="col">{t.t('amb.col.acts')}</th>
              </tr></thead>
              <tbody>{page.items.map((r) => {
                const who = personKey(r.displayName);
                const la = lastActive(r.lastActivityAt, now);
                return (
                  <tr key={r.id}>
                    <th scope="row"><Link href={detailHref(r.id)}>{t.t(who.key, who.vars)}</Link> <span className="kv-field__hint">· {r.phoneMasked}</span>
                      {!r.isActive && <span className="kv-badge"> {t.t('amb.suspended')}</span>}</th>
                    <td>{r.tierCode ? t.t(tierKey(r.tierCode)) : <span className="kv-field__hint">{t.t('amb.tier.none')}</span>}</td>
                    <td>{r.clusterRegionNames.length ? r.clusterRegionNames.join(', ') : <span className="kv-field__hint">{t.t('amb.cluster.none')}</span>}</td>
                    <td>{n(r.onboarded30d)}</td>
                    <td>{money(r.owedMinor)}</td>
                    <td>{t.t(la.key, la.vars)}{(r.kioskEnabled || r.aepsEnabled) && <span className="kv-field__hint"> · {t.t(r.kioskEnabled && r.aepsEnabled ? 'amb.flags.both' : r.kioskEnabled ? 'amb.flags.kiosk' : 'amb.flags.aeps')}</span>}</td>
                    <td>
                      {actsFor(r).map((act) => <span key={act}><Link href={actHref(r.id, act)} className="kv-btn--link">{t.t(actKey(act))}</Link>{' · '}</span>)}
                      <Link href={editHref(r.id)} className="kv-btn--link">{t.t('amb.edit')}</Link>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
          {page.nextCursor && <p><Link href={rosterHref(f, page.nextCursor)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('amb.nextPage')}</Link></p>}
          <p className="kv-field__hint">{t.t('amb.refused.training')} {t.t('amb.footer.inactive')}</p>
        </>
      )}
    </section>
  );
}
