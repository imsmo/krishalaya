// apps/web-storefront/src/test/store6b-drafts.spec.ts · PC-56 STORE-6b · D1 / D2 / D4 (founder Q3 = b, Q4, Q7) — THE RULES OF A DRAFT ON THIS PHONE.
//   • the scope: (host, slug, owner) — no owner marker → OFF (fail closed);
//   • the OWNER MISMATCH rule: another owner's drafts are removed at the sweep, never shown (survey E1) — and with no marker, every draft goes;
//   • the 7-day / 30-day boundaries (`draftState`), the 7-day question asked once, expired drafts removed and counted;
//   • the draftable set is DERIVED from the act registry (acts.ts): only the composer, the review form and the review edit form — every money
//     and every countdown act (and every device act) is NOT draftable (E7);
//   • `safeField` refuses token-shaped values (`eyJ…`, `kv_…`, `send:`, `review:`, 32+ hex) and anything over the live limit;
//   • `liveHref` = the live page + `?draft=<id>` (never a send; never another organisation's under a store's chrome);
//   • the wipe on sign-out: HOTFIX-8's header still names "storage" (it deletes IndexedDB), and the armed pass also sets the JS-readable
//     `kvs_wipe` for a browser that ignores the header.
import { STOREFRONT_ACTS, actsOf, neverQueued } from '../features/store6/acts';
import {
  ASK_DAYS, DAY_MS, DRAFT_ACTS, EXPIRE_DAYS, HIDDEN_FIELDS, MESSAGE_BODY_MAX, MemoryDraftStore, REVIEW_WORDS_MAX, type Draft,
  ageParts, ageText, doneRemovals, draftScope, draftState, firstWords, inScope, isDraftId, isDraftable, isEmptyFields, liveHref, needsAsk, newDraftId,
  runSweep, safeField, safeFields, shown, sweep,
} from '../features/store6b/drafts';
import { REVIEW_BODY_MAX } from '../features/store5a/review';
import { PLATFORM_CHROME, tenantChrome } from '../features/store4a/account';
import { clearRouteAnswer, clearSiteDataHeader, CLEAR_SITE_COOKIE, DRAFTS_WIPE_COOKIE } from '../features/offline/owner';
import { cacheableScope } from '../features/store6/sw-rules';

const A = 'AAAAAAAAAAAAAAAAAAAAAA'; const B = 'BBBBBBBBBBBBBBBBBBBBBB';
const H = 'anand.example'; const S = 'anand-fpo';
const CONVO = '0190a8b2-0000-7000-8000-00000000c0c0'; const ORDER = '0190a8b2-0000-7000-8000-00000000a0a0';
const NOW = Date.parse('2026-10-17T10:00:00.000Z');
let n = 0;
const id = () => newDraftId(Uint8Array.from({ length: 16 }, (_x, i) => (i * 13 + (n++) * 7) & 255));
const d = (o: Partial<Draft> = {}): Draft => ({ id: id(), kind: 'message', host: H, slug: S, owner: A, ref: CONVO, fields: { body: 'Is the groundnut still there?' }, savedAt: NOW - DAY_MS, ...o });

describe('STORE-6b · the scope and the owner', () => {
  it('a scope needs an owner marker: none (a session from before HOTFIX-8) → null — drafts OFF', () => {
    expect(draftScope(H, S, A)).toBe(`${H}|${S}|${A}`);
    for (const bad of [null, undefined, '', 'short', 'eyJhbGciOi.x.y', `${A}x`]) expect(draftScope(H, S, bad as string)).toBeNull();
    expect(draftScope(H, '../x', A)).toBeNull();
    expect(draftScope('', S, A)).toBeNull();
  });
  it('inScope matches each given part; a missing part matches every value', () => {
    const x = d();
    expect(inScope(x, { host: H })).toBe(true);
    expect(inScope(x, { host: H, slug: S, owner: A })).toBe(true);
    expect(inScope(x, { host: H, owner: B })).toBe(false);
    expect(inScope(x, { host: 'other.example' })).toBe(false);
    expect(inScope(x, { host: H, slug: 'other' })).toBe(false);
  });
  it('ids are opaque (`d_` + 22 url-safe characters) — never the owner, never a ref', () => {
    const x = id();
    expect(isDraftId(x)).toBe(true);
    expect(x).not.toContain(A); expect(x).not.toContain(CONVO);
    for (const bad of ['', 'd_short', A, CONVO, `d_${A}x`]) expect(isDraftId(bad)).toBe(false);
  });
});

