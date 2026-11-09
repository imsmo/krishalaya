// apps/web-ops/src/app/chc/dashboard/page.tsx · PC-56 OPS-4a · W405 (canon `chc/dashboard`) — THE HIRE: A READ OF YOUR MACHINES AND THE HIRES ON
// THEM (founder Q2-A, 2026-11-09). Three reads, all EXISTING: `GET /v1/equipment/assets?box=mine` (the machines the signed-in person listed),
// `GET /v1/equipment/rentals?box=owner` (the latest 100 hires on them) and the equipment categories (to name a machine). Nothing is changed,
// computed or written here. `?act=confirm|success|failure` is the W3304–W3306 chain (PARITY-DECOR), answered FIRST, before any read.
import type { Metadata } from 'next';
import { SdkError, type CategoryNode, type EquipmentAsset, type EquipmentRental } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { ChcDashboardView } from '../../../components/ops4/ChcViews';
import { Ops4Chain } from '../../../components/ops4/Ops4Chain';
import { chain4State } from '../../../features/ops4/refusals';
import { CHC, DASH_LIMIT, chcState } from '../../../features/ops4/chc';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops4.dash.title'), robots: { index: false, follow: false } };
}

export default async function ChcDashboardPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession(CHC.dashboard);
  const t = getTranslator(); const lang = getLang();
  const act = chain4State('chc_act', searchParams);
  if (act) return <Ops4Chain t={t} chain="chc_act" state={act} page={CHC.dashboard} />;
  const c = opsClient();
  let status: 'ok' | number | 'failed' = 'ok';
  let machines: EquipmentAsset[] = []; let machinesMore = false; let hires: EquipmentRental[] = []; let hiresMore = false;
  try {
    const m = await c.equipment.assets({ box: 'mine', limit: DASH_LIMIT });
    machines = m.items; machinesMore = !!m.nextCursor;
    const h = await c.equipment.rentals({ box: 'owner', limit: DASH_LIMIT });
    hires = h.items; hiresMore = !!h.nextCursor;
  } catch (e) { status = e instanceof SdkError ? e.status : 'failed'; }
  let categories: CategoryNode[] = [];
  if (status === 'ok') { try { categories = await c.lookups.categories({ rootCode: 'equipment' }); } catch { categories = []; } }
  return <ChcDashboardView t={t} lang={lang} state={chcState(status)} machines={machines} machinesMore={machinesMore} categories={categories} hires={hires} hiresMore={hiresMore} />;
}
