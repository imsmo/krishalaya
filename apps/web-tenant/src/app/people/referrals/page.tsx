// apps/web-tenant/src/app/people/referrals/page.tsx · W162 · REFERRALS · PC-56 TENANT-10a.
// (canon slug `people/referrals`; breadcrumb People › Members › Referrals.)
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • the lede — invited → signed_up → activated → rewarded is the real state machine; "rewards release on activation (first
//     real transaction)" is NOT what this platform does: activation is a MANUAL, recorded act, and no reward exists — said so;
//   • "Configure reward rule" → /people/referrals/reward-rule, ONE state card (B): the rule needs a funding decision first;
//   • four KPI tiles from GET /ambassadors/referrals/summary (a cohort over the last 30 days of invites); "Rewards paid" is
//     "—" with its reason, never ₹0;
//   • the tabs all / invited / signed_up / activated are REAL filters; the desk lists every referral in the cooperative with
//     the referrer's and referee's short name + MASKED phone — an invited row says "not yet joined" (no invitee column);
//     the Reward column says "not configured"; a signed_up row offers "Activate" → the mutate chain (reason required);
//   • the note — wallet-credit rewards and ring detection are refused by name; self-referral (same account) IS refused;
//   • states: content, Loading, Flagged off (rides the Ambassadors flag — said plainly), Restricted, Couldn't load, empty.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { ReferralDeskRow, ReferralDeskSummary } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { env } from '../../../lib/env';
import {
  MEMBERS_HREF, REFERRALS_HREF, REFERRAL_TABS, REWARD_RULE_HREF, activateHref, consoleState, personKey, referralFilters, referralHref, statusKey, tabStatus,
} from '../../../features/ambassadors/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ref.title'), robots: { index: false, follow: false } };
}

