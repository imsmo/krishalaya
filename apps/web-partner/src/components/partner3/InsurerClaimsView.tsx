// apps/web-partner/src/components/partner3/InsurerClaimsView.tsx · PC-56 PARTNER-3a · W252 THE CLAIMS QUEUE — CLAIM FACTS, NEVER A CLAIMANT (founder
// Q4), presentational.
//
// What `GET /v1/partner/insurance/claims` and `/counts` answered, and nothing else: the COUNTS of the claims filed in the FY window by status
// (intimated · documents pending · survey scheduled · surveyed · approved (incl. partially) · rejected · paid or closed) with their as-of; the
// queue OLDEST-WAITING FIRST — waiting days, the claim REFERENCE (its id's short form: there is no claim number), the event type code, the
// subject TYPE, the policy's sum insured, "reported within 72 hours" as recorded (a late report is recorded; nothing rejects a claim for it),
// the status. NO claimant, name, phone, village, note, surveyor or media column exists to fill. The status filter is the machine's own nine
// statuses; keyset paging. "Take next" is DECOR (no claim is assigned or taken — the W2857–W2859 chain, `?act=`). The canon's "approved ·
// paying" chip is the approved COUNT; the payout run, the hour counts, the timers, the roles and the two-person rule are refused by name.
import Link from 'next/link';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { PartnerInsuranceClaim, PartnerInsuranceClaimCounts } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { InsurerSwitchedOff } from '../partner2/InsurerStates';
import { ClaimsSubNav } from './ClaimsSubNav';
import { ClaimsRefusals } from './InsurerClaimsChain';
import { asOfText } from '../../features/partner1/dashboard';
import { fpoLabel, subjectKey } from '../../features/partner2/figures';
import {
  CLAIM_STATUSES, chipCounts, claimRef, claimStatusKey, claimStatusTone, claimsHref, eventLabel, reportedKey, waitingText, windowLabel, type InsurerListState,
} from '../../features/partner3/figures';

export function InsurerClaimsView({ t, lang, state, items, counts, status, nextCursor, computedAt }: {
  t: Tr; lang: string; state: InsurerListState; items: PartnerInsuranceClaim[]; counts: PartnerInsuranceClaimCounts | null; status?: string; nextCursor: string | null; computedAt: string | null;
}) {
  if (state === 'off' || state === 'insurance_off') return <InsurerSwitchedOff t={t} which={state} page="claims" />;
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const ev = (code: string | null) => { const l = eventLabel(code); return 'key' in l ? t.t(l.key) : l.raw; };
  const win = windowLabel(counts);
  return (
    <section data-kv-insurer="claims" data-kv-state={state}>
      <h1>{t.t('partner3.claims.title')}</h1>
      <p className="kv-muted">{t.t('partner3.claims.lead')}</p>
      <ClaimsSubNav t={t} current="/insurer/claims" />
      {counts && (
        <div className="kv-card kv-counts" data-kv-counts="claims">
          <h2 className="kv-card__title">{win ? t.t(win.key, win.vars) : t.t('partner3.claims.countsTitle')}</h2>
          <dl className="kv-counts__list">
            {chipCounts(counts.byStatus).map((c) => (
              <div key={c.id} className="kv-counts__item" data-kv-count={c.id}><dt>{t.t(c.key)}</dt><dd>{c.n}</dd></div>
            ))}
          </dl>
          <p className="kv-muted" data-kv-asof={counts.computedAt}>{t.t('partner3.asOf', { time: asOfText(counts.computedAt, lang) })}</p>
        </div>
      )}
      <p><Link className="kv-btn kv-btn--muted" href="/insurer/claims?act=confirm" data-kv-decor="take-next">{t.t('partner3.claims.takeNext')}</Link></p>
      <nav className="kv-filters" aria-label={t.t('partner3.claims.filter')}>
        <Link href={claimsHref()} className={`kv-chip${!status ? ' is-active' : ''}`} aria-current={!status ? 'true' : undefined}>{t.t('partner3.claims.all')}</Link>
        {CLAIM_STATUSES.map((s) => (
          <Link key={s} href={claimsHref(s)} className={`kv-chip${status === s ? ' is-active' : ''}`} aria-current={status === s ? 'true' : undefined} data-kv-status-filter={s}>{t.t(claimStatusKey(s))}</Link>
        ))}
      </nav>
      {state === 'error' ? (
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner3.claims.error.title')}</h2>
          <p>{t.t('partner3.claims.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/insurer/claims?act=confirm">{t.t('partner3.retry')}</Link></p>
        </div>
      ) : state === 'empty' ? (
        <div className="kv-card kv-empty-state">
          <h2 className="kv-card__title">{t.t(status ? 'partner3.claims.emptyFilter.title' : 'partner3.claims.empty.title')}</h2>
          <p>{t.t(status ? 'partner3.claims.emptyFilter.body' : 'partner3.claims.empty.body')}</p>
          <p className="kv-pager"><Link className="kv-btn kv-btn--muted" href="/insurer/policies">{t.t('partner3.claims.viewPolicies')}</Link></p>
        </div>
      ) : (
        <>
          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('partner3.claims.colWaiting')}</th><th scope="col">{t.t('partner3.claims.colClaim')}</th>
              <th scope="col">{t.t('partner3.claims.colEvent')}</th><th scope="col">{t.t('partner3.claims.colSubject')}</th>
              <th scope="col">{t.t('partner3.claims.colSumInsured')}</th><th scope="col">{t.t('partner3.claims.colReported')}</th>
              <th scope="col">{t.t('partner3.claims.colStatus')}</th>
            </tr></thead>
            <tbody>{items.map((c) => {
              const w = waitingText(c.waitingDays);
              return (
                <tr key={c.id} data-kv-claim={c.id}>
                  <td>{w ? t.t(w.key, w.vars) : t.t('partner3.claims.notWaiting')}</td>
                  <td><Link href={`/insurer/claims/${encodeURIComponent(c.id)}`}>{claimRef(c.id)}</Link> <span className="kv-muted">{fpoLabel(c.fpoName, t.t('partner1.fpoUnnamed'))}</span></td>
                  <td>{ev(c.eventTypeCode)}</td>
                  <td>{t.t(subjectKey(c.subjectType))}</td>
                  <td>{money(c.sumInsuredMinor)}</td>
                  <td data-kv-reported={String(c.reportedWithin72h)}>{t.t(reportedKey(c.reportedWithin72h))}</td>
                  <td><span className={`kv-status kv-status--${claimStatusTone(c.status)}`}>{t.t(claimStatusKey(c.status))}</span></td>
                </tr>
              );
            })}</tbody>
          </table>
          <p className="kv-muted">{t.t('partner3.claims.lateNote')}</p>
        </>
      )}
      {state === 'ok' && nextCursor && <p className="kv-pager"><Link className="kv-btn" href={claimsHref(status, nextCursor)} data-kv-next="true">{t.t('partner3.claims.next')}</Link></p>}
      {state !== 'error' && computedAt && <p className="kv-muted" data-kv-asof={computedAt}>{t.t('partner3.asOf', { time: asOfText(computedAt, lang) })}</p>}
      <ClaimsRefusals t={t} surface="claims" />
    </section>
  );
}
