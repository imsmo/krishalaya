// apps/web-partner/src/app/lender/portfolio/[id]/page.tsx · PC-56 PARTNER-4a · W215 (canon `lender/portfolio/[id]`) — ONE LOAN of this
// lender's own book (`GET /v1/partner/loans/:id`) and the repayments RECORDED against it (`GET …/:id/repayments`) — TWO reads, TWO audit
// rows. Another lender's loan or an absent id answers the same 404 → "not found" (never "not yours").
// `?export=queued|ready` is the W2876–W2877 chain (DECOR + the partners-mailbox line) — this page's "Borrower statement" button is its ONLY
// trigger, though the canon's own donor line, crumb and Back all name W206; the built chain returns HERE.
// `?act=confirm|success|failure` is W2878–W2880 (PARITY-DECOR), likewise linking back here. An insurer is sent to its own dashboard.
// The canon reaches this screen from NOTHING (survey F-22: zero inbound references in all 222 partner files) — the portfolio's rows are the
// inbound edge this build creates. The PARTNER-0 not-yet address `/portfolio/:id` answers a real 307 here.
import type { Metadata } from 'next';
import { requirePartner } from '../../../../lib/session';
import { partnerClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { lenderFailure, lenderGate, isLoanNotFound } from '../../../../lib/lender';
import { partnersMailbox } from '../../../../lib/partners-mailbox';
import type { PartnerBookLoan, PartnerBookRepayment } from '@krishalaya/sdk-js';
import { LenderLoanView } from '../../../../components/partner4/LenderLoanView';
import { LenderChain } from '../../../../components/partner4/LenderChain';
import { chain4State } from '../../../../features/partner4/refusals';
import type { LenderFailure } from '../../../../features/partner4/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner4.loan.title'), robots: { index: false, follow: false } };
}

export default async function LenderLoanPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await lenderGate();
  const self = `/lender/portfolio/${encodeURIComponent(params.id)}`;
  const exp = chain4State('loan_export', searchParams);
  if (exp) return <LenderChain t={t} chain="loan_export" state={exp} back={self} mailbox={await partnersMailbox()} />;
  const act = chain4State('loan_act', searchParams);
  if (act) return <LenderChain t={t} chain="loan_act" state={act} back={self} />;
  let l: (PartnerBookLoan & { computedAt: string }) | null = null;
  let repayments: PartnerBookRepayment[] = [];
  let failure: LenderFailure | null = null; let notFound = false;
  try {
    l = await partnerClient().partner.loans.get(params.id);
    repayments = (await partnerClient().partner.loans.repayments(params.id)).items;
  } catch (e) {
    if (isLoanNotFound(e)) notFound = true; else failure = await lenderFailure(e);
  }
  return <LenderLoanView t={t} lang={lang} l={l} repayments={repayments} failure={failure} notFound={notFound} computedAt={l?.computedAt ?? null} />;
}
