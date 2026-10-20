// apps/web-partner/src/app/insurer/claims/insights/page.tsx · PC-56 PARTNER-3a · W264 (canon `insurer/claims/insights`) — COUNTS of the claims
// filed on this insurer's products in the current FY (`GET /v1/partner/insurance/claims/counts`, the window answered by the database, audited):
// by status, by event type code, decided — never a money ratio. `?export=queued|ready` is the W2855–W2856 chain (DECOR: exports are not
// available — write to the partners mailbox); `?act=` the W2857–W2859 re-read (PARITY-DECOR). A lender is sent to `/dashboard`.
import type { Metadata } from 'next';
import { requirePartner } from '../../../../lib/session';
import { partnerClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { insurerFailure, insurerGate } from '../../../../lib/insurer';
import { partnersMailbox } from '../../../../lib/partners-mailbox';
import type { PartnerInsuranceClaimCounts } from '@krishalaya/sdk-js';
import { InsurerClaimsInsightsView } from '../../../../components/partner3/InsurerClaimsInsightsView';
import { InsurerClaimsChain } from '../../../../components/partner3/InsurerClaimsChain';
import { chain3State } from '../../../../features/partner3/refusals';
import { countsState, type InsurerFailure } from '../../../../features/partner3/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner3.insights.title'), robots: { index: false, follow: false } };
}

export default async function InsurerClaimsInsightsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await insurerGate();
  const exp = chain3State('insights_export', searchParams);
  if (exp) return <InsurerClaimsChain t={t} chain="insights_export" state={exp} mailbox={await partnersMailbox()} />;
  const act = chain3State('insights_act', searchParams);
  if (act) return <InsurerClaimsChain t={t} chain="insights_act" state={act} />;
  let counts: PartnerInsuranceClaimCounts | null = null; let failure: InsurerFailure | null = null;
  try { counts = await partnerClient().partner.insurance.claims.counts(); } catch (e) { failure = await insurerFailure(e); }
  return <InsurerClaimsInsightsView t={t} lang={lang} state={countsState(counts, failure)} counts={counts} />;
}
