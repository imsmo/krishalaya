// apps/web-storefront/src/test/store6b-keeper.spec.ts · PC-56 STORE-6b · D4 — THE KEEPER, against DOM doubles (jsdom is not installed in this repo):
//   • it fills the form from the phone (the words; the overall stars; each dimension — "not rated" when none was kept);
//   • it writes ~300 ms after the LAST keystroke (debounced), not on every key;
//   • the HIDDEN fields (slug, id, key, conversationId) are NEVER stored — only the named visible fields and the ref;
//   • a token-shaped value is refused (nothing written); a cleared form removes the draft;
//   • the success render (`done`) fills nothing; another owner's draft is never filled (and is gone after the start);
//   • no owner marker / no store → OFF: nothing written, nothing read.
import { createKeeper, fillForm, readForm, DEBOUNCE_MS, type ControlLike, type KeeperDeps } from '../features/store6b/keeper';
import { MemoryDraftStore, DAY_MS, HIDDEN_FIELDS, type Draft } from '../features/store6b/drafts';

const A = 'AAAAAAAAAAAAAAAAAAAAAA'; const B = 'BBBBBBBBBBBBBBBBBBBBBB';
const H = 'anand.example'; const S = 'anand-fpo';
const CONVO = '0190a8b2-0000-7000-8000-00000000c0c0'; const ORDER = '0190a8b2-0000-7000-8000-00000000a0a0';
const NOW = Date.parse('2026-10-17T10:00:00.000Z');
const KEY = 'send:0190a8b2-0000-7000-8000-0000000000ee';

const ctl = (name: string, type: string, value = '', checked = false): ControlLike => ({ name, type, value, checked });
const composer = () => ({ elements: [ctl('slug', 'hidden', S), ctl('conversationId', 'hidden', CONVO), ctl('key', 'hidden', KEY), ctl('body', 'text', '')] });
const reviewForm = () => ({
  elements: [
    ctl('slug', 'hidden', S), ctl('id', 'hidden', ORDER), ctl('key', 'hidden', 'review:0190a8b2-0000-7000-8000-0000000000ff'),
    ...[5, 4, 3, 2, 1].map((n) => ctl('stars', 'radio', String(n))),
    ...['5', '4', '3', '2', '1', ''].map((v) => ctl('dim.quality', 'radio', v, v === '')),
    ...['5', '4', '3', '2', '1', ''].map((v) => ctl('dim.packing', 'radio', v, v === '')),
    ctl('body', 'textarea', ''),
  ],
});
const get = (f: { elements: ControlLike[] }, name: string, value?: string) => f.elements.find((c) => c.name === name && (value === undefined || c.value === value))!;

function harness(over: Partial<KeeperDeps> = {}, form: { elements: ControlLike[] } = composer()) {
  const store = new MemoryDraftStore();
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  let ids = 0; let clock = NOW; let writes = 0;
  const deps: KeeperDeps = {
    store, host: H, slug: S, owner: A, kind: 'message', ref: CONVO, edit: false,
    now: () => clock, newId: () => `d_${String(++ids).padStart(22, 'x')}`,
    setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { (t as { live: boolean }).live = false; },
    onWrite: () => { writes++; },
    ...over,
  };
  const keeper = createKeeper(form, deps);
  const fire = async () => { for (const t of timers.filter((x) => x.live)) { t.live = false; t.fn(); } await new Promise((r) => setImmediate(r)); };
  return { store, keeper, form, timers, fire, tick: (ms: number) => { clock += ms; }, writes: () => writes };
}
const msg = (o: Partial<Draft> = {}): Draft => ({ id: 'd_kept000000000000000000', kind: 'message', host: H, slug: S, owner: A, ref: CONVO, fields: { body: 'kept words' }, savedAt: NOW - 3600000, ...o });

describe('STORE-6b · the keeper fills the form from THIS phone', () => {
  it('a message kept for this conversation fills `body` and says restored (with its saved instant)', async () => {
    const h = harness();
    await h.store.put(msg());
    const s = await h.keeper.start({ wanted: null, done: false });
    expect(s.state).toBe('restored');
    expect(get(h.form, 'body').value).toBe('kept words');
    expect(h.keeper.draftId).toBe('d_kept000000000000000000');
    expect(get(h.form, 'key').value).toBe(KEY);                       // the form's own key, minted at THIS render, untouched
  });
  it('a review fills the stars, each dimension (none kept → "not rated") and the words', async () => {
    const form = reviewForm();
    const h = harness({ kind: 'review', ref: ORDER }, form);
    await h.store.put(msg({ kind: 'review', ref: ORDER, fields: { stars: 4, subRatings: { quality: 5 }, body: 'Fresh' } }));
    const s = await h.keeper.start({ wanted: null, done: false });
    expect(s.state).toBe('restored');
    expect(form.elements.filter((c) => c.name === 'stars' && c.checked).map((c) => c.value)).toEqual(['4']);
    expect(form.elements.filter((c) => c.name === 'dim.quality' && c.checked).map((c) => c.value)).toEqual(['5']);
    expect(form.elements.filter((c) => c.name === 'dim.packing' && c.checked).map((c) => c.value)).toEqual(['']);
    expect(get(form, 'body').value).toBe('Fresh');
  });
  it('7 days old or more → the restore carries the question', async () => {
    const h = harness();
    await h.store.put(msg({ savedAt: NOW - 8 * DAY_MS }));
    expect(await h.keeper.start({ wanted: null, done: false })).toMatchObject({ state: 'restored', ask: true });
  });
  it('another owner\'s draft for the same ref is NEVER filled — and is gone after the start (unseen)', async () => {
    const h = harness();
    await h.store.put(msg({ id: 'd_theirs00000000000000000', owner: B, fields: { body: 'B secret' } }));
    const s = await h.keeper.start({ wanted: 'd_theirs00000000000000000', done: false });
    expect(s).toEqual({ state: 'empty', wantedMissing: true });
    expect(get(h.form, 'body').value).toBe('');
    expect(h.store.rows.size).toBe(0);
  });
  it('the success render (`done`) fills nothing', async () => {
    const h = harness();
    await h.store.put(msg());
    expect(await h.keeper.start({ wanted: null, done: true })).toEqual({ state: 'done' });
    expect(get(h.form, 'body').value).toBe('');
  });
  it('no owner marker or no store → OFF: nothing read, nothing written', async () => {
    for (const over of [{ owner: null }, { store: null }] as Partial<KeeperDeps>[]) {
      const h = harness(over);
      expect(await h.keeper.start({ wanted: null, done: false })).toEqual({ state: 'off' });
      get(h.form, 'body').value = 'typed'; h.keeper.onInput();
      expect(h.timers).toHaveLength(0);
      expect(await h.keeper.save()).toBe('off');
    }
  });
});

