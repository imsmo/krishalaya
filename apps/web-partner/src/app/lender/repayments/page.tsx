// apps/web-partner/src/app/lender/repayments/page.tsx · PC-56 PARTNER-4b · W211 (canon `lender/repayments`) — WHAT CAME BACK, AND WHY NOTHING
// IS LATE: TWO reads (`GET /v1/partner/loans/collected` + `GET /v1/partner/loans/dpd`), TWO audit rows, counts and bigint sums only.
// `?export=queued|ready` is the W2994–W2995 chain (DECOR + the partners-mailbox line) and is checked FIRST;
// `?act=confirm|success|failure` is W2996–W2998 (PARITY-DECOR: the module's only trigger is Retry, a re-read).
// Every borrower name, every due figure, every punctuality figure and the whole collections code of conduct are refused by name (founder 4b-5).
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { lenderFailure, lenderGate } from '../../../lib/lender';
import { partnersMailbox } from '../../../lib/partners-mailbox';
import type { PartnerBookArrears, PartnerBookCollected } from '@krishalaya/sdk-js';
import { LenderRepaymentsView } from '../../../components/partner4/LenderRepaymentsView';
import { LenderChain } from '../../../components/partner4/LenderChain';
import { chain4State } from '../../../features/partner4/refusals';
import { servicingState, type LenderFailure } from '../../../features/partner4/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner4.repayments.title'), robots: { index: false, follow: false } };
}

export default async function LenderRepaymentsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await lenderGate();
  const exp = chain4State('repayments_export', searchParams);
  if (exp) return <LenderChain t={t} chain="repayments_export" state={exp} mailbox={await partnersMailbox()} />;
  const act = chain4State('repayments_act', searchParams);
  if (act) return <LenderChain t={t} chain="repayments_act" state={act} />;
  let collected: PartnerBookCollected | null = null; let arrears: PartnerBookArrears | null = null; let failure: LenderFailure | null = null;
  try {
    collected = await partnerClient().partner.loans.collected();
    arrears = await partnerClient().partner.loans.dpd();
  } catch (e) { failure = await lenderFailure(e); }
  return <LenderRepaymentsView t={t} lang={lang} state={servicingState(arrears, collected, failure)} collected={collected} arrears={arrears} />;
}
