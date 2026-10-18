// apps/web-partner/src/app/dashboard/page.tsx · PC-56 PARTNER-1a · founder D1 — the partner home REBUILT over the server's figures
// (`GET /v1/partner/dashboard`: computed on the kv_partner axis from the partner's own consented applications and loan book, with
// `computedAt`). The page fetches and picks the state; components/partner1/DashboardView.tsx renders (the render test renders the same
// component). `?retry=confirm|success|failure` is the W2926–W2928 chain (PARITY-DECOR: Retry is a re-read). A 404 while `partner_console`
// is OFF prints the switched-off sentence, never an outage (F-7). The persona gate (PARTNER-0, F-11) runs first.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { partnerConsoleSwitch } from '../../lib/console-flag';
import { SdkError, type PartnerDashboard as Figures } from '@krishalaya/sdk-js';
import { DashboardView } from '../../components/partner1/DashboardView';
import { ChainNotice } from '../../components/partner1/ChainNotice';
import { chainState } from '../../features/partner1/refusals';
import { dashboardState, failureOf } from '../../features/partner1/dashboard';
import { wrongConsole } from '../../features/partner2/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner1.dash.title'), robots: { index: false, follow: false } };
}

export default async function PartnerDashboard({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  // PC-56 PARTNER-2a (founder Q9): this is the LENDER's dashboard — an insurer organisation lands on its own (`/insurer/dashboard`)
  const me = await partnerClient().partner.me().catch(() => null);
  if (wrongConsole(me?.organisation?.kind, 'lender')) redirect('/insurer/dashboard');
  const chain = chainState('dashboard_retry', searchParams);
  if (chain) return <ChainNotice t={t} chain="dashboard_retry" state={chain} />;
  let d: Figures | null = null;
  let failure: 'off' | 'error' | null = null;
  let orgName: string | null = null;
  try {
    const c = partnerClient();
    d = await c.partner.dashboard();
    orgName = me?.organisation?.name ?? null;
  } catch (e) {
    failure = failureOf(e instanceof SdkError ? e.status : undefined, e instanceof SdkError && e.status === 404 ? await partnerConsoleSwitch() : 'unknown');
  }
  return <DashboardView t={t} lang={lang} state={dashboardState(d, failure)} d={d} orgName={orgName} />;
}
