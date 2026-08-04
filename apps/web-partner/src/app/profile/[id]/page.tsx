// apps/web-partner/src/app/profile/[id]/page.tsx · lender (financial partner) detail (GET fintech/partners/:id;
// 404 → notFound). Read-only registry record. Links to the products this partner offers. Degrade-never-die. All
// copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import { partnerKindKey, type PartnerRow } from '../../../features/lending/product';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('lender.detailTitle'), robots: { index: false, follow: false } };
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="kv-facts__row"><dt>{label}</dt><dd>{value}</dd></div>;
}

export default async function LenderDetailPage({ params }: { params: { id: string } }) {
  await requirePartner();
  const t = getTranslator();

  let p: PartnerRow | undefined;
  let notice: string | undefined;
  try {
    p = (await partnerClient().request<PartnerRow>('GET', `fintech/partners/${params.id}`)).data;
  } catch (e) {
    if (e instanceof SdkError && e.status === 404) notFound();
    notice = t.t('dash.unavailable');
  }

  if (!p) {
    return <section><p className="kv-backlink"><Link href="/profile">{t.t('lender.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  return (
    <section>
      <p className="kv-backlink"><Link href="/profile">{t.t('lender.back')}</Link></p>
      <h1>{p.name}</h1>
      <p><span className={`kv-status kv-status--${p.isActive ? 'ok' : 'muted'}`}>{t.t(p.isActive ? 'common.active' : 'common.inactive')}</span></p>
      <dl className="kv-facts">
        <Field label={t.t('lender.code')} value={p.code} />
        <Field label={t.t('lender.kind')} value={t.t(partnerKindKey(p.partnerKind))} />
        <Field label={t.t('lender.regulator')} value={p.regulatorRef ?? t.t('common.dash')} />
      </dl>
      <p className="kv-pager"><Link className="kv-btn" href={`/products?partnerId=${encodeURIComponent(p.id)}`}>{t.t('lender.products')}</Link></p>
    </section>
  );
}
