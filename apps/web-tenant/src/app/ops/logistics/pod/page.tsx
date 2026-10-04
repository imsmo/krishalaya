// apps/web-tenant/src/app/ops/logistics/pod/page.tsx · W237 · POD review queue — PC-56 TENANT-SW-a.
//
// Tiles from real rows (awaiting · auto-cleared today · flagged · escrow released today from the ledger). The queue is oldest first; each
// row shows the 2-hour timer (an unflagged POD clears itself when it runs out — the job, not this page). "Take next" claims the oldest
// awaiting review nobody holds, skipping shipments the viewer drove or dispatched (the database refuses those reviewers anyway).
// A flagged POD HOLDS the order's settlement until it is approved, or rejected by a second person (which opens a qty_mismatch dispute).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { PodBoard, PodReview } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { DataTable } from '../../../../components/DataTable';
import { POD_HREF, codeKey, pageState, podTimerLeftMinutes } from '../../../../features/swa/console';
import { podTakeNextAction } from './actions';
import { AsOf } from '../../../../components/AsOf';
import { asOfLabels } from '../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swa.pod.title'), robots: { index: false, follow: false } }; }
const STATUSES = ['awaiting', 'flagged', 'auto_cleared', 'approved', 'rejected'] as const;
type Status = (typeof STATUSES)[number];

export default async function PodQueuePage({ searchParams }: { searchParams: { status?: string; cursor?: string; none?: string; error?: string } }) {
  await requireSession(POD_HREF);
  const t = getTranslator(); const lang = getLang();
  const status: Status | undefined = (STATUSES as readonly string[]).includes(searchParams.status ?? '') ? (searchParams.status as Status) : undefined;
  let board: (PodBoard & { nextCursor: string | null }) | null = null; let state: string | null = null;
  try { board = await tenantClient().shipments.podBoard({ status: status ?? 'awaiting', limit: 50, cursor: searchParams.cursor }); }
  catch (e) { state = pageState(e instanceof SdkError ? e.status : undefined, true); }
  const timer = (r: PodReview) => {
    if (r.status !== 'awaiting') return t.t('common.dash');
    const m = podTimerLeftMinutes(r.timerDueAt);
    return m === null ? t.t('common.dash') : m === 0 ? t.t('swa.pod.timer.due') : t.t('swa.pod.timer.left', { h: String(Math.floor(m / 60)), m: String(m % 60) });
  };
  const errCode = /^[A-Za-z0-9_]{2,60}$/.test(searchParams.error ?? '') ? searchParams.error! : null;

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swa.pod.title')}><span>{t.t('swa.ops')}</span> / <span>{t.t('swa.logistics')}</span> / <span aria-current="page">{t.t('swa.pod.title')}</span></nav>
      <div className="kv-page-head">
        <h1>{t.t('swa.pod.title')}</h1>
        {/* PC-56 TENANT-SW-f · W318 §1: when this page's data was read — absolute IST + relative; stale past 1 h */}
        <AsOf at={new Date().toISOString()} labels={asOfLabels(t)} />
        {board?.enabled && (
          <form action={podTakeNextAction}><button type="submit" className="kv-btn kv-btn--primary">{t.t('swa.pod.takeNext')}</button></form>
        )}
      </div>
      <p className="kv-field__hint">{t.t('swa.pod.subtitle')}</p>
      {searchParams.none === '1' && <p className="kv-notice" role="status">{t.t('swa.pod.nothingToTake')}</p>}
      {errCode && <p className="kv-error" role="alert">{t.t(codeKey(errCode))} <code>{errCode}</code></p>}
      {state || !board ? (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`swa.pod.state.${state ?? 'error'}.title`)}</strong><p>{t.t(`swa.pod.state.${state ?? 'error'}.body`)}</p>
          {(state ?? 'error') === 'error' && <p><Link href={POD_HREF} className="kv-btn--link">{t.t('swa.retry')}</Link></p>}
        </div>
      ) : (
        <>
          {!board.enabled && <div className="kv-card kv-card--notice" role="status"><strong>{t.t('swa.pod.off.title')}</strong><p>{t.t('swa.pod.off.body')}</p></div>}
          <div className="kv-tiles">
            <div className="kv-tile"><span className="kv-tile__label">{t.t('swa.pod.tile.awaiting')}</span><strong className="kv-tile__value">{board.tiles.awaiting}</strong></div>
            <div className="kv-tile"><span className="kv-tile__label">{t.t('swa.pod.tile.autoClearedToday')}</span><strong className="kv-tile__value">{board.tiles.autoClearedToday}</strong></div>
            <div className="kv-tile"><span className="kv-tile__label">{t.t('swa.pod.tile.flagged')}</span><strong className="kv-tile__value">{board.tiles.flagged}</strong></div>
            <div className="kv-tile"><span className="kv-tile__label">{t.t('swa.pod.tile.escrowReleasedToday')}</span><strong className="kv-tile__value">{formatMoneyMinor(board.tiles.escrowReleasedTodayMinor, 'INR', lang)}</strong></div>
          </div>
          <nav className="kv-tabs" aria-label={t.t('swa.pod.filter')}>
            {STATUSES.map((s) => (
              <Link key={s} href={`${POD_HREF}?status=${s}`} className={`kv-tab${(status ?? 'awaiting') === s ? ' kv-tab--active' : ''}`} aria-current={(status ?? 'awaiting') === s ? 'page' : undefined}>{t.t(`swa.pod.status.${s}`)}</Link>
            ))}
          </nav>
          <DataTable rows={board.items} empty={t.t('swa.pod.empty')} columns={[
            { header: t.t('swa.pod.col.shipment'), cell: (r) => <Link href={`${POD_HREF}/${r.id}`} className="kv-btn--link">{r.shipmentId.slice(0, 8)}…</Link> },
            { header: t.t('swa.pod.col.order'), cell: (r) => <Link href={`/orders/${r.orderId}`} className="kv-btn--link">{r.orderId.slice(0, 8)}…</Link> },
            { header: t.t('swa.pod.col.delivered'), cell: (r) => formatDate(r.deliveredAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) },
            { header: t.t('swa.pod.col.evidence'), cell: (r) => `${t.t(r.podMediaId ? 'swa.pod.photo.yes' : 'swa.pod.photo.no')} · ${t.t(r.otpVerified ? 'swa.pod.otp.yes' : 'swa.pod.otp.no')}` },
            { header: t.t('swa.pod.col.timer'), cell: timer },
            { header: t.t('swa.pod.col.status'), cell: (r) => t.t(`swa.pod.status.${r.status}`) },
            { header: t.t('swa.pod.col.reviewer'), cell: (r) => (r.youDroveOrDispatched ? t.t('swa.pod.youDrove') : r.reviewerUserId ? `${r.reviewerUserId.slice(0, 8)}…` : t.t('common.dash')) },
          ]} />
          {board.nextCursor && <p><Link href={`${POD_HREF}?${new URLSearchParams({ ...(status ? { status } : {}), cursor: board.nextCursor }).toString()}`} className="kv-btn--link">{t.t('swa.next')}</Link></p>}
          <p className="kv-field__hint">{t.t('swa.pod.holdLaw')}</p>
          <p className="kv-field__hint">{t.t('swa.pod.weighbridge')}</p>
        </>
      )}
    </section>
  );
}
