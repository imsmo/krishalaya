// apps/web-partner/src/app/insurer/claims/[id]/page.tsx · PC-56 PARTNER-3a · W253 (canon `insurer/claims/[id]`) — ONE claim on this insurer's
// products, claim facts only (`GET /v1/partner/insurance/claims/:id`, audited). "Decide" is DECOR with the founder's sentence (Q3).
// `?act=confirm|success|failure` is the W2857–W2859 chain (PARITY-DECOR: Retry is a re-read), linking back to this claim. Another insurer's
// claim or an absent id → "not found". A lender is sent to `/dashboard`.
import type { Metadata } from 'next';
import { requirePartner } from '../../../../lib/session';
import { partnerClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { insurerFailure, insurerGate, isNotFound } from '../../../../lib/insurer';
import type { PartnerInsuranceClaim } from '@krishalaya/sdk-js';
import { InsurerClaimView } from '../../../../components/partner3/InsurerClaimView';
import { InsurerClaimsChain } from '../../../../components/partner3/InsurerClaimsChain';
import { chain3State } from '../../../../features/partner3/refusals';
import type { InsurerFailure } from '../../../../features/partner3/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner3.claim.title'), robots: { index: false, follow: false } };
}

export default async function InsurerClaimPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await insurerGate();
  const self = `/insurer/claims/${encodeURIComponent(params.id)}`;
  const act = chain3State('claim_act', searchParams);
  if (act) return <InsurerClaimsChain t={t} chain="claim_act" state={act} back={self} />;
  let c: (PartnerInsuranceClaim & { computedAt: string }) | null = null;
  let failure: InsurerFailure | null = null; let notFound = false;
  try { c = await partnerClient().partner.insurance.claims.get(params.id); } catch (e) {
    if (isNotFound(e, 'PARTNER_CLAIM_NOT_FOUND')) notFound = true; else failure = await insurerFailure(e);
  }
  return <InsurerClaimView t={t} lang={lang} c={c} failure={failure} notFound={notFound} />;
}
