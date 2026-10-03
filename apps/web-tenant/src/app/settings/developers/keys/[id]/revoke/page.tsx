// apps/web-tenant/src/app/settings/developers/keys/[id]/revoke/page.tsx · THE REVOKE MUTATE CHAIN — W2492 confirm → W2493 success →
// W2494 failure · PC-56 TENANT-13c.
//   • the confirm names the key (prefix, name, scopes, last used) and prints the REAL bound: the key guard reads the key row on every call,
//     so the revocation takes effect on the next call — within the 60 s the canon promises — and callers get `key_revoked` with the
//     re-issue path ("fail closed, explain kindly"). A reason (5–300) is required and written to the audit row; revocation is permanent;
//   • success reads the audit entry back (AuditEntryCard); failure lists every refusal by name; Retry is a page load back to confirm.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { ApiKeyList, ApiKeyView } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../../lib/i18n';
import { mutateStep, mutateStepKey } from '../../../../../../features/mutate/chain';
import { AuditEntryCard } from '../../../../../people/ambassadors/AuditEntryCard';
import { DEVELOPERS_HREF, isUuid, pageState, parseCodes, prefixMask, refusalKey, revokeBase, statusKey } from '../../../../../../features/api-keys/api-keys';
import { revokeKeyAction } from '../../../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ak.revoke.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function RevokeKeyPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = revokeBase(params.id);
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('ak.list.never'));
  const step = mutateStep(searchParams.step);
  const failed = parseCodes(searchParams.error);

  let key: ApiKeyView | null = null; let bound = 60; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state && step === 'confirm') {
    try {
      // the list is the one read the console has; the key is found by id across its pages
      let cursor: string | undefined; let page: ApiKeyList | null = null;
      for (let i = 0; i < 20 && !key; i++) {
        page = await tenantClient().apiKeys.list({ cursor, limit: 100 });
        bound = page.contract.revocationBoundSeconds;
        key = page.items.find((k) => k.id === params.id) ?? null;
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      if (!key) state = 'notFound';
    } catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status, true); }
  }

  return (
    <section>
      <nav aria-label={t.t('ak.breadcrumb.label')} className="kv-field__hint">{t.t('ak.breadcrumb.settings')} › {t.t('ak.breadcrumb.developers')} › <Link href={DEVELOPERS_HREF} className="kv-btn--link">{t.t('ak.list.crumb')}</Link> › {t.t('ak.revoke.title')}</nav>
      <h1>{t.t('ak.revoke.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('ak.revoke.module')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`ak.state.${state}.title`)}</strong><p>{t.t(`ak.state.${state}.body`)}</p>
          <p><Link href={DEVELOPERS_HREF} className="kv-btn--link">{t.t('ak.form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'confirm' && key && (
        <div className="kv-card">
          <p>{t.t('ak.revoke.lede')}</p>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('ak.list.col.name')}</dt><dd>{key.name}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ak.list.col.key')}</dt><dd><code>{prefixMask(key.keyPrefix)}</code></dd></div>
            <div className="kv-facts__row"><dt>{t.t('ak.list.col.scopes')}</dt><dd>{key.scopes.join(' · ')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ak.list.col.lastUsed')}</dt><dd>{when(key.lastUsedAt)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ak.list.col.status')}</dt><dd>{t.t(statusKey(key.status))}</dd></div>
          </dl>
          <div className="kv-card kv-card--notice" role="note">
            <strong>{t.t('ak.revoke.panel.title')}</strong>
            <p>{t.t('ak.revoke.panel.body', { seconds: formatNumber(bound, lang) })}</p>
          </div>
          {key.canRevoke ? (
            <form action={revokeKeyAction} className="kv-form">
              <input type="hidden" name="id" value={key.id} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <label className="kv-field" htmlFor="ak-revoke-reason"><span>{t.t('ak.revoke.reason')}</span>
                <textarea id="ak-revoke-reason" name="reason" className="kv-textarea" rows={2} minLength={5} maxLength={300} required placeholder={t.t('ak.revoke.reasonPlaceholder')} /></label>
              <p className="kv-field__hint">{t.t('ak.revoke.audit')}</p>
              <button type="submit" className="kv-btn kv-btn--danger">{t.t('ak.revoke.proceed')}</button>{' '}
              <Link href={DEVELOPERS_HREF} className="kv-btn--link">{t.t('ak.revoke.cancel')}</Link>
            </form>
          ) : <p className="kv-error" role="alert">{t.t(refusalKey('KEY_ALREADY_REVOKED'))}</p>}
        </div>
      )}

      {step === 'success' && isUuid(params.id) && (
        <>
          <div className="kv-card kv-success" role="status">
            <strong>{t.t('ak.revoke.done')}</strong>
            <p><Link href={DEVELOPERS_HREF} className="kv-btn kv-btn--primary">{t.t('ak.form.backToScreen')}</Link></p>
          </div>
          <AuditEntryCard t={t} lang={lang} entityType="api_key" entityId={params.id} action="api_key.revoked" />
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('ak.form.failure.title')}</strong>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((c) => <li key={c}>{t.t(refusalKey(c))}</li>)}</ul>
          <p>{t.t('ak.form.failure.untouched')}</p>
          <p className="kv-field__hint">{t.t('ak.form.failure.onCall')}</p>
          <p>
            <Link href={`${base}?step=confirm`} className="kv-btn--link">{t.t('ak.form.failure.retry')}</Link>{' · '}
            <Link href={DEVELOPERS_HREF} className="kv-btn--link">{t.t('ak.form.backToScreen')}</Link>
          </p>
        </div>
      )}
    </section>
  );
}
