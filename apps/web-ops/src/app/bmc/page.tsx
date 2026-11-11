// apps/web-ops/src/app/bmc/page.tsx · PC-56 OPS-3b · W366 (canon `bmc`) — THE TANK: A READ of the cooler(s) at the centres in your custody, and the
// MANUAL READING, REAL (founder Q12-A, Q13-A, Q10-A, Q14-A, 2026-11-08). Two reads, both EXISTING: `GET /v1/dairy/mccs/mine` (the centres in the
// signed-in person's OPEN custody) and `GET /v1/dairy/bmc/monitor` (every active cooler of the organisation — the page keeps those at the custody
// centres; a person who holds no centre is shown them all, and told so). The series is asked for BY the shown cooler's id, so the monitor never
// picks another centre's tank. One write, through the server action: `POST /v1/dairy/bmc/readings {unitId,tempC}`.
// The chains are query states, checked FIRST: `?act=confirm|success|failure` is W3286–W3288 (dispatch refused — DECOR; Retry a re-read — PARITY-
// DECOR) and reads nothing; `?form=failure|success` (W3285 / W3284) read nothing but this browser's kept answer; `?form=review|error` (W3283 /
// W3282) read the cooler they are for.
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { SdkError, type DairyBmcMonitor, type DairyMcc } from '@krishalaya/sdk-js';
import { requireSession } from '../../lib/session';
import { opsClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { BmcView, FormErrorReason, ManualReadingForm, ReadingFailure, ReadingRecorded, ReadingReview } from '../../components/ops3/BmcViews';
import { Ops3Chain } from '../../components/ops3/Ops3Chain';
import { chain3State } from '../../features/ops3/refusals';
import {
  BMC, READING_COOKIE, SERIES_HOURS, bmcState, coolersFor, decodeReading, parseFormError, parseReadingReason, parseTemp, parseUnit, pickCooler, typedTemp,
} from '../../features/ops3/bmc';
import { recordBmcReadingAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('ops3.bmc.title'), robots: { index: false, follow: false } }; }

type SP = Record<string, string | string[] | undefined>;
const status = (e: unknown): number | 'failed' => (e instanceof SdkError ? e.status : 'failed');

export default async function BmcPage({ searchParams }: { searchParams?: SP }) {
  await requireSession(BMC);
  const t = getTranslator(); const lang = getLang();
  const unit = parseUnit(searchParams?.unit);
  const back = unit ? `${BMC}?unit=${unit}` : BMC;
  const act = chain3State('bmc_act', searchParams);
  if (act) return <Ops3Chain t={t} chain="bmc_act" state={act} backKey="ops3.bmc.back" />;
  const form = chain3State('bmc_form', searchParams);
  if (form === 'failure') {
    return <Ops3Chain t={t} chain="bmc_form" state="failure" back={back} backKey="ops3.bmc.back"><ReadingFailure t={t} reason={parseReadingReason(searchParams?.reason)} /></Ops3Chain>;
  }
  if (form === 'success') {
    const reading = decodeReading(cookies().get(READING_COOKIE)?.value);
    return <Ops3Chain t={t} chain="bmc_form" state="success" back={reading ? `${BMC}?unit=${reading.unitId}` : back} backKey="ops3.bmc.back"><ReadingRecorded t={t} reading={reading} /></Ops3Chain>;
  }

  const c = opsClient();
  let mine: 'ok' | number | 'failed' = 'ok'; let mon: 'ok' | number | 'failed' = 'ok';
  let centres: DairyMcc[] = []; let monitor: DairyBmcMonitor | null = null;
  try { centres = (await c.dairy.counterCentres()).centres; } catch (e) { mine = status(e); }
  if (mine === 'ok') { try { monitor = await c.dairy.bmcMonitor({ hours: SERIES_HOURS }); } catch (e) { mon = status(e); } }
  const state = bmcState(mine, mine === 'ok' ? mon : 'ok');
  const { scope, tiles } = coolersFor(monitor?.units ?? [], centres);
  const cooler = state === 'ok' ? pickCooler(tiles, unit, parseUnit(searchParams?.mcc)) : null;

  if (form === 'review' || form === 'error') {
    if (state !== 'ok') return <BmcView t={t} lang={lang} state={state} scope={scope} centres={centres} tiles={[]} cooler={null} points={null} />;
    const named = unit ? tiles.find((x) => x.unitId === unit) ?? null : null;
    const typed = typedTemp(searchParams?.[form === 'review' ? 'tempC' : 'value']);
    const tempC = parseTemp(typed);
    const error = !named ? 'unit' : form === 'error' ? parseFormError(searchParams?.reason) : !tempC ? 'temp' : null;
    if (error || !named || !tempC) {
      return (
        <Ops3Chain t={t} chain="bmc_form" state="error" back={back} backKey="ops3.bmc.back">
          <FormErrorReason t={t} error={error ?? 'temp'} />
          {named ? <ManualReadingForm t={t} tile={named} value={typed} /> : null}
        </Ops3Chain>
      );
    }
    return <Ops3Chain t={t} chain="bmc_form" state="review" back={back} backKey="ops3.bmc.back"><ReadingReview t={t} lang={lang} tile={named} tempC={tempC} action={recordBmcReadingAction} /></Ops3Chain>;
  }

  // the series of the SHOWN cooler, asked for by its id (the first read's focus may be another centre's tank)
  let points: NonNullable<DairyBmcMonitor['focus']>['points'] | null = null;
  if (cooler && monitor) {
    if (monitor.focus?.unitId === cooler.unitId) points = monitor.focus.points;
    else { try { const f = (await c.dairy.bmcMonitor({ unitId: cooler.unitId, hours: SERIES_HOURS })).focus; points = f?.unitId === cooler.unitId ? f.points : null; } catch { points = null; } }
  }
  return <BmcView t={t} lang={lang} state={state} scope={scope} centres={centres} tiles={tiles} cooler={cooler} points={points} />;
}
