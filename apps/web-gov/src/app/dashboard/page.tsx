// apps/web-gov/src/app/dashboard/page.tsx · gov home (PC-40 GW-0). requireSession-gated; auth.me greeting; the
// HONEST wave map (GW-1..5 badged coming — no dead links). Gov persona = read + audit-stamped exports; every
// export the waves ship must carry its audit receipt (contract from Ledger Part 3).
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { govClient } from '../../lib/api-client';
import { getTranslator } from '../../lib/i18n';
import type { UserProfile } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dash.title'), robots: { index: false, follow: false } };
}

// GW-1..5 — every gov wave is built (PC-55 B2 closed GW-5). There is no 'coming' list left to render, which is
// why the wave table below has no second section: an empty "coming soon" shell would be noise, not honesty.
const BUILT = [{ key: 'schemes', href: '/schemes' }, { key: 'dbt', href: '/schemes' }, { key: 'regulator', href: '/registers' },
  { key: 'verification', href: '/verification' }, { key: 'mgnrega', href: '/mgnrega' }] as const;

export default async function DashboardPage() {
  await requireSession('/dashboard');
  const t = getTranslator();
  let me: UserProfile | null = null;
  try { me = await govClient().auth.me(); } catch { me = null; }
  return (
    <section>
      <h1>{t.t('dash.title')}</h1>
      {me && <p className="kv-muted">{t.t('dash.hello', { name: me.displayName ?? me.id })}</p>}
      <p className="kv-field__hint">{t.t('dash.hint')}</p>
      <table className="kv-table">
        <thead><tr><th>{t.t('dash.colArea')}</th><th>{t.t('dash.colStatus')}</th></tr></thead>
        <tbody>
          {BUILT.map((b) => (
            <tr key={b.key}><td><a href={b.href} className="kv-link">{t.t(`dash.wave.${b.key}`)}</a></td><td><span className="kv-badge">{t.t('dash.live')}</span></td></tr>
          ))}
        </tbody>
      </table>
      <p className="kv-field__hint kv-note">{t.t('dash.honesty')}</p>
    </section>
  );
}
