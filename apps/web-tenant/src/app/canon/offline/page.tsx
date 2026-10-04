// apps/web-tenant/src/app/canon/offline/page.tsx · W318 · Console offline & stale-data canon — PC-56 TENANT-SW-f (founder: STALE + DEGRADED
// + VERIFY-BEFORE-WRITE, NO SERVICE WORKER). The binding canon as a POLICY page: each of its four laws, and the MECHANISM that makes each
// true on this console, named — or REFUSED BY NAME where the founder declined it (the local draft queue / service worker).
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { AsOf } from '../../../components/AsOf';
import { SignalBanner } from '../../../components/OnlineGuard';
import { OFFLINE_CANON_HREF, asOfLabels, refusedKey, signalLabels } from '../../../features/swf/console';
import { STALE_AFTER_MS } from '../../../features/offline/stale';
import { HEARTBEAT_MS, NO_OFFLINE_WRITE_QUEUE } from '../../../features/offline/signal';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swf.canon.title'), robots: { index: false, follow: false } }; }

export default async function OfflineCanonPage() {
  await requireSession(OFFLINE_CANON_HREF);
  const t = getTranslator();
  return (
    <section>
      <h1>{t.t('swf.canon.title')}</h1>
      <p className="kv-field__hint">{t.t('swf.canon.lead')}</p>
      <div className="kv-card">
        <h2>{t.t('swf.canon.stale.title')}</h2>
        <p>{t.t('swf.canon.stale.law')}</p>
        <p className="kv-field__hint">{t.t('swf.canon.stale.mechanism', { minutes: String(STALE_AFTER_MS / 60_000) })}</p>
        <AsOf at={new Date().toISOString()} labels={asOfLabels(t)} />
      </div>
      <div className="kv-card">
        <h2>{t.t('swf.canon.degraded.title')}</h2>
        <p>{t.t('swf.canon.degraded.law')}</p>
        <p className="kv-field__hint">{t.t('swf.canon.degraded.mechanism', { seconds: String(HEARTBEAT_MS / 1000) })}</p>
        <p className="kv-field__hint">{t.t('swf.canon.degraded.example')}</p>
        <SignalBanner mode="degraded" labels={signalLabels(t)} />
      </div>
      <div className="kv-card">
        <h2>{t.t('swf.canon.verify.title')}</h2>
        <p>{t.t('swf.canon.verify.law')}</p>
        <p className="kv-field__hint">{t.t('swf.canon.verify.mechanism')}</p>
        <p className="kv-field__hint">{t.t('swf.canon.verify.covered')}</p>
      </div>
      <div className="kv-card">
        <h2>{t.t('swf.canon.laws.title')}</h2>
        <ul className="kv-list">
          <li><strong>{t.t('swf.canon.law.noCache')}</strong> — {t.t('swf.canon.law.noCache.how')}</li>
          <li><strong>{t.t('swf.canon.law.noReplay')}</strong> — {t.t('swf.canon.law.noReplay.how')}</li>
          <li><strong>{t.t('swf.canon.law.nav')}</strong> — {t.t('swf.canon.law.nav.how')}</li>
          <li><strong>{t.t('swf.canon.law.badge')}</strong> — {t.t('swf.canon.law.badge.how')}</li>
        </ul>
      </div>
      <div className="kv-card">
        <h2>{t.t('swf.canon.queue.title')}</h2>
        <p><span className="kv-badge kv-badge--muted">{t.t('swf.refusedByName')}</span> {t.t(refusedKey(NO_OFFLINE_WRITE_QUEUE))} <code>{NO_OFFLINE_WRITE_QUEUE}</code></p>
      </div>
    </section>
  );
}
