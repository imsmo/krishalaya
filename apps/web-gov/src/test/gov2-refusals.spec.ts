// apps/web-gov/src/test/gov2-refusals.spec.ts · PC-56 GOV-2b · E5 — the GOV-2 registry (features/gov2/refusals.ts): ALL 28 canon files, one
// verdict each (2b decides its 18; 2c's 10 are `pending_2c`); the 22 chain files in exactly one group each; every 2b group built by a chain;
// every refusal / chain key in en, hi and gu; the chains' query states and Backs (a chain opened on a scheme returns to THAT scheme). Plus the
// scheme pages' pure state pickers and the stored-value printer (features/gov2/schemes.ts).
import { chain2Back, chain2For, chain2Href, chain2State, GOV2_CANON_FILES, GOV2_CHAIN_GROUPS, GOV2_CHAINS, GOV2_DELTAS, GOV2_REFUSALS, isSchemeId, schemeTab, SURFACES_2B, SURFACES_2C } from '../features/gov2/refusals';
import { activeKey, asStored, diffFieldKey, diffVersion, schemesState, schemeState, secondPersonKey, versionStatusKey, DIFF_FIELDS } from '../features/gov2/schemes';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const ID = '0192d2c4-c000-7000-8000-00000000000a';

describe('PC-56 GOV-2 · the registry', () => {
  it('28 canon files, each once, one verdict; 2b decides 18; 2c\'s 10 pending', () => {
    expect(GOV2_CANON_FILES).toHaveLength(28);
    expect(new Set(GOV2_CANON_FILES.map((f) => f.file)).size).toBe(28);
    const b = GOV2_CANON_FILES.filter((f) => f.wave === '2b');
    const c = GOV2_CANON_FILES.filter((f) => f.wave === '2c');
    expect([b.length, c.length]).toEqual([18, 10]);
    expect(c.every((f) => f.verdict === 'pending_2c')).toBe(true);
    expect(b.filter((f) => f.verdict === 'pending_2c')).toEqual([]);
    expect(Object.fromEntries(b.map((f) => [f.file.split('-')[0], f.verdict]))).toEqual({
      W326: 'BUILT (read)', W327: 'BUILT (honest)', W328: 'BUILT (honest)', W329: 'BUILT (read)',
      W3172: 'DECOR', W3173: 'DECOR', W3174: 'DECOR', W3175: 'DECOR', W3176: 'DECOR', W3177: 'DECOR', W3178: 'DECOR',
      W3182: 'DECOR', W3183: 'DECOR', W3184: 'DECOR', W3185: 'DECOR', W3186: 'DECOR', W3187: 'DECOR', W3188: 'DECOR',
    });
    expect(c.map((f) => f.file.split('-')[0]).sort()).toEqual(['W3159', 'W3160', 'W3161', 'W3162', 'W3163', 'W3164', 'W3165', 'W3166', 'W330', 'W331']);
  });
  it('22 chain files in 7 groups, each file exactly once; each group\'s files are canon files of the same wave; 6 real screens', () => {
    expect(GOV2_CHAIN_GROUPS).toHaveLength(7);
    const all = GOV2_CHAIN_GROUPS.flatMap((g) => g.files);
    expect(all).toHaveLength(22); expect(new Set(all).size).toBe(22);
    for (const g of GOV2_CHAIN_GROUPS) for (const f of g.files) {
      const x = GOV2_CANON_FILES.find((y) => y.file.startsWith(`${f}-`));
      expect([f, x?.wave]).toEqual([f, g.wave]);
    }
    expect(GOV2_CANON_FILES.length - all.length).toBe(6);
  });
  it('each built chain belongs to a 2b group; every 2b group is built; no 2c group is built yet', () => {
    for (const c of GOV2_CHAINS) expect([c.id, GOV2_CHAIN_GROUPS.find((g) => g.id === c.group)?.wave]).toEqual([c.id, c.wave]);
    for (const g of GOV2_CHAIN_GROUPS) expect([g.id, GOV2_CHAINS.some((c) => c.group === g.id)]).toEqual([g.id, g.wave === '2b']);
  });
  it('every refusal id once; every refusal and chain key in en/hi/gu; every 2b surface prints at least one refusal; no 2c surface yet', () => {
    expect(new Set(GOV2_REFUSALS.map((r) => r.id)).size).toBe(GOV2_REFUSALS.length);
    expect(new Set(GOV2_DELTAS.map((d) => d.id)).size).toBe(GOV2_DELTAS.length);
    for (const [l, cat] of Object.entries(CATS)) {
      for (const r of GOV2_REFUSALS) expect([l, r.key, typeof cat[r.key]]).toEqual([l, r.key, 'string']);
      for (const c of GOV2_CHAINS) {
        for (const k of [c.statement, c.rereadKey, 'gov2.chain.backList', 'gov2.chain.backScheme']) expect([l, k, typeof cat[k]]).toEqual([l, k, 'string']);
        for (const st of c.states) for (const part of ['title', 'body']) expect([l, c.id, st, part, typeof cat[`${c.key(st)}.${part}`]]).toEqual([l, c.id, st, part, 'string']);
      }
      for (const f of DIFF_FIELDS) expect([l, f, typeof cat[diffFieldKey(f)]]).toEqual([l, f, 'string']);
    }
    for (const r of GOV2_REFUSALS) for (const s of r.surfaces) expect([r.id, SURFACES_2B.includes(s)]).toEqual([r.id, true]);
    for (const s of SURFACES_2B) expect([s, GOV2_REFUSALS.some((r) => r.surfaces.includes(s))]).toEqual([s, true]);
    for (const s of SURFACES_2C) expect([s, GOV2_REFUSALS.some((r) => r.surfaces.includes(s))]).toEqual([s, false]);
  });
  it('every English refusal says no (the negative-word rule)', () => {
    const NEG = /\b(no|not|never|nobody|nothing|cannot|only)\b|n't\b/i;
    for (const r of GOV2_REFUSALS) expect([r.id, NEG.test(en[r.key])]).toEqual([r.id, true]);
  });
});

