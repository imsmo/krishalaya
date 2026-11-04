// apps/web-partner/src/app/lender/portfolio/writeoffs/page.tsx · PC-56 PARTNER-5a · W222 (canon `lender/portfolio/writeoffs`) — THE
// WRITTEN-OFF LOANS AS LOAN FACTS: TWO reads (`GET /v1/partner/loans/counts` — the written-off count and outstanding over the loans OPENED in
// the window — and `GET /v1/partner/loans?status=written_off`, keyset, every such loan whenever opened), TWO partner-realm audit rows.
// No new route, no new SDK method. `?export=queued|ready` is W3024–W3025 (DECOR + the partners-mailbox line) and is checked FIRST;
// `?act=confirm|success|failure` is W3026–W3028 (PARITY-DECOR: Retry is a re-read). Both are checked BEFORE any read.
import type { Metadata } from 'next';
import { requirePartner } from '../../../../lib/session';
import { partnerClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { lenderFailure, lenderGate } from '../../../../lib/lender';
import { partnersMailbox } from '../../../../lib/partners-mailbox';
import type { PartnerBookCounts, PartnerBookLoan } from '@krishalaya/sdk-js';
import { LenderWriteoffsView } from '../../../../components/partner5/LenderWriteoffsView';
import { LenderChain5 } from '../../../../components/partner5/LenderChain5';
import { chain5State } from '../../../../features/partner5/refusals';
import { writeoffsQuery, writeoffsState } from '../../../../features/partner5/figures';
import type { LenderFailure } from '../../../../features/partner4/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner5.writeoffs.title'), robots: { index: false, follow: false } };
}

export default async function LenderWriteoffsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await lenderGate();
  const exp = chain5State('writeoffs_export', searchParams);
  if (exp) return <LenderChain5 t={t} chain="writeoffs_export" state={exp} mailbox={await partnersMailbox()} />;
  const act = chain5State('writeoffs_act', searchParams);
  if (act) return <LenderChain5 t={t} chain="writeoffs_act" state={act} />;
  const q = writeoffsQuery(searchParams);
  let counts: PartnerBookCounts | null = null; let items: PartnerBookLoan[] | null = null;
  let nextCursor: string | null = null; let computedAt: string | null = null; let failure: LenderFailure | null = null;
  try {
    counts = await partnerClient().partner.loans.counts();
    const page = await partnerClient().partner.loans.list({ status: 'written_off', cursor: q.cursor, limit: 25 });
    items = page.items; nextCursor = page.nextCursor; computedAt = page.computedAt;
  } catch (e) { failure = await lenderFailure(e); }
  return <LenderWriteoffsView t={t} lang={lang} state={writeoffsState(counts, items, failure)} counts={counts} items={items ?? []} nextCursor={nextCursor} computedAt={computedAt} />;
}
