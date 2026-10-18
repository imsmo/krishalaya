// apps/web-partner/src/app/insurer/products/[id]/page.tsx · PC-56 PARTNER-2a · W247 (canon `insurer/products/[id]`, "Product Edit") — ONE of this
// insurer's products, READ-ONLY (`GET /v1/partner/insurance/products/:id`, audited). `?form=` is the W2869–W2872 chain on this page ("Choose
// kind" / "Save" — DECOR, founder Q7); `?retry=` the re-read chain. Another insurer's product or an absent id → "not found".
import type { Metadata } from 'next';
import { requirePartner } from '../../../../lib/session';
import { partnerClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { insurerFailure, insurerGate, isNotFound } from '../../../../lib/insurer';
import type { PartnerInsuranceProduct } from '@krishalaya/sdk-js';
import { InsurerProductView } from '../../../../components/partner2/InsurerProductView';
import { InsurerChain } from '../../../../components/partner2/InsurerChain';
import { chain2State } from '../../../../features/partner2/refusals';
import type { InsurerFailure } from '../../../../features/partner2/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner2.product.title'), robots: { index: false, follow: false } };
}

export default async function InsurerProductPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await insurerGate();
  const self = `/insurer/products/${encodeURIComponent(params.id)}`;
  const form = chain2State('ins_form', searchParams);
  if (form) return <InsurerChain t={t} chain="ins_form" state={form} back={self} />;
  const retry = chain2State('ins_retry', searchParams);
  if (retry) return <InsurerChain t={t} chain="ins_retry" state={retry} back={self} />;
  let p: (PartnerInsuranceProduct & { computedAt: string }) | null = null;
  let failure: InsurerFailure | null = null; let notFound = false;
  try { p = await partnerClient().partner.insurance.product(params.id); } catch (e) {
    if (isNotFound(e, 'PARTNER_PRODUCT_NOT_FOUND')) notFound = true; else failure = await insurerFailure(e);
  }
  return <InsurerProductView t={t} lang={lang} p={p} failure={failure} notFound={notFound} />;
}
