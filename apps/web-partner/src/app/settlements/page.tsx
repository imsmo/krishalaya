// apps/web-partner/src/app/settlements/page.tsx · the partner's OWN payment/settlement ledger (PC-2C).
// payments.list is CALLER-scoped — these are the partner's transactions (disbursement legs, fees), read-only.
// Money via formatMoneyMinor (bigint minor strings, Law 2). Batch views need a server read-model (PC-54).
import type { Metadata } from 'next';
import { requirePartner } from '../../lib/partner-auth';
import { partnerClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import type { PaymentSummary } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('settle.title'), robots: { index: false, follow: false } };
}

export default async function SettlementsPage({ searchParams }: { searchParams: { cursor?: string } }) {
  await requirePartner();
  const t = getTranslator();
  const lang = getLang();

  let items: PaymentSummary[] = []; let nextCursor: string | null = null; let failed = false;
  try {
    const p = await partnerClient().payments.list(searchParams.cursor, 50);
    items = p.items; nextCursor = p.nextCursor;
  } catch { failed = true; }

  return (
    <section>
      <h1>{t.t('settle.title')}</h1>
      <p className="kv-field__hint">{t.t('settle.hint')}</p>
      {failed ? <p className="kv-error" role="alert">{t.t('settle.loadError')}</p> : (
        <DataTable
          rows={items}
          empty={t.t('settle.empty')}
          columns={[
            { header: t.t('settle.colAmount'), cell: (x) => <strong>{formatMoneyMinor(x.amountMinor, x.currencyCode, lang)}</strong> },
            { header: t.t('settle.colPurpose'), cell: (x) => x.purpose ?? t.t('common.dash') },
            { header: t.t('settle.colStatus'), cell: (x) => <span className="kv-badge">{x.status}</span> },
            { header: t.t('settle.colWhen'), cell: (x) => (x.createdAt ? formatDate(x.createdAt, lang) : t.t('common.dash')) },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={`/settlements?cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}
    </section>
  );
}
