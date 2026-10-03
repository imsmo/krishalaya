// apps/web-tenant/src/app/settings/developers/page.tsx · W190 · API KEYS — PC-56 TENANT-13c.
//
// The canon's screen, printed as built:
//   • the lede says what is true: shown once at creation, stored as a sha256 hash, scopes are exact allow-lists — and only live keys
//     exist (this platform has no sandbox mode, so no `kv_test_`);
//   • columns Name · Key (prefix only) · Scopes (chips; writes and checker scopes marked) · Rate/hr · Last used · Status (active /
//     waiting for a second administrator / revoked — reason / expired) · Revoke;
//   • "Create key" opens the form chain (W2488–W2491); Revoke opens the mutate chain (W2492–W2494) whose confirm prints the REAL bound —
//     the guard reads the key row on every call, so a revocation takes effect on the next call, within the 60 s the canon promises;
//   • waiting proposals with Confirm (offered only to a different administrator) / Refuse;
//   • the footnote: creation recorded · member-data scopes need a checker · Idempotency-Key required on every write · platform oversight
//     (W106) sees these keys too;
//   • states: Locked (no `api_access` on the plan — creation refused) · empty · Couldn't load (Retry; gateway enforcement is unaffected)
//     · restricted (api.manage) · Flagged off (the API's `tenant_api` flag) · Loading.
// No key, hash or secret is ever rendered here, and no query parameter is read for one.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { ApiKeyList } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getLang, getTranslator } from '../../../lib/i18n';
import { DEVELOPERS_HREF, NEW_KEY_HREF, keyProposalHref, pageState, prefixMask, revokeHref, scopeChips, statusKey } from '../../../features/api-keys/api-keys';
import { WEBHOOKS_HREF } from '../../../features/webhooks/webhooks';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ak.list.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function ApiKeysPage({ searchParams }: { searchParams: { cursor?: string } }) {
  await requireSession(DEVELOPERS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('ak.list.never'));
  const cursor = typeof searchParams.cursor === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(searchParams.cursor) ? searchParams.cursor : undefined;

  let data: ApiKeyList | null = null; let state: string | null = null;
  try { data = await tenantClient().apiKeys.list({ cursor, limit: 50 }); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status); }
  const locked = data !== null && !data.access.enabled;

  return (
    <section>
      <nav aria-label={t.t('ak.breadcrumb.label')} className="kv-field__hint">{t.t('ak.breadcrumb.settings')} › {t.t('ak.breadcrumb.developers')} › {t.t('ak.list.crumb')}</nav>
      <h1>{t.t('ak.list.title')}</h1>
      <p>{t.t('ak.list.lede')}</p>
      <p>
        <Link href={WEBHOOKS_HREF} className="kv-btn--link">{t.t('ak.list.webhooks')}</Link>{' · '}
        {data && !locked && <Link href={NEW_KEY_HREF} className="kv-btn kv-btn--primary">{t.t('ak.list.create')}</Link>}
      </p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`ak.state.${state}.title`)}</strong><p>{t.t(`ak.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={DEVELOPERS_HREF} className="kv-btn--link">{t.t('ak.state.retry')}</Link></p>}
        </div>
      )}

      {locked && data && (
        <div className="kv-card kv-card--notice" role="note">
          <strong>{t.t('ak.state.locked.title')}</strong>
          <p>{t.t('ak.state.locked.body', { plan: data.access.planCode ?? t.t('ak.state.locked.noPlan') })}</p>
          <p><Link href="/billing/upgrade" className="kv-btn--link">{t.t('ak.state.locked.upgrade')}</Link></p>
        </div>
      )}

      {data && data.proposals.length > 0 && (
        <div className="kv-card">
          <h2>{t.t('ak.proposals.title')}</h2>
          <ul className="kv-list">
            {data.proposals.map((p) => (
              <li key={p.id}>
                <code>{prefixMask(p.keyPrefix)}</code> {p.keyName} — {p.scopes.join(' · ')}
                <br /><span className="kv-field__hint">{t.t('ak.proposals.line', { by: p.proposedByName ?? t.t('ak.proposals.someone'), until: when(p.expiresAt) })}</span>
                <br /><Link href={keyProposalHref(p.id)} className="kv-btn--link">{t.t(p.canConfirm ? 'ak.proposals.review' : p.youProposed ? 'ak.proposals.yours' : 'ak.proposals.open')}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && data.items.length === 0 && !locked && (
        <div className="kv-card">
          <strong>{t.t('ak.list.empty.title')}</strong>
          <p>{t.t('ak.list.empty.body')}</p>
          <p><Link href={NEW_KEY_HREF} className="kv-btn kv-btn--primary">{t.t('ak.list.create')}</Link></p>
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('ak.list.col.name')}</th><th scope="col">{t.t('ak.list.col.key')}</th><th scope="col">{t.t('ak.list.col.scopes')}</th>
              <th scope="col">{t.t('ak.list.col.rate')}</th><th scope="col">{t.t('ak.list.col.lastUsed')}</th><th scope="col">{t.t('ak.list.col.status')}</th>
              <th scope="col">{t.t('ak.list.col.actions')}</th>
            </tr></thead>
            <tbody>
              {data.items.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}<br /><span className="kv-field__hint">{t.t('ak.list.createdBy', { by: k.createdByName ?? t.t('ak.proposals.someone'), at: when(k.createdAt) })}</span></td>
                  <td><code>{prefixMask(k.keyPrefix)}</code></td>
                  <td>{scopeChips(k, data!.catalogue).map((c) => (
                    <span key={c.code} className="kv-badge">{c.code}{c.write ? ` · ${t.t('ak.form.write')}` : ''}{c.checker ? ` · ${t.t('ak.form.needsChecker')}` : ''}</span>
                  ))}</td>
                  <td>{formatNumber(k.ratePerHour, lang)}</td>
                  <td>{when(k.lastUsedAt)}</td>
                  <td>
                    {t.t(statusKey(k.status))}
                    {k.status === 'revoked' && k.revokedReason && <><br /><span className="kv-field__hint">{t.t(k.revokedByPlatform ? 'ak.list.revokedByPlatform' : 'ak.list.revokedReason', { reason: k.revokedReason })}</span></>}
                    {k.expiresAt && k.status !== 'revoked' && <><br /><span className="kv-field__hint">{t.t('ak.list.expires', { at: when(k.expiresAt) })}</span></>}
                    {k.checker && <><br /><span className="kv-field__hint">{t.t('ak.list.checkedBy', { by: k.checker.name ?? t.t('ak.proposals.someone') })}</span></>}
                  </td>
                  <td>{k.canRevoke ? <Link href={revokeHref(k.id)} className="kv-btn--link">{t.t('ak.list.revoke')}</Link> : <span className="kv-field__hint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="kv-field__hint">{t.t('ak.list.count', { shown: formatNumber(data.items.length, lang), total: formatNumber(data.total, lang), active: formatNumber(data.active, lang) })}</p>
          {data.nextCursor && <p><Link href={`${DEVELOPERS_HREF}?cursor=${encodeURIComponent(data.nextCursor)}`} className="kv-btn--link">{t.t('ak.list.more')}</Link></p>}
        </>
      )}

      {data && (
        <>
          <div className="kv-card">
            <h2>{t.t('ak.revoke.panel.title')}</h2>
            <p>{t.t('ak.revoke.panel.body', { seconds: formatNumber(data.contract.revocationBoundSeconds, lang) })}</p>
          </div>
          <p className="kv-field__hint">{t.t('ak.list.footnote', { max: formatNumber(data.contract.rate.max, lang) })}</p>
        </>
      )}
    </section>
  );
}
