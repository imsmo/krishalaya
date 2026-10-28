// apps/web-partner/src/app/insurer/claims/evidence/[id]/page.tsx · PC-56 PARTNER-3b · W256 (canon `insurer/claims/evidence/[id]`) — AN HONEST
// PAGE: the claim's FACTS (`GET /v1/partner/insurance/claims/:id`, PARTNER-3a's audited detail read — ONE audit row, the shared `ClaimFacts`
// wall) in place of the canon's media board, plus the evidence statement (founder Q4 + Q5). `?act=confirm` is the W2866–W2868 chain (DECOR).
// Another insurer's claim or an absent id → "not found" (PARTNER-3a's `PARTNER_CLAIM_NOT_FOUND`), never a 403. A lender is sent to `/dashboard`.
import type { Metadata } from 'next';
import { requirePartner } from '../../../../../lib/session';
import { partnerClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { insurerFailure, insurerGate, isNotFound } from '../../../../../lib/insurer';
import type { PartnerInsuranceClaim } from '@krishalaya/sdk-js';
import { InsurerEvidenceBoardView } from '../../../../../components/partner3/InsurerEvidenceBoardView';
import { InsurerClaimsChain } from '../../../../../components/partner3/InsurerClaimsChain';
import { chain3State } from '../../../../../features/partner3/refusals';
import type { InsurerFailure } from '../../../../../features/partner3/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner3.board.title'), robots: { index: false, follow: false } };
}

export default async function InsurerEvidenceBoardPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await insurerGate();
  const self = `/insurer/claims/evidence/${encodeURIComponent(params.id)}`;
  const act = chain3State('evidence_board_act', searchParams);
  if (act) return <InsurerClaimsChain t={t} chain="evidence_board_act" state={act} back={self} />;
  let c: (PartnerInsuranceClaim & { computedAt: string }) | null = null;
  let failure: InsurerFailure | null = null; let notFound = false;
  try { c = await partnerClient().partner.insurance.claims.get(params.id); } catch (e) {
    if (isNotFound(e, 'PARTNER_CLAIM_NOT_FOUND')) notFound = true; else failure = await insurerFailure(e);
  }
  return <InsurerEvidenceBoardView t={t} lang={lang} c={c} failure={failure} notFound={notFound} />;
}
