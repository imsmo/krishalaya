// apps/web-partner/src/app/insurer/issuance/page.tsx · PC-56 PARTNER-2b · W249 (canon `insurer/issuance`) — the issuance desk as a READ (founder Q5):
// the `proposed` policies on this insurer's products (`GET /v1/partner/insurance/issuance`, keyset, every read audited) under the founder's
// sentence "Cover starts when the farmer's premium payment is confirmed; the insurer does not issue policies on the platform yet". Only the
// opaque cursor enters the URL. `?form=error|review|success|failure` is the W2944–W2947 chain (DECOR: nothing is issued here), `?act=` the
// W2948–W2950 re-read chain (PARITY-DECOR). A lender is sent to `/dashboard`.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { insurerFailure, insurerGate } from '../../../lib/insurer';
import type { PartnerInsuranceQueueRow } from '@krishalaya/sdk-js';
import { InsurerIssuanceView } from '../../../components/partner2/InsurerIssuanceView';
import { InsurerChain } from '../../../components/partner2/InsurerChain';
import { chain2State } from '../../../features/partner2/refusals';
import { issuanceQuery, listState, type InsurerFailure } from '../../../features/partner2/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner2.issuance.title'), robots: { index: false, follow: false } };
}

export default async function InsurerIssuancePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await insurerGate();
  const form = chain2State('issuance_form', searchParams);
  if (form) return <InsurerChain t={t} chain="issuance_form" state={form} />;
  const act = chain2State('issuance_act', searchParams);
  if (act) return <InsurerChain t={t} chain="issuance_act" state={act} />;
  const q = issuanceQuery(searchParams);
  let items: PartnerInsuranceQueueRow[] | null = null; let nextCursor: string | null = null; let computedAt: string | null = null;
  let failure: InsurerFailure | null = null;
  try {
    const page = await partnerClient().partner.insurance.issuance({ cursor: q.cursor, limit: 25 });
    items = page.items; nextCursor = page.nextCursor; computedAt = page.computedAt;
  } catch (e) { failure = await insurerFailure(e); }
  return <InsurerIssuanceView t={t} lang={lang} state={listState(items, failure)} items={items ?? []} nextCursor={nextCursor} computedAt={computedAt} />;
}
