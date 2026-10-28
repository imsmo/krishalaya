// apps/web-partner/src/app/lender/kcc/[id]/page.tsx · PC-56 PARTNER-4c · W216 (canon `lender/kcc/[id]`) — AN HONEST PAGE: there is no KCC
// account on this platform (founder 4c-2 / 4c-3). The canon's `[id]` is a LOAN id — there is no account entity to have one — so the page
// prints the statement BESIDE that loan's own facts through PARTNER-4a's existing audited `partner_loan` read: the same wall, the same
// projection, ONE audit row, nothing added to the API and no migration. Another lender's loan and an absent id answer the same named 404 →
// "not found", never a 403 and never "not yours".
// `?form=error|review|success|failure` is the W2953–W2956 FORM chain (DECOR — the partner panel's first four-state form chain, with its own
// mailbox line); `?act=confirm|success|failure` is W2957–W2959 (DECOR — no control on either KCC page leads there). Both are checked BEFORE
// any read, so a chain state writes no audit row. The page is in NO nav: the lending sub-navigation's KCC row (drawn wherever a loan id is in
// scope) and the loan page are its inbound edges — the ones the canon never drew. An insurer is sent to its own dashboard.
import type { Metadata } from 'next';
import { requirePartner } from '../../../../lib/session';
import { partnerClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { lenderFailure, lenderGate, isLoanNotFound } from '../../../../lib/lender';
import { partnersMailbox } from '../../../../lib/partners-mailbox';
import type { PartnerBookLoan } from '@krishalaya/sdk-js';
import { LenderKccView } from '../../../../components/partner4/LenderKccView';
import { LenderChain } from '../../../../components/partner4/LenderChain';
import { chain4State } from '../../../../features/partner4/refusals';
import { kccHref, type LenderFailure } from '../../../../features/partner4/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner4.kcc.title'), robots: { index: false, follow: false } };
}

export default async function LenderKccPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await lenderGate();
  const self = kccHref(params.id);
  const form = chain4State('kcc_form', searchParams);
  if (form) return <LenderChain t={t} chain="kcc_form" state={form} back={self} mailbox={await partnersMailbox()} />;
  const act = chain4State('kcc_act', searchParams);
  if (act) return <LenderChain t={t} chain="kcc_act" state={act} back={self} />;
  let l: (PartnerBookLoan & { computedAt: string }) | null = null;
  let failure: LenderFailure | null = null; let notFound = false;
  try {
    l = await partnerClient().partner.loans.get(params.id);
  } catch (e) {
    if (isLoanNotFound(e)) notFound = true; else failure = await lenderFailure(e);
  }
  return <LenderKccView t={t} lang={lang} loanId={params.id} l={l} failure={failure} notFound={notFound} computedAt={l?.computedAt ?? null} />;
}
