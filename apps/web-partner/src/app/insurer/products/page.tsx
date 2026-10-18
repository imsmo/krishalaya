// apps/web-partner/src/app/insurer/products/page.tsx · PC-56 PARTNER-2a · W246 (canon `insurer/products`) — this insurer's OWN products
// (`GET /v1/partner/insurance/products`, every read audited). `?form=error|review|success|failure` is the W2869–W2872 chain (DECOR: products
// are authored by the platform — founder Q7); `?retry=` the W2873–W2875 re-read chain. A lender is sent to `/dashboard`.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { insurerFailure, insurerGate } from '../../../lib/insurer';
import type { PartnerInsuranceProduct } from '@krishalaya/sdk-js';
import { InsurerProductsView } from '../../../components/partner2/InsurerProductsView';
import { InsurerChain } from '../../../components/partner2/InsurerChain';
import { chain2State } from '../../../features/partner2/refusals';
import { listState, type InsurerFailure } from '../../../features/partner2/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner2.products.title'), robots: { index: false, follow: false } };
}

export default async function InsurerProductsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await insurerGate();
  const form = chain2State('ins_form', searchParams);
  if (form) return <InsurerChain t={t} chain="ins_form" state={form} />;
  const retry = chain2State('ins_retry', searchParams);
  if (retry) return <InsurerChain t={t} chain="ins_retry" state={retry} back="/insurer/products" />;
  let items: PartnerInsuranceProduct[] | null = null; let computedAt: string | null = null;
  let failure: InsurerFailure | null = null;
  try { const r = await partnerClient().partner.insurance.products(); items = r.items; computedAt = r.computedAt; } catch (e) { failure = await insurerFailure(e); }
  return <InsurerProductsView t={t} lang={lang} state={listState(items, failure)} items={items ?? []} computedAt={computedAt} />;
}
