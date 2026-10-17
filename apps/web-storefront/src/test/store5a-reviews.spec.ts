import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// apps/web-storefront/src/test/store5a-reviews.spec.ts · PC-56 STORE-5a · C6 — the review and accessibility pages' PURE halves, pinned:
//   • W290's state from the SERVER's answers only (no client clock); the form codec (stars required, the vocabulary's dimensions, the words
//     ≤ 4,000) with the values always returned; the chain keys; the held draft (deflated, ≤ 3 cookies — a 4,000-character Gujarati review fits;
//     a foreign key / order / tampered chunk is refused); the named failures; old vs new and the PATCH;
//   • the accessibility route's decision (a chain post sets a cookie or NOTHING; the outcome on the way back; the old lenient senior rule
//     without the chain) and its query read back (only a real mode and value is re-posted);
//   • the floor the page prints is what the stylesheet proves (44px, 56px money actions outside senior mode, the focus ring, contrast and calm
//     motion — with the phone's own settings);
//   • the refusal registry (exhaustive, unique, every key in every catalogue, the 12 canon files) and the i18n parity (2,039 ×3).
import {
  reviewPageState, readReviewForm, readFormError, encodeReviewDraft, decodeReviewDraft, REVIEW_DRAFT_CHUNKS, submitFailureOf, editFailureOf, editDiff, editPatch,
  readKey, SUBMIT_KEY_RE, EDIT_KEY_RE, submitKey, editKey, reviewHref, reviewEditHref, REVIEW_BODY_MAX, SUBMIT_FAILURES, EDIT_FAILURES, type ReviewDraft,
} from '../features/store5a/review';
import { mechanismDecision, a11yReturn, readA11yQuery, modeValue, A11Y_FLOOR_PX, A11Y_COOKIES } from '../features/store5a/accessibility';
import { STORE5A_REFUSALS, STORE5A_DELTAS, STORE5A_CHAIN_PAGES, store5aRefusalKeys } from '../features/store5a/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const OID = '0218e000-0000-7000-8000-000000000001';
const KEY = 'review:0218c000-0000-4000-8000-000000000001';
const fd = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null, names: Object.keys(o) });

describe('STORE-5a · W290 which state (the server\'s answers only)', () => {
  const ok = { eligible: true, windowOpen: true, reviewed: false };
  it('flag → completion → eligibility → reviewed (editable or locked) → the window → the form', () => {
    expect(reviewPageState({ flagOn: false, orderStatus: 'completed', elig: ok, mineEditable: null })).toBe('off');
    expect(reviewPageState({ flagOn: true, orderStatus: 'delivered', elig: ok, mineEditable: null })).toBe('not_completed');
    expect(reviewPageState({ flagOn: true, orderStatus: 'completed', elig: null, mineEditable: null })).toBe('not_eligible');
    expect(reviewPageState({ flagOn: true, orderStatus: 'completed', elig: { ...ok, eligible: false }, mineEditable: null })).toBe('not_eligible');
    expect(reviewPageState({ flagOn: true, orderStatus: 'completed', elig: { ...ok, reviewed: true }, mineEditable: true })).toBe('reviewed');
    expect(reviewPageState({ flagOn: true, orderStatus: 'completed', elig: { ...ok, reviewed: true }, mineEditable: false })).toBe('locked');
    expect(reviewPageState({ flagOn: true, orderStatus: 'completed', elig: { ...ok, reviewed: true }, mineEditable: null })).toBe('locked');   // unknown → no edit offered
    expect(reviewPageState({ flagOn: true, orderStatus: 'completed', elig: { ...ok, windowOpen: false }, mineEditable: null })).toBe('closed');
    expect(reviewPageState({ flagOn: true, orderStatus: 'completed', elig: ok, mineEditable: null })).toBe('form');
  });
  it('the routes live under the organisation', () => {
    expect(reviewHref('anand-fpo', OID)).toBe(`/anand-fpo/orders/${OID}/review`);
    expect(reviewEditHref('anand-fpo', OID, { step: 'review', k: KEY, x: '' })).toBe(`/anand-fpo/orders/${OID}/review/edit?step=review&k=${encodeURIComponent(KEY)}`);
  });
});

