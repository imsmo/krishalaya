// apps/web-ops/src/app/aeps/withdrawal/page.tsx · PC-56 OPS-1b · W391 (canon `aeps/withdrawal`) — RECORD AN AePS EVENT: the record form moved
// from `/money` (which now answers a REAL 307 here) and reframed as a LOG (founder Q1-A): "Record what the bank's device showed. This platform
// did not move the money and cannot check it." REAL over the existing keyed route. It reads nothing before the act: whether this person may
// record is the server's answer (403 → the failure state names it).
// `?act=confirm|success|failure` is the W3289–W3291 chain (REAL): confirm = the same form under the confirm sentence; success / failure = the
// act's result (failure with the server's named reason). Back → this page, never W393.
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { AepsRecordView } from '../../../components/ops1/AepsViews';
import { Ops1Chain } from '../../../components/ops1/Ops1Chain';
import { chain1State } from '../../../features/ops1/refusals';
import { AEPS_RECORD, parseAepsReason } from '../../../features/ops1/aeps';
import { recordAepsEventAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops1.aeps.record.title'), robots: { index: false, follow: false } };
}

export default async function AepsRecordPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession(AEPS_RECORD);
  const t = getTranslator();
  const act = chain1State('aeps_act', searchParams);
  if (act === 'confirm') return <AepsRecordView t={t} mode="confirm" action={recordAepsEventAction} />;
  if (act === 'failure') {
    const reason = parseAepsReason(searchParams);
    return <Ops1Chain t={t} chain="aeps_act" state="failure"><p className="kv-error" role="alert" data-kv-reason={reason}><strong>{t.t('ops1.aeps.reasonLabel')}</strong> {t.t(`ops1.aeps.reason.${reason}`)}</p></Ops1Chain>;
  }
  if (act === 'success') return <Ops1Chain t={t} chain="aeps_act" state="success" />;
  return <AepsRecordView t={t} mode="page" action={recordAepsEventAction} />;
}
