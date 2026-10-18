// apps/web-partner/src/components/partner2/InsurerPoliciesView.tsx · PC-56 PARTNER-2a · W248 THE POLICIES ON THE INSURER'S PRODUCTS, presentational.
//
// Policy FACTS only (founder Q6), as `GET /v1/partner/insurance/policies` answered them: the policy number or "no policy number yet" (NULL on
// every activated policy — nobody issues on the platform, Q5), the product, the FPO's PUBLIC name ("an organisation" when not live), the
// subject TYPE, the sum insured, the farmer's premium share as stored, the status, the valid dates. NO name, NO phone, NO subject id, NO holder
// column exists to fill. Keyset paging (`?cursor=`) and the status filter (the state machine's own list) are the only things that enter the
// URL. "Export book" is DECOR (W2881–W2882: no partner export plane); there is no bulk bar.
import Link from 'next/link';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import type { PartnerInsurancePolicy } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { InsurerRefusals } from './InsurerRefusals';
import { InsurerSwitchedOff } from './InsurerStates';
import { asOfText } from '../../features/partner1/dashboard';
import { fpoLabel, policiesHref, policyNoText, policyRef, POLICY_STATUSES, statusKey, statusTone, subjectKey, type InsurerListState } from '../../features/partner2/figures';

export function InsurerPoliciesView({ t, lang, state, items, status, nextCursor, computedAt }: {
  t: Tr; lang: string; state: InsurerListState; items: PartnerInsurancePolicy[]; status?: string; nextCursor: string | null; computedAt: string | null;
}) {
  if (state === 'off' || state === 'insurance_off') return <InsurerSwitchedOff t={t} which={state} page="policies" />;
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const day = (d: string | null) => (d ? formatDate(d, lang, { dateStyle: 'medium', timeZone: 'UTC' }) : t.t('partner2.none'));
  return (
    <section data-kv-insurer="policies" data-kv-state={state}>
      <h1>{t.t('partner2.policies.title')}</h1>
      <p className="kv-muted">{t.t('partner2.policies.lead')}</p>
      <nav className="kv-filters" aria-label={t.t('partner2.policies.filter')}>
        <Link href={policiesHref()} className={`kv-chip${!status ? ' is-active' : ''}`} aria-current={!status ? 'true' : undefined}>{t.t('partner2.policies.all')}</Link>
        {POLICY_STATUSES.map((s) => (
          <Link key={s} href={policiesHref(s)} className={`kv-chip${status === s ? ' is-active' : ''}`} aria-current={status === s ? 'true' : undefined} data-kv-status-filter={s}>{t.t(statusKey(s))}</Link>
        ))}
      </nav>
      <p><Link className="kv-btn kv-btn--muted" href="/insurer/policies?export=queued" data-kv-decor="export">{t.t('partner2.policies.export')}</Link></p>
      {state === 'error' ? (
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner2.policies.error.title')}</h2>
          <p>{t.t('partner2.policies.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/insurer/policies?retry=confirm">{t.t('partner2.retry')}</Link></p>
        </div>
      ) : state === 'empty' ? (
        <div className="kv-card kv-empty-state">
          <h2 className="kv-card__title">{t.t('partner2.policies.empty.title')}</h2>
          <p>{t.t('partner2.policies.empty.body')}</p>
        </div>
      ) : (
        <table className="kv-table">
          <thead><tr>
            <th scope="col">{t.t('partner2.policies.colPolicy')}</th><th scope="col">{t.t('partner2.policies.colProduct')}</th>
            <th scope="col">{t.t('partner2.policies.colFpo')}</th><th scope="col">{t.t('partner2.policies.colSubject')}</th>
            <th scope="col">{t.t('partner2.policies.colSumInsured')}</th><th scope="col">{t.t('partner2.policies.colPremium')}</th>
            <th scope="col">{t.t('partner2.policies.colStatus')}</th><th scope="col">{t.t('partner2.policies.colValid')}</th>
          </tr></thead>
          <tbody>{items.map((p) => (
            <tr key={p.id} data-kv-policy={p.id}>
              <td><Link href={`/insurer/policies/${encodeURIComponent(p.id)}`}>{policyNoText(p.policyNo, t.t('partner2.policies.noNumber'))}</Link> <span className="kv-muted kv-code">{policyRef(p.id)}</span></td>
              <td>{p.productName ?? t.t('partner2.none')}</td>
              <td>{fpoLabel(p.fpoName, t.t('partner1.fpoUnnamed'))}</td>
              <td>{t.t(subjectKey(p.subjectType))}</td>
              <td>{money(p.sumInsuredMinor)}</td>
              <td>{money(p.premiumMinor)}</td>
              <td><span className={`kv-status kv-status--${statusTone(p.status)}`}>{t.t(statusKey(p.status))}</span></td>
              <td>{t.t('partner2.policies.validRange', { from: day(p.validFrom), until: day(p.validUntil) })}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={policiesHref(status, nextCursor)} data-kv-next="true">{t.t('partner2.policies.next')}</Link></p>}
      {computedAt && <p className="kv-muted" data-kv-asof={computedAt}>{t.t('partner2.asOf', { time: asOfText(computedAt, lang) })}</p>}
      <InsurerRefusals t={t} surface="ins_policies" />
    </section>
  );
}
