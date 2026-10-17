// apps/web-storefront/src/features/store6/signal-words.ts · PC-56 STORE-6a · D1 — "PAY — NEEDS SIGNAL", AND WHY, IN WORDS. PURE.
// The drift-pinned port (features/offline/signal.ts + components/OnlineGuard.tsx, byte-identical to web-tenant's) holds every submit of every
// POST form "— needs signal" while the signal is down and lifts it when it returns. It has no notion of WHY. This storefront-local layer reads
// the port's own output — never edits it:
//   • degraded = the port's banner is on the page (`[data-kv-signal="degraded"]`);
//   • a form marked `data-kv-needs-signal-reason="<key>"` (features/store6/acts.ts `actAttrs` — the 16 money acts, the sign-in / signup codes,
//     the download links) whose buttons the port HELD gets ONE sentence beside them: the reason in words (`store6.reason.<key>`); when the port
//     lifts the hold, the sentence goes;
//   • a money BUTTON that is not inside a form (the Pay button — a client button that opens the payment sheet, which the port's form rule
//     cannot see) is held here the same way the port holds a form's submit (disabled, "— needs signal" appended, its own words remembered and
//     restored exactly), with its reason beside it.
// Nothing is queued, nothing is replayed: the person presses again on a live page (NO_OFFLINE_WRITE_QUEUE, the port's constant).

export const REASON_ATTR = 'data-kv-needs-signal-reason';
export const ACT_CLASS_ATTR = 'data-kv-act-class';
export const REASON_NODE_ATTR = 'data-kv-signal-reason';

/** The minimal DOM this needs — the rule is tested without a browser (test/store6-signal-words.spec.ts). */
export interface WordsNode {
  getAttribute(n: string): string | null; setAttribute(n: string, v: string): void; removeAttribute(n: string): void;
  dataset: Record<string, string | undefined>; textContent: string | null; disabled?: boolean;
  querySelectorAll(sel: string): ArrayLike<WordsNode>; querySelector(sel: string): WordsNode | null;
  closest(sel: string): WordsNode | null;
  insertAdjacentElement(where: 'afterend', el: WordsNode): unknown;
  remove(): void;
}
export interface WordsDoc { querySelector(sel: string): WordsNode | null; querySelectorAll(sel: string): ArrayLike<WordsNode>; createElement(tag: string): WordsNode }

/** Is the port's degraded banner on the page? */
export function isDegraded(doc: Pick<WordsDoc, 'querySelector'>): boolean {
  return doc.querySelector('[data-kv-signal="degraded"]') !== null;
}

function reasonNode(doc: WordsDoc, key: string, words: string): WordsNode {
  const s = doc.createElement('span');
  s.setAttribute('class', 'kv-signal__reason');
  s.setAttribute(REASON_NODE_ATTR, key);
  s.setAttribute('role', 'note');
  s.textContent = words;
  return s;
}

/**
 * Print (or lift) the reasons. `words` maps a reason key to its sentence; `needsSignal` is the port's "— needs signal" label (for the standalone
 * money buttons this layer holds itself). Idempotent: run it as often as the DOM changes. Returns how many nodes it changed.
 */
export function applyReasons(doc: WordsDoc, words: Record<string, string>, needsSignal: string): number {
  const degraded = isDegraded(doc);
  let n = 0;
  // 1 · forms the port holds: a sentence beside the held button(s)
  const forms = doc.querySelectorAll(`form[${REASON_ATTR}]`);
  for (let i = 0; i < forms.length; i++) {
    const f = forms[i];
    const key = f.getAttribute(REASON_ATTR) ?? '';
    const held = f.querySelectorAll('[data-kv-signal="held"]');
    const existing = f.querySelector(`[${REASON_NODE_ATTR}]`);
    if (held.length > 0 && !existing && words[key]) { held[held.length - 1].insertAdjacentElement('afterend', reasonNode(doc, key, words[key])); n++; }
    if (held.length === 0 && existing) { existing.remove(); n++; }
  }
  // 2 · standalone money buttons (outside any form): held here, with the reason
  const buttons = doc.querySelectorAll(`button[${REASON_ATTR}]`);
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    if (b.closest('form')) continue;                       // a form's button is the port's to hold
    const key = b.getAttribute(REASON_ATTR) ?? '';
    if (degraded && b.dataset.kvSignalOwn !== 'held') {
      b.dataset.kvSignalOwn = 'held';
      b.dataset.kvWasDisabled = b.disabled ? '1' : '0';
      b.dataset.kvLabel = b.textContent ?? '';
      b.disabled = true;
      b.setAttribute('aria-disabled', 'true');
      b.textContent = `${b.textContent ?? ''} ${needsSignal}`;
      if (words[key]) b.insertAdjacentElement('afterend', reasonNode(doc, key, words[key]));
      n++;
    } else if (!degraded && b.dataset.kvSignalOwn === 'held') {
      b.disabled = b.dataset.kvWasDisabled === '1';
      b.removeAttribute('aria-disabled');
      b.textContent = b.dataset.kvLabel ?? b.textContent;
      delete b.dataset.kvSignalOwn; delete b.dataset.kvWasDisabled; delete b.dataset.kvLabel;
      n++;
    }
  }
  if (!degraded) {
    // a standalone button's sentence sits beside it, outside any form — lift every one left once the signal is back
    const left = doc.querySelectorAll(`[${REASON_NODE_ATTR}]`);
    for (let i = 0; i < left.length; i++) { if (!left[i].closest('form')) { left[i].remove(); n++; } }
  }
  return n;
}
