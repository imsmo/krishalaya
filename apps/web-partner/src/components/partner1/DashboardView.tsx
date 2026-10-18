// apps/web-partner/src/components/partner1/DashboardView.tsx · PC-56 PARTNER-1a · founder D1 — THE DASHBOARD (canon W205), presentational.
//
// Renders what `GET /v1/partner/dashboard` computed — six figures and their "as of", the published decision promise beside the actual
// latency, the organisations routing to the partner (PUBLIC display names; a non-live one is "an organisation"), and "needs you today" (the
// oldest awaiting applications by reference, product, amount, organisation and age — never an applicant's name). It formats; it never adds
// or divides (features/partner1/dashboard.ts does the integer maths). States: empty → the loan queue (no "view products": products is not in
// the partner console yet); error → "computed on the server; nothing is affected" + Reload; off → the console's switched-off sentence
// ("nothing is broken" — never "unavailable"). The scope state is PARTNER-0's persona gate (requirePartner), before this renders.
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { PartnerDashboard } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { RefusalList } from './RefusalList';
import { ageHours, appRef, asOfText, bpsPercentText, fpoLabel, hoursText, type DashboardState } from '../../features/partner1/dashboard';

function Tile({ id, label, value, hint }: { id: string; label: string; value: string; hint?: string }) {
  return (
    <div className="kv-card kv-stat" data-kv-tile={id}>
      <div className="kv-stat__label">{label}</div>
      <div className="kv-stat__value">{value}</div>
      {hint && <p className="kv-field__hint">{hint}</p>}
    </div>
  );
}

export function DashboardView({ t, lang, state, d, orgName }: { t: Tr; lang: string; state: DashboardState; d: PartnerDashboard | null; orgName: string | null }) {
  const money = (minor: string) => formatMoneyMinor(minor, 'INR', lang);
  const head = (
    <>
      <h1>{t.t('partner1.dash.title')}</h1>
      <p className="kv-muted">{orgName ?? t.t('partner.shell.orgUnknown')}</p>
    </>
  );
  if (state === 'off') {
    return <section data-kv-dash="off"><h1>{t.t('partner.off.title')}</h1><p className="kv-muted">{t.t('partner.off.body')}</p></section>;
  }
  if (state === 'error' || !d) {
    return (
      <section data-kv-dash="error">
        {head}
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner1.dash.error.title')}</h2>
          <p>{t.t('partner1.dash.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/dashboard?retry=confirm">{t.t('partner1.dash.retry')}</Link></p>
        </div>
      </section>
    );
  }
  const asOf = <p className="kv-muted" data-kv-asof={d.computedAt}>{t.t('partner1.asOf', { time: asOfText(d.computedAt, lang) })}</p>;
  if (state === 'empty') {
    return (
      <section data-kv-dash="empty">
        {head}
        <div className="kv-card kv-empty-state">
          <h2 className="kv-card__title">{t.t('partner1.dash.empty.title')}</h2>
          <p>{t.t('partner1.dash.empty.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/loan-queue">{t.t('partner1.dash.openQueue')}</Link></p>
        </div>
        {asOf}
      </section>
    );
  }
  const m = d.decidedThisMonth;
  const rate = bpsPercentText(m.approvalRateBps);
  const onTime = bpsPercentText(d.onTime.shareBps);
  const median = hoursText(d.sla.medianSec); const p90 = hoursText(d.sla.p90Sec);
  return (
    <section data-kv-dash="ok">
      {head}
      <p className="kv-muted">{t.t('partner1.dash.lead')}</p>
      <div className="kv-stat-row">
        <Tile id="awaiting" label={t.t('partner1.dash.awaiting')} value={String(d.awaitingDecision)} hint={t.t('partner1.dash.awaitingHint')} />
        <Tile id="decided" label={t.t('partner1.dash.decided')} value={String(m.decided)}
          hint={t.t('partner1.dash.decidedHint', { approved: m.approved, rejected: m.rejected, amount: money(m.approvedAmountMinor) })} />
        <Tile id="rate" label={t.t('partner1.dash.rate')} value={rate === null ? t.t('partner1.dash.rateNone') : t.t('partner1.dash.rateValue', { value: rate })} hint={t.t('partner1.dash.rateHint')} />
        <Tile id="outstanding" label={t.t('partner1.dash.outstanding')} value={money(d.portfolio.outstandingMinor)} hint={t.t('partner1.dash.outstandingHint', { count: d.portfolio.activeLoans })} />
        <Tile id="ontime" label={t.t('partner1.dash.onTime', { days: d.onTime.windowDays })}
          value={onTime === null ? t.t('partner1.dash.onTimeNone') : t.t('partner1.dash.rateValue', { value: onTime })}
          hint={t.t('partner1.dash.onTimeHint', { onTime: d.onTime.onTime, due: d.onTime.due })} />
      </div>
      {asOf}

      <div className="kv-card" data-kv-sla={d.sla.decisionPromiseHours ?? 'none'}>
        <h2 className="kv-card__title">{t.t('partner1.dash.slaTitle')}</h2>
        <p>{d.sla.decisionPromiseHours === null ? t.t('partner1.dash.slaNone') : t.t('partner1.dash.slaPromise', { hours: d.sla.decisionPromiseHours })}</p>
        <p>{median === null || p90 === null ? t.t('partner1.dash.slaActualNone', { days: d.sla.windowDays })
          : t.t('partner1.dash.slaActual', { days: d.sla.windowDays, median, p90, count: d.sla.decided })}</p>
        {d.sla.withinPromise !== null && d.sla.decided > 0 && <p>{t.t('partner1.dash.slaWithin', { within: d.sla.withinPromise, count: d.sla.decided })}</p>}
      </div>

      <div className="kv-card">
        <h2 className="kv-card__title">{t.t('partner1.dash.needsTitle')}</h2>
        <p className="kv-muted">{t.t('partner1.dash.needsLead')}</p>
        {d.needsYouToday.length === 0 ? <p>{t.t('partner1.dash.needsNone')}</p> : (
          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('partner1.dash.colApp')}</th><th scope="col">{t.t('partner1.dash.colProduct')}</th><th scope="col">{t.t('partner1.dash.colAmount')}</th>
              <th scope="col">{t.t('partner1.dash.colFpo')}</th><th scope="col">{t.t('partner1.dash.colAge')}</th>
            </tr></thead>
            <tbody>{d.needsYouToday.map((a) => (
              <tr key={a.id} data-kv-needs={a.id}>
                <td><Link href={`/loan-queue/${a.id}`}>{appRef(a.id)}</Link></td>
                <td>{a.productName}</td>
                <td>{money(a.amountRequestedMinor)}</td>
                <td>{fpoLabel(a.fpoName, t.t('partner1.fpoUnnamed'))}</td>
                <td>{t.t('partner1.dash.age', { hours: ageHours(a.createdAt, d.computedAt) })}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <p className="kv-pager"><Link className="kv-btn" href="/loan-queue">{t.t('partner1.dash.openQueue')}</Link></p>
      </div>

      <div className="kv-card">
        <h2 className="kv-card__title">{t.t('partner1.dash.fposTitle')}</h2>
        {d.fpos.length === 0 ? <p>{t.t('partner1.dash.fposNone')}</p> : (
          <ul className="kv-list" data-kv-fpos={d.fpos.length}>{d.fpos.map((f) => <li key={f.tenantId} data-kv-fpo={f.tenantId}>{fpoLabel(f.name, t.t('partner1.fpoUnnamed'))}</li>)}</ul>
        )}
      </div>

      <RefusalList t={t} surface="dashboard" />
    </section>
  );
}
