// apps/web-ops/src/app/warehouse/dashboard/page.tsx · PC-56 OPS-2a · W370 (canon `warehouse/dashboard`) — WAREHOUSE DASHBOARD, a READ of the bookings
// at the warehouses the signed-in person OPERATES (founder Q9-A, Q11-A, Q12-A, Q14-A, 2026-11-06). `/warehouse` answers a 307 here (next.config.js).
// The one read is `readDashboard` (features/ops2/intake.ts): `warehouses({ box: 'mine' })`, then each one's `bookings({ box: 'warehouse', warehouseId })`
// and each commodity's own name. `?form=` is the W3362–W3365 chain (DECOR — "New booking", Q12-A) and `?act=` the W3366–W3368 chain (PARITY-DECOR —
// "Retry" re-reads this page), both checked FIRST, before any read; their Back returns HERE.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { WhDashboardView } from '../../../components/ops2/IntakeViews';
import { Ops2Chain } from '../../../components/ops2/Ops2Chain';
import { chain2State } from '../../../features/ops2/refusals';
import { DASHBOARD_PAGE, parseCursor, parseStatus, parseWarehouse, readDashboard } from '../../../features/ops2/intake';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops2.whDash.title'), robots: { index: false, follow: false } };
}

export default async function WarehouseDashboardPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession('/warehouse/dashboard');
  const t = getTranslator(); const lang = getLang();
  const form = chain2State('wh_form', searchParams);
  if (form) return <Ops2Chain t={t} chain="wh_form" state={form} />;
  const act = chain2State('wh_act', searchParams);
  if (act) return (
    <Ops2Chain t={t} chain="wh_act" state={act}>
      {act === 'confirm' ? <p className="kv-pager"><Link className="kv-btn" href={DASHBOARD_PAGE} data-kv-parity="reread">{t.t('ops2.chain.whAct.reread')}</Link></p> : null}
    </Ops2Chain>
  );
  const status = parseStatus(searchParams?.status);
  const c = opsClient();
  const read = await readDashboard({ warehouses: (p) => c.warehousing.warehouses(p), bookings: (p) => c.warehousing.bookings(p), product: (id) => c.catalogue.product(id) },
    { status, warehouse: parseWarehouse(searchParams?.warehouse), cursor: parseCursor(searchParams?.cursor) });
  return <WhDashboardView t={t} lang={lang} state={read.state} groups={read.groups} status={status} />;
}
