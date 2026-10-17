// apps/web-storefront/src/features/store5a/accessibility.ts · PC-56 STORE-5a · C4 (founder D4 / Q17) — THE ACCESSIBILITY PAGE'S PURE HALF (W324
// + the save chain W3074–W3076). No React, no Next, no I/O; unit-tested in test/store5a-reviews.spec.ts.
//
//   • THREE device modes, each its own cookie and its own `<html>` attribute, so they STACK: Senior Farmer Mode (`kvs_senior` on/off →
//     data-senior="true"), High contrast (`kvs_contrast` on/off → data-contrast="true"), Calm motion (`kvs_motion` calm/off → data-motion="calm").
//     The parsers are @krishalaya/ui's (isSeniorOn / isContrastOn / isCalmMotionOn). Voice-first is refused by name.
//   • THE SAVE (W3074 is a DELTA: a device preference has no confirm — the chain is the save itself): each switch posts `/api/mechanism` with
//     `chain=a11y`; the route answers 303 back to the page with `?a11y=saved&mode=<mode>` (W3075 — the page re-rendered in the mode(s)) or, when
//     the post cannot be read or a value is not one the mode takes, NO cookie is set (nothing half-switched) and `?a11y=err&want=<mode>:<value>`
//     (W3076 — "Couldn't save — the previous setting still applies" + Retry re-posting the SAME values).
//   • THE FLOOR printed as facts — only what the stylesheet proves (styles/globals.css, pinned by a spec): 44px targets, 56px money actions in
//     every mode, a visible focus ring. "Colour never alone" and the screen-reader order are unaudited → refused by name until audited.
import { ACCESSIBILITY_COOKIE_VALUES, type AccessibilityMode } from '@krishalaya/ui';

export const A11Y_MODES: readonly AccessibilityMode[] = ['senior', 'contrast', 'motion'];
export const A11Y_COOKIES: Readonly<Record<AccessibilityMode, string>> = Object.freeze({ senior: 'kvs_senior', contrast: 'kvs_contrast', motion: 'kvs_motion' });
/** The value a switch posts to turn a mode on / off. */
export function modeValue(mode: AccessibilityMode, on: boolean): string {
  const [onV, offV] = ACCESSIBILITY_COOKIE_VALUES[mode];
  return on ? onV : offV;
}
export function isModeValue(mode: AccessibilityMode, v: string): boolean {
  return (ACCESSIBILITY_COOKIE_VALUES[mode] as readonly string[]).includes(v);
}

/** The route's decision for one POST (pure): which cookies to set, or — for the accessibility chain — an error with nothing set.
 *  `theme` keeps its old lenient rule (unknown → system); `senior` posted WITHOUT the chain keeps 4c's lenient rule (anything but "on" → off). */
export interface MechanismDecision { set: Array<{ cookie: string; value: string }>; chain: boolean; error: boolean; mode: AccessibilityMode | null; want: string | null }
export function mechanismDecision(form: { has: (k: string) => boolean; get: (k: string) => unknown } | null, themes: readonly string[]): MechanismDecision {
  if (!form) return { set: [], chain: true, error: true, mode: null, want: null };
  const chain = String(form.get('chain') ?? '') === 'a11y';
  const set: Array<{ cookie: string; value: string }> = [];
  if (form.has('theme')) { const raw = String(form.get('theme') ?? ''); set.push({ cookie: 'kvs_theme', value: themes.includes(raw) ? raw : 'system' }); }
  let mode: AccessibilityMode | null = null; let want: string | null = null;
  for (const m of A11Y_MODES) {
    if (!form.has(m)) continue;
    const raw = String(form.get(m) ?? '');
    mode = m; want = isModeValue(m, raw) ? `${m}:${raw}` : null;
    if (isModeValue(m, raw)) set.push({ cookie: A11Y_COOKIES[m], value: raw });
    else if (m === 'senior' && !chain) set.push({ cookie: A11Y_COOKIES.senior, value: 'off' });
    else return { set: [], chain: true, error: true, mode: m, want: null };   // not a value of this mode → nothing is set
  }
  if (chain && !mode) return { set: [], chain: true, error: true, mode: null, want: null };
  return { set, chain, error: false, mode, want };
}

/** Where the route sends the browser back: the same-origin page, with the chain's outcome when the post was the accessibility chain. */
export function a11yReturn(path: string, d: Pick<MechanismDecision, 'chain' | 'error' | 'mode' | 'want'>): string {
  if (!d.chain) return path;
  const [p, qs = ''] = path.split('?');
  const sp = new URLSearchParams(qs);
  for (const k of ['a11y', 'mode', 'want']) sp.delete(k);
  sp.set('a11y', d.error ? 'err' : 'saved');
  if (!d.error && d.mode) sp.set('mode', d.mode);
  if (d.error && d.want) sp.set('want', d.want);
  return `${p}?${sp.toString()}`;
}

/** W3075 / W3076 read back from the page's query: the outcome, the mode saved, the values a Retry re-posts (only a real mode and value). */
export function readA11yQuery(sp: Record<string, string | string[] | undefined>): { status: 'saved' | 'err' | null; mode: AccessibilityMode | null; want: { mode: AccessibilityMode; value: string } | null } {
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const s = one('a11y'); const status = s === 'saved' || s === 'err' ? s : null;
  const m = one('mode'); const mode = (A11Y_MODES as readonly string[]).includes(String(m)) ? (m as AccessibilityMode) : null;
  const w = String(one('want') ?? ''); const [wm, wv] = w.split(':');
  const want = (A11Y_MODES as readonly string[]).includes(wm) && typeof wv === 'string' && isModeValue(wm as AccessibilityMode, wv) ? { mode: wm as AccessibilityMode, value: wv } : null;
  return { status, mode: status === 'saved' ? mode : null, want: status === 'err' ? want : null };
}

/** "Always true" — only what the stylesheet proves (test/store5a-reviews.spec.ts reads styles/globals.css for each). */
export const A11Y_FLOOR = ['targets', 'money', 'focus'] as const;
/** The pixel facts the floor sentences interpolate — the SAME numbers the stylesheet sets (the spec reads globals.css for each). */
export const A11Y_FLOOR_PX = Object.freeze({ targets: 44, money: 56 });
