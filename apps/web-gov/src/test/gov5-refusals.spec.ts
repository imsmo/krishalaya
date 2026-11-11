// apps/web-gov/src/test/gov5-refusals.spec.ts · PC-56 GOV-5a · E5 (GOV-5b: 33/33 decided, 0 pending) — the GOV-5 registry
// (features/gov5/refusals.ts): ALL 33 canon files, one verdict each (5a's 23 and 5b's 10 — `pending_5b` no longer exists); the 26 chain
// files in exactly one of NINE groups each; every group built by ONE chain; the 5b sections "Wages" (W349) and "Social audit" (W350); every refusal / chain / "does not do" key in en, hi and gu; every surface prints a refusal; every English
// refusal says no; the chains' query states; Back is /mgnrega.
import { chain5For, chain5State, GOV5_CANON_FILES, GOV5_CHAIN_GROUPS, GOV5_CHAINS, GOV5_DELTAS, GOV5_NOT_DONE, GOV5_REFUSALS, GOV5_SECTIONS_5B, MGNREGA_BACK, SURFACES_5A, SURFACES_5B } from '../features/gov5/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const DECIDED = ['BUILT (honest)', 'BUILT (read)', 'REAL', 'PARITY-DECOR', 'DECOR'];
const code = (f: string) => f.split('-')[0];