describe('STORE-6b · the OWNER MISMATCH rule (survey E1)', () => {
  it('another owner\'s draft is removed at the sweep and NEVER shown', () => {
    const mine = d(); const theirs = d({ owner: B, fields: { body: 'B\'s private words' } });
    const s = sweep([mine, theirs], A, NOW);
    expect(s.remove).toEqual([theirs.id]);
    expect(s.expired).toEqual([]);
    expect(shown([mine, theirs], A, NOW).map((x) => x.id)).toEqual([mine.id]);
  });
  it('no owner marker on the device → every draft goes (nothing may be shown to an unknown person)', () => {
    const all = [d(), d({ owner: B })];
    expect(sweep(all, null, NOW).remove.sort()).toEqual(all.map((x) => x.id).sort());
    expect(shown(all, undefined, NOW)).toEqual([]);
  });
  it('runSweep deletes them from the store (unseen) and keeps the owner\'s own', async () => {
    const st = new MemoryDraftStore();
    const mine = d(); const theirs = d({ owner: B });
    await st.put(mine); await st.put(theirs);
    const r = await runSweep(st, H, A, NOW);
    expect(r.ok).toBe(true);
    expect(r.kept.map((x) => x.id)).toEqual([mine.id]);
    expect([...st.rows.keys()]).toEqual([mine.id]);
  });
});

describe('STORE-6b · how long (founder Q7): 7 days ask, 30 days removed', () => {
  it('the constants the copy interpolates', () => { expect([ASK_DAYS, EXPIRE_DAYS]).toEqual([7, 30]); });
  it('draftState boundaries: < 7 d fresh · 7 d ask · < 30 d ask · 30 d expired', () => {
    const at = (ms: number) => draftState(NOW - ms, NOW);
    expect(at(0)).toBe('fresh');
    expect(at(6 * DAY_MS)).toBe('fresh');
    expect(at(7 * DAY_MS - 1)).toBe('fresh');
    expect(at(7 * DAY_MS)).toBe('ask');
    expect(at(29 * DAY_MS)).toBe('ask');
    expect(at(30 * DAY_MS - 1)).toBe('ask');
    expect(at(30 * DAY_MS)).toBe('expired');
    expect(draftState(NOW + DAY_MS, NOW)).toBe('fresh');                 // a clock that runs backwards
  });
  it('the 7-day question is asked once (Keep sets askedAt)', () => {
    const old = d({ savedAt: NOW - 8 * DAY_MS });
    expect(needsAsk(old, NOW)).toBe(true);
    expect(needsAsk({ ...old, askedAt: NOW }, NOW)).toBe(false);
    expect(needsAsk(d({ savedAt: NOW - 6 * DAY_MS }), NOW)).toBe(false);
    expect(sweep([old], A, NOW).ask).toEqual([old.id]);
  });
  it('expired drafts are removed at the sweep and COUNTED (the one-line notice); fresh and asking ones stay', () => {
    const exp = d({ savedAt: NOW - 31 * DAY_MS }); const asking = d({ savedAt: NOW - 10 * DAY_MS }); const fresh = d();
    const s = sweep([exp, asking, fresh], A, NOW);
    expect(s.remove).toEqual([exp.id]);
    expect(s.expired).toEqual([exp.id]);
    expect(s.ask).toEqual([asking.id]);
  });
  it('runSweep reports the expired count', async () => {
    const st = new MemoryDraftStore();
    await st.put(d({ savedAt: NOW - 40 * DAY_MS })); await st.put(d());
    const r = await runSweep(st, H, A, NOW);
    expect(r.expired).toBe(1); expect(r.kept).toHaveLength(1); expect(st.rows.size).toBe(1);
  });
});

