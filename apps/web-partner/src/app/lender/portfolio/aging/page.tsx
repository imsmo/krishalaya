// apps/web-partner/src/app/lender/portfolio/aging/page.tsx · PC-56 PARTNER-5a · W223 (canon `lender/portfolio/aging`) — THE BOOK IN ARREARS,
// AS COUNTS: TWO reads (`GET /v1/partner/loans/dpd` — the six rows and the servicing total, not windowed — and `GET /v1/partner/loans/counts`
// — the restructured count, windowed), TWO partner-realm audit rows, counts and bigint sums only. No new route, no new SDK method.
// `?export=queued|ready` is the W2929–W2930 chain (DECOR + the partners-mailbox line) and is checked FIRST; `?act=confirm|success|failure`
// is W2931–W2933 (PARITY-DECOR: the only trigger is Retry, a re-read). Both are checked BEFORE any read. An insurer is sent to its own home.
// This page is also the POSITIVE CONTROL of the readlessness assertion (test/readless.spec.ts): it reads, so the ban set must fire here.
import type { Metadata } from 'next';
import { requirePartner } from '../../../../lib/session';
import { partnerClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { lenderFailure, lenderGate } from '../../../../lib/lender';
import { partnersMailbox } from '../../../../lib/partners-mailbox';
import type { PartnerBookArrears, PartnerBookCounts } from '@krishalaya/sdk-js';
import { LenderAgingView } from '../../../../components/partner5/LenderAgingView';
import { LenderChain5 } from '../../../../components/partner5/LenderChain5';
import { chain5State } from '../../../../features/partner5/refusals';
import { agingState } from '../../../../features/partner5/figures';
import type { LenderFailure } from '../../../../features/partner4/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner5.aging.title'), robots: { index: false, follow: false } };
}

export default async function LenderAgingPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await lenderGate();
  const exp = chain5State('aging_export', searchParams);
  if (exp) return <LenderChain5 t={t} chain="aging_export" state={exp} mailbox={await partnersMailbox()} />;
  const act = chain5State('aging_act', searchParams);
  if (act) return <LenderChain5 t={t} chain="aging_act" state={act} />;
  let dpd: PartnerBookArrears | null = null; let counts: PartnerBookCounts | null = null; let failure: LenderFailure | null = null;
  try {
    dpd = await partnerClient().partner.loans.dpd();
    counts = await partnerClient().partner.loans.counts();
  } catch (e) { failure = await lenderFailure(e); }
  return <LenderAgingView t={t} lang={lang} state={agingState(dpd, counts, failure)} dpd={dpd} counts={counts} />;
}