describe('PC-56 GOV-2b · the chains\' query states and Backs (pure)', () => {
  it('the list: do=define → the scheme form, do=reread → the scheme re-read; anything else → the page', () => {
    expect(chain2For({ do: 'define' }, false)).toBe('scheme_form'); expect(chain2For({ do: 'reread' }, false)).toBe('scheme_reread');
    expect(chain2For({ do: 'send' }, false)).toBeNull(); expect(chain2For({}, false)).toBeNull();
  });
  it('a scheme: scheme / send / rule / remove; reread → the rules re-read on the rules tab, the scheme re-read elsewhere', () => {
    expect(chain2For({ do: 'scheme' }, true)).toBe('scheme_form'); expect(chain2For({ do: 'send' }, true)).toBe('scheme_send');
    expect(chain2For({ do: 'rule' }, true)).toBe('rule_form'); expect(chain2For({ do: 'remove' }, true)).toBe('rule_remove');
    expect(chain2For({ do: 'reread', tab: 'rules' }, true)).toBe('rules_reread'); expect(chain2For({ do: 'reread', tab: 'versions' }, true)).toBe('scheme_reread');
    expect(chain2For({ do: ['define'] }, true)).toBeNull();
  });
  it('states: a form chain has no confirm; a mutate chain has no review', () => {
    expect(chain2State('scheme_form', { act: 'confirm' })).toBeNull(); expect(chain2State('scheme_form', { act: 'review' })).toBe('review');
    expect(chain2State('scheme_send', { act: 'review' })).toBeNull(); expect(chain2State('rule_remove', { act: ['failure'] })).toBe('failure');
  });
  it('Back: a chain opened on a scheme → THAT scheme (the tab that opened it); rule chains → its rules; the list (or a junk id) → /schemes', () => {
    expect(chain2Back('scheme_form', ID)).toBe(`/schemes/${ID}?tab=identity`);
    expect(chain2Back('scheme_form', ID, 'versions')).toBe(`/schemes/${ID}?tab=versions`);
    expect(chain2Back('scheme_send', ID, 'versions')).toBe(`/schemes/${ID}?tab=versions`);
    expect(chain2Back('rule_form', ID, 'identity')).toBe(`/schemes/${ID}?tab=rules`); expect(chain2Back('rules_reread', ID)).toBe(`/schemes/${ID}?tab=rules`);
    expect(chain2Back('scheme_form', null)).toBe('/schemes'); expect(chain2Back('scheme_form', '../../evil')).toBe('/schemes');
    expect(isSchemeId(ID)).toBe(true); expect(isSchemeId('x')).toBe(false);
  });
  it('hrefs: the list opens ?do=define; a scheme opens its tab with do=', () => {
    expect(chain2Href('scheme_form', 'review', null)).toBe('/schemes?do=define&act=review');
    expect(chain2Href('scheme_reread', 'confirm', null)).toBe('/schemes?do=reread&act=confirm');
    expect(chain2Href('scheme_send', 'confirm', ID, 'versions')).toBe(`/schemes/${ID}?tab=versions&do=send&act=confirm`);
    expect(chain2Href('rule_remove', 'confirm', ID, 'identity')).toBe(`/schemes/${ID}?tab=rules&do=remove&act=confirm`);
    expect(schemeTab({ tab: 'versions' })).toBe('versions'); expect(schemeTab({ tab: 'publish' })).toBe('identity'); expect(schemeTab(undefined)).toBe('identity');
  });
});

