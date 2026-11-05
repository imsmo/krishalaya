// apps/web-ops/src/app/payout/page.tsx · PC-56 OPS-1a · W367 (canon `payout`) — THE PAYOUT RUN, A READ (founder 1a-1, Q2-A). The reads are the
// EXISTING `GET /v1/dairy/milk-bills?box=all` (keyset; the page size from the one GET select), the memberships list (member codes, as the
// console's dairy desk prints them) and `GET /v1/dairy/bill-cycles?limit=1` (only to tell "no cycle yet" from "no bills yet"). The ops console
// approves nothing and pays nothing. `?act=confirm|success|failure` is the W3332–W3334 chain (DECOR), checked FIRST, before any read.
import type { Metadata } from 'next';
import { SdkError, type MilkBill } from '@krishalaya/sdk-js';
import { requireSession } from '../../lib/session';
import { opsClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { PayoutView } from '../../components/ops1/PayoutView';
import { Ops1Chain } from '../../components/ops1/Ops1Chain';
import { chain1State } from '../../features/ops1/refusals';
import { parseCursor, parsePageSize, payoutState } from '../../features/ops1/payout';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops1.payout.title'), robots: { index: false, follow: false } };
}

export default async function PayoutPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession('/payout');
  const t = getTranslator(); const lang = getLang();
  const act = chain1State('payout_act', searchParams);
  if (act) return <Ops1Chain t={t} chain="payout_act" state={act} />;
  const size = parsePageSize(searchParams?.size);
  const client = opsClient();
  let bills: MilkBill[] = []; let nextCursor: string | null = null; let billsStatus: 'ok' | number | 'failed' = 'ok';
  try {
    const p = await client.dairy.listBills({ box: 'all', cursor: parseCursor(searchParams?.cursor), limit: size });
    bills = p.items; nextCursor = p.nextCursor;
  } catch (e) { billsStatus = e instanceof SdkError ? e.status : 'failed'; }
  let cycles: number | null = null;
  if (billsStatus === 'ok' && bills.length === 0) {
    try { cycles = (await client.dairy.listBillCycles({ limit: 1 })).length; } catch { cycles = null; }
  }
  const memberCodes: Record<string, string> = {};
  if (bills.length > 0) {
    try { for (const m of (await client.dairy.listMemberships({ box: 'all', limit: 100 })).items) memberCodes[m.id] = m.memberCode; } catch { /* codes stay unknown */ }
  }
  return <PayoutView t={t} lang={lang} state={payoutState(billsStatus, bills.length, cycles)} bills={bills} memberCodes={memberCodes} size={size} nextCursor={nextCursor} />;
}
