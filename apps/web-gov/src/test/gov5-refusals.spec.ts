// apps/web-gov/src/test/gov5-refusals.spec.ts · PC-56 GOV-5a · E5 — the GOV-5 registry (features/gov5/refusals.ts): ALL 33 canon files, one
// verdict each (5a's 23 decided, 5b's 10 `pending_5b`); the 26 chain files in exactly one of NINE groups each; every 5a group built by ONE
// chain, no 5b group built yet; every refusal / chain / "does not do" key in en, hi and gu; every surface prints a refusal; every English
// refusal says no; the chains' query states; Back is /mgnrega.
import { chain5For, chain5State, GOV5_CANON_FILES, GOV5_CHAIN_GROUPS, GOV5_CHAINS, GOV5_DELTAS, GOV5_NOT_DONE, GOV5_REFUSALS, MGNREGA_BACK, SURFACES_5A, SURFACES_5B } from '../features/gov5/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const DECIDED = ['BUILT (honest)', 'BUILT (read)', 'REAL', 'PARITY-DECOR', 'DECOR'];
const code = (f: string) => f.split('-')[0];

describe('PC-56 GOV-5 · the registry', () => {
  it('33 canon files, each once, one verdict; 23 decided (5a), 10 pending (5b)', () => {
    expect(GOV5_CANON_FILES).toHaveLength(33);
    expect(new Set(GOV5_CANON_FILES.map((f) => f.file)).size).toBe(33);
    const a = GOV5_CANON_FILES.filter((f) => f.wave === '5a'); const b = GOV5_CANON_FILES.filter((f) => f.wave === '5b');
    expect([a.length, b.length]).toEqual([23, 10]);
    expect(a.every((f) => DECIDED.includes(f.verdict))).toBe(true);
    expect(b.every((f) => f.verdict === 'pending_5b')).toBe(true);
    expect(Object.fromEntries(a.map((f) => [code(f.file), f.verdict]))).toEqual({
      W345: 'BUILT (honest)', W346: 'BUILT (honest)', W347: 'BUILT (honest)', W348: 'BUILT (honest)', W440: 'BUILT (honest)',
      W3224: 'DECOR', W3225: 'DECOR', W3226: 'PARITY-DECOR', W3227: 'PARITY-DECOR', W3228: 'PARITY-DECOR',
      W3233: 'DECOR', W3234: 'DECOR', W3235: 'DECOR', W3236: 'PARITY-DECOR', W3237: 'PARITY-DECOR', W3238: 'PARITY-DECOR',
      W3275: 'DECOR', W3276: 'DECOR', W3277: 'DECOR', W3278: 'DECOR', W3279: 'PARITY-DECOR', W3280: 'PARITY-DECOR', W3281: 'PARITY-DECOR',
    });
    expect(b.map((f) => code(f.file)).sort()).toEqual(['W3267', 'W3268', 'W3269', 'W3270', 'W3271', 'W3272', 'W3273', 'W3274', 'W349', 'W350']);
    // survey §1 tally for 5a: BUILT (honest) 5, DECOR 9, PARITY-DECOR 9
    expect(['BUILT (honest)', 'DECOR', 'PARITY-DECOR'].map((v) => a.filter((f) => f.verdict === v).length)).toEqual([5, 9, 9]);
  });
  it('26 chain files in 9 groups (the canon\'s route comments), each file exactly once, each in a group of its own wave; 7 real screens', () => {
    expect(GOV5_CHAIN_GROUPS).toHaveLength(9);
    const all = GOV5_CHAIN_GROUPS.flatMap((g) => g.files);
    expect(all).toHaveLength(26); expect(new Set(all).size).toBe(26);
    for (const g of GOV5_CHAIN_GROUPS) for (const f of g.files) expect([f, GOV5_CANON_FILES.find((y) => y.file.startsWith(`${f}-`))?.wave]).toEqual([f, g.wave]);
    expect(GOV5_CANON_FILES.length - all.length).toBe(7);
    expect(GOV5_CHAIN_GROUPS.filter((g) => g.wave === '5a').map((g) => g.id)).toEqual(['job_export', 'job_mutate', 'mgnrega_mutate', 'muster_mutate', 'work_form', 'work_mutate']);
  });
  it('the built chains: six, one per 5a group, none for a 5b group; files map one-to-one onto states; kind = every file\'s verdict', () => {
    expect(GOV5_CHAINS.map((c) => [c.id, c.wave, c.kind, c.group, c.statement, c.back, c.doing])).toEqual([
      ['job_file', '5a', 'DECOR', 'job_export', 'gov5.download', '/mgnrega', 'job-file'],
      ['job_reread', '5a', 'PARITY-DECOR', 'job_mutate', 'gov5.q2', '/mgnrega', 'job-reread'],
      ['sync_act', '5a', 'DECOR', 'mgnrega_mutate', 'gov5.q3', '/mgnrega', 'sync'],
      ['muster_reread', '5a', 'PARITY-DECOR', 'muster_mutate', 'gov5.q2', '/mgnrega', 'muster-reread'],
      ['demand_form', '5a', 'DECOR', 'work_form', 'gov5.q3', '/mgnrega', 'demand'],
      ['work_reread', '5a', 'PARITY-DECOR', 'work_mutate', 'gov5.q3', '/mgnrega', 'work-reread'],
    ]);
    for (const g of GOV5_CHAIN_GROUPS) expect([g.id, GOV5_CHAINS.filter((c) => c.group === g.id).length]).toEqual([g.id, g.wave === '5a' ? 1 : 0]);
    for (const c of GOV5_CHAINS) expect([c.id, c.states.length]).toEqual([c.id, GOV5_CHAIN_GROUPS.find((g) => g.id === c.group)?.files.length]);
    for (const c of GOV5_CHAINS) for (const f of GOV5_CHAIN_GROUPS.find((g) => g.id === c.group)?.files ?? [])
      expect([c.id, f, GOV5_CANON_FILES.find((y) => y.file.startsWith(`${f}-`))?.verdict]).toEqual([c.id, f, c.kind]);
  });
  it('"What this console does not do" names W345\'s acts, W346, W347, W348 and W440 — each 5a real screen at least once, each item once', () => {
    expect([...new Set(GOV5_NOT_DONE.map((n) => n.file))].sort()).toEqual(['W345', 'W346', 'W347', 'W348', 'W440']);
    expect(new Set(GOV5_NOT_DONE.map((n) => n.id)).size).toBe(GOV5_NOT_DONE.length);
    for (const id of ['one_route', 'nav_mgnrega', 'reads_nothing', 'q4_not_printed', 'q1_own_sentence', 'no_retry_opener']) expect([id, GOV5_DELTAS.some((d) => d.id === id)]).toEqual([id, true]);
  });
  it('every key in en/hi/gu; every refusal id once; refusals only on built surfaces; every surface prints one', () => {
    expect(new Set(GOV5_REFUSALS.map((r) => r.id)).size).toBe(GOV5_REFUSALS.length);
    for (const [l, cat] of Object.entries(CATS)) {
      const keys = [...GOV5_REFUSALS.map((r) => r.key), ...GOV5_NOT_DONE.map((n) => n.key), 'gov5.refused.title', 'gov5.notDone.title', 'gov5.chain.back', 'gov5.chain.reread',
        'gov5.q1', 'gov5.q2', 'gov5.q3', 'gov5.download', 'gov5.nav.mgnrega', 'gov5.mgnrega.title',
        ...GOV5_CHAINS.flatMap((c) => c.states.flatMap((s) => [`${c.key(s)}.title`, `${c.key(s)}.body`]))];
      for (const k of keys) expect([l, k, typeof (cat as Record<string, string>)[k]]).toEqual([l, k, 'string']);
    }
    for (const r of GOV5_REFUSALS) for (const s of r.surfaces) expect([r.id, SURFACES_5A.includes(s), SURFACES_5B.includes(s)]).toEqual([r.id, true, false]);
    for (const s of SURFACES_5A) expect([s, GOV5_REFUSALS.some((r) => r.surfaces.includes(s))]).toEqual([s, true]);
    expect(SURFACES_5B).toEqual([]);
  });
  it('every English refusal and "does not do" item says no (the negative-word rule)', () => {
    const NEG = /\b(no|not|never|nobody|nothing|cannot|only)\b|n't\b/i;
    for (const r of GOV5_REFUSALS) expect([r.id, NEG.test(en[r.key])]).toEqual([r.id, true]);
    for (const n of GOV5_NOT_DONE) expect([n.id, NEG.test(en[n.key])]).toEqual([n.id, true]);
  });
  it('the registry\'s canon quotes are anonymised: no canon person, place, body, card, muster or measurement reference', () => {
    const all = JSON.stringify([GOV5_REFUSALS, GOV5_NOT_DONE, GOV5_DELTAS, GOV5_CANON_FILES]);
    expect(all).not.toMatch(/Vanthali|Junagadh|talav|GJ-0|D-2026|MR-\d|MB-\d|••847|[A-Z]••• [A-Z]\.|₹|\bNK\b|DELTA-0/);
  });
});