describe('STORE-6b · what may draft — DERIVED from the act registry (E7)', () => {
  it('exactly the composer, the review form and the review edit form', () => {
    const yes = STOREFRONT_ACTS.filter((a) => isDraftable(a.file, a.name)).map((a) => a.name).sort();
    expect(yes).toEqual(['editReviewAction', 'postMessageAction', 'previewReviewAction']);
    for (const a of DRAFT_ACTS) expect(STOREFRONT_ACTS.find((x) => x.file === a.file && x.name === a.name)?.cls).toBe('content');
  });
  it('every MONEY and every COUNTDOWN act is NOT draftable (and no device act)', () => {
    expect(neverQueued().length).toBe(28);
    for (const a of [...neverQueued(), ...actsOf('device')]) expect([a.name, isDraftable(a.file, a.name)]).toEqual([a.name, false]);
    expect(isDraftable('[tenantSlug]/auctions/[id]/actions.ts', 'placeBidAction')).toBe(false);
    expect(isDraftable('[tenantSlug]/checkout/pay/actions.ts', 'createOrderAttemptAction')).toBe(false);
  });
  it('the content acts that are NOT drafts stay so: cart lines, addresses, preferences, the confirm submits; an unknown export is never draftable', () => {
    for (const name of ['updateCartLineAction', 'removeCartLineAction', 'addToCartAction', 'submitAddressAction', 'submitPreferencesAction', 'updateProfileAction', 'submitReviewAction', 'saveReviewEditAction', 'reportMessageAction']) {
      const a = STOREFRONT_ACTS.find((x) => x.name === name)!;
      expect([name, isDraftable(a.file, a.name)]).toEqual([name, false]);
    }
    expect(isDraftable('[tenantSlug]/messages/[id]/actions.ts', 'somethingNew')).toBe(false);
  });
});

describe('STORE-6b · safeField: text only, the live limits, nothing token-shaped', () => {
  it('the limits are the live pages\' own', () => { expect(MESSAGE_BODY_MAX).toBe(4000); expect(REVIEW_WORDS_MAX).toBe(REVIEW_BODY_MAX); });
  it('ordinary words pass; over the limit is REFUSED (null), never cut', () => {
    expect(safeField('Is the groundnut still there? ₹6,150 was the price.')).toBe('Is the groundnut still there? ₹6,150 was the price.');
    expect(safeField('x'.repeat(4000))).toHaveLength(4000);
    expect(safeField('x'.repeat(4001))).toBeNull();
    expect(safeField(42 as unknown as string)).toBeNull();
  });
  it('a token or a key is REFUSED: eyJ…, kv_…, send:, review:, review-edit:, 32+ hex', () => {
    for (const bad of ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig', 'kv_live_abc', 'send:0190a8b2-0000-7000-8000-000000000001', 'review:0190a8b2-0000-7000-8000-000000000001',
      'review-edit:0190a8b2-0000-7000-8000-000000000001', 'my key is 0123456789abcdef0123456789abcdef ok', ' eyJx']) expect([bad, safeField(bad)]).toEqual([bad, null]);
    expect(safeField('a uuid 0190a8b2-0000-7000-8000-000000000001 is not 32 hex in a row')).not.toBeNull();
  });
  it('safeFields: a review keeps stars 1–5, the dimension codes, the words — anything refused → null (nothing written)', () => {
    expect(safeFields('review', { stars: '4', subRatings: { quality: '5', packing: '', bad: '9' }, body: 'Good' })).toEqual({ stars: 4, subRatings: { quality: 5 }, body: 'Good' });
    expect(safeFields('review', { stars: '4', subRatings: {}, body: 'eyJhbGci' })).toBeNull();
    expect(safeFields('review', { stars: '4', subRatings: { 'dim.x;drop': '3' }, body: '' })).toBeNull();
    expect(safeFields('message', { body: 'hi' })).toEqual({ body: 'hi' });
    expect(isEmptyFields({ body: '  ' })).toBe(true);
    expect(isEmptyFields({ stars: null, subRatings: {}, body: '' })).toBe(true);
    expect(isEmptyFields({ stars: 3, subRatings: {}, body: '' })).toBe(false);
  });
  it('the hidden fields are named once — the keeper never stores them as values', () => {
    expect(HIDDEN_FIELDS).toEqual(['slug', 'id', 'key', 'conversationId']);
  });
});