describe('PC-56 GOV-5 · the registry', () => {
  it('33 canon files, each once, one verdict; 33 decided, 0 pending (5a 23, 5b 10)', () => {
    expect(GOV5_CANON_FILES).toHaveLength(33);
    expect(new Set(GOV5_CANON_FILES.map((f) => f.file)).size).toBe(33);
    const a = GOV5_CANON_FILES.filter((f) => f.wave === '5a'); const b = GOV5_CANON_FILES.filter((f) => f.wave === '5b');
    expect([a.length, b.length]).toEqual([23, 10]);
    expect(a.every((f) => DECIDED.includes(f.verdict))).toBe(true);
    expect(b.every((f) => DECIDED.includes(f.verdict))).toBe(true);
    expect(JSON.stringify(GOV5_CANON_FILES)).not.toMatch(/pending/);
    expect(Object.fromEntries(a.map((f) => [code(f.file), f.verdict]))).toEqual({
      W345: 'BUILT (honest)', W346: 'BUILT (honest)', W347: 'BUILT (honest)', W348: 'BUILT (honest)', W440: 'BUILT (honest)',
      W3224: 'DECOR', W3225: 'DECOR', W3226: 'PARITY-DECOR', W3227: 'PARITY-DECOR', W3228: 'PARITY-DECOR',
      W3233: 'DECOR', W3234: 'DECOR', W3235: 'DECOR', W3236: 'PARITY-DECOR', W3237: 'PARITY-DECOR', W3238: 'PARITY-DECOR',
      W3275: 'DECOR', W3276: 'DECOR', W3277: 'DECOR', W3278: 'DECOR', W3279: 'PARITY-DECOR', W3280: 'PARITY-DECOR', W3281: 'PARITY-DECOR',
    });
    expect(Object.fromEntries(b.map((f) => [code(f.file), f.verdict]))).toEqual({
      W349: 'BUILT (honest)', W350: 'BUILT (honest)', W3267: 'DECOR', W3268: 'DECOR', W3269: 'DECOR', W3270: 'DECOR', W3271: 'DECOR',
      W3272: 'PARITY-DECOR', W3273: 'PARITY-DECOR', W3274: 'PARITY-DECOR',
    });
    // survey §1 tally — 5a: BUILT (honest) 5, DECOR 9, PARITY-DECOR 9; 5b: 2, 5, 3; all 33: 7 real screens, DECOR 14, PARITY-DECOR 12
    expect(['BUILT (honest)', 'DECOR', 'PARITY-DECOR'].map((v) => a.filter((f) => f.verdict === v).length)).toEqual([5, 9, 9]);
    expect(['BUILT (honest)', 'DECOR', 'PARITY-DECOR'].map((v) => b.filter((f) => f.verdict === v).length)).toEqual([2, 5, 3]);
    expect(['BUILT (honest)', 'DECOR', 'PARITY-DECOR'].map((v) => GOV5_CANON_FILES.filter((f) => f.verdict === v).length)).toEqual([7, 14, 12]);
  });
  it('26 chain files in 9 groups (the canon\'s route comments), each file exactly once, each in a group of its own wave; 7 real screens', () => {
    expect(GOV5_CHAIN_GROUPS).toHaveLength(9);
    const all = GOV5_CHAIN_GROUPS.flatMap((g) => g.files);
    expect(all).toHaveLength(26); expect(new Set(all).size).toBe(26);
    for (const g of GOV5_CHAIN_GROUPS) for (const f of g.files) expect([f, GOV5_CANON_FILES.find((y) => y.file.startsWith(`${f}-`))?.wave]).toEqual([f, g.wave]);
    expect(GOV5_CANON_FILES.length - all.length).toBe(7);
    expect(GOV5_CHAIN_GROUPS.filter((g) => g.wave === '5a').map((g) => g.id)).toEqual(['job_export', 'job_mutate', 'mgnrega_mutate', 'muster_mutate', 'work_form', 'work_mutate']);
    expect(GOV5_CHAIN_GROUPS.filter((g) => g.wave === '5b').map((g) => g.id)).toEqual(['social_mutate', 'wage_export', 'wage_mutate']);
  });
  it('the built chains: nine, one per group (six 5a, three 5b); files map one-to-one onto states; kind = every file\'s verdict', () => {
    expect(GOV5_CHAINS.map((c) => [c.id, c.wave, c.kind, c.group, c.statement, c.back, c.doing])).toEqual([
      ['job_file', '5a', 'DECOR', 'job_export', 'gov5.download', '/mgnrega', 'job-file'],
      ['job_reread', '5a', 'PARITY-DECOR', 'job_mutate', 'gov5.q2', '/mgnrega', 'job-reread'],
      ['sync_act', '5a', 'DECOR', 'mgnrega_mutate', 'gov5.q3', '/mgnrega', 'sync'],
      ['muster_reread', '5a', 'PARITY-DECOR', 'muster_mutate', 'gov5.q2', '/mgnrega', 'muster-reread'],
      ['demand_form', '5a', 'DECOR', 'work_form', 'gov5.q3', '/mgnrega', 'demand'],
      ['work_reread', '5a', 'PARITY-DECOR', 'work_mutate', 'gov5.q3', '/mgnrega', 'work-reread'],
      ['wage_file', '5b', 'DECOR', 'wage_export', 'gov5.download', '/mgnrega', 'wage-file'],
      ['wage_reread', '5b', 'PARITY-DECOR', 'wage_mutate', 'gov5.q1', '/mgnrega', 'wage-reread'],
      ['publish_act', '5b', 'DECOR', 'social_mutate', 'gov5.q5', '/mgnrega', 'publish'],
    ]);
    for (const g of GOV5_CHAIN_GROUPS) expect([g.id, GOV5_CHAINS.filter((c) => c.group === g.id).length, GOV5_CHAINS.find((c) => c.group === g.id)?.wave]).toEqual([g.id, 1, g.wave]);
    for (const c of GOV5_CHAINS) expect([c.id, c.states.length]).toEqual([c.id, GOV5_CHAIN_GROUPS.find((g) => g.id === c.group)?.files.length]);
    for (const c of GOV5_CHAINS) for (const f of GOV5_CHAIN_GROUPS.find((g) => g.id === c.group)?.files ?? [])
      expect([c.id, f, GOV5_CANON_FILES.find((y) => y.file.startsWith(`${f}-`))?.verdict]).toEqual([c.id, f, c.kind]);
  });
  it('"What this console does not do" names W345\'s acts, W346, W347, W348 and W440 — each 5a real screen at least once, each item once', () => {
    expect([...new Set(GOV5_NOT_DONE.map((n) => n.file))].sort()).toEqual(['W345', 'W346', 'W347', 'W348', 'W440']);
    expect(new Set(GOV5_NOT_DONE.map((n) => n.id)).size).toBe(GOV5_NOT_DONE.length);
    for (const id of ['one_route', 'nav_mgnrega', 'reads_nothing', 'q4_not_printed', 'q1_own_sentence', 'no_retry_opener', 'two_sections', 'q1_moved', 'chrome_5b', 'no_retry_opener_5b']) expect([id, GOV5_DELTAS.some((d) => d.id === id)]).toEqual([id, true]);
  });
  it('GOV-5b: two sections — "Wages" (W349, Q1\'s sentence) and "Social audit" (W350, Q5\'s sentence); each item once; ids unique page-wide', () => {
    expect(GOV5_SECTIONS_5B.map((s) => [s.id, s.file, s.surface, s.title, s.statement])).toEqual([
      ['wages', 'W349', 'wages', 'gov5.wages.title', 'gov5.q1'], ['social_audit', 'W350', 'social_audit', 'gov5.social.title', 'gov5.q5'],
    ]);
    expect(GOV5_SECTIONS_5B[0].items.map((n) => n.id)).toEqual(['wage_list', 'payment_order', 'compensation', 'allowance', 'pay_date']);
    expect(GOV5_SECTIONS_5B[1].items.map((n) => n.id)).toEqual(['public_notice', 'audit_papers', 'complaints']);
    const ids = [...GOV5_NOT_DONE.map((n) => n.id), ...GOV5_SECTIONS_5B.flatMap((s) => s.items.map((n) => n.id))];
    expect(new Set(ids).size).toBe(ids.length);
    const keys = [...GOV5_NOT_DONE.map((n) => n.key), ...GOV5_SECTIONS_5B.flatMap((s) => s.items.map((n) => n.key))];
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of GOV5_SECTIONS_5B) expect([s.id, SURFACES_5B.includes(s.surface)]).toEqual([s.id, true]);
  });
  it('every key in en/hi/gu; every refusal id once; refusals only on built surfaces; every surface prints one', () => {
    expect(new Set(GOV5_REFUSALS.map((r) => r.id)).size).toBe(GOV5_REFUSALS.length);
    for (const [l, cat] of Object.entries(CATS)) {
      const keys = [...GOV5_REFUSALS.map((r) => r.key), ...GOV5_NOT_DONE.map((n) => n.key), ...GOV5_SECTIONS_5B.flatMap((s) => [s.title, s.statement, ...s.items.map((n) => n.key)]), 'gov5.refused.title', 'gov5.notDone.title', 'gov5.chain.back', 'gov5.chain.reread',
        'gov5.q1', 'gov5.q2', 'gov5.q3', 'gov5.q5', 'gov5.download', 'gov5.nav.mgnrega', 'gov5.mgnrega.title',
        ...GOV5_CHAINS.flatMap((c) => c.states.flatMap((s) => [`${c.key(s)}.title`, `${c.key(s)}.body`]))];
      for (const k of keys) expect([l, k, typeof (cat as Record<string, string>)[k]]).toEqual([l, k, 'string']);
    }
    // a refusal sits on 5a surfaces only or on 5b surfaces only, never both
    for (const r of GOV5_REFUSALS) for (const s of r.surfaces) expect([r.id, s, SURFACES_5A.includes(s) !== SURFACES_5B.includes(s)]).toEqual([r.id, s, true]);
    for (const r of GOV5_REFUSALS) expect([r.id, r.surfaces.every((s) => SURFACES_5A.includes(s)) || r.surfaces.every((s) => SURFACES_5B.includes(s))]).toEqual([r.id, true]);
    for (const s of [...SURFACES_5A, ...SURFACES_5B]) expect([s, GOV5_REFUSALS.some((r) => r.surfaces.includes(s))]).toEqual([s, true]);
    expect(SURFACES_5B).toEqual(['wages', 'social_audit', 'wage_file', 'wage_reread', 'publish_act']);
  });
  it('every English refusal and "does not do" item says no (the negative-word rule)', () => {
    const NEG = /\b(no|not|never|nobody|nothing|cannot|only)\b|n't\b/i;
    for (const r of GOV5_REFUSALS) expect([r.id, NEG.test(en[r.key])]).toEqual([r.id, true]);
    for (const n of GOV5_NOT_DONE) expect([n.id, NEG.test(en[n.key])]).toEqual([n.id, true]);
    for (const n of GOV5_SECTIONS_5B.flatMap((s) => s.items)) expect([n.id, NEG.test(en[n.key])]).toEqual([n.id, true]);
  });
  it('the registry\'s canon quotes are anonymised: no canon person, place, body, card, muster or measurement reference', () => {
    const all = JSON.stringify([GOV5_REFUSALS, GOV5_NOT_DONE, GOV5_SECTIONS_5B, GOV5_DELTAS, GOV5_CANON_FILES]);
    expect(all).not.toMatch(/Vanthali|Junagadh|talav|GJ-0|D-2026|MR-\d|MB-\d|••847|[A-Z]••• [A-Z]\.|₹|\bNK\b|DELTA-0|W289|0\.05|22\.68|પગાર/);
  });
});

