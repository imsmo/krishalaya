// apps/web-tenant/src/app/ops/logistics/cod/page.tsx · W243 · COD as a ledger fact — PC-56 TENANT-SW-a.
//
// Every tile is computed from the ledger (cash_in_hand / cash_clearing legs), never typed: collected today, deposited today, in riders'
// hands, unreconciled > 24 h, shortfalls open. Riders over the cap are marked (the cap is the platform's / the tenant's setting; the API
// refuses a delivery that would take a rider past it). The cash day: open it, then a DIFFERENT person closes it — every remittance of the
// day reconciled or carried forward with a reason. Shortfalls are recorded against the order and collected with a deposit reference.
// The remittance acts themselves (open / deposit / reconcile / cancel) stay on the worksheet at /cod.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { CodBoard, CodShortfall } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { DataTable } from '../../../../components/DataTable';
import { COD_HREF, COD_WORKSHEET_HREF, pageState } from '../../../../features/swa/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swa.cod.title'), robots: { index: false, follow: false } }; }
const TILES = ['collectedTodayMinor', 'depositedTodayMinor', 'inRiderHandsMinor', 'unreconciledOver24hMinor', 'shortfallOpenMinor'] as const;

export default async function CodLedgerPage({ searchParams }: { searchParams: { cursor?: string } }) {
  await requireSession(COD_HREF);
  const t = getTranslator(); const lang = getLang();
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  let board: CodBoard | null = null; let state: string | null = null;
  try { board = await tenantClient().shipments.codBoard(); }
  catch (e) { state = pageState(e instanceof SdkError ? e.status : undefined, true); }
  let shortfalls: CodShortfall[] = []; let next: string | null = null; let sfFailed = false;
  if (board) {
    try { const p = await tenantClient().shipments.codShortfalls({ status: 'open', limit: 50, cursor: searchParams.cursor }); shortfalls = p.items; next = p.nextCursor; }
    catch { sfFailed = true; }
  }
  const today = board?.days.find((d) => d.businessDate === board!.today) ?? null;
  const short = (id: string | null) => (id ? `${id.slice(0, 8)}…` : t.t('common.dash'));

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swa.cod.title')}><span>{t.t('swa.ops')}</span> / <span>{t.t('swa.logistics')}</span> / <span aria-current="page">{t.t('swa.cod.title')}</span></nav>
      <div className="kv-page-head">
        <h1>{t.t('swa.cod.title')}</h1>
        <Link href={COD_WORKSHEET_HREF} className="kv-btn--link">{t.t('swa.cod.worksheet')}</Link>
      </div>
      <p className="kv-field__hint">{t.t('swa.cod.subtitle')}</p>
      {state || !board ? (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`swa.cod.state.${state ?? 'error'}.title`)}</strong><p>{t.t(`swa.cod.state.${state ?? 'error'}.body`)}</p>
          {(state ?? 'error') === 'error' && <p><Link href={COD_HREF} className="kv-btn--link">{t.t('swa.retry')}</Link></p>}
        </div>
      ) : (
        <>
          {!board.enabled && <div className="kv-card kv-card--notice" role="status"><strong>{t.t('swa.cod.off.title')}</strong><p>{t.t('swa.cod.off.body')}</p></div>}
          <div className="kv-tiles">
            {TILES.map((k) => (
              <div key={k} className="kv-tile"><span className="kv-tile__label">{t.t(`swa.cod.tile.${k}`)}</span><strong className="kv-tile__value">{money(board!.tiles[k])}</strong></div>
            ))}
          </div>
          <p className="kv-field__hint">{t.t('swa.cod.fromLedger')}</p>

          <h2>{t.t('swa.cod.riders')}</h2>
          <p className="kv-field__hint">{t.t('swa.cod.cap', { cap: money(board.riderCapMinor) })}</p>
          <DataTable rows={board.riders} empty={t.t('swa.cod.noRiders')} columns={[
            { header: t.t('swa.cod.col.rider'), cell: (r) => short(r.riderUserId) },
            { header: t.t('swa.cod.col.holding'), cell: (r) => money(r.holdingMinor) },
            { header: t.t('swa.cod.col.cap'), cell: (r) => (r.overCap ? <strong className="kv-notice">{t.t('swa.cod.overCap')}</strong> : t.t('swa.cod.underCap')) },
          ]} />

          <h2>{t.t('swa.cod.day.title')}</h2>
          <div className="kv-card">
            {!today ? (
              <>
                <p>{t.t('swa.cod.day.notOpen', { date: board.today })}</p>
                {board.enabled && <p><Link href={`${COD_HREF}/act?act=openDay`} className="kv-btn kv-btn--primary">{t.t('swa.cod.act.openDay')}</Link></p>}
              </>
            ) : today.status === 'open' ? (
              <>
                <p>{t.t('swa.cod.day.open', { date: today.businessDate, at: formatDate(today.openedAt, lang, { timeStyle: 'short' }), by: short(today.openedBy) })}</p>
                <p className="kv-field__hint">{t.t('swa.cod.day.checkerRule')}</p>
                {board.enabled && <p><Link href={`${COD_HREF}/act?act=closeDay&date=${today.businessDate}`} className="kv-btn kv-btn--primary">{t.t('swa.cod.act.closeDay')}</Link></p>}
              </>
            ) : (
              <p>{t.t('swa.cod.day.closed', { date: today.businessDate, by: short(today.closedBy) })}</p>
            )}
          </div>
          <DataTable rows={board.days} empty={t.t('swa.cod.day.none')} columns={[
            { header: t.t('swa.cod.col.date'), cell: (d) => d.businessDate },
            { header: t.t('swa.cod.col.status'), cell: (d) => t.t(`swa.cod.day.status.${d.status}`) },
            { header: t.t('swa.cod.col.openedBy'), cell: (d) => short(d.openedBy) },
            { header: t.t('swa.cod.col.closedBy'), cell: (d) => short(d.closedBy) },
            { header: t.t('swa.cod.col.note'), cell: (d) => d.closeNote ?? t.t('common.dash') },
          ]} />

          <h2>{t.t('swa.cod.sf.title')}</h2>
          <p className="kv-field__hint">{t.t('swa.cod.sf.law')}</p>
          {sfFailed ? <p className="kv-error" role="alert">{t.t('swa.cod.state.error.body')}</p> : (
            <DataTable rows={shortfalls} empty={t.t('swa.cod.sf.none')} columns={[
              { header: t.t('swa.cod.col.order'), cell: (s) => <Link href={`/orders/${s.orderId}`} className="kv-btn--link">{short(s.orderId)}</Link> },
              { header: t.t('swa.cod.col.amount'), cell: (s) => money(s.amountMinor) },
              { header: t.t('swa.cod.col.reason'), cell: (s) => s.reason },
              { header: t.t('swa.cod.col.recorded'), cell: (s) => formatDate(s.createdAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) },
              { header: '', cell: (s) => (board!.enabled ? <Link href={`${COD_HREF}/act?act=collectShortfall&id=${s.id}`} className="kv-btn--link">{t.t('swa.cod.act.collectShortfall')}</Link> : t.t('common.dash')) },
            ]} />
          )}
          {next && <p><Link href={`${COD_HREF}?cursor=${encodeURIComponent(next)}`} className="kv-btn--link">{t.t('swa.next')}</Link></p>}
          <p className="kv-field__hint">{t.t('swa.cod.writeOff')}</p>
        </>
      )}
    </section>
  );
}
