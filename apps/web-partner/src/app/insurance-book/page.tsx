// apps/web-partner/src/app/insurance-book/page.tsx · the insurer's book, issuance and loss ratio (PC-55 B7, on W54-9).
// Three things an underwriter needs in one place: what has been written, what is waiting to be issued, and whether
// the book is losing money.
//
// NO PREMIUM, NO COVER. Issuance is offered only for a PROPOSED policy whose premium payment is linked — both are
// server guards, mirrored here so nobody types a policy number into a form that cannot succeed, and so no colleague
// reads an un-issued row as live cover. Where issuance is unavailable the page SAYS WHY rather than hiding a button.
//
// THE LOSS RATIO IS NULL, NOT ZERO, ON AN EMPTY BOOK. A ratio with no written premium is UNKNOWN; rendering "0%"
// would tell an underwriter their young book is perfectly healthy, which is the opposite of what the absence of data
// means. It is also computed in BASIS POINTS from minor-unit strings — integer arithmetic on money (Law 2), never a
// float — and it is explicitly labelled as approved claims over written premium, because "loss ratio" means
// different things at different desks.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import {
  CALC_MODES, canIssue, countByStatus, describeCalc, issueBlockedReason, lossRatioBps, sumMinor,
  type InsightRow, type PolicyRow,
} from '../../features/insurance/authoring';
import { createProductAction, issuePolicyAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('insBook.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['product', 'issued']);
const ERR = new Set(['generic', 'forbidden', 'notFound', 'illegal', 'invalid',
  'pr_partner', 'pr_kind', 'pr_name', 'pr_mode', 'pr_pct', 'pr_flat', 'pr_parametric', 'pr_parametricJson',
  'pr_subsidy', 'pr_commission', 'pr_sumInsuredJson', 'is_policyNo', 'is_triggersJson']);

type BookRow = PolicyRow & Record<string, unknown> & {
  id?: string; policyNo?: string | null; subjectType?: string; sumInsuredMinor?: string; premiumMinor?: string;
  validFrom?: string; validUntil?: string; productId?: string; holderUserId?: string;
};
type ProductRow = { id?: string; defaultName?: string | null; premiumCalc?: Record<string, unknown> | null; isActive?: boolean; isParametric?: boolean };

export default async function InsuranceBookPage({ searchParams }: {
  searchParams: { status?: string; ok?: string; error?: string };
}) {
  await requirePartner();
  const t = getTranslator();
  const client = partnerClient();
  const status = (searchParams.status ?? '').trim() || undefined;

  let book: BookRow[] = []; let bookFailed = false; let forbidden = false;
  try { book = (await client.insuranceAuthoring.book({ status, limit: 200 })) as BookRow[]; }
  catch (e) { forbidden = (e as { status?: number }).status === 403; bookFailed = !forbidden; }

  let insights: { policies?: InsightRow[]; claims?: InsightRow[] } = {}; let insightsFailed = false;
  if (!forbidden) {
    try { insights = (await client.insuranceAuthoring.insights()) as { policies?: InsightRow[]; claims?: InsightRow[] }; }
    catch { insightsFailed = true; }
  }

  // The product catalogue is read from the existing public list; it tells an underwriter which formulas are live.
  let products: ProductRow[] = [];
  if (!forbidden) {
    try { products = (await client.request<ProductRow[]>('GET', 'insurance/products', { query: { limit: 100 } })).data ?? []; }
    catch { products = []; }
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  const policies = insights.policies ?? [];
  const claims = insights.claims ?? [];
  const ratio = lossRatioBps(policies, claims);
  const writtenPremium = sumMinor(policies.map((p) => p.premium));
  const approvedClaims = sumMinor(claims.map((c) => c.approved));
  const policyCounts = countByStatus(policies);
  const claimCounts = countByStatus(claims);

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('insBook.title')}</h1>
        <Link href="/insurance-products" className="kv-btn--link">{t.t('nav.insuranceProducts')} →</Link>
      </div>
      <p className="kv-field__hint">{t.t('insBook.hint')}</p>

      {okKey && <p className="kv-success" role="status">{t.t(`insBook.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`insBook.error.${errKey}`)}</p>}
      {forbidden && <p className="kv-error" role="alert">{t.t('insBook.forbidden')}</p>}

      {!forbidden && (
        <>
          <h2>{t.t('insBook.insights.title')}</h2>
          {insightsFailed ? <p className="kv-error" role="alert">{t.t('insBook.loadError')}</p> : (
            <>
              <dl className="kv-facts kv-facts--totals">
                <div className="kv-facts__row"><dt>{t.t('insBook.writtenPremium')}</dt><dd>{formatMoneyMinor(writtenPremium.toString(), 'INR', 'en')}</dd></div>
                <div className="kv-facts__row"><dt>{t.t('insBook.approvedClaims')}</dt><dd>{formatMoneyMinor(approvedClaims.toString(), 'INR', 'en')}</dd></div>
                <div className="kv-facts__row">
                  <dt>{t.t('insBook.lossRatio')}</dt>
                  <dd>{ratio === null ? t.t('insBook.lossRatioUnknown') : `${(ratio / 100).toFixed(2)} %`}</dd>
                </div>
              </dl>
              <p className="kv-field__hint">{t.t('insBook.lossRatioNote')}</p>
              <p className="kv-fine">
                {Object.entries(policyCounts).map(([k, n]) => `${k}: ${n}`).join(' · ') || t.t('insBook.noPolicies')}
                {Object.keys(claimCounts).length > 0 ? ` — ${t.t('insBook.claims')}: ${Object.entries(claimCounts).map(([k, n]) => `${k}: ${n}`).join(' · ')}` : ''}
              </p>
            </>
          )}

          <h2>{t.t('insBook.book.title')}</h2>
          {bookFailed ? <p className="kv-error" role="alert">{t.t('insBook.loadError')}</p> : (
            <DataTable
              rows={book}
              empty={t.t('insBook.book.empty')}
              columns={[
                { header: t.t('insBook.col.policyNo'), cell: (p) => p.policyNo ?? <span className="kv-badge">{t.t('insBook.notIssued')}</span> },
                { header: t.t('insBook.col.status'), cell: (p) => <span className="kv-badge">{String(p.status ?? '')}</span> },
                { header: t.t('insBook.col.subject'), cell: (p) => String(p.subjectType ?? t.t('common.dash')) },
                { header: t.t('insBook.col.sumInsured'), cell: (p) => (p.sumInsuredMinor ? formatMoneyMinor(String(p.sumInsuredMinor), 'INR', 'en') : t.t('common.dash')) },
                { header: t.t('insBook.col.premium'), cell: (p) => (p.premiumMinor ? formatMoneyMinor(String(p.premiumMinor), 'INR', 'en') : t.t('common.dash')) },
                { header: t.t('insBook.col.cover'), cell: (p) => (p.validFrom && p.validUntil ? `${formatDate(String(p.validFrom), 'en')} → ${formatDate(String(p.validUntil), 'en')}` : t.t('common.dash')) },
                {
                  header: t.t('insBook.col.issue'),
                  cell: (p) => (canIssue(p) ? (
                    <form action={issuePolicyAction} className="kv-inline-form">
                      <input type="hidden" name="policyId" value={String(p.id ?? '')} />
                      <label htmlFor={`no-${p.id}`} className="kv-field__label">{t.t('insBook.policyNo')}</label>
                      <input id={`no-${p.id}`} name="policyNo" className="kv-input" minLength={3} maxLength={80} required />
                      {p.subjectType === 'crop_season' ? <input name="triggersJson" className="kv-input" placeholder={t.t('insBook.triggersPlaceholder')} /> : null}
                      <button type="submit" className="kv-btn kv-btn--sm">{t.t('insBook.issueBtn')}</button>
                    </form>
                  ) : (
                    <span className="kv-fine">{t.t(`insBook.blocked.${issueBlockedReason(p)}`)}</span>
                  )),
                },
              ]}
            />
          )}
          <p className="kv-field__hint">{t.t('insBook.issueNote')}</p>

          <h2>{t.t('insBook.products.title')}</h2>
          <DataTable
            rows={products}
            empty={t.t('insBook.products.empty')}
            columns={[
              { header: t.t('insBook.col.product'), cell: (p) => p.defaultName ?? String(p.id ?? '').slice(0, 8) },
              {
                header: t.t('insBook.col.formula'),
                cell: (p) => {
                  const d = describeCalc(p.premiumCalc);
                  if (d.mode === 'pct_of_sum_insured') return `${d.pct} % ${t.t('insBook.ofSumInsured')}`;
                  if (d.mode === 'flat_minor') return `${formatMoneyMinor(String(d.flatMinor), 'INR', 'en')} ${t.t('insBook.flat')}`;
                  if (d.mode === 'parametric') return t.t('insBook.calc.parametric');
                  return <strong>{t.t('insBook.calc.unknown')}</strong>;
                },
              },
              { header: t.t('insBook.col.active'), cell: (p) => (p.isActive === false ? t.t('insBook.inactive') : t.t('insBook.active')) },
            ]}
          />

          <form action={createProductAction} className="kv-card kv-form">
            <h3 className="kv-card__title">{t.t('insBook.newProduct')}</h3>
            <p className="kv-notice" role="note">{t.t('insBook.formulaNotice')}</p>
            <div className="kv-field">
              <label htmlFor="pr-partner" className="kv-field__label">{t.t('insBook.partnerId')}</label>
              <input id="pr-partner" name="partnerId" className="kv-input" required />
              <label htmlFor="pr-kind" className="kv-field__label">{t.t('insBook.productKindId')}</label>
              <input id="pr-kind" name="productKindId" className="kv-input" required aria-describedby="pr-kind-hint" />
              <p id="pr-kind-hint" className="kv-field__hint">{t.t('insBook.productKindHint')}</p>
              <label htmlFor="pr-name" className="kv-field__label">{t.t('insBook.productName')}</label>
              <input id="pr-name" name="defaultName" className="kv-input" minLength={3} maxLength={200} required />
            </div>

            <fieldset className="kv-fieldset">
              <legend>{t.t('insBook.premiumLegend')}</legend>
              <label htmlFor="pr-mode" className="kv-field__label">{t.t('insBook.calcMode')}</label>
              <select id="pr-mode" name="mode" className="kv-select" required>
                {CALC_MODES.map((m) => <option key={m} value={m}>{t.t(`insBook.calc.${m}`)}</option>)}
              </select>
              <p className="kv-field__hint">{t.t('insBook.calcModeHint')}</p>

              <label htmlFor="pr-pct" className="kv-field__label">{t.t('insBook.pct')}</label>
              <input id="pr-pct" name="pct" className="kv-input" inputMode="decimal" placeholder="2.5" />
              <label htmlFor="pr-flat" className="kv-field__label">{t.t('insBook.flatAmount')}</label>
              <input id="pr-flat" name="flatMajor" className="kv-input" inputMode="decimal" />
              <label htmlFor="pr-param" className="kv-field__label">{t.t('insBook.parametricJson')}</label>
              <textarea id="pr-param" name="parametricJson" className="kv-textarea" rows={3} placeholder='{"rainfall_mm_below": 400}' aria-describedby="pr-param-hint" />
              <p id="pr-param-hint" className="kv-field__hint">{t.t('insBook.parametricHint')}</p>
            </fieldset>

            <div className="kv-field">
              <label htmlFor="pr-sir" className="kv-field__label">{t.t('insBook.sumInsuredRules')}</label>
              <textarea id="pr-sir" name="sumInsuredJson" className="kv-textarea" rows={2} />
              <label htmlFor="pr-sub" className="kv-field__label">{t.t('insBook.govtSubsidyBps')}</label>
              <input id="pr-sub" name="govtSubsidyBps" className="kv-input" inputMode="numeric" pattern="\d{1,5}" />
              <label htmlFor="pr-com" className="kv-field__label">{t.t('insBook.commissionBps')}</label>
              <input id="pr-com" name="ourCommissionBps" className="kv-input" inputMode="numeric" pattern="\d{1,5}" aria-describedby="pr-bps-hint" />
              <p id="pr-bps-hint" className="kv-field__hint">{t.t('insBook.bpsHint')}</p>
            </div>

            <div className="kv-form__actions"><button type="submit" className="kv-btn">{t.t('insBook.publishBtn')}</button></div>
          </form>
        </>
      )}
      <p className="kv-field__hint kv-note">{t.t('insBook.footerNote')}</p>
    </section>
  );
}
