// apps/web-tenant/src/app/comms/page.tsx · W429 — THE BROADCAST PLANE: the cooperative's announcements, told the truth.
// PC-56 TENANT-8e.
//
// [PC-27 said here: *"member BROADCASTS (WhatsApp/SMS/push fan-out handled server-side by the communication module +
// whatsapp-bot)"*. Every part of that was false (survey F-2): `apps/whatsapp-bot` exits 1, no WhatsApp provider exists,
// SMS was never a channel of the broadcast event, and the push leg had no template — every one recorded `no_template`
// while the broadcast was marked `sent` with `sent_count` = the recipient count.]
//
// WHAT THIS PAGE IS: an IN-APP ANNOUNCEMENT to the cooperative's active members (or one registered role) — the
// `tenant.broadcast` event, delivered as an in-app item and, where the member has a device, a push (held inside the
// member's quiet hours, 8b). The history's result column is the DELIVERY LOG's (in-app items · push sent · held · switched
// off · failed with its reason), never a copy. W429's WhatsApp half — the opt-in maths, the marketing templates, the
// WhatsApp result — is refused by name (`/channels/whatsapp/broadcast`), with what exists instead.
//
// STATES: data · empty (no broadcast yet) · couldn't load + Retry (a page load) · restricted (no read verb) · flagged off ·
// loading (`loading.tsx`). Sending needs `notification.broadcast.send` (tenant_admin); without it the history is read-only
// and the page says so (the canon's own restricted state). No client JS: chips and paging are GET links.
import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { BroadcastPage } from '@krishalaya/sdk-js';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import {
  BROADCAST_FORM_HREF, HISTORY_STATUSES, WA_BROADCAST_HREF, WA_HUB_HREF, broadcastHref, historyHref, isHistoryStatus, resultParts, retryAsDraftHref,
  statusKey, statusTone, transportState,
} from '../../features/comms/broadcasts';
import { enqueueBroadcastsExportAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('bc.title'), robots: { index: false, follow: false } };
}

export default async function CommsPage({ searchParams }: { searchParams: { status?: string; cursor?: string; error?: string } }) {
  await requireSession('/comms');
  const t = getTranslator();
  const lang = getLang();
  const status = isHistoryStatus(searchParams.status) ? searchParams.status : undefined;
  let page: BroadcastPage | null = null;
  let state: ReturnType<typeof transportState> | 'data' = 'data';
  try { page = await tenantClient().notifications.broadcasts({ status, cursor: searchParams.cursor, limit: 25 }); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = transportState(err?.code, err?.status); }
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: page?.zone ?? undefined }) : null);
  const total = page ? Object.values(page.byStatus).reduce((a, b) => a + b, 0) : 0;

  return (
    <section>
      <h1>{t.t('bc.title')}</h1>
      <p className="kv-field__hint">{t.t('bc.lead')}</p>
      <div className="kv-card kv-card--notice" role="note">
        <p>{t.t('bc.notWhatsApp')}</p>
        <p><Link href={WA_BROADCAST_HREF} className="kv-btn--link">{t.t('bc.whyNotWhatsApp')}</Link>{' · '}<Link href={WA_HUB_HREF} className="kv-btn--link">{t.t('nav.whatsapp')}</Link></p>
      </div>
      {searchParams.error && <div className="kv-error" role="alert"><p>{t.t('bc.export.failed')} <code>{searchParams.error}</code></p></div>}

      {state !== 'data' && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(`bc.state.${state}`)}</p>
          {state === 'error' && <p><Link href={historyHref(status)} className="kv-btn--link">{t.t('bc.retry')}</Link> <span className="kv-field__hint">{t.t('bc.retryIsReload')}</span></p>}
        </div>
      )}

      {page && (
        <>
          <div className="kv-card">
            {page.canSend
              ? <p><Link href={BROADCAST_FORM_HREF} className="kv-btn kv-btn--primary">{t.t('bc.new')}</Link> <span className="kv-field__hint">{t.t('bc.newHint')}</span></p>
              : <p className="kv-field__hint" role="status">{t.t('bc.readOnly')}</p>}
            <form action={enqueueBroadcastsExportAction} className="kv-inline-form">
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--secondary">{t.t('bc.export.button')}</button>
              <span className="kv-field__hint"> {t.t('bc.export.hint')}</span>
            </form>
          </div>

          <nav aria-label={t.t('bc.chips')} className="kv-chips">
            <Link href={historyHref(null)} className={!status ? 'kv-chip kv-chip--on' : 'kv-chip'} aria-current={!status ? 'page' : undefined}>{t.t('bc.all')} ({formatNumber(total, lang)})</Link>
            {HISTORY_STATUSES.map((s) => (
              <Link key={s} href={historyHref(s)} className={status === s ? 'kv-chip kv-chip--on' : 'kv-chip'} aria-current={status === s ? 'page' : undefined}>
                {t.t(statusKey(s))} ({formatNumber(page!.byStatus[s] ?? 0, lang)})
              </Link>
            ))}
          </nav>

          {page.items.length === 0 ? (
            <div className="kv-card kv-card--notice" role="status">
              <p>{t.t(status ? 'bc.empty.filtered' : 'bc.empty')}</p>
              {status && <p><Link href={historyHref(null)} className="kv-btn--link">{t.t('bc.clearFilter')}</Link></p>}
            </div>
          ) : (
            <table className="kv-table">
              <caption className="kv-sr-only">{t.t('bc.history')}</caption>
              <thead><tr><th scope="col">{t.t('bc.col.when')}</th><th scope="col">{t.t('bc.col.title')}</th><th scope="col">{t.t('bc.col.audience')}</th><th scope="col">{t.t('bc.col.status')}</th><th scope="col">{t.t('bc.col.result')}</th></tr></thead>
              <tbody>
                {page.items.map((b) => {
                  const parts = resultParts(b.counts);
                  const retry = retryAsDraftHref(b);
                  return (
                    <tr key={b.id}>
                      <td>
                        {b.status === 'scheduled' && b.scheduledLocal ? <>{t.t('bc.scheduledFor')} {when(b.scheduledAt)}</> : when(b.fannedOutAt ?? b.sendRequestedAt ?? b.createdAt) ?? t.t('common.dash')}
                      </td>
                      <td><Link href={broadcastHref(b.id)}>{b.title}</Link></td>
                      <td>{b.audienceRoleCode ? <code>{b.audienceRoleCode}</code> : t.t('bc.audience.everyone')}{b.sendRequestedAt && <span className="kv-field__hint"> · {t.t('bc.eligibleAtSend', { n: formatNumber(b.eligibleCount, lang) })}</span>}</td>
                      <td><span className={`kv-badge kv-badge--${statusTone(b.status)}`}>{t.t(statusKey(b.status))}</span></td>
                      <td>
                        {parts ? parts.map((p, i) => <span key={p.key}>{i > 0 ? ' · ' : ''}{t.t(p.key, { n: formatNumber(p.n, lang) })}</span>)
                          : b.status === 'failed' ? t.t(`bc.failure.${b.failureReason ?? 'unrecorded'}`) : <span className="kv-field__hint">{t.t('bc.result.none')}</span>}
                        {retry && <> {' · '}<Link href={retry} className="kv-btn--link">{t.t('bc.retryAsDraft')}</Link></>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {page.nextCursor && <p><Link href={historyHref(status, page.nextCursor)} className="kv-btn--link">{t.t('bc.next')}</Link></p>}
          <p className="kv-field__hint">{t.t('bc.countsFromLog')}</p>
        </>
      )}
    </section>
  );
}
