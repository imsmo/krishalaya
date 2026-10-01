// apps/web-tenant/src/app/comms/[id]/page.tsx · W429's receipt — one broadcast and WHAT THE DELIVERY LOG SAYS IT DID.
// PC-56 TENANT-8e.
//
// The canon's result column — *"1,384 delivered · 3 failed (number no longer on WhatsApp)"* — is, on this platform, the log
// of an in-app announcement: members holding the item (sent · read), and the push leg by its own rows — sent, HELD inside
// a member's quiet hours (released when the window ends, 8b), switched off by the member, failed with its code
// (`no_device` …). Every figure is a `notifications` row joined through `tenant_broadcast_recipients.fanout_key`; none is
// a copy the fan-out wrote (F-2: `markSent(total, total)` is gone). A broadcast that never fanned out has no result — not
// zero. The acts are offered where the state allows them (send a draft · cancel a draft or a scheduled one); *Retry* of a
// failed or cancelled broadcast is a NEW draft from its words.
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { BroadcastView } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { auditHref } from '../../../features/forms/chain';
import {
  COMMS_HREF, broadcastActHref, broadcastEditHref, broadcastHref, channelKey, failedByKey, failureKey, offeredActs, retryAsDraftHref, statusKey, statusTone,
  suppressedByKey, transportState,
} from '../../../features/comms/broadcasts';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('bc.receipt.title'), robots: { index: false, follow: false } };
}

export default async function BroadcastReceiptPage({ params }: { params: { id: string } }) {
  await requireSession(broadcastHref(params.id));
  const t = getTranslator();
  const lang = getLang();
  let v: BroadcastView | null = null; let state: string = 'data';
  try { v = await tenantClient().notifications.broadcast(params.id); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = transportState(err?.code, err?.status); }
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: v?.zone ?? undefined }) : null);

  return (
    <section>
      <nav aria-label={t.t('bc.breadcrumb')} className="kv-field__hint"><Link href={COMMS_HREF}>{t.t('bc.title')}</Link></nav>
      {!v && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(`bc.state.${state}`)}</p>
          {state === 'error' && <p><Link href={broadcastHref(params.id)} className="kv-btn--link">{t.t('bc.retry')}</Link></p>}
        </div>
      )}
      {v && (() => {
        const b = v.broadcast; const c = v.counts; const acts = v.canSend ? offeredActs(b.status) : [];
        const retry = retryAsDraftHref(b);
        return (
          <>
            <h1>{b.title}</h1>
            <p><span className={`kv-badge kv-badge--${statusTone(b.status)}`}>{t.t(statusKey(b.status))}</span> · {t.t(channelKey(b.channel))} · {b.audienceRoleCode ? <code>{b.audienceRoleCode}</code> : t.t('bc.audience.everyone')}</p>
            <div className="kv-card"><p style={{ whiteSpace: 'pre-line' }}>{b.body}</p></div>

            <dl className="kv-facts">
              <dt>{t.t('bc.receipt.created')}</dt><dd>{when(b.createdAt)}</dd>
              {b.scheduledAt && <><dt>{t.t('bc.receipt.scheduled')}</dt><dd>{when(b.scheduledAt)} <span className="kv-field__hint">{v.zone}</span></dd></>}
              {b.sendRequestedAt && <><dt>{t.t('bc.receipt.sendRequested')}</dt><dd>{when(b.sendRequestedAt)} · {t.t('bc.eligibleAtSend', { n: formatNumber(b.eligibleCount, lang) })}</dd></>}
              {b.queuedAt && <><dt>{t.t('bc.receipt.queued')}</dt><dd>{when(b.queuedAt)}</dd></>}
              {b.fannedOutAt && <><dt>{t.t('bc.receipt.fannedOut')}</dt><dd>{when(b.fannedOutAt)}</dd></>}
              {b.status === 'failed' && <><dt>{t.t('bc.receipt.failed')}</dt><dd className="kv-error">{t.t(failureKey(b.failureReason))} · {when(b.failedAt)}</dd></>}
              {b.status === 'cancelled' && <><dt>{t.t('bc.receipt.cancelled')}</dt><dd>{when(b.cancelledAt)} · “{b.cancelReason}”</dd></>}
            </dl>

            {c ? (
              <div className="kv-card">
                <h2>{t.t('bc.receipt.result')}</h2>
                <p>{t.t('bc.receipt.reached', { n: formatNumber(c.recipients, lang) })} · {t.t('bc.result.inapp', { n: formatNumber(c.inapp, lang) })} · {t.t('bc.receipt.read', { n: formatNumber(c.read, lang) })}</p>
                <table className="kv-table">
                  <caption className="kv-sr-only">{t.t('bc.receipt.byChannel')}</caption>
                  <thead><tr>
                    <th scope="col">{t.t('bc.impact.col.channel')}</th><th scope="col">{t.t('bc.receipt.col.sent')}</th><th scope="col">{t.t('bc.receipt.col.read')}</th>
                    <th scope="col">{t.t('bc.receipt.col.held')}</th><th scope="col">{t.t('bc.receipt.col.suppressed')}</th><th scope="col">{t.t('bc.receipt.col.failed')}</th>
                  </tr></thead>
                  <tbody>{c.channels.map((ch) => (
                    <tr key={ch.channel}>
                      <th scope="row">{t.t(channelKey(ch.channel))}</th>
                      <td>{formatNumber(ch.sent + ch.delivered, lang)}</td><td>{formatNumber(ch.read, lang)}</td>
                      <td>{formatNumber(ch.held, lang)}{ch.released > 0 && <span className="kv-field__hint"> · {t.t('bc.receipt.released', { n: formatNumber(ch.released, lang) })}</span>}</td>
                      <td>{formatNumber(ch.suppressed, lang)}{Object.entries(ch.suppressedBy).map(([k, n]) => <div key={k} className="kv-field__hint">{t.t(suppressedByKey(k))}: {formatNumber(n, lang)}</div>)}</td>
                      <td>{formatNumber(ch.failed, lang)}{Object.entries(ch.failedBy).map(([k, n]) => <div key={k} className="kv-field__hint">{t.t(failedByKey(k))}: {formatNumber(n, lang)}</div>)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                <p className="kv-field__hint">{t.t('bc.countsFromLog')}</p>
                <p className="kv-field__hint">{t.t('bc.receipt.noSms')}</p>
              </div>
            ) : <p className="kv-field__hint">{t.t('bc.result.none')}</p>}

            <p>
              {acts.includes('send') && <><Link href={broadcastActHref(b.id, 'send')} className="kv-btn kv-btn--primary">{t.t('bc.act.send')}</Link>{' '}</>}
              {b.status === 'draft' && v.canSend && <><Link href={broadcastEditHref(b.id)} className="kv-btn kv-btn--secondary">{t.t('bc.act.edit')}</Link>{' '}</>}
              {acts.includes('cancel') && <><Link href={broadcastActHref(b.id, 'cancel')} className="kv-btn kv-btn--secondary">{t.t('bc.act.cancel')}</Link>{' '}</>}
              {retry && v.canSend && <><Link href={retry} className="kv-btn--link">{t.t('bc.retryAsDraft')}</Link>{' · '}</>}
              <Link href={auditHref('tenant_broadcast', b.id)} className="kv-btn--link">{t.t('form.viewAudit')}</Link>
            </p>
            {!v.canSend && <p className="kv-field__hint">{t.t('bc.readOnly')}</p>}
          </>
        );
      })()}
    </section>
  );
}