describe('PC-56 GOV-5a · the chains\' query states (pure); Back is /mgnrega', () => {
  it('do=job-file / job-reread / sync / muster-reread / demand / work-reread open their chains; anything else → the page', () => {
    expect([chain5For({ do: 'job-file' }), chain5For({ do: 'job-reread' }), chain5For({ do: 'sync' }), chain5For({ do: 'muster-reread' }), chain5For({ do: 'demand' }), chain5For({ do: 'work-reread' })])
      .toEqual(['job_file', 'job_reread', 'sync_act', 'muster_reread', 'demand_form', 'work_reread']);
    expect([chain5For({ do: 'publish' }), chain5For({ do: 'wage-file' }), chain5For({ do: 'file' }), chain5For({}), chain5For(undefined)]).toEqual([null, null, null, null, null]);
    expect(chain5For({ do: ['sync'] })).toBe('sync_act');
  });
  it('states: file queued / ready; re-reads and sync confirm / success / failure; demand form-error / review / success / failure', () => {
    expect(chain5State('job_file', { act: 'ready' })).toBe('ready'); expect(chain5State('job_file', { act: 'confirm' })).toBeNull();
    expect(chain5State('sync_act', { act: 'confirm' })).toBe('confirm'); expect(chain5State('sync_act', { act: 'queued' })).toBeNull();
    expect(chain5State('demand_form', { act: 'form-error' })).toBe('form-error'); expect(chain5State('demand_form', { act: 'confirm' })).toBeNull();
    expect(chain5State('work_reread', { act: 'failure' })).toBe('failure'); expect(chain5State('muster_reread', {})).toBeNull();
    expect(MGNREGA_BACK).toBe('/mgnrega');
  });
});
