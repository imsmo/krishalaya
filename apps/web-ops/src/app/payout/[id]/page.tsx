// apps/web-ops/src/app/payout/[id]/page.tsx · PC-56 OPS-1a · the W367 drill-in (FM:18) — ONE bill's own read, `GET /v1/dairy/milk-bills/:id`.
// Read only (founder 1a-1, Q2-A): no approve, no pay. A bill the API will not show (unknown, another organisation's — RLS) prints the same
// "cannot be read here" sentence; the `dairy` flag off (404 from a switched-off route) prints the switched-off sentence.
import type { Metadata } from 'next';
import { SdkError, type MilkBill } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { PayoutBillView } from '../../../components/ops1/PayoutBillView';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops1.payout.billTitle'), robots: { index: false, follow: false } };
}

export default async function PayoutBillPage({ params }: { params: { id: string } }) {
  await requireSession(`/payout/${params.id}`);
  const t = getTranslator(); const lang = getLang();
  const client = opsClient();
  let bill: MilkBill | null = null; let state: 'ok' | 'not_found' | 'off' = 'ok';
  try { bill = await client.dairy.getBill(params.id); }
  catch (e) { state = e instanceof SdkError && e.status === 404 && e.code !== 'MILK_BILL_NOT_FOUND' ? 'off' : 'not_found'; }
  let memberCode: string | null = null;
  if (bill) {
    try { memberCode = (await client.dairy.listMemberships({ box: 'all', limit: 100 })).items.find((m) => m.id === bill!.membershipId)?.memberCode ?? null; } catch { memberCode = null; }
  }
  return <PayoutBillView t={t} lang={lang} bill={bill} memberCode={memberCode} state={state} />;
}