describe('STORE-5a · the form codec (W290 / W3141)', () => {
  const vocab = ['quality', 'freshness', 'packaging'];
  it('stars are required 1–5; each sub-rating a known code 1–5 (blank = not rated); the words trimmed ≤ 4,000; the values ALWAYS returned', () => {
    const a = fd({ stars: '4', 'dim.quality': '5', 'dim.freshness': '', body: '  good  ' });
    expect(readReviewForm(a.get, a.names, vocab)).toEqual({ values: { stars: 4, subRatings: { quality: 5 }, body: 'good' }, errors: [] });
    const b = fd({ stars: '', 'dim.taste': '4', 'dim.quality': '9', body: 'x'.repeat(REVIEW_BODY_MAX + 1) });
    const r = readReviewForm(b.get, b.names, vocab);
    expect(r.errors).toEqual(['stars', 'dimension', 'body_long']);
    expect(r.values.body.length).toBe(REVIEW_BODY_MAX + 1);
    const c = fd({ stars: '3', 'dim.taste': '4' });
    expect(readReviewForm(c.get, c.names, null)).toEqual({ values: { stars: 3, subRatings: { taste: 4 }, body: '' }, errors: [] });   // vocabulary unreadable → the API judges
    expect([readFormError('stars'), readFormError('nothing'), readFormError('x'), readFormError(undefined)]).toEqual(['stars', 'nothing', null, null]);
  });
  it('the chain keys', () => {
    expect(submitKey('0218c000-0000-4000-8000-000000000001')).toBe(KEY);
    expect(editKey('0218c000-0000-4000-8000-000000000001')).toBe('review-edit:0218c000-0000-4000-8000-000000000001');
    expect([readKey(KEY, SUBMIT_KEY_RE), readKey(KEY, EDIT_KEY_RE), readKey('review:x', SUBMIT_KEY_RE), readKey([KEY], SUBMIT_KEY_RE)]).toEqual([KEY, null, null, KEY]);
  });
});

describe('STORE-5a · the held draft (never the URL)', () => {
  const d = (over: Partial<ReviewDraft> = {}): ReviewDraft => ({ v: 1, mode: 'submit', key: KEY, orderId: OID, reviewId: null, stars: 5, subRatings: { quality: 4 }, body: 'ok', ...over });
  it('round-trips; a 4,000-character Gujarati review fits in at most three cookies', () => {
    expect(decodeReviewDraft(encodeReviewDraft(d())!, KEY, OID)).toEqual(d());
    const gujarati = 'ભીંડા તાજા હતા અને વજન બરાબર હતું. '.repeat(200).slice(0, REVIEW_BODY_MAX);
    const parts = encodeReviewDraft(d({ body: gujarati }))!;
    expect(parts.length).toBeLessThanOrEqual(REVIEW_DRAFT_CHUNKS);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(3800);
    expect(decodeReviewDraft(parts, KEY, OID)!.body).toBe(gujarati);
  });
  it('a foreign key, another order, a tampered chunk, an edit without its review → null; a form-error draft keeps a null star', () => {
    const parts = encodeReviewDraft(d())!;
    expect(decodeReviewDraft(parts, 'review:0218c000-0000-4000-8000-000000000009', OID)).toBeNull();
    expect(decodeReviewDraft(parts, KEY, '0218e000-0000-7000-8000-000000000002')).toBeNull();
    expect(decodeReviewDraft(['x' + parts[0].slice(1)], KEY, OID)).toBeNull();
    expect(decodeReviewDraft(['not base64!'], KEY, OID)).toBeNull();
    expect(decodeReviewDraft(encodeReviewDraft(d({ mode: 'edit', reviewId: null }))!, KEY, OID)).toBeNull();
    expect(decodeReviewDraft(encodeReviewDraft(d({ stars: null }))!, KEY, OID)!.stars).toBeNull();
    expect(decodeReviewDraft([], KEY, OID)).toBeNull();
  });
});

