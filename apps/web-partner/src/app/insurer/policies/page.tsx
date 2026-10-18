// apps/web-partner/src/app/insurer/policies/page.tsx · PC-56 PARTNER-2a · W248 (canon `insurer/policies`) — the policies on this insurer's
// products, POLICY FACTS ONLY (founder Q6; `GET /v1/partner/insurance/policies`, keyset, every read audited). Only the status filter and the
// opaque cursor enter the URL. `?export=queued|ready` is the W2881–W2882 chain (DECOR: no partner export plane), `?retry=` W2883–W2885
// (PARITY-DECOR). A lender is sent to `/dashboard`.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { insurerFailure, insurerGate } from '../../../lib/insurer';
import type { PartnerInsurancePolicy } from '@krishalaya/sdk-js';
import { InsurerPoliciesView } from '../../../components/partner2/InsurerPoliciesView';
import { InsurerChain } from '../../../components/partner2/InsurerChain';
import { chain2State } from '../../../features/partner2/refusals';
import { listState, policiesQuery, type InsurerFailure } from '../../../features/partner2/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner2.policies.title'), robots: { index: false, follow: false } };
}

export default async function InsurerPoliciesPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await insurerGate();
  const exp = chain2State('policies_export', searchParams);
  if (exp) return <InsurerChain t={t} chain="policies_export" state={exp} />;
  const retry = chain2State('policies_retry', searchParams);
  if (retry) return <InsurerChain t={t} chain="policies_retry" state={retry} />;
  const q = policiesQuery(searchParams);
  let items: PartnerInsurancePolicy[] | null = null; let nextCursor: string | null = null; let computedAt: string | null = null;
  let failure: InsurerFailure | null = null;
  try {
    const page = await partnerClient().partner.insurance.policies({ status: q.status, cursor: q.cursor, limit: 25 });
    items = page.items; nextCursor = page.nextCursor; computedAt = page.computedAt;
  } catch (e) { failure = await insurerFailure(e); }
  return <InsurerPoliciesView t={t} lang={lang} state={listState(items, failure)} items={items ?? []} status={q.status} nextCursor={nextCursor} computedAt={computedAt} />;
}
