// apps/web-ops/src/app/chc/bookings/page.tsx · PC-56 OPS-4a · W407 (canon `chc/bookings`) — THE HIRES ON YOUR MACHINES, READ (founder Q1-A, Q2-A,
// 2026-11-09; Q3-A applied from OPS-1 Q2-A). `GET /v1/equipment/rentals?box=owner` (keyset, 50 a page, the status filter), your machines
// (`box=mine`, to name each hire's machine) and the equipment categories. NO renter name, NO money button: quotes, starting, finishing and
// payment are done by the machine's owner in their own app. `?act=` is the W3304–W3306 chain (PARITY-DECOR), answered FIRST, before any read.
import type { Metadata } from 'next';
import { SdkError, type CategoryNode, type EquipmentAsset, type EquipmentRental } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { ChcBookingsView } from '../../../components/ops4/ChcViews';
import { Ops4Chain } from '../../../components/ops4/Ops4Chain';
import { chain4State } from '../../../features/ops4/refusals';
import { BOOKINGS_PAGE, CHC, DASH_LIMIT, chcState, cursorParam, statusParam } from '../../../features/ops4/chc';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops4.bookings.title'), robots: { index: false, follow: false } };
}

export default async function ChcBookingsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession(CHC.bookings);
  const t = getTranslator(); const lang = getLang();
  const act = chain4State('chc_act', searchParams);
  if (act) return <Ops4Chain t={t} chain="chc_act" state={act} page={CHC.bookings} />;
  const status = statusParam(searchParams?.status); const cursor = cursorParam(searchParams?.cursor);
  const c = opsClient();
  let st: 'ok' | number | 'failed' = 'ok'; let hires: EquipmentRental[] = []; let nextCursor: string | null = null;
  try { const p = await c.equipment.rentals({ box: 'owner', status, cursor, limit: BOOKINGS_PAGE }); hires = p.items; nextCursor = p.nextCursor; }
  catch (e) { st = e instanceof SdkError ? e.status : 'failed'; }
  let machines: EquipmentAsset[] = []; let categories: CategoryNode[] = [];
  if (st === 'ok') {
    try { machines = (await c.equipment.assets({ box: 'mine', limit: DASH_LIMIT })).items; } catch { machines = []; }
    try { categories = await c.lookups.categories({ rootCode: 'equipment' }); } catch { categories = []; }
  }
  return <ChcBookingsView t={t} lang={lang} state={chcState(st)} hires={hires} nextCursor={nextCursor} status={status} machines={machines} categories={categories} />;
}