describe('STORE-6b · where a draft leaves from (founder D1: the person presses Send)', () => {
  it('liveHref: the thread / the review / the review edit + `?draft=<id>` — a link, never a send', () => {
    const m = d(); const r = d({ kind: 'review', ref: ORDER, fields: { stars: 4, subRatings: {}, body: 'ok' } }); const e = { ...r, edit: true };
    expect(liveHref(m, PLATFORM_CHROME)).toBe(`/${S}/messages/${CONVO}?draft=${m.id}`);
    expect(liveHref(r, tenantChrome(S))).toBe(`/${S}/orders/${ORDER}/review?draft=${r.id}`);
    expect(liveHref(e, tenantChrome(S))).toBe(`/${S}/orders/${ORDER}/review/edit?draft=${e.id}`);
  });
  it('under another organisation\'s chrome: no link (white-label); a malformed ref or id: no link', () => {
    expect(liveHref(d(), tenantChrome('other-org'))).toBeNull();
    expect(liveHref(d({ ref: '../x' }), PLATFORM_CHROME)).toBeNull();
    expect(liveHref({ ...d(), id: 'nope' }, PLATFORM_CHROME)).toBeNull();
  });
  it('firstWords: whole words up to 80 characters, an ellipsis when cut', () => {
    expect(firstWords('  short   words ')).toBe('short words');
    const long = 'word '.repeat(40);
    const f = firstWords(long, 80);
    expect(f.length).toBeLessThanOrEqual(81); expect(f.endsWith('…')).toBe(true); expect(f).not.toMatch(/wor…$/);
  });
  it('the age words; the done removal spares words typed after the success render', () => {
    expect(ageParts(NOW, NOW).unit).toBe('now');
    expect(ageParts(NOW - 5 * 60000, NOW)).toEqual({ unit: 'minutes', n: 5 });
    expect(ageParts(NOW - 3 * 3600000, NOW)).toEqual({ unit: 'hours', n: 3 });
    expect(ageText(NOW - 2 * DAY_MS, NOW, { now: 'now', minutes: '{n} m', hours: '{n} h', days: '{n} d' })).toBe('2 d');
    const before = d({ savedAt: NOW - 1000 }); const after = d({ savedAt: NOW + 1000 }); const other = d({ ref: ORDER });
    expect(doneRemovals([before, after, other], 'message', CONVO, NOW)).toEqual([before.id]);
  });
});

describe('STORE-6b · D2 — the wipe, the cache law', () => {
  it('HOTFIX-8\'s header still names "storage" (it deletes IndexedDB — the drafts) on sign-out and on another person\'s sign-in', () => {
    expect(clearSiteDataHeader()).toMatch(/"storage"/);
    const armed = clearRouteAnswer({ next: '/', cookie: `${CLEAR_SITE_COOKIE}=1`, rsc: false });
    expect(armed.headers).toContainEqual(['Clear-Site-Data', '"cache", "storage"']);
  });
  it('the armed pass also sets the JS-READABLE wipe marker (kvs_wipe=1, no HttpOnly); an unarmed pass never does', () => {
    const armed = clearRouteAnswer({ next: '/', cookie: `${CLEAR_SITE_COOKIE}=1`, rsc: false });
    const wipe = armed.headers.filter(([k, v]) => k === 'Set-Cookie' && v.startsWith(`${DRAFTS_WIPE_COOKIE}=`));
    expect(wipe).toHaveLength(1);
    expect(wipe[0][1]).toMatch(/^kvs_wipe=1; Path=\/; Max-Age=\d+; SameSite=Lax$/);
    expect(wipe[0][1]).not.toMatch(/HttpOnly/);
    const plain = clearRouteAnswer({ next: '/', cookie: '', rsc: false });
    expect(plain.headers.some(([k, v]) => k === 'Set-Cookie' && v.startsWith('kvs_wipe'))).toBe(false);
  });
  it('the /sync page is NEVER marked cacheable (HOTFIX-8\'s law: nothing personal in the worker\'s caches)', () => {
    expect(cacheableScope(`/${S}/sync`)).toBeNull();
    expect(cacheableScope('/sync')).toBeNull();
  });
  it('the memory store: a failed write is a named outcome, never a throw', async () => {
    const st = new MemoryDraftStore(); st.failWrites = true;
    expect(await st.put(d())).toEqual({ ok: false, reason: 'write' });
    expect(await st.remove('x')).toEqual({ ok: false, reason: 'write' });
    expect(await st.clear({ host: H })).toEqual({ ok: false, reason: 'write' });
  });
});