export default async function ReferralsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(REFERRALS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const f = referralFilters(searchParams);
  const n = (v: number) => formatNumber(v, lang);
  const crumbs = (
    <nav className="kv-breadcrumb" aria-label={t.t('amb.breadcrumb')}>
      <Link href={MEMBERS_HREF}>{t.t('amb.breadcrumb.people')}</Link> / <Link href={MEMBERS_HREF}>{t.t('ref.breadcrumb.members')}</Link> / <span aria-current="page">{t.t('ref.title')}</span>
    </nav>
  );
  if (!env.featureAmbassadors) {
    return <section>{crumbs}<h1>{t.t('ref.title')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('ref.state.flaggedOff.title')}</strong><p>{t.t('ref.state.flaggedOff.body')}</p></div></section>;
  }
  const a = tenantClient().ambassadors;
  let state: 'flaggedOff' | 'restricted' | 'notFound' | 'error' | null = null;
  let page: { items: ReferralDeskRow[]; nextCursor: string | null; total?: number | null } = { items: [], nextCursor: null, total: 0 };
  let sum: ReferralDeskSummary | null = null;
  try {
    [page, sum] = await Promise.all([a.referralDesk({ status: tabStatus(f.tab), cursor: f.cursor, limit: 25 }), a.referralSummary()]);
  } catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status, true); }
  const tabCount = (tab: (typeof REFERRAL_TABS)[number]) => (sum ? (tab === 'all' ? sum.total : sum.byStatus[tab] ?? 0) : 0);

  return (
    <section>
      {crumbs}
      <div className="kv-page-head">
        <h1>{t.t('ref.title')}</h1>
        <Link href={REWARD_RULE_HREF} className="kv-btn kv-btn--muted">{t.t('ref.configureRule')}</Link>
      </div>
      <p className="kv-field__hint">{t.t('ref.lede')}</p>
      <p className="kv-field__hint">{t.t('ref.refused.firstTxnActivation')}</p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <strong>{t.t(`ref.state.${state}.title`)}</strong><p>{t.t(`ref.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={referralHref(f.tab)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('amb.retry')}</Link> <span className="kv-field__hint">{t.t('amb.refused.retry')}</span></p>}
        </div>
      )}

      {!state && sum && (
        <>
          <dl className="kv-tiles">
            <div className="kv-tile"><dt>{t.t('ref.kpi.invites')}</dt><dd><strong>{n(sum.invites30d)}</strong></dd><dd className="kv-field__hint">{t.t('ref.kpi.invitesSub')}</dd></div>
            <div className="kv-tile"><dt>{t.t('ref.kpi.signedUp')}</dt><dd><strong>{n(sum.signedUp30d)}</strong></dd><dd className="kv-field__hint">{t.t('ref.kpi.signedUpSub', { n: n(sum.awaitingActivation) })}</dd></div>
            <div className="kv-tile"><dt>{t.t('ref.kpi.activated')}</dt><dd><strong>{n(sum.activated30d)}</strong></dd><dd className="kv-field__hint">{t.t('ref.kpi.activatedSub')}</dd></div>
            <div className="kv-tile"><dt>{t.t('ref.kpi.rewards')}</dt><dd><strong>{t.t('common.dash')}</strong></dd><dd className="kv-field__hint">{t.t('ref.refused.rewardPaid')}</dd></div>
          </dl>
          <nav className="kv-tabs" aria-label={t.t('ref.tabs')}>
            {REFERRAL_TABS.map((tab) => (
              <Link key={tab} href={referralHref(tab)} className={`kv-tab${f.tab === tab ? ' kv-tab--active' : ''}`} aria-current={f.tab === tab ? 'page' : undefined}>{t.t(`ref.tab.${tab}`)} {n(tabCount(tab))}</Link>
            ))}
          </nav>
          {page.items.length === 0 ? (
            <div className="kv-card">
              <strong>{t.t(f.tab === 'all' ? 'ref.empty.title' : 'ref.empty.filtered.title')}</strong>
              <p className="kv-detail__muted">{t.t(f.tab === 'all' ? 'ref.empty.body' : 'ref.empty.filtered.body')}</p>
              {f.tab === 'all' && <Link href={MEMBERS_HREF} className="kv-btn kv-btn--sm">{t.t('ref.viewMembers')}</Link>}
            </div>
          ) : (
            <table className="kv-table">
              <caption className="kv-detail__muted">{t.t('ref.showing', { n: n(page.items.length), m: n(page.total ?? page.items.length) })}</caption>
              <thead><tr>
                <th scope="col" aria-sort="descending">{t.t('ref.col.when')} ▾</th><th scope="col">{t.t('ref.col.referrer')}</th><th scope="col">{t.t('ref.col.referee')}</th>
                <th scope="col">{t.t('ref.col.code')}</th><th scope="col">{t.t('ref.col.status')}</th><th scope="col">{t.t('ref.col.reward')}</th><th scope="col">{t.t('amb.col.acts')}</th>
              </tr></thead>
              <tbody>{page.items.map((r) => {
                const by = personKey(r.referrer.displayName);
                const to = r.referee ? personKey(r.referee.displayName) : null;
                return (
                  <tr key={r.id}>
                    <td>{formatDate(r.createdAt, lang, { dateStyle: 'medium' })}</td>
                    <td>{t.t(by.key, by.vars)} <span className="kv-field__hint">· {r.referrer.phoneMasked}{r.referrer.isAmbassador ? ` · ${t.t('ref.isAmbassador')}` : ''}</span></td>
                    <td>{to ? <>{t.t(to.key, to.vars)} <span className="kv-field__hint">· {r.referee!.phoneMasked}</span></> : <span className="kv-field__hint">{t.t('ref.notYetJoined')}</span>}</td>
                    <td><code>{r.code}</code></td>
                    <td>{t.t(statusKey(r.status))}{r.status === 'signed_up' && <span className="kv-field__hint"> · {t.t('ref.activatesManually')}</span>}</td>
                    <td><span className="kv-field__hint">{t.t('ref.reward.notConfigured')}</span></td>
                    <td>{r.status === 'signed_up' ? <Link href={activateHref(r.id)} className="kv-btn--link">{t.t('ref.activate')}</Link> : <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
          {page.nextCursor && <p><Link href={referralHref(f.tab, page.nextCursor)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('amb.nextPage')}</Link></p>}
          <p className="kv-field__hint kv-note">{t.t('ref.note')} {t.t('ref.refused.ringDetection')}</p>
        </>
      )}
    </section>
  );
}
