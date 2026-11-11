// apps/web-gov/src/test/gov3-refusals.spec.ts · PC-56 GOV-3a · E5 — the GOV-3 registry (features/gov3/refusals.ts): ALL 23 canon files, one
// verdict each (3a decides its 9; 3b's 14 stay `pending_3b`); the 16 chain files in exactly one group each (SIX groups — the canon's own route
// comments; the brief's "5" is recorded as a finding); every 3a group built by a chain; every refusal / chain / "does not do" key in en, hi
// and gu; every 3a surface prints a refusal; every English refusal says no; the chains' query states; B4 — one key for "marked disbursed".
import { chain3For, chain3State, DBT_BACK, GOV3_CANON_FILES, GOV3_CHAIN_GROUPS, GOV3_CHAINS, GOV3_DELTAS, GOV3_NOT_DONE, GOV3_REFUSALS, SURFACES_3A, SURFACES_3B } from '../features/gov3/refusals';
import { DISBURSED_KEY, statusKey } from '../features/gov2/applications';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const DECIDED = ['BUILT (honest)', 'BUILT (read)', 'REAL', 'PARITY-DECOR', 'DECOR'];

describe('PC-56 GOV-3 · the registry', () => {
  it('23 canon files, each once, one verdict; 3a decides 9; 3b\'s 14 are pending_3b', () => {
    expect(GOV3_CANON_FILES).toHaveLength(23);
    expect(new Set(GOV3_CANON_FILES.map((f) => f.file)).size).toBe(23);
    const a = GOV3_CANON_FILES.filter((f) => f.wave === '3a'); const b = GOV3_CANON_FILES.filter((f) => f.wave === '3b');
    expect([a.length, b.length]).toEqual([9, 14]);
    expect(a.every((f) => DECIDED.includes(f.verdict))).toBe(true);
    expect(b.every((f) => f.verdict === 'pending_3b')).toBe(true);
    expect(Object.fromEntries(a.map((f) => [f.file.split('-')[0], f.verdict]))).toEqual({
      W332: 'BUILT (honest)', W339: 'BUILT (honest)', W340: 'BUILT (honest)', W344: 'BUILT (honest)',
      W3167: 'DECOR', W3168: 'DECOR', W3169: 'DECOR', W3170: 'DECOR', W3171: 'DECOR',
    });
    expect(b.map((f) => f.file.split('-')[0])).toEqual(['W341', 'W342', 'W343', 'W3179', 'W3180', 'W3181', 'W3211', 'W3212', 'W3213', 'W3239', 'W3240', 'W3241', 'W3242', 'W3243']);
  });
  it('16 chain files in 6 groups (the canon\'s route comments), each file exactly once, each in a group of its own wave; 7 real screens', () => {
    expect(GOV3_CHAIN_GROUPS).toHaveLength(6);
    const all = GOV3_CHAIN_GROUPS.flatMap((g) => g.files);
    expect(all).toHaveLength(16); expect(new Set(all).size).toBe(16);
    for (const g of GOV3_CHAIN_GROUPS) for (const f of g.files) expect([f, GOV3_CANON_FILES.find((y) => y.file.startsWith(`${f}-`))?.wave]).toEqual([f, g.wave]);
    expect(GOV3_CANON_FILES.length - all.length).toBe(7);
    expect(GOV3_DELTAS.some((d) => d.id === 'six_groups')).toBe(true);
  });
  it('the built chains: three, all 3a, both 3a groups built; the stop and the file DECOR, the re-read PARITY-DECOR', () => {
    expect(GOV3_CHAINS.map((c) => [c.id, c.kind, c.group, c.statement])).toEqual([['dbt_file', 'DECOR', 'dbt_export', 'gov3.q4'], ['dbt_pause', 'DECOR', 'dbt_mutate', 'gov3.q1'], ['dbt_reread', 'PARITY-DECOR', 'dbt_mutate', 'gov3.q1']]);
    for (const g of GOV3_CHAIN_GROUPS.filter((x) => x.wave === '3a')) expect([g.id, GOV3_CHAINS.some((c) => c.group === g.id)]).toEqual([g.id, true]);
    for (const g of GOV3_CHAIN_GROUPS.filter((x) => x.wave === '3b')) expect([g.id, GOV3_CHAINS.some((c) => c.group === g.id)]).toEqual([g.id, false]);
  });
  it('"What this console does not do" names W339, W340 and W344 — each canon file at least once, each item once', () => {
    expect([...new Set(GOV3_NOT_DONE.map((n) => n.file))].sort()).toEqual(['W339', 'W340', 'W344']);
    expect(new Set(GOV3_NOT_DONE.map((n) => n.id)).size).toBe(GOV3_NOT_DONE.length);
  });
  it('every key in en/hi/gu; every refusal id once; refusals only on 3a surfaces; every 3a surface prints one', () => {
    expect(new Set(GOV3_REFUSALS.map((r) => r.id)).size).toBe(GOV3_REFUSALS.length);
    for (const [l, cat] of Object.entries(CATS)) {
      const keys = [...GOV3_REFUSALS.map((r) => r.key), ...GOV3_NOT_DONE.map((n) => n.key), 'gov3.refused.title', 'gov3.notDone.title', 'gov3.chain.back', 'gov3.chain.rereadLink',
        'gov3.q1', 'gov3.q2', 'gov3.q4', 'gov3.nav.dbt', 'gov3.dbt.title', ...GOV3_CHAINS.flatMap((c) => c.states.flatMap((s) => [`${c.key(s)}.title`, `${c.key(s)}.body`]))];
      for (const k of keys) expect([l, k, typeof cat[k]]).toEqual([l, k, 'string']);
    }
    for (const r of GOV3_REFUSALS) for (const s of r.surfaces) expect([r.id, SURFACES_3A.includes(s), SURFACES_3B.includes(s)]).toEqual([r.id, true, false]);
    for (const s of SURFACES_3A) expect([s, GOV3_REFUSALS.some((r) => r.surfaces.includes(s))]).toEqual([s, true]);
  });
  it('every English refusal and "does not do" item says no (the negative-word rule)', () => {
    const NEG = /\b(no|not|never|nobody|nothing|cannot|only)\b|n't\b/i;
    for (const r of GOV3_REFUSALS) expect([r.id, NEG.test(en[r.key])]).toEqual([r.id, true]);
    for (const n of GOV3_NOT_DONE) expect([n.id, NEG.test(en[n.key])]).toEqual([n.id, true]);
  });
});

