'use client';
// apps/web-storefront/src/components/install/InstallStatus.tsx · PC-56 STORE-6b · D3 / C2 — the `/app` page's invitation STATUS LINE, read from THIS
// device (the `kvs_install` mark and whether the browser can install from a page at all): "You said Not now — the invitation waits until
// <date>" · "This phone has it on its home screen" · W3137 "This browser can't install from here — Share → Add to Home Screen" (a browser
// without `beforeinstallprompt`: iOS Safari, Firefox). Nothing before the device answers, or without JavaScript.
import { useEffect, useState } from 'react';
import { INSTALL_COOKIE, cookieValue, installStatus, readInstall } from '../../features/store6b/install';

export interface StatusLabels { notNow: string; added: string; cannot: string }
export type StatusView = { kind: 'notnow'; until: number } | { kind: 'added' } | { kind: 'cannot' } | null;

/** PURE view. `fmt` prints the date in the page's language. */
export function InstallStatusView({ view, labels, fmt }: { view: StatusView; labels: StatusLabels; fmt: (ms: number) => string }) {
  if (!view) return null;
  if (view.kind === 'notnow') return <p className="kv-field__hint" role="status" data-kv-install-status="notnow">{labels.notNow.replace('{date}', fmt(view.until))}</p>;
  if (view.kind === 'added') return <p className="kv-field__hint" role="status" data-kv-install-status="added">{labels.added}</p>;
  return <p className="kv-field__hint" role="status" data-kv-install-status="cannot">{labels.cannot}</p>;
}

export function InstallStatus({ labels, lang }: { labels: StatusLabels; lang: string }) {
  const [view, setView] = useState<StatusView>(null);
  useEffect(() => {
    try {
      const s = installStatus(readInstall(cookieValue(document.cookie, INSTALL_COOKIE)), Date.now());
      if (s) { setView(s); return; }
      if (!('onbeforeinstallprompt' in window)) setView({ kind: 'cannot' });
    } catch { setView(null); }
  }, []);
  let fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  try { const df = new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }); fmt = (ms) => df.format(new Date(ms)); } catch { /* the ISO date */ }
  return <InstallStatusView view={view} labels={labels} fmt={fmt} />;
}
