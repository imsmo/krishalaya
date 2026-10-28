// apps/web-partner/src/app/insurer/surveyors/page.tsx · PC-56 PARTNER-3b · W257 (canon `insurer/surveyors`) — AN HONEST PAGE: there is no
// surveyor roster on the platform and this console manages nobody's staff; surveys are arranged by the organisation that serves the farmer
// (founder Q5). The page makes NO insurer read (so it writes NO audit row) and prints NO count — a surveyor is not an entity on the platform.
// Its state is the platform's public, client-safe flag map (`partner_console`, `insurance` — OFF as OFF), the PARTNER-2b honest-page precedent.
// `?act=confirm` is the W2904–W2906 chain (DECOR). A lender or an asset manager is sent to `/dashboard`. No nav item: the claims sub-navigation.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { insurerGate, insurerSwitches } from '../../../lib/insurer';
import { InsurerSurveyorsView } from '../../../components/partner3/InsurerSurveyorsView';
import { InsurerClaimsChain } from '../../../components/partner3/InsurerClaimsChain';
import { chain3State } from '../../../features/partner3/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner3.surveyors.title'), robots: { index: false, follow: false } };
}

export default async function InsurerSurveyorsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator();
  await insurerGate();
  const act = chain3State('surveyors_act', searchParams);
  if (act) return <InsurerClaimsChain t={t} chain="surveyors_act" state={act} />;
  return <InsurerSurveyorsView t={t} state={await insurerSwitches()} />;
}
