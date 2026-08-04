// apps/web-ops/src/app/dashboard/page.tsx · ops home (PC-30 OW-0). requireSession-gated; greets via auth.me()
// (ops staff are platform-API users with ops-scoped roles). The wave map below is HONEST status — each row names
// its OW wave from OPS_BUILD_BACKLOG.md and flips to a link only when built (no dead links, ever).
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { opsClient } from '../../lib/api-client';
import { getTranslator } from '../../lib/i18n';
import type { UserProfile } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dash.title'), robots: { index: false, follow: false } };
}

const BUILT: ReadonlyArray<{ key: string; href: string }> = [{ key: 'kiosk', href: '/kiosk' }, { key: 'warehouse', href: '/warehouse' }, { key: 'chc', href: '/equipment' }, { key: 'dairypos', href: '/dairy' }, { key: 'insights', href: '/insights' }]; // OW-1..4,6
const WAVES = ['money'] as const;

export default async function DashboardPage() {
  await requireSession('/dashboard');
  const t = getTranslator();

  let me: UserProfile | null = null;
  try { me = await opsClient().auth.me(); } catch { me = null; }

  return (
    <section>
      <h1>{t.t('dash.title')}</h1>
      {me && <p className="kv-muted">{t.t('dash.hello', { name: me.displayName ?? me.id })}</p>}
      <p className="kv-field__hint">{t.t('dash.hint')}</p>

      <table className="kv-table">
        <thead><tr><th>{t.t('dash.colArea')}</th><th>{t.t('dash.colStatus')}</th></tr></thead>
        <tbody>
          {BUILT.map((b) => (
            <tr key={b.key}>
              <td><a href={b.href} className="kv-link">{t.t(`dash.wave.${b.key}`)}</a></td>
              <td><span className="kv-badge">{t.t('dash.live')}</span></td>
            </tr>
          ))}
          {WAVES.map((w) => (
            <tr key={w}>
              <td>{t.t(`dash.wave.${w}`)}</td>
              <td><span className="kv-badge">{t.t('dash.coming')}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="kv-field__hint kv-note">{t.t('dash.honesty')}</p>
    </section>
  );
}
