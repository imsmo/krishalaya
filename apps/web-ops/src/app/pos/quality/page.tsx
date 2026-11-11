// apps/web-ops/src/app/pos/quality/page.tsx · PC-56 OPS-3a · W362 (canon `pos/quality`) — THE CHECK STEP of the record act = the pos chain's confirm
// (W3335), REAL (founder Q2-A, Q3-A, Q4-A). The pour arrives from the record form as query parameters; nothing is stored until "Record this pour".
// Two reads: the centre in your custody and the organisation's today, and the centre's roll by the member's code (the member must be on it).
// `?act=failure&reason=` is W3337 ("Nothing was recorded" + the named reason), checked FIRST — it reads nothing.
import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { PosQualityView, PourFailure, CounterStateView } from '../../../components/ops3/CounterViews';
import { Ops3Chain } from '../../../components/ops3/Ops3Chain';
import { chain3State } from '../../../features/ops3/refusals';
import { POS, ROLL_PAGE_SIZE, parseId, parseReason, pourFromParams, pourQuery } from '../../../features/ops3/counter';
import { loadCounter } from '../../../features/ops3/counter-load';
import { recordPourAction } from '../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('ops3.chain.posAct.confirm.title'), robots: { index: false, follow: false } }; }

export default async function PosQualityPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession(POS.quality);
  const t = getTranslator(); const lang = getLang();
  const mcc = parseId(searchParams?.mcc);
  const collect = mcc ? `${POS.collect}?mcc=${mcc}` : POS.collect;
  const act = chain3State('pos_act', searchParams);
  if (act === 'failure') {
    // Back → the check step it came from (the pour echoed), when the pour is still in the URL; else the form.
    const echoed = searchParams?.member ? `${POS.quality}?${new URLSearchParams(Object.entries(searchParams).flatMap(([k, v]) =>
      ['act', 'reason'].includes(k) ? [] : (Array.isArray(v) ? v : [v ?? '']).map((x) => [k, String(x)] as [string, string]))).toString()}` : collect;
    return <Ops3Chain t={t} chain="pos_act" state="failure" back={echoed} backKey="ops3.pos.backToCheck"><PourFailure t={t} reason={parseReason(searchParams)} /></Ops3Chain>;
  }
  const ctx = await loadCounter(mcc);
  if (ctx.state !== 'ok' || !ctx.today) return <section data-kv-page="pos_quality"><CounterStateView t={t} state={ctx.state === 'ok' ? 'error' : ctx.state} page={collect} /></section>;
  if (!ctx.centre) return <Ops3Chain t={t} chain="pos_act" state="failure" back={collect} backKey="ops3.pos.backToForm"><PourFailure t={t} reason="custody" /></Ops3Chain>;
  const built = pourFromParams(searchParams, ctx.today);
  if (!built.ok || !built.code) {
    // a pre-check before anything is sent: back to the form, the reason named
    return <Ops3Chain t={t} chain="pos_act" state="failure" back={collect} backKey="ops3.pos.backToForm"><PourFailure t={t} reason={built.ok ? 'member' : built.error} /></Ops3Chain>;
  }
  let milkType: string | null = null; let onRoll = false;
  try {
    const roll = await opsClient().dairy.listMemberships({ box: 'mcc', mccId: ctx.centre.id, code: built.code, limit: ROLL_PAGE_SIZE });
    const m = roll.items.find((x) => x.id === built.value.membershipId && x.memberCode === built.code && x.mccId === ctx.centre?.id);
    onRoll = !!m; milkType = m?.defaultAnimalType ?? null;
  } catch { return <section data-kv-page="pos_quality"><CounterStateView t={t} state="error" page={`${POS.quality}?${pourQuery(built.value, ctx.centre.id, built.code)}`} /></section>; }
  if (!onRoll) return <Ops3Chain t={t} chain="pos_act" state="failure" back={collect} backKey="ops3.pos.backToForm"><PourFailure t={t} reason="member" /></Ops3Chain>;
  return <PosQualityView t={t} lang={lang} centre={ctx.centre} pour={built.value} memberCode={built.code} milkType={milkType} idemKey={randomUUID()} action={recordPourAction} back={collect} />;
}
