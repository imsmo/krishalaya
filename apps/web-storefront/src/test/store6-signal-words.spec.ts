// apps/web-storefront/src/test/store6-signal-words.spec.ts · PC-56 STORE-6a · D1 — "PAY — NEEDS SIGNAL", AND WHY. The storefront-local layer over the
// drift-pinned port, run against a small DOM double (no jsdom in this repo): it prints a money form's reason beside the button the PORT held
// (`applySignal` itself, the real port function), lifts it when the port lifts the hold, holds the standalone Pay button with its reason and
// restores it exactly, and is idempotent (the MutationObserver may run it many times).
import { applySignal } from '../features/offline/signal';
import { applyReasons, isDegraded } from '../features/store6/signal-words';

// ── a minimal element double: attributes, dataset, text, children, closest, insertAdjacentElement, remove ──
class El {
  tag: string; attrs = new Map<string, string>(); dataset: Record<string, string | undefined> = {}; children: El[] = []; parent: El | null = null;
  textContent: string | null = ''; disabled = false; method = '';
  constructor(tag: string, attrs: Record<string, string> = {}, text = '') { this.tag = tag; for (const [k, v] of Object.entries(attrs)) this.setAttribute(k, v); this.textContent = text; }
  getAttribute(n: string) { if (n.startsWith('data-')) { const k = n.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase()); return this.dataset[k] ?? null; } return this.attrs.get(n) ?? null; }
  setAttribute(n: string, v: string) { if (n.startsWith('data-')) { const k = n.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase()); this.dataset[k] = v; } else this.attrs.set(n, v); if (n === 'method') this.method = v; }
  removeAttribute(n: string) { this.attrs.delete(n); }
  append(...c: El[]) { for (const x of c) { x.parent = this; this.children.push(x); } return this; }
  all(): El[] { return this.children.flatMap((c) => [c, ...c.all()]); }
  matches(sel: string): boolean {
    return sel.split(',').map((s) => s.trim()).some((one) => {
      const m = /^([a-z]+)?((?:\[[^\]]+\]|:not\(\[[^\]]+\]\))*)$/.exec(one); if (!m) return false;
      if (m[1] && m[1] !== this.tag) return false;
      for (const part of m[2].match(/:not\(\[[^\]]+\]\)|\[[^\]]+\]/g) ?? []) {
        const neg = part.startsWith(':not'); const inner = /\[([\w-]+)(?:="([^"]*)")?\]/.exec(part)!;
        const v = this.getAttribute(inner[1]); const ok = inner[2] === undefined ? v !== null : v === inner[2];
        if (neg ? ok : !ok) return false;
      }
      return true;
    });
  }
  querySelectorAll(sel: string) { return this.all().filter((e) => e.matches(sel)); }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
  closest(sel: string): El | null { let e: El | null = this.parent; while (e) { if (e.matches(sel)) return e; e = e.parent; } return null; }
  insertAdjacentElement(_w: 'afterend', el: El) { const p = this.parent!; el.parent = p; p.children.splice(p.children.indexOf(this) + 1, 0, el); return el; }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
}
const doc = (body: El) => ({ querySelector: (s: string) => body.querySelector(s), querySelectorAll: (s: string) => body.querySelectorAll(s), createElement: (t: string) => new El(t) });
const WORDS = { paymentAttempt: 'a payment made hours later at a changed price would be a betrayal, not a convenience.', placeOrder: 'an order is placed only with a live answer.' };
const NEEDS = '— needs signal';
function page() {
  const body = new El('body');
  const place = new El('form', { method: 'post', 'data-kv-act-class': 'money', 'data-kv-needs-signal-reason': 'placeOrder' }).append(new El('button', { type: 'submit' }, 'Place order'));
  const search = new El('form', { method: 'get' }).append(new El('button', { type: 'submit' }, 'Search'));
  const line = new El('form', { method: 'post' }).append(new El('button', { type: 'submit' }, 'Remove'));
  const pay = new El('button', { type: 'button', 'data-kv-act-class': 'money', 'data-kv-needs-signal-reason': 'paymentAttempt' }, 'Pay');
  const payBox = new El('div').append(pay);
  body.append(place, search, line, payBox);
  return { body, place, search, line, pay, payBox, d: doc(body) };
}
const banner = () => new El('div', { 'data-kv-signal': 'degraded' });

describe('STORE-6a · D1 · the reason beside "— needs signal"', () => {
  it('live: nothing changes (no banner, nothing held)', () => {
    const p = page();
    expect(isDegraded(p.d)).toBe(false);
    expect(applyReasons(p.d as never, WORDS, NEEDS)).toBe(0);
    expect(p.pay.disabled).toBe(false); expect(p.pay.textContent).toBe('Pay');
  });
  it('degraded: the PORT holds every POST button; this layer adds the money form\'s reason beside it and holds + words the Pay button', () => {
    const p = page(); const b = banner(); p.body.append(b);
    applySignal(p.d as never, 'degraded', NEEDS);                                     // the drift-pinned port, unchanged
    expect(p.place.children[0].textContent).toBe(`Place order ${NEEDS}`);
    expect(applyReasons(p.d as never, WORDS, NEEDS)).toBe(2);
    const r = p.place.querySelector('[data-kv-signal-reason]')!;
    expect([r.textContent, r.getAttribute('data-kv-signal-reason'), r.getAttribute('role')]).toEqual([WORDS.placeOrder, 'placeOrder', 'note']);
    expect(p.line.querySelector('[data-kv-signal-reason]')).toBeNull();               // a content form: held by the port, no money reason
    expect(p.search.querySelector('[data-kv-signal-reason]')).toBeNull();
    expect([p.pay.disabled, p.pay.textContent, p.pay.getAttribute('aria-disabled')]).toEqual([true, `Pay ${NEEDS}`, 'true']);
    expect(p.payBox.querySelector('[data-kv-signal-reason="paymentAttempt"]')!.textContent).toBe(WORDS.paymentAttempt);
    expect(applyReasons(p.d as never, WORDS, NEEDS)).toBe(0);                         // idempotent
    expect(p.body.querySelectorAll('[data-kv-signal-reason]').length).toBe(2);
    // the signal returns: the port lifts its holds, this layer lifts the reasons and restores the Pay button exactly
    b.remove(); applySignal(p.d as never, 'live', NEEDS);
    expect(applyReasons(p.d as never, WORDS, NEEDS)).toBe(3);
    expect(p.body.querySelectorAll('[data-kv-signal-reason]').length).toBe(0);
    expect([p.pay.disabled, p.pay.textContent, p.pay.getAttribute('aria-disabled')]).toEqual([false, 'Pay', null]);
    expect(p.place.children[0].textContent).toBe('Place order');
  });
  it('a button already disabled stays disabled when the signal returns (the port\'s own rule, kept for the Pay button)', () => {
    const p = page(); p.pay.disabled = true; const b = banner(); p.body.append(b);
    applyReasons(p.d as never, WORDS, NEEDS); b.remove(); applyReasons(p.d as never, WORDS, NEEDS);
    expect(p.pay.disabled).toBe(true);
  });
});
