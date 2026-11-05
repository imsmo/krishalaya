// apps/web-partner/src/app/insurer/settlements/[id]/page.tsx · PC-56 PARTNER-6a · W261 (canon `insurer/settlements/[id]`) — AN HONEST PAGE THAT
// READS NOTHING (founder 6a-2): no settlement exists for any claim on this platform. The `[id]` is a CLAIM id and the page LOOKS NOTHING UP,
// so every id prints the same page (no not-found, no existence oracle, no error state); the id is only encoded into the link to the claim's
// own page. NO partner read → NO audit row; the state is the platform's public flag map. `?act=` is the settlement chain on this page
// (DECOR, `files: []` — its files are recorded on W260's chain), checked FIRST, and it returns HERE (never the canon's W260). A lender or any
// other kind is sent to its own home.
import type { Metadata } from 'next';
import { requirePartner } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { insurerGate, insurerSwitches } from '../../../../lib/insurer';
import { InsurerSettlementView } from '../../../../components/partner6/InsurerSettlementView';
import { InsurerChain6 } from '../../../../components/partner6/InsurerChain6';
import { chain6State } from '../../../../features/partner6/refusals';
import { settlementHref } from '../../../../features/partner6/figures';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner6.settlement.title'), robots: { index: false, follow: false } };
}

export default async function InsurerSettlementPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator();
  await insurerGate();
  const act = chain6State('settlement_detail_act', searchParams);
  if (act) return <InsurerChain6 t={t} chain="settlement_detail_act" state={act} back={settlementHref(params.id)} />;
  return <InsurerSettlementView t={t} state={await insurerSwitches()} claimId={params.id} />;
}
