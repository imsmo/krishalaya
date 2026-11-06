// apps/web-ops/src/app/warehouse/assay/page.tsx · PC-56 OPS-2b · W372 (canon `warehouse/assay`) — ASSAY LAB: a READ of ONE booking's assays + the
// record act, REAL (founder Q13-A, Q11-A, 2026-11-06). The booking travels in the URL as an id only (`?booking=<uuid>`, else the "pick a booking"
// state). Three reads: the booking (its status — the form is offered on `stored` only, F-16), its assays, and the warehouses the signed-in person
// operates (`box=mine` — the form is offered only when the booking's warehouse is one of them; the server refuses anyone else by name, 403
// WAREHOUSE_OPERATOR_ONLY). `?act=confirm|success|failure` is the W3297–W3299 chain (REAL), checked FIRST; its Back returns HERE, never W373.
import type { Metadata } from 'next';
import { SdkError, type AssayReport, type StorageBooking } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { AssayForm, AssayLabView } from '../../../components/ops2/AssayViews';
import { Ops2Chain } from '../../../components/ops2/Ops2Chain';
import { chain2State } from '../../../features/ops2/refusals';
import { assayPageState, canRecordAssay, chain2bBack, parseAssayReason, parseId } from '../../../features/ops2/receipts';
import { recordAssayAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops2.assay.title'), robots: { index: false, follow: false } };
}

export default async function AssayLabPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession('/warehouse/assay');
  const t = getTranslator(); const lang = getLang();
  const bookingId = parseId(searchParams?.booking);
  const act = chain2State('assay_act', searchParams);
  const back = chain2bBack('assay_act', { booking: bookingId });
  if (act === 'success') return <Ops2Chain t={t} chain="assay_act" state="success" back={back} />;
  if (act === 'failure') {
    const reason = parseAssayReason(searchParams);
    return <Ops2Chain t={t} chain="assay_act" state="failure" back={back}><p className="kv-error" role="alert" data-kv-reason={reason}><strong>{t.t('ops2.assay.reasonLabel')}</strong> {t.t(`ops2.assay.reason.${reason}`)}</p></Ops2Chain>;
  }

  let booking: StorageBooking | null = null; let assays: AssayReport[] = []; let isOperator = false; let status: 'ok' | number | 'failed' = 'ok';
  if (bookingId) {
    try {
      const w = opsClient().warehousing;
      booking = await w.booking(bookingId);
      assays = await w.assays(bookingId);
      const mine = await w.warehouses({ box: 'mine', limit: 100 });
      isOperator = mine.items.some((x) => x.id === booking?.warehouseId);
    } catch (e) { status = e instanceof SdkError ? e.status : 'failed'; }
  }
  const state = assayPageState(bookingId, status);
  if (act === 'confirm' && state === 'ok' && bookingId && canRecordAssay(booking?.status, isOperator)) {
    return <Ops2Chain t={t} chain="assay_act" state="confirm" back={back}><AssayForm t={t} bookingId={bookingId} action={recordAssayAction} /></Ops2Chain>;
  }
  return <AssayLabView t={t} lang={lang} state={state} bookingId={bookingId} bookingStatus={booking?.status ?? null} isOperator={isOperator} assays={assays} action={recordAssayAction} />;
}
