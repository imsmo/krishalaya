// apps/web-partner/src/app/lender/products/[id]/page.tsx · PC-56 PARTNER-2c · W209 (canon `lender/products/[id]`, "Product Edit") — ONE of this
// lender's loan products, READ-ONLY (`GET /v1/partner/loan-products/:id`, audited). `?form=` is the W2980–W2983 chain on this page ("Choose
// kind" / "Save" — DECOR, founder Q7), linking back HERE (never the canon's "every step → W208", F-18); `?act=` the W2984–W2986 re-read chain.
// Another lender's product or an absent id → "not found". The old not-yet `/products/:id` answers a real 307 here (next.config.js).
import type { Metadata } from 'next';
import { requirePartner } from '../../../../lib/session';
import { partnerClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { isLoanProductNotFound, lenderFailure, lenderGate } from '../../../../lib/lender';
import { partnersMailbox } from '../../../../lib/partners-mailbox';
import type { PartnerLoanProduct } from '@krishalaya/sdk-js';
import { LenderProductView } from '../../../../components/partner2/LenderProductView';
import { InsurerChain } from '../../../../components/partner2/InsurerChain';
import { chain2State } from '../../../../features/partner2/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner2.loanProducts.product.title'), robots: { index: false, follow: false } };
}

export default async function LenderProductPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await lenderGate();
  const self = `/lender/products/${encodeURIComponent(params.id)}`;
  const form = chain2State('lender_form', searchParams);
  if (form) return <InsurerChain t={t} chain="lender_form" state={form} back={self} mailbox={await partnersMailbox()} />;
  const act = chain2State('lender_act', searchParams);
  if (act) return <InsurerChain t={t} chain="lender_act" state={act} back={self} />;
  let p: (PartnerLoanProduct & { computedAt: string; windowDays: number }) | null = null;
  let failure: 'off' | 'error' | null = null; let notFound = false;
  try { p = await partnerClient().partner.loanProducts.get(params.id); } catch (e) {
    if (isLoanProductNotFound(e)) notFound = true; else failure = await lenderFailure(e);
  }
  return <LenderProductView t={t} lang={lang} p={p} failure={failure} notFound={notFound} mailbox={await partnersMailbox()} />;
}