describe('STORE-6b · kept AS YOU TYPE — debounced, named fields only', () => {
  it('three keystrokes inside the window → ONE write, DEBOUNCE_MS after the last', async () => {
    const h = harness();
    await h.keeper.start({ wanted: null, done: false });
    for (const v of ['I', 'Is', 'Is it']) { get(h.form, 'body').value = v; h.keeper.onInput(); }
    expect(DEBOUNCE_MS).toBe(300);
    expect(h.timers.map((t) => t.ms)).toEqual([300, 300, 300]);
    expect(h.timers.filter((t) => t.live)).toHaveLength(1);
    expect(h.store.rows.size).toBe(0);
    await h.fire();
    expect([...h.store.rows.values()].map((d) => d.fields)).toEqual([{ body: 'Is it' }]);
    expect(h.writes()).toBe(1);
  });
  it('the HIDDEN fields are never stored: the record holds only kind, ref, scope and the person\'s words', async () => {
    const h = harness();
    await h.keeper.start({ wanted: null, done: false });
    get(h.form, 'body').value = 'Is the groundnut still there?';
    expect(await h.keeper.save()).toBe('saved');
    const rec = [...h.store.rows.values()][0];
    expect(Object.keys(rec).sort()).toEqual(['fields', 'host', 'id', 'kind', 'owner', 'ref', 'savedAt', 'slug']);
    expect(Object.keys(rec.fields)).toEqual(['body']);
    const json = JSON.stringify(rec);
    expect(json).not.toContain(KEY); expect(json).not.toContain('send:');
    for (const name of HIDDEN_FIELDS) expect(Object.keys(rec.fields)).not.toContain(name);
  });
  it('readForm ignores every hidden input, even one named `body`', () => {
    const f = { elements: [ctl('body', 'hidden', 'eyJsecret'), ctl('key', 'hidden', KEY), ctl('body', 'text', 'mine')] };
    expect(readForm(f, 'message')).toEqual({ body: 'mine' });
    expect(readForm(reviewForm(), 'review')).toEqual({ stars: null, subRatings: {}, body: '' });
  });
  it('a token-shaped value is REFUSED — nothing written, the kept draft unchanged', async () => {
    const h = harness();
    await h.store.put(msg());
    await h.keeper.start({ wanted: null, done: false });
    get(h.form, 'body').value = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig';
    expect(await h.keeper.save()).toBe('refused');
    expect([...h.store.rows.values()][0].fields).toEqual({ body: 'kept words' });
  });
  it('a cleared form removes the draft (a draft of nothing is not kept); the next words make a new one; an edit form marks `edit`', async () => {
    const h = harness();
    await h.store.put(msg());
    await h.keeper.start({ wanted: null, done: false });
    get(h.form, 'body').value = '   ';
    expect(await h.keeper.save()).toBe('removed');
    expect(h.store.rows.size).toBe(0);
    get(h.form, 'body').value = 'again'; h.tick(1000);
    expect(await h.keeper.save()).toBe('saved');
    expect([...h.store.rows.values()][0]).toMatchObject({ savedAt: NOW + 1000, fields: { body: 'again' } });
    const e = harness({ kind: 'review', ref: ORDER, edit: true }, reviewForm());
    await e.keeper.start({ wanted: null, done: false });
    get(e.form, 'stars', '3').checked = true;
    expect(await e.keeper.save()).toBe('saved');
    expect([...e.store.rows.values()][0]).toMatchObject({ kind: 'review', ref: ORDER, edit: true, fields: { stars: 3, subRatings: {}, body: '' } });
  });
  it('a failed write is a named outcome (the page keeps working)', async () => {
    const h = harness();
    await h.keeper.start({ wanted: null, done: false });
    h.store.failWrites = true;
    get(h.form, 'body').value = 'x';
    expect(await h.keeper.save()).toBe('failed');
  });
  it('fillForm writes words only into the named visible fields', () => {
    const f = composer();
    fillForm(f, { body: 'back' });
    expect(f.elements.map((c) => c.value)).toEqual([S, CONVO, KEY, 'back']);
  });
});
