// apps/web-ops/src/app/pos/home/page.tsx · PC-56 OPS-3a · W360 (canon `pos/home`) — THE COUNTER'S DAY: a READ (founder Q9-A, Q10-A, Q14-A). The centre in
// your custody and the organisation's today (`GET /v1/dairy/mccs/mine`), then its day sheet per shift (`GET /v1/dairy/d2c/mccs/:mccId/day-summary`
// for that day): pours, kg, the priced sum labelled, the server's split by hold state, the flagged count; the recorded shift hours. Nothing is
// computed, recorded or changed here; no input.
import type { Metadata } from 'next';
import type { DairyDaySummaryRow } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { PosHomeView } from '../../../components/ops3/CounterViews';
import { POS, parseId } from '../../../features/ops3/counter';
import { loadCounter } from '../../../features/ops3/counter-load';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('ops3.pos.home.title'), robots: { index: false, follow: false } }; }

export default async function PosHomePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession(POS.home);
  const t = getTranslator(); const lang = getLang();
  const ctx = await loadCounter(parseId(searchParams?.mcc));
  let rows: DairyDaySummaryRow[] | null = null;
  if (ctx.centre && ctx.today) { try { rows = await opsClient().dairy.mccDaySummary(ctx.centre.id, ctx.today); } catch { rows = null; } }
  return <PosHomeView t={t} lang={lang} state={ctx.state} centre={ctx.centre} centres={ctx.centres} today={ctx.today} rows={rows} />;
}
