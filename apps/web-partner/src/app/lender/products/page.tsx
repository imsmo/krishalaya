// apps/web-partner/src/app/lender/products/page.tsx · PC-56 PARTNER-2c · W208 (canon `lender/products`) — THE LENDER'S OWN SHELF
// (`GET /v1/partner/loan-products`: this lender's own loan products' terms + the consented applications in 30 days; every read audited).
// `?form=error|review|success|failure` is the W2980–W2983 chain (DECOR: loan products are authored by the platform — founder Q7; write to the
// partners mailbox to propose a change); `?act=confirm|success|failure` the W2984–W2986 re-read chain (PARITY-DECOR). An insurer is sent to its
// own dashboard. The old not-yet `/products` answers a real 307 here (next.config.js).
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { lenderFailure, lenderGate } from '../../../lib/lender';
import { partnersMailbox } from '../../../lib/partners-mailbox';
import type { PartnerLoanShelf } from '@krishalaya/sdk-js';
import { LenderProductsView } from '../../../components/partner2/LenderProductsView';
import { InsurerChain } from '../../../components/partner2/InsurerChain';
import { chain2State } from '../../../features/partner2/refusals';
import { shelfState } from '../../../features/partner2/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner2.loanProducts.title'), robots: { index: false, follow: false } };
}

export default async function LenderProductsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await lenderGate();
  const form = chain2State('lender_form', searchParams);
  if (form) return <InsurerChain t={t} chain="lender_form" state={form} mailbox={await partnersMailbox()} />;
  const act = chain2State('lender_act', searchParams);
  if (act) return <InsurerChain t={t} chain="lender_act" state={act} />;
  let shelf: PartnerLoanShelf | null = null; let failure: 'off' | 'error' | null = null;
  try { shelf = await partnerClient().partner.loanProducts.list(); } catch (e) { failure = await lenderFailure(e); }
  return <LenderProductsView t={t} lang={lang} state={shelfState(shelf?.items ?? null, failure)} items={shelf?.items ?? []} computedAt={shelf?.computedAt ?? null}
    windowDays={shelf?.windowDays ?? null} mailbox={await partnersMailbox()} />;
}
