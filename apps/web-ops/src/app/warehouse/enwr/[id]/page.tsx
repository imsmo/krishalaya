// apps/web-ops/src/app/warehouse/enwr/[id]/page.tsx · PC-56 OPS-2b · the W376 drill-in (FM:22) — ONE receipt RECORD over the EXISTING
// `GET /v1/warehousing/nwr/:id` (the holder's own or staff; 404 otherwise — no IDOR). Its booking is read only for the unit (the receipt stores none);
// if that read fails the page says the unit is not recorded on the receipt. No holder, no value (Q9-A, Q4-A), zero inputs, no release or cancel
// button (founder Q5-A: release refused by name; cancel is the named operator's API act and no console button calls it in OPS-2b).
import type { Metadata } from 'next';
import { SdkError, type NwrReceipt } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { opsClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { EnwrReceiptView, type ReceiptState } from '../../../../components/ops2/EnwrViews';
import { parseId } from '../../../../features/ops2/receipts';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops2.enwrReceipt.title'), robots: { index: false, follow: false } };
}

export default async function EnwrReceiptPage({ params }: { params: { id: string } }) {
  const id = parseId(params.id);
  await requireSession(id ? `/warehouse/enwr/${id}` : '/warehouse/enwr/registry');
  const t = getTranslator(); const lang = getLang();
  let state: ReceiptState = 'unavailable'; let receipt: NwrReceipt | null = null; let unitCode: string | null = null;
  if (id) {
    try {
      receipt = await opsClient().warehousing.nwr(id); state = 'ok';
      try { unitCode = (await opsClient().warehousing.booking(receipt.storageBookingId)).unitCode; } catch { unitCode = null; }
    } catch (e) { state = e instanceof SdkError && (e.status === 404 || e.status === 403) ? 'unavailable' : 'error'; }
  }
  return <EnwrReceiptView t={t} lang={lang} state={state} receipt={receipt} unitCode={unitCode} />;
}
