// apps/web-tenant/src/app/settings/developers/webhooks/page.tsx · W188 · WEBHOOKS — PC-56 TENANT-13a.
//
// The canon's screen, printed as built:
//   • the lede says what is true of the secret: "encrypted at rest, shown once" (the canon's "stored hashed — even we cannot read them
//     back" cannot be true of an HMAC signer, which must hold the key — founder decision 2026-10-03);
//   • columns Endpoint · Events · Success (7d) + delivered · Secret (whsec_••••hint + Rotate) · Status (active / paused — reason /
//     disabled) — every figure from the API's attempt rows (a rate only over real attempts; no attempts → "no attempts yet");
//   • row acts Pause / Resume / Rotate / Replay failed / Delete open the mutate chain (W2836–W2838) with a reason;
//   • "Add endpoint" opens the form chain (W2832–W2835);
//   • the three promises and the rotation panel are printed FROM `contract` — the ladder, the overlap and the retention the worker
//     actually uses (GET /webhooks returns them);
//   • states: empty · Couldn't load (Retry) · restricted (api.manage) · Flagged off (the API's `tenancy` flag) · Loading.
// No secret is ever rendered here, and no query parameter is read for one (F-5).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { WebhookEndpointList } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../lib/i18n';
import {
  DELIVERIES_HREF, NEW_ENDPOINT_HREF, WEBHOOKS_HREF, actHref, logHref, pageState, promiseVars, rowActs, secretMask, statusKey, successLine,
} from '../../../../features/webhooks/webhooks';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('wh.list.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function WebhooksPage() {
  await requireSession(WEBHOOKS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : '');

  let data: WebhookEndpointList | null = null; let state: string | null = null;
  try { data = await tenantClient().webhooks.list(); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status); }
  const pv = data ? promiseVars(data.contract) : null;

  return (
    <section>
      <nav aria-label={t.t('wh.breadcrumb.label')} className="kv-field__hint">{t.t('wh.breadcrumb.settings')} › {t.t('wh.breadcrumb.developers')} › {t.t('wh.list.crumb')}</nav>
      <h1>{t.t('wh.list.title')}</h1>
      <p>{t.t('wh.list.lede')}</p>
      <p>
        <Link href={DELIVERIES_HREF} className="kv-btn--link">{t.t('wh.list.deliveryLog')}</Link>{' · '}
        {state === null && <Link href={NEW_ENDPOINT_HREF} className="kv-btn kv-btn--primary">{t.t('wh.list.add')}</Link>}
      </p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`wh.state.${state}.title`)}</strong><p>{t.t(`wh.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={WEBHOOKS_HREF} className="kv-btn--link">{t.t('wh.state.retry')}</Link></p>}
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="kv-card">
          <strong>{t.t('wh.list.empty.title')}</strong>
          <p>{t.t('wh.list.empty.body')}</p>
          <p><Link href={NEW_ENDPOINT_HREF} className="kv-btn kv-btn--primary">{t.t('wh.list.add')}</Link></p>
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('wh.list.col.endpoint')}</th><th scope="col">{t.t('wh.list.col.events')}</th><th scope="col">{t.t('wh.list.col.success')}</th>
              <th scope="col">{t.t('wh.list.col.secret')}</th><th scope="col">{t.t('wh.list.col.status')}</th><th scope="col">{t.t('wh.list.col.actions')}</th>
            </tr></thead>
            <tbody>
              {data.items.map((e) => {
                const sl = successLine(e.stats);
                const mask = secretMask(e.secretHint);
                return (
                  <tr key={e.id}>
                    <td><code>{e.url}</code><br /><span className="kv-field__hint">{t.t('wh.list.developer', { email: e.developerEmail ?? t.t('wh.list.noDeveloper') })}</span></td>
                    <td>{e.eventTypes.join(' · ')}</td>
                    <td>
                      {t.t(sl.key, { ...sl.vars, delivered: formatNumber(Number(sl.vars.delivered ?? 0), lang) })}
                      {(e.stats?.failedOpen ?? 0) > 0 && <><br /><Link href={logHref({ endpointId: e.id, failedOnly: true, window: '7d', size: 25 })} className="kv-btn--link">{t.t('wh.list.inspect')}</Link></>}
                    </td>
                    <td>
                      {mask ? <code>{mask}</code> : <span className="kv-field__hint">{t.t('wh.list.noHint')}</span>}
                      {e.previousSecretSignsUntil && <><br /><span className="kv-field__hint">{t.t('wh.list.previousSigns', { until: when(e.previousSecretSignsUntil) })}</span></>}
                    </td>
                    <td>
                      {t.t(statusKey(e))}
                      {e.pausedAt && <><br /><span className="kv-field__hint">{t.t('wh.list.since', { at: when(e.pausedAt) })}</span></>}
                      {(e.stats?.held ?? 0) > 0 && <><br /><span className="kv-field__hint">{t.t('wh.list.held', { n: formatNumber(e.stats!.held, lang) })}</span></>}
                    </td>
                    <td>{rowActs(e).map((a, i) => <span key={a}>{i > 0 ? ' · ' : ''}<Link href={actHref(e.id, a)} className="kv-btn--link">{t.t(`wh.act.${a}.button`)}</Link></span>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="kv-field__hint">{t.t('wh.list.count', { shown: formatNumber(data.items.length, lang), total: formatNumber(data.total, lang) })}</p>
        </>
      )}

      {pv && (
        <>
          <div className="kv-card">
            <h2>{t.t('wh.promise.title')}</h2>
            <ul className="kv-list">
              <li>✓ {t.t('wh.promise.backoff', pv)}</li>
              <li>✓ {t.t('wh.promise.neverLost', pv)}</li>
              <li>✓ {t.t('wh.promise.twoxx', pv)}</li>
            </ul>
            <p className="kv-field__hint">{t.t('wh.promise.guard', pv)}</p>
          </div>
          <div className="kv-card">
            <h2>{t.t('wh.rotate.title')}</h2>
            <p>{t.t('wh.rotate.body', pv)}</p>
            <p className="kv-field__hint">{t.t('wh.rotate.signature', pv)}</p>
          </div>
          <p className="kv-field__hint">{t.t('wh.list.footnote')}</p>
        </>
      )}
    </section>
  );
}
