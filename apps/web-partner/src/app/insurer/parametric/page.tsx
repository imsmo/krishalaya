// apps/web-partner/src/app/insurer/parametric/page.tsx · PC-56 PARTNER-2b · W262 (canon `insurer/parametric`) — AN HONEST PAGE (founder Q3):
// "There is no parametric run, index feed, trigger evaluation or automatic payout on the platform …" and two COUNTS from the 2a products read
// (`GET /v1/partner/insurance/products` — one audit row): the own products marked parametric and the policies in force on them. Linked from the
// insurer dashboard and the products page, NOT the nav (founder 2b-4). `?act=confirm|success|failure` is the W2977–W2979 chain (DECOR — the
// canon's "Trigger audit trail" and "Retry": there is no run and no trigger record). A lender is sent to `/dashboard`.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { insurerFailure, insurerGate } from '../../../lib/insurer';
import { InsurerParametricView } from '../../../components/partner2/InsurerParametricView';
import { InsurerChain } from '../../../components/partner2/InsurerChain';
import { chain2State } from '../../../features/partner2/refusals';
import { honestState, parametricCounts, type InsurerFailure, type ParametricCounts } from '../../../features/partner2/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner2.parametric.title'), robots: { index: false, follow: false } };
}

export default async function InsurerParametricPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  await insurerGate();
  const act = chain2State('parametric_act', searchParams);
  if (act) return <InsurerChain t={t} chain="parametric_act" state={act} />;
  let counts: ParametricCounts | null = null; let failure: InsurerFailure | null = null;
  try { const r = await partnerClient().partner.insurance.products(); counts = parametricCounts(r.items, r.computedAt); } catch (e) { failure = await insurerFailure(e); }
  return <InsurerParametricView t={t} lang={lang} state={honestState(counts, failure)} counts={counts} />;
}
