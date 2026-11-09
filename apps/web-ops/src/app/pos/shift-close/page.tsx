// apps/web-ops/src/app/pos/shift-close/page.tsx · PC-56 OPS-3a · W365 (canon `pos/shift-close`) — THE SHIFT'S TOTALS, a READ (founder Q9-A). The centre in
// your custody and the organisation's today; the day sheet per shift (server sums, labelled, split by hold state); the cooler's last STATED level
// and its latest reading with their times (`GET /v1/dairy/bmc/monitor`, filtered to this centre). No variance is worked out; "Close shift" is
// refused by name (no shift record exists); no cooler page is linked (none is built). Retry (FM:43) re-reads — PARITY-DECOR. No input.
import type { Metadata } from 'next';
import { SdkError, type DairyBmcTile, type DairyDaySummaryRow } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { PosShiftView, type CoolerState } from '../../../components/ops3/CounterViews';
import { POS, parseId } from '../../../features/ops3/counter';
import { loadCounter } from '../../../features/ops3/counter-load';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('ops3.pos.shiftPage.title'), robots: { index: false, follow: false } }; }

export default async function PosShiftPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession(POS.shift);
  const t = getTranslator(); const lang = getLang();
  const ctx = await loadCounter(parseId(searchParams?.mcc));
  let rows: DairyDaySummaryRow[] | null = null; let cooler: CoolerState = 'none'; let tiles: DairyBmcTile[] = [];
  if (ctx.centre && ctx.today) {
    const c = opsClient();
    try { rows = await c.dairy.mccDaySummary(ctx.centre.id, ctx.today); } catch { rows = null; }
    try { tiles = (await c.dairy.bmcMonitor({})).units; cooler = tiles.some((x) => x.mccId === ctx.centre?.id) ? 'ok' : 'none'; }
    catch (e) { cooler = e instanceof SdkError && e.status === 404 ? 'off' : 'error'; }
  }
  return <PosShiftView t={t} lang={lang} state={ctx.state} centre={ctx.centre} centres={ctx.centres} today={ctx.today} rows={rows} cooler={cooler} tiles={tiles} />;
}
