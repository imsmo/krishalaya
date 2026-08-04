// apps/web-tenant/src/app/requirements/[id]/page.tsx · one requirement's detail (PC-28c): facts + the quotes
// received + a QUOTE form (open requirements; requirement.quote gated server-side) + CLOSE for the owner/
// moderator (server-asserted — we show the button on open requirements and let a 403/409 degrade honestly).
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { quoteRequirementAction, closeRequirementAction } from '../actions';
import type { Requirement, RequirementResponse } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('reqs.detailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['posted', 'closed', 'quoted']);
const ERR = new Set(['close', 'illegal', 'quote', 'q_price', 'q_quantity', 'q_message', 'q_dup']);

export default async function RequirementDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requireSession(`/requirements/${params.id}`);
  const t = getTranslator();
  const lang = getLang();
  const client = tenantClient();

  let req: Requirement;
  try { req = await client.requirements.get(params.id); }
  catch { notFound(); }

  let responses: RequirementResponse[] = []; let responsesFailed = false;
  try { responses = (await client.requirements.responses(params.id, { limit: 50 })).items; }
  catch { responsesFailed = true; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const cur = req.currencyCode ?? 'INR';
  const isOpen = req.status === 'open';

  return (
    <section>
      <div className="kv-page-head">
        <h1>{req.isUrgent ? '⚡ ' : ''}{req.title}</h1>
        <Link href="/requirements" className="kv-btn--link">← {t.t('reqs.title')}</Link>
      </div>
      {okKey && <p className="kv-success" role="status">{t.t(`reqs.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`reqs.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('reqs.colQty')}</dt><dd>{req.quantity} {req.unitCode}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('reqs.colBudget')}</dt><dd>{req.budgetMinMinor || req.budgetMaxMinor ? `${req.budgetMinMinor ? formatMoneyMinor(req.budgetMinMinor, cur, lang) : '…'} – ${req.budgetMaxMinor ? formatMoneyMinor(req.budgetMaxMinor, cur, lang) : '…'}` : t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('reqs.colNeedBy')}</dt><dd>{req.needBy ? formatDate(req.needBy, lang) : t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('reqs.pincode')}</dt><dd>{req.deliveryPincode ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('reqs.colStatus')}</dt><dd><span className="kv-badge">{t.t(`reqs.status.${req.status}`) || req.status}</span></dd></div>
      </dl>

      {isOpen && (
        <form action={closeRequirementAction} className="kv-inline-form">
          <input type="hidden" name="id" value={req.id} />
          <button type="submit" className="kv-btn kv-btn--muted">{t.t('reqs.closeBtn')}</button>
          <p className="kv-field__hint">{t.t('reqs.closeHint')}</p>
        </form>
      )}

      <h2>{t.t('reqs.quotes')}</h2>
      {responsesFailed ? <p className="kv-error" role="alert">{t.t('reqs.loadError')}</p> : responses.length === 0 ? (
        <p className="kv-muted">{t.t('reqs.quotesEmpty')}</p>
      ) : (
        <table className="kv-table">
          <thead><tr><th>{t.t('reqs.quotePrice')}</th><th>{t.t('reqs.colQty')}</th><th>{t.t('reqs.quoteMsg')}</th><th>{t.t('reqs.quoteWhen')}</th></tr></thead>
          <tbody>
            {responses.map((q) => (
              <tr key={q.id}>
                <td><strong>{formatMoneyMinor(q.quotedPriceMinor, cur, lang)}</strong> / {req.unitCode}</td>
                <td>{q.quantity} {req.unitCode}</td>
                <td>{q.message ?? t.t('common.dash')}</td>
                <td>{q.createdAt ? formatDate(q.createdAt, lang) : t.t('common.dash')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {isOpen && (
        <details className="kv-card">
          <summary className="kv-card__title">{t.t('reqs.quoteCta')}</summary>
          <form action={quoteRequirementAction} className="kv-form">
            <input type="hidden" name="id" value={req.id} />
            <label htmlFor="qt-price" className="kv-field__label">{t.t('reqs.quotePriceUnit', { unit: req.unitCode })}</label>
            <input id="qt-price" name="priceMajor" className="kv-input" required inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" />
            <label htmlFor="qt-qty" className="kv-field__label">{t.t('reqs.quoteQty')}</label>
            <input id="qt-qty" name="quantity" className="kv-input" required inputMode="decimal" pattern="\d{1,11}(\.\d{1,3})?" defaultValue={req.quantity} />
            <label htmlFor="qt-msg" className="kv-field__label">{t.t('reqs.quoteMsg')}</label>
            <textarea id="qt-msg" name="message" className="kv-textarea" rows={2} maxLength={1000} />
            <button type="submit" className="kv-btn">{t.t('reqs.quoteBtn')}</button>
          </form>
        </details>
      )}
    </section>
  );
}
