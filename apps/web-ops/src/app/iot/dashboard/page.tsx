// apps/web-ops/src/app/iot/dashboard/page.tsx · PC-56 OPS-4c · W400 (canon `iot/dashboard`) — THE SENSORS: A READ (founder door Q6-A, applied by the
// lead). Reads, all EXISTING and all behind `logistics` (`logistics.manage`): `GET /v1/logistics/cold-chain/subjects` (each monitored subject's
// latest reading WITH ITS SOURCE, its band verdict, its logger; the breaches in 7 days), `GET …/breaches?limit=1` (the last breach) and `GET
// …/loggers` (the registered loggers). And, only when `digital_twin` is on for the organisation, `GET /v1/twin/overview` (the registry's own
// counts of soil pods and weather masts) — refused or off → nothing is said about them beyond the Q6 sentence. Nothing is changed, summed or
// written here. `?act=confirm|success|failure` is the W3326–W3328 chain (PARITY-DECOR), answered FIRST, before any read.
import type { Metadata } from 'next';
import { SdkError, type ColdBreach, type ColdLogger, type ColdOverview } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { IotDashboardView } from '../../../components/ops4/IotViews';
import { Ops4Chain } from '../../../components/ops4/Ops4Chain';
import { chain4State } from '../../../features/ops4/refusals';
import { IOT, iotState } from '../../../features/ops4/iot';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops4.iot.dash.title'), robots: { index: false, follow: false } };
}

export default async function IotDashboardPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession(IOT.dashboard);
  const t = getTranslator();
  const act = chain4State('iot_act', searchParams);
  if (act) return <Ops4Chain t={t} chain="iot_act" state={act} page={IOT.dashboard} />;
  const c = opsClient();
  let status: 'ok' | number | 'failed' = 'ok';
  let overview: ColdOverview | null = null;
  try { overview = await c.coldChain.subjects(); } catch (e) { status = e instanceof SdkError ? e.status : 'failed'; }
  let lastBreach: ColdBreach | null | 'failed' = null;
  let loggers: ColdLogger[] | null = null;
  let registry: { soilPods: number; weatherMasts: number } | null = null;
  if (status === 'ok') {
    try { lastBreach = (await c.coldChain.breaches({ limit: 1 })).items[0] ?? null; } catch { lastBreach = 'failed'; }
    try { loggers = (await c.coldChain.loggers()).items; } catch { loggers = null; }
    try { const d = (await c.twin.overview()).devices; registry = { soilPods: d.soilPods, weatherMasts: d.weatherMasts }; } catch { registry = null; }
  }
  return <IotDashboardView t={t} state={iotState(status)} readAt={Date.now()} overview={overview} lastBreach={lastBreach} loggers={loggers} registry={registry} />;
}
