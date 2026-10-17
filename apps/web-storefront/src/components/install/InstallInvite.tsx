'use client';
// apps/web-storefront/src/components/install/InstallInvite.tsx · PC-56 STORE-6b · D3 (founder Q8) / C2 (canon W3138, W3139, W3140) — THE INSTALL
// INVITATION: a dismissible bottom sheet that never blocks the page. Mounted ONCE in each chrome's layout with the name and icon the store's
// manifest has (`{ name, iconHref, flagOn }`; the platform layout passes the platform store's name and icon and `flagOn: false` — the platform
// host reads the tenant-scoped `storefront_install_prompt` absent, so OFF: the 6a Q1 limit, named).
//   • flag OFF → nothing at all: no listener, no cookie written, the browser's own install untouched;
//   • flag ON → the device's visit is counted once a day (`kvs_visits`, written HERE — no server round-trip, no API, no audit row); the browser's
//     own prompt event (`beforeinstallprompt`) is held; the sheet opens only when `shouldInvite` says so (the 2nd visit or later, no "Not now"
//     from the last 30 days, not already added); a browser that never fires the event (iOS, Firefox) gets NO sheet — the `/app` page says the
//     Share → Add to Home Screen way;
//   • "Add to home screen" → the browser's prompt → accepted (or `appinstalled`) → "Added — opens as <organisation>" (W3139) and `added:<ISO>`;
//     dismissed → "Not added — add it later from the App page" (W3140) and `notnow:<ISO>` (30 days); "Not now" → the same mark, the sheet
//     closes. Each outcome also links the `/app` page with its state (`?install=success|failure|error`).
import { useEffect, useRef, useState } from 'react';
import {
  INSTALL_COOKIE, VISITS_COOKIE, bumpVisits, cookieValue, dayOf, deviceCookie, installValue, readInstall, shouldInvite,
} from '../../features/store6b/install';

export interface InviteLabels { title: string; body: string; add: string; notNow: string; added: string; notAdded: string; close: string; appLink: string; label: string }
export type SheetState = 'closed' | 'open' | 'added' | 'notadded' | 'error';

interface PromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

/** PURE view — the render tests render each state. */
export function InstallSheetView({ state, name, iconHref, labels, appHref, onAdd, onNotNow, onClose }: {
  state: SheetState; name: string; iconHref: string; labels: InviteLabels; appHref: string; onAdd?: () => void; onNotNow?: () => void; onClose?: () => void;
}) {
  if (state === 'closed') return null;
  const n = (s: string) => s.replace('{name}', name);
  return (
    <aside className="kv-install-sheet" role="dialog" aria-modal="false" aria-label={labels.label} data-kv-install-sheet={state}>
      <img src={iconHref} alt="" width={48} height={48} className="kv-install-sheet__icon" data-kv-install-icon="" />
      {state === 'open' && (
        <>
          <p><strong>{n(labels.title)}</strong></p>
          <p className="kv-field__hint">{labels.body}</p>
          <p className="kv-cart__actions">
            <button type="button" className="kv-btn" data-kv-act="install-add" onClick={onAdd}>{labels.add}</button>{' '}
            <button type="button" className="kv-btn--link" data-kv-act="install-notnow" onClick={onNotNow}>{labels.notNow}</button>
          </p>
        </>
      )}
      {state === 'added' && <p role="status" data-kv-install-outcome="success">{n(labels.added)} <a href={`${appHref}?install=success`} className="kv-btn--link">{labels.appLink}</a></p>}
      {state === 'notadded' && <p role="status" data-kv-install-outcome="failure">{labels.notAdded} <a href={`${appHref}?install=failure`} className="kv-btn--link">{labels.appLink}</a></p>}
      {state === 'error' && <p role="status" data-kv-install-outcome="error"><a href={`${appHref}?install=error`} className="kv-btn--link">{labels.appLink}</a></p>}
      {state !== 'open' && <button type="button" className="kv-btn--link" data-kv-act="install-close" onClick={onClose}>{labels.close}</button>}
    </aside>
  );
}

export function InstallInvite({ name, iconHref, flagOn, appHref, labels }: { name: string; iconHref: string; flagOn: boolean; appHref: string; labels: InviteLabels }) {
  const [state, setState] = useState<SheetState>('closed');
  const held = useRef<PromptEvent | null>(null);
  const secure = typeof location !== 'undefined' && location.protocol === 'https:';
  const mark = (kind: 'notnow' | 'added') => { try { document.cookie = deviceCookie(INSTALL_COOKIE, installValue(kind, new Date()), secure); } catch { /* blocked: nothing kept */ } };
  useEffect(() => {
    if (!flagOn) return;                                                  // OFF: nothing is listened to, nothing is written
    let visits = 0;
    try {
      const b = bumpVisits(cookieValue(document.cookie, VISITS_COOKIE), dayOf(new Date()));
      visits = b.visits;
      if (b.changed) document.cookie = deviceCookie(VISITS_COOKIE, b.value, secure);
    } catch { visits = 0; }
    const installedNow = () => {
      const m = readInstall(cookieValue(document.cookie, INSTALL_COOKIE));
      let standalone = false;
      try { standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true; } catch { standalone = false; }
      return { m, installed: m?.kind === 'added' || standalone };
    };
    const onPrompt = (e: Event) => {
      e.preventDefault();                                                 // the store decides when to ask (never on the first visit)
      held.current = e as PromptEvent;
      const { m, installed } = installedNow();
      if (shouldInvite({ visits, notNowAt: m?.kind === 'notnow' ? m.at : null, installed, supported: true, flagOn }, Date.now())) setState('open');
    };
    const onInstalled = () => { mark('added'); setState((s) => (s === 'closed' ? s : 'added')); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, [flagOn]);   // eslint-disable-line react-hooks/exhaustive-deps -- one mount per page
  const add = async () => {
    const e = held.current;
    if (!e) { setState('error'); return; }
    try {
      await e.prompt();
      const c = await e.userChoice;
      held.current = null;
      if (c.outcome === 'accepted') { mark('added'); setState('added'); } else { mark('notnow'); setState('notadded'); }
    } catch { setState('error'); }
  };
  const notNow = () => { mark('notnow'); setState('closed'); };
  return (
    <>
      {/* the island is armed only where the organisation switched it on (the server's HTML says so; nothing personal in it) */}
      {flagOn && <span hidden data-kv-install-invite="on" />}
      <InstallSheetView state={state} name={name} iconHref={iconHref} labels={labels} appHref={appHref} onAdd={() => { void add(); }} onNotNow={notNow} onClose={() => setState('closed')} />
    </>
  );
}
