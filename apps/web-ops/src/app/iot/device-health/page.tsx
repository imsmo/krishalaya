// apps/web-ops/src/app/iot/device-health/page.tsx · PC-56 OPS-4c · W404 (canon `iot/device-health`) — THE LOGGERS THE SERVER FLAGGED SILENT: A READ.
// One read, EXISTING, behind `logistics` (`logistics.manage`): `GET /v1/logistics/cold-chain/loggers` — the registered loggers, the silences the
// server's watch job flagged from SIGNED readings only (`cold_chain_device_silences`, resolved only by the logger's next signed reading), and the
// server's own silence threshold (`silenceMinutes`), printed as sent — never written in this page. Nothing is changed or written here.
// `?act=confirm|success|failure` is the W3307–W3309 chain (PARITY-DECOR), answered FIRST, before any read.
import type { Metadata } from 'next';
import { SdkError, type ColdLogger } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { IotHealthView } from '../../../components/ops4/IotViews';
import { Ops4Chain } from '../../../components/ops4/Ops4Chain';
import { chain4State } from '../../../features/ops4/refusals';
import { IOT, iotState } from '../../../features/ops4/iot';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops4.iot.health.title'), robots: { index: false, follow: false } };
}

export default async function IotHealthPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession(IOT.health);
  const t = getTranslator();
  const act = chain4State('device_act', searchParams);
  if (act) return <Ops4Chain t={t} chain="device_act" state={act} page={IOT.health} />;
  let status: 'ok' | number | 'failed' = 'ok';
  let loggers: ColdLogger[] = []; let silences: Awaited<ReturnType<ReturnType<typeof opsClient>['coldChain']['loggers']>>['silences'] = [];
  let silenceMinutes: number | null = null;
  try {
    const r = await opsClient().coldChain.loggers();
    loggers = r.items; silences = r.silences; silenceMinutes = typeof r.silenceMinutes === 'number' ? r.silenceMinutes : null;
  } catch (e) { status = e instanceof SdkError ? e.status : 'failed'; }
  return <IotHealthView t={t} state={iotState(status)} silences={silences} loggers={loggers} silenceMinutes={silenceMinutes} />;
}
