// apps/web-partner/src/app/insurer/claims/evidence/page.tsx · PC-56 PARTNER-3b · W255 (canon `insurer/claims/evidence`) — AN HONEST PAGE: claim
// evidence stays with the farmer and the organisation that serves them; insurers do not see, review, verify or request it on the platform
// (founder Q4 + Q5). Its ONE read is PARTNER-3a's audited counts (`GET /v1/partner/insurance/claims/counts` — ONE audit row): COUNTS OF CLAIMS
// by survey status (founder 3b-1), never a count of media items and never a person. `?act=confirm` is the W2866–W2868 chain (DECOR — the whole
// chain is its confirm state). A lender or an asset manager is sent to `/dashboard`. Reached from the claims sub-navigation (no nav item).
import type { Metadata } from 'next';
import { requirePartner } from '../../../../lib/session';
import { partnerClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { insurerFailure, insurerGate } from '../../../../lib/insurer';
import type { PartnerInsuranceClaimCounts } from '@krishalaya/sdk-js';
import { InsurerEvidenceView } from '../../../../components/partner3/InsurerEvidenceView';
import { InsurerClaimsChain } from '../../../../components/partner3/InsurerClaimsChain';
import { chain3State } from '../../../../features/partner3/refusals';
import { stageCountsState, type InsurerFailure } from '../../../../features/partner3/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner3.evidence.title'), robots: { index: false, follow: false } };
}

export default async function InsurerEvidencePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await insurerGate();
  const act = chain3State('evidence_act', searchParams);
  if (act) return <InsurerClaimsChain t={t} chain="evidence_act" state={act} />;
  let counts: PartnerInsuranceClaimCounts | null = null; let failure: InsurerFailure | null = null;
  try { counts = await partnerClient().partner.insurance.claims.counts(); } catch (e) { failure = await insurerFailure(e); }
  return <InsurerEvidenceView t={t} lang={lang} state={stageCountsState(counts, failure)} counts={counts} />;
}
