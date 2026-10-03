// apps/web-tenant/src/app/settings/developers/webhooks/deliveries/page.tsx · W189 · WEBHOOK DELIVERIES — PC-56 TENANT-13a.
//   • the tenant's OWN deliveries only (the API's RLS admits endpoint_kind 'tenant' and every query joins this tenant's endpoints —
//     a partner delivery never appears, F-19);
//   • filters: endpoint chips · failed only · window 24h / 7d / 30d / 90d; page size 25 / 50 / 100; µs keyset paging ("Older");
//   • columns When ▾ · Event (+ the object it concerns) · Attempt (the COUNT of attempt rows — every attempt is logged) · HTTP ·
//     Next retry (time + the ladder step that set it, "30m backoff") · Payload → the masked viewer;
//   • "Replay N failed" is real: per endpoint, through the mutate chain (reason, key, audit);
//   • the count line, and the diagnosis COMPUTED from the failed attempt rows ("12 failures, all 504, all on sheets-bridge…, since 14:32");
//   • retention: "deliveries retain 90 days of payloads" (the number the API returns, the rule the retention job enforces);
//   • states: none yet · none in range (Widen range) · Couldn't load (Retry) · restricted (api.manage) · Flagged off · Loading.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { WebhookDeliveryPage, WebhookEndpointList } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../lib/i18n';
import {
  DELIVERIES_HREF, PAGE_SIZES, WEBHOOKS_HREF, WINDOWS, actHref, deliveryHref, diagnosisLine, isUuid, logHref, nextRetryCell, pageSizeOf, pageState, sinceOf, windowOf,
} from '../../../../../features/webhooks/webhooks';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('wh.log.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function DeliveriesPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(DELIVERIES_HREF);
  const t = getTranslator();
  const lang = getLang();
  const fmt = (n: number) => formatNumber(n, lang);
  const time = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'short', timeStyle: 'short' }) : '');
  const endpointId = isUuid(searchParams.endpoint) ? searchParams.endpoint : undefined;
  const failedOnly = searchParams.failed === '1';
  const window = windowOf(searchParams.window);
  const size = pageSizeOf(searchParams.size);
  const cursor = typeof searchParams.cursor === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(searchParams.cursor) ? searchParams.cursor : undefined;
  const q = { endpointId, failedOnly, window, size };

  let page: WebhookDeliveryPage | null = null; let endpoints: WebhookEndpointList | null = null; let state: string | null = null;
  try {
    [page, endpoints] = await Promise.all([
      tenantClient().webhooks.deliveries({ endpointId, status: failedOnly ? 'failed' : 'all', since: sinceOf(window, new Date()), cursor, limit: size }),
      tenantClient().webhooks.list(),
    ]);
  } catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status); }
  const diag = page ? diagnosisLine(page.diagnosis) : null;
  const replayable = (endpoints?.items ?? []).filter((e) => e.status === 'active' && (e.stats?.failedOpen ?? 0) > 0 && (!endpointId || e.id === endpointId));
  const noneEver = page && page.total === 0 && !failedOnly && !endpointId && window === '90d';

  return (
    <section>
      <nav aria-label={t.t('wh.breadcrumb.label')} className="kv-field__hint">{t.t('wh.breadcrumb.settings')} › {t.t('wh.breadcrumb.developers')} › <Link href={WEBHOOKS_HREF} className="kv-btn--link">{t.t('wh.list.crumb')}</Link> › {t.t('wh.log.crumb')}</nav>
      <h1>{t.t('wh.log.title')}</h1>
      <p>{t.t('wh.log.lede')}</p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`wh.state.log.${state}.title`)}</strong><p>{t.t(`wh.state.log.${state}.body`)}</p>
          {state === 'error' && <p><Link href={logHref({ ...q, cursor })} className="kv-btn--link">{t.t('wh.state.retry')}</Link></p>}
        </div>
      )}

      {page && endpoints && (
        <>
          {replayable.length > 0 && (
            <p>{replayable.map((e, i) => <span key={e.id}>{i > 0 ? ' · ' : ''}<Link href={actHref(e.id, 'replay-failed')} className="kv-btn">{t.t('wh.log.replayFailed', { n: fmt(e.stats!.failedOpen), host: e.host })}</Link></span>)}</p>
          )}
          <p className="kv-chips">
            <Link href={logHref({ ...q, endpointId: undefined })} className={!endpointId ? 'kv-chip kv-chip--on' : 'kv-chip'}>{t.t('wh.log.filter.allEndpoints')}</Link>{' '}
            {endpoints.items.map((e) => <span key={e.id}><Link href={logHref({ ...q, endpointId: e.id })} className={endpointId === e.id ? 'kv-chip kv-chip--on' : 'kv-chip'}>{e.host}{e.status !== 'active' ? ` (${t.t(`wh.status.short.${e.status}`)})` : ''}</Link>{' '}</span>)}
          </p>
          <p className="kv-chips">
            <Link href={logHref({ ...q, failedOnly: !failedOnly })} className={failedOnly ? 'kv-chip kv-chip--on' : 'kv-chip'}>{t.t('wh.log.filter.failedOnly')}</Link>{' '}
            {WINDOWS.map((w) => <span key={w}><Link href={logHref({ ...q, window: w })} className={window === w ? 'kv-chip kv-chip--on' : 'kv-chip'}>{t.t(`wh.log.window.${w}`)}</Link>{' '}</span>)}
          </p>

          {page.items.length === 0 ? (
            <div className="kv-card">
              <strong>{t.t(noneEver ? 'wh.log.empty.title' : 'wh.log.noneInRange.title')}</strong>
              <p>{t.t(noneEver ? 'wh.log.empty.body' : 'wh.log.noneInRange.body', { days: fmt(page.retentionDays) })}</p>
              {!noneEver && window !== '90d' && <p><Link href={logHref({ ...q, window: '90d' })} className="kv-btn--link">{t.t('wh.log.widen')}</Link></p>}
            </div>
          ) : (
            <table className="kv-table">
              <thead><tr>
                <th scope="col" aria-sort="descending">{t.t('wh.log.col.when')} ▾</th><th scope="col">{t.t('wh.log.col.event')}</th><th scope="col">{t.t('wh.log.col.attempt')}</th>
                <th scope="col">{t.t('wh.log.col.http')}</th><th scope="col">{t.t('wh.log.col.next')}</th><th scope="col">{t.t('wh.log.col.payload')}</th>
              </tr></thead>
              <tbody>
                {page.items.map((d) => {
                  const nx = nextRetryCell(d);
                  return (
                    <tr key={d.id}>
                      <td>{time(d.createdAt)}<br /><span className="kv-field__hint">{d.endpointHost}</span></td>
                      <td><code>{d.eventType}</code>{d.eventRef && <><br /><span className="kv-field__hint">{d.eventRef}</span></>}</td>
                      <td>{fmt(d.attempts)}</td>
                      <td>{d.statusCode ?? (d.lastError ? t.t('wh.log.noAnswer') : '—')}</td>
                      <td>{t.t(nx.key, { at: time(nx.at), step: nx.step ?? '' })}</td>
                      <td><Link href={deliveryHref(d.id)} className="kv-btn--link">{t.t('wh.log.payload')}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <p className="kv-field__hint">{t.t('wh.log.count', { shown: fmt(page.items.length), total: fmt(page.total), window: t.t(`wh.log.window.${window}`), failed: fmt(page.failed) })}</p>
          <p className="kv-field__hint">
            {t.t('wh.log.rows')}{' '}{PAGE_SIZES.map((n) => <span key={n}><Link href={logHref({ ...q, size: n })} className={size === n ? 'kv-chip kv-chip--on' : 'kv-chip'}>{n}</Link>{' '}</span>)}
            {cursor && <Link href={logHref(q)} className="kv-btn--link">{t.t('wh.log.newest')}</Link>}{' '}
            {page.nextCursor && <Link href={logHref({ ...q, cursor: page.nextCursor })} className="kv-btn--link">{t.t('wh.log.older')}</Link>}
          </p>
          {diag && <p className="kv-card kv-card--notice">{t.t(diag.key, { ...diag.vars, since: time(diag.since) })}</p>}
          <p className="kv-field__hint">{t.t('wh.log.maskNote')} {t.t('wh.log.retention', { days: fmt(page.retentionDays) })}</p>
        </>
      )}
    </section>
  );
}
