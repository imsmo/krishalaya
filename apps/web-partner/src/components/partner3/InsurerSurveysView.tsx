// apps/web-partner/src/components/partner3/InsurerSurveysView.tsx · PC-56 PARTNER-3b · W258 SURVEY SCHEDULING — A READ OF CLAIM FACTS BY SURVEY
// STATUS (founder Q4 + Q5 + 3b-1), presentational.
//
// "Surveys are scheduled and recorded by the organisation that serves the farmer, not from this console. Shown here are the claims on your
// products by survey status, as recorded." (`partner3.surveys.statement`, the founder's words of 2026-10-28.)
//
// Where the canon draws a day-by-day booking schedule (a village cluster on Wednesday, named surveyors riding their vaccination loops,
// provisional holds, time windows and a 48-hour rule), this page draws FOUR TABS over PARTNER-3a's own claims read — survey scheduled (the
// default) · intimated · documents pending · surveyed — with 3a's queue row model (waiting days, the claim reference, the event code, the
// subject type, the sum insured, reported within 72 hours as recorded, the status) and its keyset "older" link. Each row links to that claim's
// survey report. The tab labels carry the COUNT OF CLAIMS in that status from 3a's counts read (founder 3b-1 — never a count of media items,
// never a person), with the FY label and an as-of.
//
// "Confirm Wednesday cluster" and "Retry" are DECOR → the W3014–W3016 chain (`?act=confirm`, whose sentence IS the whole chain); "View claims"
// is real. The cluster and its rule, the slots and holds, the named surveyors and villages, the survey deadlines, the farmer's message, the
// instant reschedule notice, the automatic booking and the surveyors' offline copies are refused BY NAME below.
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
  SURVEY_STAGES, claimRef, claimStatusKey, claimStatusTone, eventLabel, reportedKey, stageTabCount, surveysHref, waitingText, windowLabel,
  type InsurerListState, type SurveyStage,
} from '../../features/partner3/figures';

export function InsurerSurveysView({ t, lang, state, items, counts, stage, nextCursor, computedAt }: {
  t: Tr; lang: string; state: InsurerListState; items: PartnerInsuranceClaim[]; counts: PartnerInsuranceClaimCounts | null; stage: SurveyStage;
  nextCursor: string | null; computedAt: string | null;
}) {
  if (state === 'off' || state === 'insurance_off') return <InsurerSwitchedOff t={t} which={state} page="surveys" />;
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const ev = (code: string | null) => { const l = eventLabel(code); return 'key' in l ? t.t(l.key) : l.raw; };
  const win = windowLabel(counts);
  return (
    <section data-kv-insurer="surveys" data-kv-state={state} data-kv-stage={stage}>
      <h1>{t.t('partner3.surveys.title')}</h1>
      <ClaimsSubNav t={t} current="/insurer/surveys" />
      <p className="kv-statement" data-kv-statement="partner3.surveys.statement">{t.t('partner3.surveys.statement')}</p>
      <nav className="kv-filters" aria-label={t.t('partner3.surveys.filter')} data-kv-tabs="surveys">
        {SURVEY_STAGES.map((s) => (
          <Link key={s} href={surveysHref(s)} className={`kv-chip${stage === s ? ' is-active' : ''}`} aria-current={stage === s ? 'page' : undefined} data-kv-stage-tab={s}>
            {t.t(claimStatusKey(s))}{counts ? ` ${stageTabCount(counts.byStatus, s)}` : ''}
          </Link>
        ))}
      </nav>
      {counts && (
        <p className="kv-muted" data-kv-counts="surveys">
          {win ? t.t(win.key, win.vars) : t.t('partner3.surveys.countsTitle')} · {t.t('partner3.surveys.countsOnlyClaims')} · <span data-kv-asof={counts.computedAt}>{t.t('partner3.asOf', { time: asOfText(counts.computedAt, lang) })}</span>
        </p>
      )}
      {state === 'error' ? (
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner3.surveys.error.title')}</h2>
          <p>{t.t('partner3.surveys.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/insurer/surveys?act=confirm" data-kv-retry="true">{t.t('partner3.retry')}</Link></p>
        </div>
      ) : state === 'empty' ? (
        <div className="kv-card kv-empty-state">
          <h2 className="kv-card__title">{t.t('partner3.surveys.empty.title')}</h2>
          <p>{t.t('partner3.surveys.empty.body', { status: t.t(claimStatusKey(stage)) })}</p>
        </div>
      ) : (
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
                <td><Link href={`/insurer/surveys/${encodeURIComponent(c.id)}/report`}>{claimRef(c.id)}</Link> <span className="kv-muted">{fpoLabel(c.fpoName, t.t('partner1.fpoUnnamed'))}</span></td>
                <td>{ev(c.eventTypeCode)}</td>
                <td>{t.t(subjectKey(c.subjectType))}</td>
                <td>{money(c.sumInsuredMinor)}</td>
                <td data-kv-reported={String(c.reportedWithin72h)}>{t.t(reportedKey(c.reportedWithin72h))}</td>
                <td><span className={`kv-status kv-status--${claimStatusTone(c.status)}`}>{t.t(claimStatusKey(c.status))}</span></td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
      {state === 'ok' && nextCursor && <p className="kv-pager"><Link className="kv-btn" href={surveysHref(stage, nextCursor)} data-kv-next="true">{t.t('partner3.surveys.next')}</Link></p>}
      <p className="kv-pager" data-kv-acts="surveys">
        <Link className="kv-btn kv-btn--muted" href="/insurer/surveys?act=confirm" data-kv-decor="confirm-visits">{t.t('partner3.surveys.confirm')}</Link>{' '}
        <Link className="kv-btn" href="/insurer/claims" data-kv-real="claims">{t.t('partner3.insights.viewClaims')}</Link>
      </p>
      {state !== 'error' && computedAt && <p className="kv-muted" data-kv-asof={computedAt}>{t.t('partner3.asOf', { time: asOfText(computedAt, lang) })}</p>}
      <ClaimsRefusals t={t} surface="surveys" />
    </section>
  );
}