describe('PC-56 GOV-3a · the chains\' query states (pure); Back is /dbt', () => {
  it('do=file / pause / reread open their chains; anything else → the page', () => {
    expect([chain3For({ do: 'file' }), chain3For({ do: 'pause' }), chain3For({ do: 'reread' }), chain3For({ do: 'release' }), chain3For({}), chain3For(undefined)])
      .toEqual(['dbt_file', 'dbt_pause', 'dbt_reread', null, null, null]);
    expect(chain3For({ do: ['pause'] })).toBe('dbt_pause');
  });
  it('states: the file chain has queued / ready only; the mutate chains confirm / success / failure', () => {
    expect(chain3State('dbt_file', { act: 'queued' })).toBe('queued'); expect(chain3State('dbt_file', { act: 'confirm' })).toBeNull();
    expect(chain3State('dbt_pause', { act: 'failure' })).toBe('failure'); expect(chain3State('dbt_reread', { act: 'ready' })).toBeNull();
    expect(DBT_BACK).toBe('/dbt');
  });
});

describe('PC-56 GOV-3a · B4 / E6 — one key words `disbursed` on every gov page', () => {
  it('the applications page\'s status words for `disbursed` are GOV-1b\'s key; gov2.status.disbursed is gone ×3', () => {
    expect(statusKey('disbursed')).toBe(DISBURSED_KEY); expect(DISBURSED_KEY).toBe('gov1.dash.status.disbursed');
    expect(en[DISBURSED_KEY]).toBe('Marked disbursed by an officer');
    for (const cat of [en, hi, gu]) expect('gov2.status.disbursed' in cat).toBe(false);
    for (const cat of [hi, gu]) expect([cat[DISBURSED_KEY] !== en[DISBURSED_KEY], /अधिकारी|અધિકારી/.test(cat[DISBURSED_KEY])]).toEqual([true, true]);
    expect(statusKey('approved')).toBe('gov2.status.approved');
  });
});
