// apps/web-partner/src/app/insurer/surveys/[id]/report/page.tsx · PC-56 PARTNER-3b · W259 (canon `insurer/surveys/[id]/report`) — AN HONEST PAGE.
// The `[id]` is a CLAIM id: no survey entity exists on the platform (the report is a column of the claim — DELTA `w259_claim_id`). ONE read,
// PARTNER-3a's audited detail (`GET /v1/partner/insurance/claims/:id` — ONE audit row): the claim's facts plus the report block (the recorded
// damage percentage, or no survey recorded yet, or a recorded report with no damage percentage) and the report statement (founder Q4 + Q5).
// `?act=confirm` is the W3014–W3016 chain (DECOR). Another insurer's claim or an absent id → "not found". A lender is sent to `/dashboard`.
import type { Metadata } from 'next';
import { requirePartner } from '../../../../../lib/session';
import { partnerClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { insurerFailure, insurerGate, isNotFound } from '../../../../../lib/insurer';
import type { PartnerInsuranceClaim } from '@krishalaya/sdk-js';
import { InsurerSurveyReportView } from '../../../../../components/partner3/InsurerSurveyReportView';
import { InsurerClaimsChain } from '../../../../../components/partner3/InsurerClaimsChain';
import { chain3State } from '../../../../../features/partner3/refusals';
import type { InsurerFailure } from '../../../../../features/partner3/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner3.report.title'), robots: { index: false, follow: false } };
}

export default async function InsurerSurveyReportPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await insurerGate();
  const self = `/insurer/surveys/${encodeURIComponent(params.id)}/report`;
  const act = chain3State('survey_report_act', searchParams);
  if (act) return <InsurerClaimsChain t={t} chain="survey_report_act" state={act} back={self} />;
  let c: (PartnerInsuranceClaim & { computedAt: string }) | null = null;
  let failure: InsurerFailure | null = null; let notFound = false;
  try { c = await partnerClient().partner.insurance.claims.get(params.id); } catch (e) {
    if (isNotFound(e, 'PARTNER_CLAIM_NOT_FOUND')) notFound = true; else failure = await insurerFailure(e);
  }
  return <InsurerSurveyReportView t={t} lang={lang} c={c} failure={failure} notFound={notFound} />;
}
