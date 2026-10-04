// apps/web-tenant/src/features/offline/signal.ts · PC-56 TENANT-SW-f · W318 §2 — READ-ONLY DEGRADED MODE, pure.
//
// W318: *"Read-only while offline — console WRITE actions (approve, pay, publish, suspend) need a live server answer … Buttons show
// '— needs signal' with words, not a spinner that lies."* The decision is two facts: the browser's `navigator.onLine` and a lightweight
// heartbeat to the console's own `/api/ping` (which asks the API's `/healthz`). Either one failing → degraded. In degraded mode EVERY
// write button — every submit of a form that POSTs (a server action) — is disabled and says "— needs signal"; GET forms (filters, the
// chain's "check the reason" step) and every link stay usable: navigation through cached pages stays free (W318 "Don't hide the nav").
//
// NOTHING IS QUEUED: there is no service worker and no local draft queue (refused by name, NO_OFFLINE_WRITE_QUEUE), so "never auto-replay a
// console write" holds by construction — a write the operator could not send is pressed again, by them, on a live page.

export type SignalMode = 'live' | 'degraded';
export const HEARTBEAT_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 5_000;
export const PING_PATH = '/api/ping';
export const NO_OFFLINE_WRITE_QUEUE = 'NO_OFFLINE_WRITE_QUEUE';

/** Offline in the browser, or the heartbeat failed → degraded. An unknown heartbeat (not yet asked) trusts the browser. */
export function signalMode(online: boolean, heartbeatOk: boolean | null): SignalMode {
  if (!online) return 'degraded';
  if (heartbeatOk === false) return 'degraded';
  return 'live';
}

/** The minimal DOM this needs — so the rule is testable without a browser. */
export interface SignalButton { disabled: boolean; getAttribute(n: string): string | null; setAttribute(n: string, v: string): void; removeAttribute(n: string): void;
  dataset: Record<string, string | undefined>; textContent: string | null }
export interface SignalForm { method: string; getAttribute(n: string): string | null; querySelectorAll(sel: string): ArrayLike<SignalButton> }
export interface SignalDoc { querySelectorAll(sel: string): ArrayLike<SignalForm> }

const isWriteForm = (f: SignalForm) => (f.method || f.getAttribute('method') || 'get').toLowerCase() === 'post';

/**
 * Apply (or lift) degraded mode: every submit button of every POST form is disabled with "— needs signal" appended (remembering its own
 * words and whether it was already disabled, so lifting restores the page exactly). Returns how many write buttons it touched.
 */
export function applySignal(doc: SignalDoc, mode: SignalMode, needsSignal: string): number {
  let n = 0;
  const forms = doc.querySelectorAll('form');
  for (let i = 0; i < forms.length; i++) {
    const f = forms[i];
    if (!isWriteForm(f)) continue;
    const buttons = f.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"]');
    for (let j = 0; j < buttons.length; j++) {
      const b = buttons[j];
      if (mode === 'degraded') {
        if (b.dataset.kvSignal === 'held') continue;
        b.dataset.kvSignal = 'held';
        b.dataset.kvWasDisabled = b.disabled ? '1' : '0';
        b.dataset.kvLabel = b.textContent ?? '';
        b.disabled = true;
        b.setAttribute('aria-disabled', 'true');
        b.textContent = `${b.textContent ?? ''} ${needsSignal}`;
        n++;
      } else if (b.dataset.kvSignal === 'held') {
        b.disabled = b.dataset.kvWasDisabled === '1';
        b.removeAttribute('aria-disabled');
        b.textContent = b.dataset.kvLabel ?? b.textContent;
        delete b.dataset.kvSignal; delete b.dataset.kvWasDisabled; delete b.dataset.kvLabel;
        n++;
      }
    }
  }
  return n;
}
