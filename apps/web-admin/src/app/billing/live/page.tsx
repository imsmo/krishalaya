// apps/web-admin/src/app/billing/live/page.tsx · the LIVE money screen (PC-56 ADMIN-1e, canon W112 — closes
// ADMIN-1-Q8). Server component for the hourly chart; the feed itself is the one client component in this console,
// because a live stream needs a connection a server render cannot hold.
//
// ADMIN-1d refused to build this as a polling ticker, and the reason is worth repeating where the screen lives: a
// browser that re-reads a rollup on a timer LOSES events (two payments between polls collapse into one changed number)
// and cannot tell "quiet" from "broken". This screen is a cursor stream with heartbeats, so no event is missed and the
// header says when it has gone stale.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { barPct } from '../../../features/billing/reporting';
import { MoneyTicker } from '../../../components/MoneyTicker';
import { EmptyState } from '@krishalaya/ui';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('live.title'), robots: { index: false, follow: false } };
}

interface TodayView {
  currency: string; tzOffsetMinutes: number;
  hours: Array<{ hour: string; receivedMinor: string; issuedMinor: string }>;
}

export default async function LiveMoneyPage() {
  requireAdmin();
  const t = getTranslator();

  let today: TodayView | null = null; let notice: string | undefined;
  try { today = (await adminGet<TodayView>('billing/today-by-hour', { currency: 'INR', tzOffsetMinutes: 330 })).data ?? null; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const cur = today?.currency ?? 'INR';
  const hours = today?.hours ?? [];
  // the tallest bar for scaling; barPct never divides by zero
  const max = hours.reduce((m, h) => {
    const v = /^\d+$/.test(h.receivedMinor) ? BigInt(h.receivedMinor) : 0n;
    return v > m ? v : m;
  }, 0n);

  return (
    <section>
      <p className="kv-backlink"><Link href="/billing">{t.t('billing.back')}</Link></p>
      <h1>{t.t('live.title')}</h1>
      <p className="kv-field__hint">{t.t('live.hint')}</p>

      {/* Today, by hour — a plain server read. The bucket boundaries are computed in SQL so every viewer sees the same
          hours regardless of their machine's clock. */}
      <h2>{t.t('live.todayTitle')}</h2>
      {notice ? <p className="kv-error" role="alert">{notice}</p> : hours.length === 0 ? (
        <EmptyState title={t.t('live.noToday')} />
      ) : (
        <table className="kv-table">
          <thead><tr>
            <th scope="col">{t.t('live.hour')}</th>
            <th scope="col">{t.t('live.received')}</th>
            <th scope="col">{t.t('live.issued')}</th>
          </tr></thead>
          <tbody>
            {hours.map((h) => (
              <tr key={h.hour}>
                <td>{h.hour}</td>
                <td>
                  {formatMoneyMinor(h.receivedMinor, cur)}
                  <span className="kv-bar" style={{ width: `${barPct(h.receivedMinor, max)}%` }} aria-hidden="true" />
                </td>
                <td>{formatMoneyMinor(h.issuedMinor, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="kv-field__hint">{t.t('live.todayNote')}</p>

      {/* The live feed. Labels are passed in because the ticker is a client component and the catalogue is server-only. */}
      <MoneyTicker labels={{
        live: t.t('live.state.live'),
        connecting: t.t('live.state.connecting'),
        stale: t.t('live.state.stale'),
        closed: t.t('live.state.closed'),
        sessionTotal: t.t('live.sessionTotal'),
        empty: t.t('live.feedEmpty'),
        payment: t.t('live.payment'),
        invoiceIssued: t.t('live.invoiceIssued'),
        reconnect: t.t('live.reconnect'),
        staleHint: t.t('live.staleHint'),
      }} />

      <p className="kv-field__hint">{t.t('live.footerNote')}</p>
    </section>
  );
}