describe('STORE-5a · the named failures, old vs new, the PATCH', () => {
  it('the submit (W3147) and the edit (W3144) failures by name; the flag OFF answer (404 NOT_FOUND) is "off"', () => {
    expect(['REVIEW_NOT_ELIGIBLE', 'REVIEW_DUPLICATE', 'REVIEW_WINDOW_CLOSED', 'REVIEW_DIMENSION_UNKNOWN', 'REVIEW_INVALID', 'NOT_FOUND', 'X'].map((c) => submitFailureOf(c, c === 'NOT_FOUND' ? 404 : 409)))
      .toEqual(['not_eligible', 'duplicate', 'window_closed', 'dimension', 'invalid', 'off', 'server']);
    expect(['REVIEW_LOCKED', 'REVIEW_REMOVED', 'REVIEW_INVALID', 'REVIEW_DIMENSION_UNKNOWN', 'NOT_FOUND', 'X'].map((c) => editFailureOf(c, c === 'NOT_FOUND' ? 404 : 409)))
      .toEqual(['locked', 'removed', 'invalid', 'dimension', 'off', 'server']);
    expect([SUBMIT_FAILURES.length, EDIT_FAILURES.length]).toEqual([7, 6]);
  });
  it('old vs new: one row per field the buyer can change; the PATCH carries only what changed (nothing → null)', () => {
    const before = { stars: 4, subRatings: { quality: 4 }, body: 'a' };
    const rows = editDiff(before, { stars: 2, subRatings: { quality: 4, packaging: 1 }, body: 'b' }, ['quality', 'freshness', 'packaging'], '—');
    expect(rows.map((r) => [r.field, r.before, r.after, r.changed])).toEqual([
      ['stars', '4', '2', true], ['dim.quality', '4', '4', false], ['dim.freshness', '—', '—', false], ['dim.packaging', '—', '1', true], ['body', 'a', 'b', true]]);
    expect(editPatch(before, { stars: 4, subRatings: { quality: 4 }, body: 'a' })).toBeNull();
    expect(editPatch(before, { stars: 4, subRatings: {}, body: '' })).toEqual({ subRatings: {}, body: null });
  });
});

describe('STORE-5a · the accessibility route and page (pure)', () => {
  const form = (o: Record<string, string>) => ({ has: (k: string) => k in o, get: (k: string) => o[k] });
  const THEMES = ['light', 'dark', 'system'];
  it('a chain post sets ONE cookie per valid mode; a value the mode does not take sets NOTHING (error); an unreadable post is an error', () => {
    expect(mechanismDecision(form({ chain: 'a11y', contrast: 'on' }), THEMES)).toEqual({ set: [{ cookie: 'kvs_contrast', value: 'on' }], chain: true, error: false, mode: 'contrast', want: 'contrast:on' });
    expect(mechanismDecision(form({ chain: 'a11y', motion: 'calm' }), THEMES).set).toEqual([{ cookie: 'kvs_motion', value: 'calm' }]);
    expect(mechanismDecision(form({ chain: 'a11y', contrast: 'on', motion: 'fast' }), THEMES)).toEqual({ set: [], chain: true, error: true, mode: 'motion', want: null });
    expect(mechanismDecision(form({ chain: 'a11y' }), THEMES).error).toBe(true);
    expect(mechanismDecision(null, THEMES)).toEqual({ set: [], chain: true, error: true, mode: null, want: null });
  });
  it('without the chain the old answers stand: the theme falls back to system, senior anything-but-on is off', () => {
    expect(mechanismDecision(form({ theme: 'neon' }), THEMES)).toEqual({ set: [{ cookie: 'kvs_theme', value: 'system' }], chain: false, error: false, mode: null, want: null });
    expect(mechanismDecision(form({ senior: 'yes' }), THEMES).set).toEqual([{ cookie: 'kvs_senior', value: 'off' }]);
  });
  it('the way back carries the outcome only for the chain (old outcome params replaced); the page reads back only a real mode and value', () => {
    expect(a11yReturn('/account/accessibility?a11y=err&want=x', { chain: true, error: false, mode: 'senior', want: 'senior:on' })).toBe('/account/accessibility?a11y=saved&mode=senior');
    expect(a11yReturn('/a', { chain: true, error: true, mode: 'contrast', want: 'contrast:on' })).toBe('/a?a11y=err&want=contrast%3Aon');
    expect(a11yReturn('/account/preferences', { chain: false, error: false, mode: 'senior', want: 'senior:on' })).toBe('/account/preferences');
    expect(readA11yQuery({ a11y: 'err', want: 'motion:calm' })).toEqual({ status: 'err', mode: null, want: { mode: 'motion', value: 'calm' } });
    expect(readA11yQuery({ a11y: 'err', want: 'motion:wild' }).want).toBeNull();
    expect(readA11yQuery({ a11y: 'saved', mode: 'contrast', want: 'senior:on' })).toEqual({ status: 'saved', mode: 'contrast', want: null });
    expect(readA11yQuery({ a11y: 'maybe' }).status).toBeNull();
    expect([modeValue('senior', true), modeValue('contrast', false), modeValue('motion', true), modeValue('motion', false)]).toEqual(['on', 'off', 'calm', 'off']);
    expect(A11Y_COOKIES).toEqual({ senior: 'kvs_senior', contrast: 'kvs_contrast', motion: 'kvs_motion' });
  });
});

