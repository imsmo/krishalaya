// apps/web-partner/src/app/insurer/claims/fraud/page.tsx · PC-56 PARTNER-3b · W263 (canon `insurer/claims/fraud`) — AN HONEST PAGE, REFUSED BY
// NAME (founder Q6): there are no fraud flags on the platform and none is raised from this console. No flag table, no signal, no score, no risk
// desk and no partner act exist, and none is built; the console never marks a claim suspicious. The page makes NO insurer read (so NO audit row)
// and prints NO count and NO row: its state is the platform's public flag map (OFF as OFF). `?act=confirm` is the W2934–W2936 chain (DECOR).
// A lender or an asset manager is sent to `/dashboard`. No nav item: reached from the claims sub-navigation only.
import type { Metadata } from 'next';
import { requirePartner } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { insurerGate, insurerSwitches } from '../../../../lib/insurer';
import { InsurerFraudView } from '../../../../components/partner3/InsurerFraudView';
import { InsurerClaimsChain } from '../../../../components/partner3/InsurerClaimsChain';
import { chain3State } from '../../../../features/partner3/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner3.fraud.title'), robots: { index: false, follow: false } };
}

export default async function InsurerFraudPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator();
  await insurerGate();
  const act = chain3State('fraud_act', searchParams);
  if (act) return <InsurerClaimsChain t={t} chain="fraud_act" state={act} />;
  return <InsurerFraudView t={t} state={await insurerSwitches()} />;
}
