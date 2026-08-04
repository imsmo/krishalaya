// apps/web-tenant/src/app/requirements/page.tsx · the requirements board (PC-28c, reverse marketplace).
// Two boxes: OPEN (browse others' needs and quote) and MINE (your posts + responses). Post form under MINE.
// requirement.post / requirement.quote are the authoritative server gates; keyset paging preserves the box.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { postRequirementAction } from './actions';
import type { Requirement } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('reqs.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['title', 'quantity', 'unit', 'budget', 'needby', 'pincode', 'post']);

export default async function RequirementsPage({ searchParams }: { searchParams: { box?: string; cursor?: string; error?: string } }) {
  await requireSession('/requirements');
  const t = getTranslator();
  const lang = getLang();
  const box = searchParams.box === 'mine' ? 'mine' : 'open';

  let items: Requirement[] = []; let nextCursor: string | null = null; let failed = false;
  try {
    const p = await tenantClient().requirements.list({ box, cursor: searchParams.cursor, limit: 50 });
    items = p.items; nextCursor = p.nextCursor;
  } catch { failed = true; }

  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const budget = (r: Requirement) => {
    if (!r.budgetMinMinor && !r.budgetMaxMinor) return t.t('common.dash');
    const cur = r.currencyCode ?? 'INR';
    const lo = r.budgetMinMinor ? formatMoneyMinor(r.budgetMinMinor, cur, lang) : '…';
    const hi = r.budgetMaxMinor ? formatMoneyMinor(r.budgetMaxMinor, cur, lang) : '…';
    return `${lo} – ${hi}`;
  };

  return (
    <section>
      <h1>{t.t('reqs.title')}</h1>
      <p className="kv-field__hint">{t.t('reqs.hint')}</p>
      {errKey && <p className="kv-error" role="alert">{t.t(`reqs.error.${errKey}`)}</p>}

      <div className="kv-actions" role="tablist" aria-label={t.t('reqs.boxes')}>
        <a href="/requirements?box=open" className={box === 'open' ? 'kv-btn' : 'kv-btn kv-btn--muted'} role="tab" aria-selected={box === 'open'}>{t.t('reqs.boxOpen')}</a>
        <a href="/requirements?box=mine" className={box === 'mine' ? 'kv-btn' : 'kv-btn kv-btn--muted'} role="tab" aria-selected={box === 'mine'}>{t.t('reqs.boxMine')}</a>
      </div>

      {failed ? <p className="kv-error" role="alert">{t.t('reqs.loadError')}</p> : (
        <DataTable
          rows={items}
          empty={t.t(box === 'mine' ? 'reqs.emptyMine' : 'reqs.emptyOpen')}
          columns={[
            { header: t.t('reqs.colTitle'), cell: (r) => <Link href={`/requirements/${r.id}`} className="kv-link">{r.isUrgent ? '⚡ ' : ''}{r.title}</Link> },
            { header: t.t('reqs.colQty'), cell: (r) => `${r.quantity} ${r.unitCode}` },
            { header: t.t('reqs.colBudget'), cell: budget },
            { header: t.t('reqs.colNeedBy'), cell: (r) => (r.needBy ? formatDate(r.needBy, lang) : t.t('common.dash')) },
            { header: t.t('reqs.colStatus'), cell: (r) => <span className="kv-badge">{t.t(`reqs.status.${r.status}`) || r.status}</span> },
            { header: t.t('reqs.colResponses'), cell: (r) => String(r.responsesCount ?? 0) },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={`/requirements?box=${box}&cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}

      {box === 'mine' && (
        <details className="kv-card">
          <summary className="kv-card__title">{t.t('reqs.post')}</summary>
          <form action={postRequirementAction} className="kv-form">
            <label htmlFor="rq-title" className="kv-field__label">{t.t('reqs.colTitle')}</label>
            <input id="rq-title" name="title" className="kv-input" required minLength={3} maxLength={250} placeholder={t.t('reqs.titlePlaceholder')} />
            <label htmlFor="rq-qty" className="kv-field__label">{t.t('reqs.colQty')}</label>
            <input id="rq-qty" name="quantity" className="kv-input" required inputMode="decimal" pattern="\d{1,11}(\.\d{1,3})?" />
            <label htmlFor="rq-unit" className="kv-field__label">{t.t('reqs.unit')}</label>
            <input id="rq-unit" name="unitCode" className="kv-input" required maxLength={20} placeholder="kg" />
            <label htmlFor="rq-bmin" className="kv-field__label">{t.t('reqs.budgetMin')}</label>
            <input id="rq-bmin" name="budgetMin" className="kv-input" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" />
            <label htmlFor="rq-bmax" className="kv-field__label">{t.t('reqs.budgetMax')}</label>
            <input id="rq-bmax" name="budgetMax" className="kv-input" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" />
            <label htmlFor="rq-needby" className="kv-field__label">{t.t('reqs.colNeedBy')}</label>
            <input id="rq-needby" name="needBy" type="date" className="kv-input" />
            <label htmlFor="rq-pin" className="kv-field__label">{t.t('reqs.pincode')}</label>
            <input id="rq-pin" name="pincode" className="kv-input" inputMode="numeric" pattern="\d{6}" />
            <label className="kv-field__label" htmlFor="rq-urgent">
              <input id="rq-urgent" type="checkbox" name="isUrgent" value="1" /> {t.t('reqs.urgent')}
            </label>
            <button type="submit" className="kv-btn">{t.t('reqs.postBtn')}</button>
          </form>
        </details>
      )}
    </section>
  );
}
