// apps/web-tenant/src/app/people/ambassadors/[id]/page.tsx · one ambassador (the W159 drill-in) · PC-56 TENANT-10a.
//
// The detail the old `/ambassadors?ambassador=<id>` page carried, now on its own route: the person named the way the roster
// names them (short name + MASKED phone), the profile as recorded, what is owed (the API's unpaid total, minor units), the
// earnings ledger (keyset, microsecond-exact since F-17), and the per-period target form. Every state change is a chain:
// suspend / reinstate / pay out (mutate, reason required) and edit (form, review with the diff). "Reassignment" is printed
// as not recorded — no reassignment act exists on this platform (F-15).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { AmbassadorEarning, AmbassadorRosterRow } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { TARGET_METRICS } from '../../../../features/ambassadors/admin';
import {
  AMBASSADORS_HREF, actHref, actKey, actsFor, consoleState, detailHref, editHref, isUuid, lastActive, minorToRupees, personKey, tierKey,
} from '../../../../features/ambassadors/console';
import { setTargetAction } from '../../../ambassadors/actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('amb.detail.title'), robots: { index: false, follow: false } };
}

const TARGET_ERRORS = new Set(['ambassador', 'metric', 'dates', 'dateOrder', 'value', 'TARGET_EXISTS', 'AMBASSADOR_NOT_FOUND']);