describe('STORE-5a · the floor is what the stylesheet proves (W324 "Always true")', () => {
  const css = readFileSync(join(__dirname, '..', 'styles', 'globals.css'), 'utf8');
  const rule = (sel: RegExp) => css.match(sel)?.[0] ?? '';
  it('money actions 56px OUTSIDE senior mode (a top-level rule); 44px controls; a visible focus ring', () => {
    expect(rule(/^\.kv-btn--money \{[^}]*\}/m)).toContain(`min-height: ${A11Y_FLOOR_PX.money}px`);
    expect(rule(/^\.kv-btn \{[^}]*\}/m)).toContain(`min-height: ${A11Y_FLOOR_PX.targets}px`);
    expect(rule(/^\.kv-btn--link \{[^}]*\}/m)).toContain(`min-height: ${A11Y_FLOOR_PX.targets}px`);
    expect(rule(/^\.kv-field__input \{[^}]*\}/m)).toContain(`min-height: ${A11Y_FLOOR_PX.targets}px`);
    expect(rule(/^\.kv-stars__star \{ min-width[^}]*\}/m)).toContain(`min-height: ${A11Y_FLOOR_PX.targets}px`);
    expect(rule(/^:focus-visible \{[^}]*\}/m)).toMatch(/outline: \dpx solid/);
  });
  it('High contrast by the cookie AND the phone\'s setting; Calm motion by the cookie AND the phone\'s setting', () => {
    expect(css).toMatch(/^html\[data-contrast="true"\] \{\s*--kv-neutral-0: #ffffff;[^}]*--kv-neutral-900: #000000;/m);
    expect(css).toMatch(/@media \(prefers-contrast: more\) \{\s*:root:not\(\[data-theme="dark"\]\) \{[^}]*--kv-neutral-900: #000000;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{ animation: none !important; transition: none !important;/);
    expect(css).toMatch(/^html\[data-motion="calm"\] \*, html\[data-motion="calm"\] \*::before, html\[data-motion="calm"\] \*::after \{ animation: none !important; transition: none !important;/m);
  });
});

describe('STORE-5a · the refusal registry and the catalogues', () => {
  it('exhaustive and unique; every key in every catalogue and every surface printed; the three surfaces', () => {
    const ids = STORE5A_REFUSALS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(18);
    for (const r of STORE5A_REFUSALS) for (const cat of [en, hi, gu] as Array<Record<string, string>>) expect([r.key, typeof cat[r.key]]).toEqual([r.key, 'string']);
    for (const s of ['review', 'review_edit', 'accessibility'] as const) expect(store5aRefusalKeys(s).length).toBeGreaterThan(0);
    expect(new Set(STORE5A_REFUSALS.flatMap((r) => r.surfaces))).toEqual(new Set(['review', 'review_edit', 'accessibility']));
  });
  it('the 12 canon files with verdicts; the DELTAs named', () => {
    expect(STORE5A_CHAIN_PAGES.map((p) => p.file.slice(0, 5))).toEqual(['W290-', 'W3141', 'W3142', 'W3143', 'W3144', 'W3145', 'W3146', 'W3147', 'W324-', 'W3074', 'W3075', 'W3076']);
    expect(STORE5A_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['review_route', 'body_limit', 'chain_links', 'a11y_no_confirm', 'a11y_links', 'invite_from_completion']));
  });
  it('i18n parity: en / hi / gu hold the same keys (2,039 each — 1,933 at HOTFIX-7 + 114 − 8)', () => {
    const k = Object.keys(en).sort();
    expect(Object.keys(hi).sort()).toEqual(k); expect(Object.keys(gu).sort()).toEqual(k);
    expect(k.length).toBe(2596);   // PC-56 STORE-SWEEP-a: + 160 (help.* 33, about.* 12, sweep.* 115) − footer.soon → 2,596 · PC-56 STORE-6b: + 83 store6b.* (On this phone, the keeper, the chip, the invitation, /app states) → 2,437 · PC-56 STORE-5b: + 163 − 5 retired v2 trace.* keys (the STORE-5a figure was 2,039); HOTFIX-8: + offline.shell.home; STORE-6a: + 157 store6.* − offline.hint
    expect(k.filter((x) => x.startsWith('store5a.')).length).toBe(113);
  });
});
