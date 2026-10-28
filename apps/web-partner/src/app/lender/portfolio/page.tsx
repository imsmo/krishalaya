// apps/web-partner/src/app/lender/portfolio/page.tsx · PC-56 PARTNER-4a · W212 (canon `lender/portfolio`) — THE PORTFOLIO: the COUNTS and
// bigint SUMS of the loans this lender's own book OPENED in the current FY (`GET /v1/partner/loans/counts`, the window answered by the
// database) and the book's newest loans (`GET /v1/partner/loans`, keyset) — TWO reads, TWO audit rows, counts only.
// `?export=queued|ready` is the W2891–W2892 chain (DECOR + the partners-mailbox line); `?act=confirm|success|failure` is W2893–W2895
// (PARITY-DECOR: the module's only trigger is Retry, a re-read of the counts). The export chain is checked FIRST.
// Every row links to its own loan — the inbound edge the canon never drew for W215. An insurer is sent to its own dashboard.
// The PARTNER-0 not-yet address `/portfolio` and the dead `/servicing` both answer a real 307 here.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { lenderFailure, lenderGate } from '../../../lib/lender';
import { partnersMailbox } from '../../../lib/partners-mailbox';
import type { PartnerBookCounts, PartnerBookLoan } from '@krishalaya/sdk-js';
import { LenderPortfolioView } from '../../../components/partner4/LenderPortfolioView';
import { LenderChain } from '../../../components/partner4/LenderChain';
import { chain4State } from '../../../features/partner4/refusals';
import { countsState, portfolioQuery, type LenderFailure } from '../../../features/partner4/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner4.portfolio.title'), robots: { index: false, follow: false } };
}

export default async function LenderPortfolioPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await lenderGate();
  const exp = chain4State('portfolio_export', searchParams);
  if (exp) return <LenderChain t={t} chain="portfolio_export" state={exp} mailbox={await partnersMailbox()} />;
  const act = chain4State('portfolio_act', searchParams);
  if (act) return <LenderChain t={t} chain="portfolio_act" state={act} />;
  const q = portfolioQuery(searchParams);
  let counts: PartnerBookCounts | null = null; let items: PartnerBookLoan[] | null = null;
  let nextCursor: string | null = null; let computedAt: string | null = null; let failure: LenderFailure | null = null;
  try {
    counts = await partnerClient().partner.loans.counts();
    const page = await partnerClient().partner.loans.list({ status: q.status, cursor: q.cursor, limit: 25 });
    items = page.items; nextCursor = page.nextCursor; computedAt = page.computedAt;
  } catch (e) { failure = await lenderFailure(e); }
  return <LenderPortfolioView t={t} lang={lang} state={countsState(counts, failure)} counts={counts} items={items ?? []} status={q.status} nextCursor={nextCursor} computedAt={computedAt} />;
}
