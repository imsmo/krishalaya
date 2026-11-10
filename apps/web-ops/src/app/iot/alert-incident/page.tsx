// apps/web-ops/src/app/iot/alert-incident/page.tsx · PC-56 OPS-5a · W403 (canon `iot/alert-incident`) — ONE BREACH: A READ. One read, EXISTING, behind
// `logistics` (`logistics.manage`): `GET /v1/logistics/cold-chain/breaches/:id` (TENANT-SW-e). Nothing is written here: acknowledging a breach,
// recording what was done and recording its outcome (and any loss) are the organisation's cold-chain console's (founder door Q1-A, lead-applied;
// verified: web-tenant `/ops/logistics/cold-chain/breaches/act` offers all three, a loss with its amount and currency). The chain states
// (`?act=confirm|success|failure`, W3292–W3294 opened by "Retry") are PARITY-DECOR, answered FIRST, before any read; Back → this breach.
import type { Metadata } from 'next';
import { SdkError, type ColdBreach } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { AlertIncidentView } from '../../../components/ops5/AlertViews';
import { Ops5Chain } from '../../../components/ops5/Ops5Chain';
import { chain5State } from '../../../features/ops5/refusals';
import { iotState } from '../../../features/ops4/iot';
import { ALERTS, incidentHref, uuidParam } from '../../../features/ops5/alerts';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('ops5.incident.title'), robots: { index: false, follow: false } }; }

export default async function AlertIncidentPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession(ALERTS.incident);
  const t = getTranslator(); const lang = getLang();
  const id = uuidParam(searchParams?.id);
  const act = chain5State('incident_act', searchParams);
  if (act) return <Ops5Chain t={t} chain="incident_act" state={act} page={id ? incidentHref(id) : ALERTS.incident} />;
  if (!id) return <AlertIncidentView t={t} lang={lang} state="notFound" id={null} breach={null} />;
  let breach: ColdBreach | null = null; let state: ReturnType<typeof iotState> | 'notFound' = 'ok';
  try { breach = await opsClient().coldChain.breach(id); }
  catch (e) { state = e instanceof SdkError && e.code === 'BREACH_NOT_FOUND' ? 'notFound' : iotState(e instanceof SdkError ? e.status : 'failed'); }
  return <AlertIncidentView t={t} lang={lang} state={state} id={id} breach={breach} />;
}