export default async function AmbassadorDetailPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = detailHref(params.id);
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  if (!env.featureAmbassadors) {
    return <section><h1>{t.t('amb.detail.title')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('amb.state.flaggedOff.title')}</strong><p>{t.t('amb.state.flaggedOff.body')}</p></div></section>;
  }
  const unpaidOnly = searchParams.unpaid === '1';
  const cursor = typeof searchParams.cursor === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(searchParams.cursor) ? searchParams.cursor : undefined;
  let row: AmbassadorRosterRow | null = null; let state: string | null = null;
  let ledger: { items: AmbassadorEarning[]; nextCursor: string | null } = { items: [], nextCursor: null };
  if (!isUuid(params.id)) state = 'notFound';
  else {
    try {
      [row, ledger] = await Promise.all([
        tenantClient().ambassadors.get(params.id),
        tenantClient().ambassadors.earnings(params.id, { unpaidOnly, cursor, limit: 50 }),
      ]);
    } catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status); }
  }
  const okTarget = searchParams.ok === 'target';
  const targetErr = searchParams.targetError && TARGET_ERRORS.has(searchParams.targetError) ? searchParams.targetError : (searchParams.targetError ? 'save' : null);

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('amb.breadcrumb')}><Link href={AMBASSADORS_HREF}>{t.t('amb.title')}</Link> / <span aria-current="page">{t.t('amb.detail.title')}</span></nav>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <strong>{t.t(`amb.state.${state}.title`)}</strong><p>{t.t(`amb.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={base} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('amb.retry')}</Link></p>}
        </div>
      )}
      {row && (() => {
        const who = personKey(row.displayName);
        const la = lastActive(row.lastActivityAt, Date.now());
        return (
          <>
            <h1>{t.t(who.key, who.vars)} <span className="kv-field__hint">· {row.phoneMasked}</span></h1>
            {!row.isActive && <p className="kv-badge">{t.t('amb.suspended')}</p>}
            {okTarget && <p className="kv-success" role="status">{t.t('amb.ok.target')}</p>}
            <dl className="kv-tiles">
              <div className="kv-tile"><dt>{t.t('amb.col.owed')}</dt><dd><strong>{money(row.owedMinor)}</strong></dd><dd className="kv-field__hint">{t.t('amb.detail.owedNote')}</dd></div>
              <div className="kv-tile"><dt>{t.t('amb.col.onboarded')}</dt><dd><strong>{formatNumber(row.onboarded30d, lang)}</strong></dd></div>
              <div className="kv-tile"><dt>{t.t('amb.col.lastActive')}</dt><dd><strong>{t.t(la.key, la.vars)}</strong></dd><dd className="kv-field__hint">{t.t('amb.refused.reassignment')}</dd></div>
            </dl>
            <dl className="kv-detail">
              <dt>{t.t('amb.col.tier')}</dt><dd>{t.t(tierKey(row.tierCode))}</dd>
              <dt>{t.t('amb.col.cluster')}</dt><dd>{row.clusterRegionNames.length ? row.clusterRegionNames.join(', ') : t.t('amb.cluster.none')}</dd>
              <dt>{t.t('amb.detail.kiosk')}</dt><dd>{t.t(row.kioskEnabled ? 'amb.yes' : 'amb.no')}</dd>
              <dt>{t.t('amb.detail.aeps')}</dt><dd>{t.t(row.aepsEnabled ? 'amb.yes' : 'amb.no')}</dd>
              <dt>{t.t('amb.detail.stipend')}</dt><dd>{money(row.monthlyStipendMinor)} <span className="kv-field__hint">{t.t('amb.detail.stipendNote', { rupees: minorToRupees(row.monthlyStipendMinor) || '0' })}</span></dd>
              <dt>{t.t('amb.detail.training')}</dt><dd>{row.trainingCompletedAt ? formatDate(row.trainingCompletedAt, lang) : t.t('amb.detail.trainingNo')} <span className="kv-field__hint">{t.t('amb.refused.training')}</span></dd>
            </dl>
            <p className="kv-actions">
              {actsFor(row).map((act) => <span key={act}><Link href={actHref(row!.id, act)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t(actKey(act))}</Link>{' '}</span>)}
              <Link href={editHref(row.id)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('amb.edit')}</Link>
            </p>

            <h2>{t.t('amb.earnings.title')}</h2>
            <p><Link href={unpaidOnly ? base : `${base}?unpaid=1`} className="kv-btn--link">{t.t(unpaidOnly ? 'amb.earnings.showAll' : 'amb.earnings.showUnpaid')}</Link></p>
            {ledger.items.length === 0 ? <p className="kv-detail__muted">{t.t('amb.earnings.empty')}</p> : (
              <table className="kv-table">
                <thead><tr><th scope="col">{t.t('amb.earnings.when')}</th><th scope="col">{t.t('amb.earnings.event')}</th><th scope="col">{t.t('amb.earnings.amount')}</th><th scope="col">{t.t('amb.earnings.status')}</th></tr></thead>
                <tbody>{ledger.items.map((e) => (
                  <tr key={e.id}>
                    <td>{e.createdAt ? formatDate(e.createdAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('common.dash')}</td>
                    <td>{t.t(`amb.event.${['farmer_onboarded', 'first_sale_facilitated', 'first_txn_30d', 'listing_assist', 'sale_trail', 'worker_onboarded', 'kcc_facilitated', 'pmsby_enrolled'].includes(e.eventCode) ? e.eventCode : 'other'}`)}</td>
                    <td>{money(e.amountMinor)}</td>
                    <td>{t.t(e.payoutId ? 'amb.earnings.paid' : 'amb.earnings.unpaid')}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {ledger.nextCursor && <p><Link href={`${base}?${new URLSearchParams({ ...(unpaidOnly ? { unpaid: '1' } : {}), cursor: ledger.nextCursor }).toString()}`} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('amb.nextPage')}</Link></p>}

            <h2>{t.t('amb.target.title')}</h2>
            {targetErr && <p className="kv-error" role="alert">{t.t(`amb.targetError.${targetErr}`)}</p>}
            <form action={setTargetAction} className="kv-card kv-form">
              <input type="hidden" name="ambassadorId" value={row.id} />
              <label className="kv-field" htmlFor="t-metric"><span>{t.t('amb.target.metric')}</span>
                <select id="t-metric" className="kv-select" name="metric" defaultValue="onboardings">{TARGET_METRICS.map((m) => <option key={m} value={m}>{t.t(`amb.metric.${m}`)}</option>)}</select></label>
              <label className="kv-field" htmlFor="t-start"><span>{t.t('amb.target.start')}</span><input id="t-start" className="kv-input" name="periodStart" type="date" required /></label>
              <label className="kv-field" htmlFor="t-end"><span>{t.t('amb.target.end')}</span><input id="t-end" className="kv-input" name="periodEnd" type="date" required /></label>
              <label className="kv-field" htmlFor="t-value"><span>{t.t('amb.target.value')}</span><input id="t-value" className="kv-input" name="targetValue" inputMode="numeric" pattern="[0-9]*" required /></label>
              <button type="submit" className="kv-btn">{t.t('amb.target.submit')}</button>
            </form>
          </>
        );
      })()}
    </section>
  );
}
