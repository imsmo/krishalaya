// apps/web-ops/src/app/warehouse/billing/page.tsx · PC-56 OPS-2c · W378 (canon `warehouse/billing`) — STORAGE BILLING, A READ OF THE RATE ON FILE
// (founder Q1-A, Q2-A, Q9-A, Q10-A, Q14-A, 2026-11-06). The one read is the EXISTING `GET /v1/warehousing/warehouses?box=mine` (the warehouses the
// signed-in person operates — the SDK's `box` is OPS-2c's minimal F-9 fix). Nothing is billed, computed, exported or written here.
// `?export=queued|ready` is the W3350–W3351 chain and `?act=confirm|success|failure` the W3352–W3354 chain (both DECOR), checked FIRST, before the read.
import type { Metadata } from 'next';
import { SdkError, type Warehouse } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { BillingView } from '../../../components/ops2/BillingView';
import { Ops2Chain } from '../../../components/ops2/Ops2Chain';
import { chain2State } from '../../../features/ops2/refusals';
import { billingState, parseCursor } from '../../../features/ops2/billing';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops2.billing.title'), robots: { index: false, follow: false } };
}

export default async function StorageBillingPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession('/warehouse/billing');
  const t = getTranslator(); const lang = getLang();
  const exp = chain2State('storage_export', searchParams);
  if (exp) return <Ops2Chain t={t} chain="storage_export" state={exp} />;
  const act = chain2State('storage_act', searchParams);
  if (act) return <Ops2Chain t={t} chain="storage_act" state={act} />;
  let warehouses: Warehouse[] = []; let nextCursor: string | null = null; let status: 'ok' | number | 'failed' = 'ok';
  try {
    const p = await opsClient().warehousing.warehouses({ box: 'mine', cursor: parseCursor(searchParams?.cursor), limit: 50 });
    warehouses = p.items; nextCursor = p.nextCursor;
  } catch (e) { status = e instanceof SdkError ? e.status : 'failed'; }
  return <BillingView t={t} lang={lang} state={billingState(status, warehouses.length)} warehouses={warehouses} nextCursor={nextCursor} />;
}
