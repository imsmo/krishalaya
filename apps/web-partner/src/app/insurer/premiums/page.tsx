// apps/web-partner/src/app/insurer/premiums/page.tsx · PC-56 PARTNER-2b · W251 (canon `insurer/premiums`) — AN HONEST PAGE (founder Q1): the
// approved statement and two COUNTS from the 2a dashboard read (`GET /v1/partner/insurance/dashboard` — no new money read; one audit row),
// reduced to integers by `premiumsCounts` before the view sees them. No rupee figure. `?export=queued|ready` is the W2896–W2897 chain (DECOR:
// a premiums file would publish money the insurer has not received — "exports are not available … write to the partners mailbox"), `?act=`
// the W2898–W2900 re-read chain (PARITY-DECOR). A lender is sent to `/dashboard`.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { insurerFailure, insurerGate } from '../../../lib/insurer';
import { partnersMailbox } from '../../../lib/partners-mailbox';
import { InsurerPremiumsView } from '../../../components/partner2/InsurerPremiumsView';
import { InsurerChain } from '../../../components/partner2/InsurerChain';
import { chain2State } from '../../../features/partner2/refusals';
import { honestState, premiumsCounts, type InsurerFailure, type PremiumsCounts } from '../../../features/partner2/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner2.premiums.title'), robots: { index: false, follow: false } };
}

export default async function InsurerPremiumsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await insurerGate();
  const exp = chain2State('premiums_export', searchParams);
  if (exp) return <InsurerChain t={t} chain="premiums_export" state={exp} mailbox={await partnersMailbox()} />;
  const act = chain2State('premiums_act', searchParams);
  if (act) return <InsurerChain t={t} chain="premiums_act" state={act} />;
  let counts: PremiumsCounts | null = null; let failure: InsurerFailure | null = null;
  try { counts = premiumsCounts(await partnerClient().partner.insurance.dashboard()); } catch (e) { failure = await insurerFailure(e); }
  return <InsurerPremiumsView t={t} lang={lang} state={honestState(counts, failure)} counts={counts} />;
}
