// apps/web-partner/src/app/insurer/surveys/page.tsx · PC-56 PARTNER-3b · W258 (canon `insurer/surveys`) — A READ OF CLAIM FACTS BY SURVEY STATUS
// (founder Q4 + Q5 + 3b-1). TWO reads of PARTNER-3a's own audited endpoints, so TWO audit rows per page view: `GET /v1/partner/insurance/claims`
// narrowed to one of the four survey stages (`?status=`, a STRICT whitelist — anything else is the default `survey_scheduled`) with 3a's keyset
// cursor, and `GET …/claims/counts` for the counts of CLAIMS in the tab labels. Nothing else enters the URL. `?act=confirm` is the W3014–W3016
// chain (DECOR — the whole chain is its confirm state). A lender is sent to `/dashboard`. No nav item: the claims sub-navigation.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { insurerFailure, insurerGate } from '../../../lib/insurer';
import type { PartnerInsuranceClaim, PartnerInsuranceClaimCounts } from '@krishalaya/sdk-js';
import { InsurerSurveysView } from '../../../components/partner3/InsurerSurveysView';
import { InsurerClaimsChain } from '../../../components/partner3/InsurerClaimsChain';
import { chain3State } from '../../../features/partner3/refusals';
import { claimsQuery, listState, surveyStage, type InsurerFailure } from '../../../features/partner3/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner3.surveys.title'), robots: { index: false, follow: false } };
}

export default async function InsurerSurveysPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await insurerGate();
  const act = chain3State('surveys_act', searchParams);
  if (act) return <InsurerClaimsChain t={t} chain="surveys_act" state={act} />;
  const stage = surveyStage(searchParams);
  const { cursor } = claimsQuery(searchParams);
  let items: PartnerInsuranceClaim[] | null = null; let nextCursor: string | null = null; let computedAt: string | null = null;
  let counts: PartnerInsuranceClaimCounts | null = null; let failure: InsurerFailure | null = null;
  try {
    const page = await partnerClient().partner.insurance.claims.list({ status: stage, cursor, limit: 25 });
    items = page.items; nextCursor = page.nextCursor; computedAt = page.computedAt;
    counts = await partnerClient().partner.insurance.claims.counts();
  } catch (e) { failure = await insurerFailure(e); }
  return <InsurerSurveysView t={t} lang={lang} state={listState(items, failure)} items={items ?? []} counts={counts} stage={stage} nextCursor={nextCursor} computedAt={computedAt} />;
}