describe('PC-56 GOV-5a/5b · the chains\' query states (pure); Back is /mgnrega', () => {
  it('do=job-file / job-reread / sync / muster-reread / demand / work-reread (5a) and wage-file / wage-reread / publish (5b) open their chains; anything else → the page', () => {
    expect([chain5For({ do: 'job-file' }), chain5For({ do: 'job-reread' }), chain5For({ do: 'sync' }), chain5For({ do: 'muster-reread' }), chain5For({ do: 'demand' }), chain5For({ do: 'work-reread' })])
      .toEqual(['job_file', 'job_reread', 'sync_act', 'muster_reread', 'demand_form', 'work_reread']);
    expect([chain5For({ do: 'wage-file' }), chain5For({ do: 'wage-reread' }), chain5For({ do: 'publish' })]).toEqual(['wage_file', 'wage_reread', 'publish_act']);
    expect([chain5For({ do: 'wall' }), chain5For({ do: 'social-audit' }), chain5For({ do: 'grievance' }), chain5For({ do: 'file' }), chain5For({}), chain5For(undefined)]).toEqual([null, null, null, null, null, null]);
    expect(chain5For({ do: ['sync'] })).toBe('sync_act');
  });
  it('states: file queued / ready; re-reads and sync confirm / success / failure; demand form-error / review / success / failure', () => {
    expect(chain5State('job_file', { act: 'ready' })).toBe('ready'); expect(chain5State('job_file', { act: 'confirm' })).toBeNull();
    expect(chain5State('sync_act', { act: 'confirm' })).toBe('confirm'); expect(chain5State('sync_act', { act: 'queued' })).toBeNull();
    expect(chain5State('demand_form', { act: 'form-error' })).toBe('form-error'); expect(chain5State('demand_form', { act: 'confirm' })).toBeNull();
    expect(chain5State('work_reread', { act: 'failure' })).toBe('failure'); expect(chain5State('muster_reread', {})).toBeNull();
    expect(chain5State('wage_file', { act: 'queued' })).toBe('queued'); expect(chain5State('wage_file', { act: 'confirm' })).toBeNull();
    expect(chain5State('publish_act', { act: 'confirm' })).toBe('confirm'); expect(chain5State('publish_act', { act: 'ready' })).toBeNull();
    expect(chain5State('wage_reread', { act: 'success' })).toBe('success');
    expect(MGNREGA_BACK).toBe('/mgnrega');
  });
});
