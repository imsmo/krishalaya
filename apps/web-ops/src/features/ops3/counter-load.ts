// apps/web-ops/src/features/ops3/counter-load.ts · PC-56 OPS-3a — the counter pages' one shared READ (server-only): the centres in the signed-in
// person's OPEN custody and the organisation's today (`GET /v1/dairy/mccs/mine`), then the centre the page works for (`?mcc=` among them, or the
// only one). No write, no money.
import 'server-only';
import { SdkError, type DairyMcc } from '@krishalaya/sdk-js';
import { opsClient } from '../../lib/api-client';
import { counterState, pickCentre, type CounterState } from './counter';

export interface CounterContext { state: CounterState; today: string | null; centres: DairyMcc[]; centre: DairyMcc | null }
export async function loadCounter(mcc: string | null): Promise<CounterContext> {
  let status: 'ok' | number | 'failed' = 'ok'; let today: string | null = null; let centres: DairyMcc[] = [];
  try { const mine = await opsClient().dairy.counterCentres(); today = mine.today; centres = mine.centres; }
  catch (e) { status = e instanceof SdkError ? e.status : 'failed'; }
  const state = counterState(status, centres.length);
  return { state, today, centres, centre: state === 'ok' ? pickCentre(centres, mcc) : null };
}
