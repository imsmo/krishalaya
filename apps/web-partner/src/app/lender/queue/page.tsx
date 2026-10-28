// apps/web-partner/src/app/lender/queue/page.tsx · PC-56 PARTNER-4a · W206 (canon `lender/queue`) — THE LOAN QUEUE: the consented
// applications on this lender's own products (`GET /v1/partner/applications` — the API decides on the kv_partner axis through 0225's consent
// oracle, never this page), plus the COUNTS of this lender's own book in the current FY (`GET /v1/partner/loans/counts`, the window answered
// by the database, every read audited). Only the box, the status filter and the opaque cursor enter the URL.
// `?act=confirm|success|failure` is the W2878–W2880 chain (PARITY-DECOR: Retry is a re-read; "Take next" is DECOR — nothing is taken).
// An insurer is sent to its own dashboard. The PARTNER-0 address `/loan-queue` answers a real 307 here.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { lenderFailure, lenderGate } from '../../../lib/lender';
import type { PartnerApplication, PartnerApplicationStatus, PartnerBookCounts } from '@krishalaya/sdk-js';
import { LenderQueueView } from '../../../components/partner4/LenderQueueView';
import { LenderChain } from '../../../components/partner4/LenderChain';
import { chain4State } from '../../../features/partner4/refusals';
import { listState, queueQuery, type LenderFailure } from '../../../features/partner4/figures';
import { partnerListFilter } from '../../../features/partner/application';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner4.queue.title'), robots: { index: false, follow: false } };
}

export default async function LenderQueuePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await lenderGate();
  const act = chain4State('queue_act', searchParams);
  if (act) return <LenderChain t={t} chain="queue_act" state={act} />;
  const q = queueQuery(searchParams);
  let items: PartnerApplication[] | null = null; let nextCursor: string | null = null; let computedAt: string | null = null;
  let counts: PartnerBookCounts | null = null; let failure: LenderFailure | null = null;
  try {
    const f = partnerListFilter(q.box, q.status);
    const page = await partnerClient().partner.applications.list({ reviewQueue: f.reviewQueue, status: f.status as PartnerApplicationStatus | undefined, cursor: q.cursor, limit: 25 });
    items = page.items; nextCursor = page.nextCursor; computedAt = page.asOf;
    counts = await partnerClient().partner.loans.counts();
  } catch (e) { failure = await lenderFailure(e); }
  return <LenderQueueView t={t} lang={lang} state={listState(items, failure)} items={items ?? []} counts={counts} box={q.box} status={q.status} nextCursor={nextCursor} computedAt={computedAt} />;
}
