// apps/web-partner/src/app/insurer/dashboard/page.tsx · PC-56 PARTNER-2a · W245 (canon `insurer/dashboard`) — the insurer's home over the
// server's figures (`GET /v1/partner/insurance/dashboard`: computed on the kv_partner axis from this insurer's own products, `computedAt`,
// every read audited). The page reads and picks the state; components/partner2/InsurerDashboardView.tsx renders (the render test renders the
// same component). `?retry=confirm|success|failure` is the W2873–W2875 chain (PARITY-DECOR: Retry is a re-read). A lender who lands here is
// sent to `/dashboard` (lib/insurer.ts).
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { insurerFailure, insurerGate } from '../../../lib/insurer';
import type { PartnerInsuranceDashboard } from '@krishalaya/sdk-js';
import { InsurerDashboardView } from '../../../components/partner2/InsurerDashboardView';
import { InsurerChain } from '../../../components/partner2/InsurerChain';
import { chain2State } from '../../../features/partner2/refusals';
import { insurerDashboardState, type InsurerFailure } from '../../../features/partner2/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner2.dash.title'), robots: { index: false, follow: false } };
}

export default async function InsurerDashboardPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  const org = await insurerGate();
  const chain = chain2State('ins_retry', searchParams);
  if (chain) return <InsurerChain t={t} chain="ins_retry" state={chain} />;
  let d: PartnerInsuranceDashboard | null = null;
  let failure: InsurerFailure | null = null;
  try { d = await partnerClient().partner.insurance.dashboard(); } catch (e) { failure = await insurerFailure(e); }
  return <InsurerDashboardView t={t} lang={lang} state={insurerDashboardState(d, failure)} d={d} orgName={org?.name ?? null} regulatorRefMasked={org?.regulatorRefMasked ?? null} />;
}
