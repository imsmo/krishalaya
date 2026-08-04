// apps/web-partner/src/app/products/[id]/page.tsx · loan-product detail (GET fintech/loan-products/:id; 404 →
// notFound). Read-only. Money via formatMoneyMinor; APR is integer bps rendered float-free; tenure window via the
// pure helper. Degrade-never-die. All copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import { formatAprBps, formatTenureMonths, type ProductRow } from '../../../features/lending/product';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('prod.detailTitle'), robots: { index: false, follow: false } };
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="kv-facts__row"><dt>{label}</dt><dd>{value}</dd></div>;
}

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  await requirePartner();
  const t = getTranslator();

  let p: ProductRow | undefined;
  let notice: string | undefined;
  try {
    p = (await partnerClient().request<ProductRow>('GET', `fintech/loan-products/${params.id}`)).data;
  } catch (e) {
    if (e instanceof SdkError && e.status === 404) notFound();
    notice = t.t('dash.unavailable');
  }

  if (!p) {
    return <section><p className="kv-backlink"><Link href="/products">{t.t('prod.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const tenure = formatTenureMonths(p.tenureMonthsMin, p.tenureMonthsMax);
  const tenureText =
    tenure.kind === 'range' ? t.t('prod.tenureRange', { min: String(tenure.min), max: String(tenure.max) })
    : tenure.kind === 'min' ? t.t('prod.tenureMin', { min: String(tenure.min) })
    : tenure.kind === 'max' ? t.t('prod.tenureMax', { max: String(tenure.max) })
    : t.t('common.dash');

  return (
    <section>
      <p className="kv-backlink"><Link href="/products">{t.t('prod.back')}</Link></p>
      <h1>{p.name}</h1>
      <p><span className={`kv-status kv-status--${p.isActive ? 'ok' : 'muted'}`}>{t.t(p.isActive ? 'common.active' : 'common.inactive')}</span></p>
      <dl className="kv-facts">
        <Field label={t.t('prod.partner')} value={<Link href={`/profile/${encodeURIComponent(p.partnerId)}`}>{p.partnerId}</Link>} />
        <Field label={t.t('prod.minAmount')} value={formatMoneyMinor(p.minAmountMinor, p.currencyCode, 'en')} />
        <Field label={t.t('prod.maxAmount')} value={formatMoneyMinor(p.maxAmountMinor, p.currencyCode, 'en')} />
        <Field label={t.t('prod.apr')} value={formatAprBps(p.interestAprBps) ?? t.t('common.dash')} />
        <Field label={t.t('prod.tenure')} value={tenureText} />
        <Field label={t.t('prod.collateral')} value={p.collateralKind ?? t.t('common.dash')} />
        <Field label={t.t('prod.repayment')} value={p.repaymentStyle} />
      </dl>
    </section>
  );
}
