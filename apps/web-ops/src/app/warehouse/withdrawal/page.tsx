// apps/web-ops/src/app/warehouse/withdrawal/page.tsx · PC-56 OPS-1a · W377 (canon `warehouse/withdrawal`) — WITHDRAWAL, a GOODS release against
// an e-NWR (survey C-3) — AN HONEST PAGE THAT READS NOTHING (founder 1a-2, Q3-A). No API call at all (not even a booking): every visit prints
// the same page. `?act=confirm|success|failure` is the W3369–W3371 chain (DECOR).
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { WithdrawalView } from '../../../components/ops1/WithdrawalView';
import { Ops1Chain } from '../../../components/ops1/Ops1Chain';
import { chain1State } from '../../../features/ops1/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops1.withdrawal.title'), robots: { index: false, follow: false } };
}

export default async function WithdrawalPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession('/warehouse/withdrawal');
  const t = getTranslator();
  const act = chain1State('withdrawal_act', searchParams);
  if (act) return <Ops1Chain t={t} chain="withdrawal_act" state={act} />;
  return <WithdrawalView t={t} />;
}
