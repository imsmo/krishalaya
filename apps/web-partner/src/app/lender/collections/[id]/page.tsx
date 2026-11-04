// apps/web-partner/src/app/lender/collections/[id]/page.tsx · PC-56 PARTNER-5b · W220 (canon `lender/collections/[id]`) — AN HONEST PAGE
// THAT READS NOTHING (founder 5b-1 / 5b-3, door Q5): there is no collections case on this platform. The `[id]` is a LOAN id and the page
// LOOKS NOTHING UP, so every id prints the same page (no not-found, no existence oracle); the id is only encoded into links. NO partner
// read → NO audit row, NO error state; the state is the public flag map. The two chain states are checked FIRST: `?form=error|review|
// success|failure` is the W2914–W2917 collections FORM chain (DECOR, NO mailbox line) and `?act=` the case's mutate chain (DECOR, its files
// recorded on W219's chain); both return HERE. The canon's two inputs are never rendered. An insurer is sent to its own dashboard.
import type { Metadata } from 'next';
import { requirePartner } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { lenderGate, lenderSwitches } from '../../../../lib/lender';
import { LenderCollectionsCaseView } from '../../../../components/partner5/LenderCollectionsCaseView';
import { LenderChain5 } from '../../../../components/partner5/LenderChain5';
import { chain5State } from '../../../../features/partner5/refusals';
import { collectionsCaseHref } from '../../../../features/partner5/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner5.case.title'), robots: { index: false, follow: false } };
}

export default async function LenderCollectionsCasePage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator();
  await lenderGate();
  const form = chain5State('collections_form', searchParams);
  if (form) return <LenderChain5 t={t} chain="collections_form" state={form} back={collectionsCaseHref(params.id)} />;
  const act = chain5State('case_act', searchParams);
  if (act) return <LenderChain5 t={t} chain="case_act" state={act} back={collectionsCaseHref(params.id)} />;
  return <LenderCollectionsCaseView t={t} state={await lenderSwitches()} loanId={params.id} />;
}
