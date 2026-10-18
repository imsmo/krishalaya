// apps/web-partner/src/components/partner2/InsurerIssuanceView.tsx · PC-56 PARTNER-2b · W249 THE ISSUANCE DESK — A READ (founder Q5), presentational.
//
// The insurer never issues on the platform: a farmer's confirmed premium payment starts cover by itself (survey F-5). This page prints that
// sentence (`partner2.issuance.statement`, approved by the founder) and lists what IS true: the `proposed` policies on the insurer's own products
// — the proposals awaiting the farmer's payment — as `GET /v1/partner/insurance/issuance` answered them: the proposal, the product, the FPO's
// PUBLIC name, the subject TYPE, the sum insured, the premium the FARMER will pay, when it was proposed, and the cover window it carries (if
// any). NO name, NO phone, NO holder column exists to fill. The canon's act ("Issue reviewed batch") is DECOR → the W2944–W2947 form chain
// (`?form=`); "Reload" → the W2948–W2950 re-read chain (`?act=`). The canon's camp batches, pre-verification, second approver, rejection
// rate, documents, holds, grid assignment, response clock, roles and the proposal-to-policy time are refused by name below.
import Link from 'next/link';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import type { PartnerInsuranceQueueRow } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { InsurerRefusals } from './InsurerRefusals';
import { InsurerSwitchedOff } from './InsurerStates';
import { asOfText } from '../../features/partner1/dashboard';
import { fpoLabel, issuanceHref, policyRef, queueWindow, subjectKey, type InsurerListState } from '../../features/partner2/figures';

export function InsurerIssuanceView({ t, lang, state, items, nextCursor, computedAt }: {
  t: Tr; lang: string; state: InsurerListState; items: PartnerInsuranceQueueRow[]; nextCursor: string | null; computedAt: string | null;
}) {
  if (state === 'off' || state === 'insurance_off') return <InsurerSwitchedOff t={t} which={state} page="issuance" />;
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const day = (d: string | null) => (d ? formatDate(d, lang, { dateStyle: 'medium', timeZone: 'UTC' }) : t.t('partner2.none'));
  return (
    <section data-kv-insurer="issuance" data-kv-state={state}>
      <h1>{t.t('partner2.issuance.title')}</h1>
      <p className="kv-statement" data-kv-statement="partner2.issuance.statement">{t.t('partner2.issuance.statement')}</p>
      <p className="kv-muted">{t.t('partner2.issuance.lead')}</p>
      <p><Link className="kv-btn kv-btn--muted" href="/insurer/issuance?form=review" data-kv-decor="issue">{t.t('partner2.issuance.act')}</Link></p>
      {state === 'error' ? (
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner2.issuance.error.title')}</h2>
          <p>{t.t('partner2.issuance.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/insurer/issuance?act=confirm">{t.t('partner2.retry')}</Link></p>
        </div>
      ) : state === 'empty' ? (
        <div className="kv-card kv-empty-state">
          <h2 className="kv-card__title">{t.t('partner2.issuance.empty.title')}</h2>
          <p>{t.t('partner2.issuance.empty.body')}</p>
        </div>
      ) : (
        <table className="kv-table">
          <thead><tr>
            <th scope="col">{t.t('partner2.issuance.colProposal')}</th><th scope="col">{t.t('partner2.issuance.colProduct')}</th>
            <th scope="col">{t.t('partner2.issuance.colFpo')}</th><th scope="col">{t.t('partner2.issuance.colSubject')}</th>
            <th scope="col">{t.t('partner2.issuance.colSumInsured')}</th><th scope="col">{t.t('partner2.issuance.colPremium')}</th>
            <th scope="col">{t.t('partner2.issuance.colProposed')}</th><th scope="col">{t.t('partner2.issuance.colWindow')}</th>
          </tr></thead>
          <tbody>{items.map((r) => {
            const w = queueWindow(r);
            return (
              <tr key={r.id} data-kv-proposal={r.id}>
                <td><Link href={`/insurer/policies/${encodeURIComponent(r.id)}`}>{policyRef(r.id)}</Link></td>
                <td>{r.productName ?? t.t('partner2.none')}</td>
                <td>{fpoLabel(r.fpoName, t.t('partner1.fpoUnnamed'))}</td>
                <td>{t.t(subjectKey(r.subjectType))}</td>
                <td>{money(r.sumInsuredMinor)}</td>
                <td>{money(r.premiumMinor)}</td>
                <td>{day(r.proposedAt)}</td>
                <td>{w.from && w.until ? t.t(w.key, { from: day(w.from), until: day(w.until) }) : t.t(w.key)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
      {state === 'ok' && nextCursor && <p className="kv-pager"><Link className="kv-btn" href={issuanceHref(nextCursor)} data-kv-next="true">{t.t('partner2.issuance.next')}</Link></p>}
      {state !== 'error' && computedAt && <p className="kv-muted" data-kv-asof={computedAt}>{t.t('partner2.asOf', { time: asOfText(computedAt, lang) })}</p>}
      <InsurerRefusals t={t} surface="ins_issuance" />
    </section>
  );
}
