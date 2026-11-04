// apps/web-partner/src/app/lender/collections/[id]/restructure/page.tsx · PC-56 PARTNER-5b · W221 (canon
// `lender/collections/[id]/restructure`) — AN HONEST PAGE THAT READS NOTHING (founder 5b-1 / 5b-4, door Q4): a restructure is proposed and
// decided by the organisation that serves the farmer, not from this console, and nothing of any proposal is shown here. The `[id]` is a
// LOAN id; every id prints the same page. NO partner read → NO audit row, NO error state; the state is the public flag map. `?act=
// confirm|success|failure` is the W2999–W3001 chain (DECOR — "Take to mediation" is the cooperative's act) and is checked FIRST; it
// returns HERE. An insurer is sent to its own dashboard.
import type { Metadata } from 'next';
import { requirePartner } from '../../../../../lib/session';
import { getTranslator } from '../../../../../lib/i18n';
import { lenderGate, lenderSwitches } from '../../../../../lib/lender';
import { LenderRestructureView } from '../../../../../components/partner5/LenderRestructureView';
import { LenderChain5 } from '../../../../../components/partner5/LenderChain5';
import { chain5State } from '../../../../../features/partner5/refusals';
import { restructureHref } from '../../../../../features/partner5/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner5.restructure.title'), robots: { index: false, follow: false } };
}

export default async function LenderRestructurePage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator();
  await lenderGate();
  const act = chain5State('restructure_act', searchParams);
  if (act) return <LenderChain5 t={t} chain="restructure_act" state={act} back={restructureHref(params.id)} />;
  return <LenderRestructureView t={t} state={await lenderSwitches()} loanId={params.id} />;
}
