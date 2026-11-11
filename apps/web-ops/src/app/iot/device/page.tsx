// apps/web-ops/src/app/iot/device/page.tsx · PC-56 OPS-4c · W401 (canon `iot/device`) — ONE MONITORED SUBJECT: A READ. `?type=&id=` name the subject
// (the canon's "device" is a subject with a logger mounted on it); `?hours=` is the GET filter for the server's window (6, 24, 48 or 168). One
// read, EXISTING, behind `logistics` (`logistics.manage`): `GET /v1/logistics/cold-chain/subjects/:type/:id?hours=` — the trail with each
// reading's source and both times, the band, the breaches, the logger. Nothing is changed, drawn or written here. `?act=` is the W3326–W3328
// chain (PARITY-DECOR), answered FIRST — and its Back keeps the subject.
import type { Metadata } from 'next';
import { SdkError, type ColdSubjectDetail } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { IotDeviceView } from '../../../components/ops4/IotViews';
import { Ops4Chain } from '../../../components/ops4/Ops4Chain';
import { chain4State } from '../../../features/ops4/refusals';
import { IOT, deviceHref, hoursParam, iotState, subjectTypeParam, uuidParam } from '../../../features/ops4/iot';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops4.iot.device.title'), robots: { index: false, follow: false } };
}

export default async function IotDevicePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession(IOT.device);
  const t = getTranslator(); const lang = getLang();
  const type = subjectTypeParam(searchParams?.type);
  const id = uuidParam(searchParams?.id);
  const hours = hoursParam(searchParams?.hours);
  const act = chain4State('iot_act', searchParams);
  if (act) return <Ops4Chain t={t} chain="iot_act" state={act} page={type && id ? deviceHref(type, id, hours) : IOT.device} />;
  if (!type || !id) return <IotDeviceView t={t} lang={lang} state="notFound" readAt={Date.now()} hours={hours} type={type} id={id} detail={null} />;
  let status: 'ok' | number | 'failed' = 'ok';
  let detail: ColdSubjectDetail | null = null;
  try { detail = await opsClient().coldChain.subject(type, id, { hours }); } catch (e) { status = e instanceof SdkError ? e.status : 'failed'; }
  const state = status === 400 ? 'notFound' : iotState(status);
  return <IotDeviceView t={t} lang={lang} state={state} readAt={Date.now()} hours={hours} type={type} id={id} detail={detail} />;
}
