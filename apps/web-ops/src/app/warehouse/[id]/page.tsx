// apps/web-ops/src/app/warehouse/[id]/page.tsx · one deposit's lifecycle (PC-32 OW-2) — the dashboard's drill-in. notFound = IDOR guard.
// PC-56 OPS-2b (founder Q3-A, Q13-A): no eNWR issue form (the API refuses issue by name); the booking's assays are read and recorded on W372.
// PC-56 OPS-2a (founder Q6-A, Q9-A, Q11-A; D3, 2026-11-06/08): presentational in `BookingDetailView`. Three reads: the booking, its commodity's own
// name (the existing product read; "not available" otherwise, never an id) and the warehouses the signed-in person operates (`box=mine` — the 2b
// approach): confirm, store and cancel are OFFERED only when the booking's warehouse is one of them (the server refuses anyone else by name, 403
// WAREHOUSE_OPERATOR_ONLY / BOOKING_CANCEL_NOT_PERMITTED); the operator's cancel has a REQUIRED reason (D3). "Mark stored" records no weight (Q6-A);
// the paused-release sentence stays; the bare "←" is gone (E9). No depositor name or id (Q9-A).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { StorageBooking, Warehouse } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { BookingDetailView } from '../../../components/ops2/IntakeViews';
import { BOOKING_ERRORS, isOperatorOf } from '../../../features/ops2/intake';
import { bookingLifecycleAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('wh.detailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['confirm', 'store', 'cancel']);
const ERR = new Set<string>(BOOKING_ERRORS);

export default async function BookingDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requireSession(`/warehouse/${params.id}`);
  const t = getTranslator();
  const lang = getLang();
  const c = opsClient();

  let b: StorageBooking;
  try { b = await c.warehousing.booking(params.id); }
  catch { notFound(); }
  let mine: Warehouse[] = [];
  try { mine = (await c.warehousing.warehouses({ box: 'mine', limit: 100 })).items; } catch { mine = []; }
  let commodity: string | null = null;
  try { commodity = (await c.catalogue.product(b.productId)).defaultName || null; } catch { commodity = null; }

  const ok = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const error = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const isOperator = isOperatorOf(b.warehouseId, mine);
  const warehouseName = mine.find((w) => w.id === b.warehouseId)?.defaultName ?? null;
  return <BookingDetailView t={t} lang={lang} booking={b} commodity={commodity} warehouseName={warehouseName} isOperator={isOperator} ok={ok} error={error} action={bookingLifecycleAction} />;
}
