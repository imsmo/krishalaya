// apps/web-partner/src/app/insurer/settlements/page.tsx · PC-56 PARTNER-6a · W260 (canon `insurer/settlements`) — CLAIM SETTLEMENTS, COUNTS ONLY
// (founder 6a-1): the ONE read is PARTNER-3a's audited `GET /v1/partner/insurance/claims/counts` (0230's `partner_insurance_claim_counts`, the
// current financial year in India time, answered by the database — ONE partner-realm audit row, counts only). The page prints how many of the
// claims on this insurer's products FILED in that window are approved and partially approved, and paid (0) beside "No claim is paid on this
// platform." — never a rupee figure. `?act=confirm|success|failure` is the W2901–W2903 settlement chain (DECOR), checked FIRST, before the read.
// A lender or any other kind is sent to its own home by `insurerGate()` (the old `/settlements` answers a 307 here — next.config.js).
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { insurerFailure, insurerGate } from '../../../lib/insurer';
import type { PartnerInsuranceClaimCounts } from '@krishalaya/sdk-js';
import { InsurerSettlementsView } from '../../../components/partner6/InsurerSettlementsView';
import { InsurerChain6 } from '../../../components/partner6/InsurerChain6';
import { chain6State } from '../../../features/partner6/refusals';
import { settlementsState } from '../../../features/partner6/figures';
import type { InsurerFailure } from '../../../features/partner3/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner6.settlements.title'), robots: { index: false, follow: false } };
}

export default async function InsurerSettlementsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await insurerGate();
  const act = chain6State('settlement_act', searchParams);
  if (act) return <InsurerChain6 t={t} chain="settlement_act" state={act} />;
  let counts: PartnerInsuranceClaimCounts | null = null; let failure: InsurerFailure | null = null;
  try { counts = await partnerClient().partner.insurance.claims.counts(); } catch (e) { failure = await insurerFailure(e); }
  return <InsurerSettlementsView t={t} lang={lang} state={settlementsState(counts, failure)} counts={counts} />;
}
