// apps/web-ops/src/app/warehouse/assay/certificate/page.tsx · PC-56 OPS-2b · W373 (canon `warehouse/assay/certificate`) — ASSAY RECORD: a READ of ONE
// recorded entry, titled "Assay record", never "certificate" (founder Q13-A). No read-by-id exists, so the entry is picked from its booking's list
// (`?booking=<uuid>&assay=<uuid>`, ids only). Zero inputs. `?export=queued|ready` is the W3295–W3296 chain (DECOR — "Download PDF", Q10-A), checked
// FIRST; its Back returns HERE (the trigger), never the canon's W372.
import type { Metadata } from 'next';
import { SdkError, type AssayReport } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { opsClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { AssayRecordView, type AssayRecordState } from '../../../../components/ops2/AssayViews';
import { Ops2Chain } from '../../../../components/ops2/Ops2Chain';
import { chain2State } from '../../../../features/ops2/refusals';
import { chain2bBack, parseId } from '../../../../features/ops2/receipts';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops2.assayRecord.title'), robots: { index: false, follow: false } };
}

export default async function AssayRecordPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession('/warehouse/assay/certificate');
  const t = getTranslator(); const lang = getLang();
  const bookingId = parseId(searchParams?.booking); const assayId = parseId(searchParams?.assay);
  const exp = chain2State('assay_export', searchParams);
  if (exp) return <Ops2Chain t={t} chain="assay_export" state={exp} back={chain2bBack('assay_export', { booking: bookingId, assay: assayId })} />;
  let state: AssayRecordState = 'pick'; let assay: AssayReport | null = null;
  if (bookingId && assayId) {
    try {
      assay = (await opsClient().warehousing.assays(bookingId)).find((a) => a.id === assayId) ?? null;
      state = assay ? 'ok' : 'missing';
    } catch (e) { state = e instanceof SdkError && (e.status === 404 || e.status === 403) ? 'unavailable' : 'error'; }
  }
  return <AssayRecordView t={t} lang={lang} state={state} bookingId={bookingId} assay={assay} />;
}
