// apps/web-tenant/src/app/settings/org/history/page.tsx · W186's history drawer, per key or for all keys — PC-56 TENANT-13b (F-16).
// Every write of a tenant setting, before → after, who (one person for an ordinary key; maker AND checker for an applied proposal), why
// and when, newest first; µs keyset ("Older ›"). Read from `tenant_setting_history` (append-only, 0192).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { SettingHistoryRow } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../lib/i18n';
import { HISTORY_HREF, ORG_HREF, isSettingKey, pageState, showValue } from '../../../../features/org-settings/org-settings';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('os.history.title'), robots: { index: false, follow: false } };
}

export default async function SettingHistoryPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(HISTORY_HREF);
  const t = getTranslator();
  const lang = getLang();
  const key = isSettingKey(searchParams.key) ? searchParams.key : undefined;
  const cursor = typeof searchParams.cursor === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(searchParams.cursor) ? searchParams.cursor : undefined;
  let rows: SettingHistoryRow[] = []; let next: string | null = null; let state: string | null = null;
  try { const r = await tenantClient().orgSettings.history({ key, cursor, limit: 25 }); rows = r.items; next = r.nextCursor; }
  catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status); }
  const q = (c?: string) => `${HISTORY_HREF}?${new URLSearchParams({ ...(key ? { key } : {}), ...(c ? { cursor: c } : {}) }).toString()}`;

  return (
    <section>
      <nav aria-label={t.t('os.breadcrumb.label')} className="kv-field__hint">{t.t('os.breadcrumb.settings')} › <Link href={ORG_HREF} className="kv-btn--link">{t.t('os.title')}</Link> › {t.t('os.history.title')}</nav>
      <h1>{t.t('os.history.title')}{key ? <> · <code>{key}</code></> : null}</h1>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`os.state.${state}.title`)}</strong><p>{t.t(`os.state.${state}.body`)}</p></div>}
      {!state && rows.length === 0 && <p className="kv-card">{t.t('os.history.empty')}</p>}
      {rows.length > 0 && (
        <table className="kv-table">
          <thead><tr><th scope="col">{t.t('os.history.when')}</th><th scope="col">{t.t('os.col.key')}</th><th scope="col">{t.t('os.form.before')} → {t.t('os.form.after')}</th><th scope="col">{t.t('os.history.who')}</th><th scope="col">{t.t('os.history.why')}</th></tr></thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.id}>
                <td>{formatDate(h.appliedAt, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}</td>
                <td><code>{h.key}</code></td>
                <td><code>{showValue(h.oldValue)}</code> → <code>{showValue(h.newValue)}</code></td>
                <td>{t.t(h.source === 'proposal' ? 'os.history.twoPeople' : 'os.history.onePerson')}</td>
                <td>{h.reason ?? t.t('os.history.noReason')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>{cursor && <Link href={q()} className="kv-btn--link">{t.t('os.history.newest')}</Link>}{cursor && next ? ' · ' : ''}{next && <Link href={q(next)} className="kv-btn--link">{t.t('os.history.older')}</Link>}</p>
    </section>
  );
}