describe('PC-56 GOV-2b · the scheme pages\' pure pieces', () => {
  it('list state: off (404) / forbidden (403) / error / empty / ok', () => {
    expect(schemesState(null, { status: 404, code: 'NOT_FOUND' })).toBe('off'); expect(schemesState(null, { status: 403, code: 'X' })).toBe('forbidden');
    expect(schemesState(null, { status: 500, code: 'X' })).toBe('error'); expect(schemesState(null, null)).toBe('error');
    expect(schemesState([], null)).toBe('empty');
  });
  it('one scheme: GOV_SCHEME_NOT_FOUND → not_found; any other 404 → off (the console\'s switch)', () => {
    expect(schemeState(null, { status: 404, code: 'GOV_SCHEME_NOT_FOUND' })).toBe('not_found');
    expect(schemeState(null, { status: 404, code: 'NOT_FOUND' })).toBe('off');
    expect(schemeState(null, { status: 403, code: 'X' })).toBe('forbidden'); expect(schemeState(null, { status: 502, code: 'X' })).toBe('error');
  });
  it('words: active / inactive, version status, the second-person fact AS READ (never inferred)', () => {
    expect([activeKey({ isActive: true }), activeKey({ isActive: false })]).toEqual(['gov2.active', 'gov2.inactive']);
    expect([versionStatusKey('published'), versionStatusKey('superseded'), versionStatusKey('draft')]).toEqual(['gov2.ver.status.published', 'gov2.ver.status.superseded', 'common.dash']);
    expect(secondPersonKey({ publishedBySecondPerson: true, isBackfilled: false })).toBe('gov2.ver.second.yes');
    expect(secondPersonKey({ publishedBySecondPerson: false, isBackfilled: true })).toBe('gov2.ver.second.backfilled');
    expect(secondPersonKey({ publishedBySecondPerson: false, isBackfilled: false })).toBe('gov2.ver.second.no');
  });
  it('the diff version: ?v= when listed, else the newest; null when none', () => {
    const vs = [3, 2, 1].map((version) => ({ version, status: 'published', publishedAt: null, publishedBySecondPerson: false, isBackfilled: false }));
    expect(diffVersion('2', vs)).toBe(2); expect(diffVersion('9', vs)).toBe(3); expect(diffVersion(['x'], vs)).toBe(3); expect(diffVersion(undefined, [])).toBeNull();
  });
  it('a stored value AS STORED: strings, numbers, list items by name, objects as pairs; empty → null; nothing converted', () => {
    expect(asStored({ opens: '2026-06-01', closes: '2026-08-31' })).toBe('opens: 2026-06-01 · closes: 2026-08-31');
    expect(asStored([{ id: 'x', name: 'A' }, { id: 'y', name: 'B' }])).toBe('A; B');
    expect(asStored([{ key: 'k', label: 'L', personal: true }])).toBe('L (k)');
    expect([asStored(null), asStored(''), asStored([]), asStored({})]).toEqual([null, null, null, null]);
    expect(asStored(2.5)).toBe('2.5'); expect(asStored(false)).toBe('false');
  });
});
