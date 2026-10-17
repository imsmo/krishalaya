'use client';
// apps/web-storefront/src/components/offline/UpdateNotice.tsx · PC-56 STORE-6a · D4 (W319 "updates itself politely") — "A new version is ready".
// The worker no longer takes over by itself (no `skipWaiting` at install, features/offline/sw-source.ts): a new version WAITS. This notice shows
// when one is waiting (`registration.waiting`, or one that finishes installing while the page is open) — "tap to refresh now, or it applies next
// time you open" — and NEVER while a form on the page has content the person typed (features/store6/sw-rules.ts `updateNoticeAllowed` over
// `formsDirty`, re-read on every input). "Refresh now" posts `SKIP_WAITING` to the waiting worker and reloads once it takes control
// (`controllerchange`). No worker support, no registration, nothing waiting → nothing rendered.
import { useEffect, useState } from 'react';
import { formsDirty, updateNoticeAllowed } from '../../features/store6/sw-rules';

export interface UpdateLabels { ready: string; refresh: string; later: string }

/** PURE view — the render test renders it directly. */
export function UpdateNoticeView({ show, labels, onRefresh }: { show: boolean; labels: UpdateLabels; onRefresh?: () => void }) {
  if (!show) return null;
  return (
    <div className="kv-state kv-update" role="status" data-kv-update="ready">
      <strong>{labels.ready}</strong>{' '}
      <button type="button" className="kv-btn--link" data-kv-update-refresh="" onClick={onRefresh}>{labels.refresh}</button>{' '}
      <span className="kv-field__hint">{labels.later}</span>
    </div>
  );
}

export function UpdateNotice({ labels }: { labels: UpdateLabels }) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    let stopped = false;
    const seen = (r: ServiceWorkerRegistration | undefined) => { if (!stopped && r?.waiting && navigator.serviceWorker.controller) setWaiting(r.waiting); };
    navigator.serviceWorker.getRegistration().then((r) => {
      if (!r) return;
      seen(r);
      r.addEventListener('updatefound', () => {
        const w = r.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') seen(r); });
      });
    }).catch(() => undefined);
    const reread = () => setDirty(formsDirty(document as never));
    reread();
    document.addEventListener('input', reread, true); document.addEventListener('change', reread, true); document.addEventListener('reset', reread, true);
    return () => {
      stopped = true;
      document.removeEventListener('input', reread, true); document.removeEventListener('change', reread, true); document.removeEventListener('reset', reread, true);
    };
  }, []);
  const refresh = () => {
    if (!waiting) return;
    let done = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!done) { done = true; window.location.reload(); } });
    waiting.postMessage({ type: 'SKIP_WAITING' });
  };
  return <UpdateNoticeView show={waiting !== null && updateNoticeAllowed(dirty)} labels={labels} onRefresh={refresh} />;
}
