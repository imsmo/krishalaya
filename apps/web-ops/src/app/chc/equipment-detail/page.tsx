// apps/web-ops/src/app/chc/equipment-detail/page.tsx · PC-56 OPS-4a · W406 (canon `chc/equipment-detail`) — ONE OF YOUR MACHINES, READ. The machine
// is found in the signed-in person's OWN list (`GET /v1/equipment/assets?box=mine`, keyset, up to 20 pages): the asset route itself answers
// any signed-in user, so a machine that is not in her own list is this page's not-found state — never another person's machine. Then its
// rate lines (`GET …/rates?assetId=`, the SDK fixed in this wave) and its maintenance entries (`GET …/maintenance-logs`), each with its own
// failure. Nothing is changed or computed here. `?act=` is the W3318–W3320 chain (PARITY-DECOR), answered FIRST, before any read.
import type { Metadata } from 'next';
import { SdkError, type CategoryNode, type EquipmentAsset, type EquipmentRate } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { ChcEquipmentView } from '../../../components/ops4/ChcViews';
import { Ops4Chain } from '../../../components/ops4/Ops4Chain';
import { chain4State } from '../../../features/ops4/refusals';
import { CHC, DASH_LIMIT, asMaintenance, chcState, idParam, type MaintenanceEntry } from '../../../features/ops4/chc';

export const dynamic = 'force-dynamic';
const MAX_PAGES = 20;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops4.detail.title'), robots: { index: false, follow: false } };
}

export default async function ChcEquipmentPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const id = idParam(searchParams?.id);
  const self = id ? `${CHC.detail}?id=${encodeURIComponent(id)}` : CHC.detail;
  await requireSession(self);
  const t = getTranslator(); const lang = getLang();
  const act = chain4State('equipment_act', searchParams);
  if (act) return <Ops4Chain t={t} chain="equipment_act" state={act} page={self} />;
  if (!id) return <ChcEquipmentView t={t} lang={lang} state="notFound" asset={null} categories={[]} rates={null} maintenance={null} />;
  const c = opsClient();
  let status: 'ok' | number | 'failed' = 'ok'; let asset: EquipmentAsset | null = null;
  try {
    let cursor: string | undefined;
    for (let i = 0; i < MAX_PAGES && !asset; i++) {
      const p = await c.equipment.assets({ box: 'mine', cursor, limit: DASH_LIMIT });
      asset = p.items.find((a) => a.id === id) ?? null;
      if (!p.nextCursor) break;
      cursor = p.nextCursor;
    }
  } catch (e) { status = e instanceof SdkError ? e.status : 'failed'; }
  if (status !== 'ok') return <ChcEquipmentView t={t} lang={lang} state={chcState(status)} asset={null} categories={[]} rates={null} maintenance={null} />;
  if (!asset) return <ChcEquipmentView t={t} lang={lang} state="notFound" asset={null} categories={[]} rates={null} maintenance={null} />;
  let rates: EquipmentRate[] | null = null; let maintenance: MaintenanceEntry[] | null = null; let categories: CategoryNode[] = [];
  try { rates = await c.equipment.rates(asset.id); } catch { rates = null; }
  try { maintenance = asMaintenance(await c.equipment.maintenanceLogs(asset.id)); } catch { maintenance = null; }
  try { categories = await c.lookups.categories({ rootCode: 'equipment' }); } catch { categories = []; }
  return <ChcEquipmentView t={t} lang={lang} state="ok" asset={asset} categories={categories} rates={rates} maintenance={maintenance} />;
}
