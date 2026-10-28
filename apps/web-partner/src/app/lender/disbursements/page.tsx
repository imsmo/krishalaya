// apps/web-partner/src/app/lender/disbursements/page.tsx · PC-56 PARTNER-4b · W210 (canon `lender/disbursements`) — THE COOLING-OFF PIPELINE
// AS COUNTS: ONE read (`GET /v1/partner/loans/pipeline`, the consent-gated application axis), ONE audit row, counts only.
// `?act=confirm|success|failure` is the W2863–W2865 chain (DECOR — the canon's primary money act is refused by name:
// a partner never disburses, because the money is the cooperative's own). The chain is checked BEFORE the read.
// No table of borrowers and no destination column: both are the wall (founder 4b-6). An insurer is sent to its own dashboard.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { lenderFailure, lenderGate } from '../../../lib/lender';
import type { PartnerBookPipeline } from '@krishalaya/sdk-js';
import { LenderPayoutsView } from '../../../components/partner4/LenderPayoutsView';
import { LenderChain } from '../../../components/partner4/LenderChain';
import { chain4State } from '../../../features/partner4/refusals';
import { pipelineState, type LenderFailure } from '../../../features/partner4/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner4.payouts.title'), robots: { index: false, follow: false } };
}

export default async function LenderPayoutsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await lenderGate();
  const act = chain4State('disbursements_act', searchParams);
  if (act) return <LenderChain t={t} chain="disbursements_act" state={act} />;
  let pipeline: PartnerBookPipeline | null = null; let failure: LenderFailure | null = null;
  try { pipeline = await partnerClient().partner.loans.pipeline(); } catch (e) { failure = await lenderFailure(e); }
  return <LenderPayoutsView t={t} lang={lang} state={pipelineState(pipeline, failure)} pipeline={pipeline} />;
}
