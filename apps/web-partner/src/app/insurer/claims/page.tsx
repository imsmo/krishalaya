// apps/web-partner/src/app/insurer/claims/page.tsx · PC-56 PARTNER-3a · W252 (canon `insurer/claims`) — THE CLAIMS QUEUE: the claim FACTS on this
// insurer's own products, oldest waiting first (`GET /v1/partner/insurance/claims`, keyset, every read audited), and the counts of the claims
// filed in the current FY by status (`GET …/claims/counts`, the window answered by the database). Only the status filter and the opaque cursor
// enter the URL. `?act=confirm|success|failure` is the W2857–W2859 chain (PARITY-DECOR: Retry is a re-read; "Take next" is DECOR — nothing is
// taken). A lender is sent to `/dashboard`.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { insurerFailure, insurerGate } from '../../../lib/insurer';
import type { PartnerInsuranceClaim, PartnerInsuranceClaimCounts } from '@krishalaya/sdk-js';
import { InsurerClaimsView } from '../../../components/partner3/InsurerClaimsView';
import { InsurerClaimsChain } from '../../../components/partner3/InsurerClaimsChain';
import { chain3State } from '../../../features/partner3/refusals';
import { claimsQuery, listState, type InsurerFailure } from '../../../features/partner3/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner3.claims.title'), robots: { index: false, follow: false } };
}

export default async function InsurerClaimsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await insurerGate();
  const act = chain3State('claims_act', searchParams);
  if (act) return <InsurerClaimsChain t={t} chain="claims_act" state={act} />;
  const q = claimsQuery(searchParams);
  let items: PartnerInsuranceClaim[] | null = null; let nextCursor: string | null = null; let computedAt: string | null = null;
  let counts: PartnerInsuranceClaimCounts | null = null; let failure: InsurerFailure | null = null;
  try {
    const page = await partnerClient().partner.insurance.claims.list({ status: q.status, cursor: q.cursor, limit: 25 });
    items = page.items; nextCursor = page.nextCursor; computedAt = page.computedAt;
    counts = await partnerClient().partner.insurance.claims.counts();
  } catch (e) { failure = await insurerFailure(e); }
  return <InsurerClaimsView t={t} lang={lang} state={listState(items, failure)} items={items ?? []} counts={counts} status={q.status} nextCursor={nextCursor} computedAt={computedAt} />;
}
