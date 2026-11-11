// apps/web-gov/src/test/gov4-refusals.spec.ts · PC-56 GOV-4a · E5 — the GOV-4 registry (features/gov4/refusals.ts): ALL 19 canon files, one
// verdict each (4a decides its 13; 4b's 6 stay `pending_4b`); the 14 chain files in exactly one of FIVE groups each; every 4a group built by a
// chain; every refusal / chain / "does not do" key in en, hi and gu; every 4a surface prints a refusal; every English refusal says no; the
// chains' query states; Back is /verification.
import { chain4For, chain4State, GOV4_CANON_FILES, GOV4_CHAIN_GROUPS, GOV4_CHAINS, GOV4_DELTAS, GOV4_NOT_DONE, GOV4_REFUSALS, SURFACES_4A, SURFACES_4B, VERIFICATION_BACK } from '../features/gov4/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const DECIDED = ['BUILT (honest)', 'BUILT (read)', 'REAL', 'PARITY-DECOR', 'DECOR'];

describe('PC-56 GOV-4 · the registry', () => {
  it('19 canon files, each once, one verdict; 4a decides 13; 4b\'s 6 are pending_4b', () => {
    expect(GOV4_CANON_FILES).toHaveLength(19);
    expect(new Set(GOV4_CANON_FILES.map((f) => f.file)).size).toBe(19);
    const a = GOV4_CANON_FILES.filter((f) => f.wave === '4a'); const b = GOV4_CANON_FILES.filter((f) => f.wave === '4b');
    expect([a.length, b.length]).toEqual([13, 6]);
    expect(a.every((f) => DECIDED.includes(f.verdict))).toBe(true);
    expect(b.every((f) => f.verdict === 'pending_4b')).toBe(true);
    expect(Object.fromEntries(a.map((f) => [f.file.split('-')[0], f.verdict]))).toEqual({
      W335: 'BUILT (honest)', W336: 'BUILT (honest)', W337: 'BUILT (honest)', W338: 'BUILT (honest)',
      W3189: 'DECOR', W3190: 'DECOR', W3191: 'DECOR', W3192: 'DECOR', W3193: 'DECOR', W3194: 'DECOR', W3195: 'DECOR', W3196: 'DECOR', W3197: 'DECOR',
    });
    expect(b.map((f) => f.file.split('-')[0])).toEqual(['W356', 'W3262', 'W3263', 'W3264', 'W3265', 'W3266']);
  });
  it('14 chain files in 5 groups (the canon\'s route comments), each file exactly once, each in a group of its own wave; 5 real screens', () => {
    expect(GOV4_CHAIN_GROUPS).toHaveLength(5);
    const all = GOV4_CHAIN_GROUPS.flatMap((g) => g.files);
    expect(all).toHaveLength(14); expect(new Set(all).size).toBe(14);
    for (const g of GOV4_CHAIN_GROUPS) for (const f of g.files) expect([f, GOV4_CANON_FILES.find((y) => y.file.startsWith(`${f}-`))?.wave]).toEqual([f, g.wave]);
    expect(GOV4_CANON_FILES.length - all.length).toBe(5);
  });
  it('the built chains: three, all 4a, all DECOR, one per 4a group; each group\'s files map one-to-one onto its chain\'s states', () => {
    expect(GOV4_CHAINS.map((c) => [c.id, c.wave, c.kind, c.group, c.statement])).toEqual([
      ['visit_file', '4a', 'DECOR', 'verification_export', 'gov4.download'], ['visit_draft', '4a', 'DECOR', 'verification_form', 'gov4.q2'], ['visit_act', '4a', 'DECOR', 'verification_mutate', 'gov4.q2'],
    ]);
    for (const g of GOV4_CHAIN_GROUPS) expect([g.id, GOV4_CHAINS.some((c) => c.group === g.id)]).toEqual([g.id, g.wave === '4a']);
    for (const c of GOV4_CHAINS) expect([c.id, c.states.length]).toEqual([c.id, GOV4_CHAIN_GROUPS.find((g) => g.id === c.group)?.files.length]);
    for (const c of GOV4_CHAINS) for (const f of GOV4_CHAIN_GROUPS.find((g) => g.id === c.group)?.files ?? [])
      expect([c.id, f, GOV4_CANON_FILES.find((y) => y.file.startsWith(`${f}-`))?.verdict]).toEqual([c.id, f, c.kind]);
  });
  it('"What this console does not do" names W335\'s acts, W336, W337 and W338 — each canon file at least once, each item once', () => {
    expect([...new Set(GOV4_NOT_DONE.map((n) => n.file))].sort()).toEqual(['W335', 'W336', 'W337', 'W338']);
    expect(new Set(GOV4_NOT_DONE.map((n) => n.id)).size).toBe(GOV4_NOT_DONE.length);
    expect(GOV4_DELTAS.some((d) => d.id === 'no_retry') && GOV4_DELTAS.some((d) => d.id === 'one_route')).toBe(true);
  });
  it('every key in en/hi/gu; every refusal id once; refusals only on 4a surfaces; every 4a surface prints one', () => {
    expect(new Set(GOV4_REFUSALS.map((r) => r.id)).size).toBe(GOV4_REFUSALS.length);
    for (const [l, cat] of Object.entries(CATS)) {
      const keys = [...GOV4_REFUSALS.map((r) => r.key), ...GOV4_NOT_DONE.map((n) => n.key), 'gov4.refused.title', 'gov4.notDone.title', 'gov4.chain.back',
        'gov4.q1', 'gov4.q2', 'gov4.q3', 'gov4.q5', 'gov4.download', 'gov4.nav.verification', 'gov4.verification.title', ...GOV4_CHAINS.flatMap((c) => c.states.flatMap((s) => [`${c.key(s)}.title`, `${c.key(s)}.body`]))];
      for (const k of keys) expect([l, k, typeof (cat as Record<string, string>)[k]]).toEqual([l, k, 'string']);
    }
    for (const r of GOV4_REFUSALS) for (const s of r.surfaces) expect([r.id, SURFACES_4A.includes(s), SURFACES_4B.includes(s)]).toEqual([r.id, true, false]);
    for (const s of SURFACES_4A) expect([s, GOV4_REFUSALS.some((r) => r.surfaces.includes(s))]).toEqual([s, true]);
  });
  it('every English refusal and "does not do" item says no (the negative-word rule)', () => {
    const NEG = /\b(no|not|never|nobody|nothing|cannot|only)\b|n't\b/i;
    for (const r of GOV4_REFUSALS) expect([r.id, NEG.test(en[r.key])]).toEqual([r.id, true]);
    for (const n of GOV4_NOT_DONE) expect([n.id, NEG.test(en[n.key])]).toEqual([n.id, true]);
  });
});

describe('PC-56 GOV-4a · the chains\' query states (pure); Back is /verification', () => {
  it('do=file / draft / act open their chains; anything else → the page', () => {
    expect([chain4For({ do: 'file' }), chain4For({ do: 'draft' }), chain4For({ do: 'act' }), chain4For({ do: 'assign' }), chain4For({}), chain4For(undefined)])
      .toEqual(['visit_file', 'visit_draft', 'visit_act', null, null, null]);
    expect(chain4For({ do: ['act'] })).toBe('visit_act');
  });
  it('states: file queued / ready; draft form-error / review / success / failure; act confirm / success / failure', () => {
    expect(chain4State('visit_file', { act: 'ready' })).toBe('ready'); expect(chain4State('visit_file', { act: 'confirm' })).toBeNull();
    expect(chain4State('visit_draft', { act: 'form-error' })).toBe('form-error'); expect(chain4State('visit_draft', { act: 'queued' })).toBeNull();
    expect(chain4State('visit_act', { act: 'failure' })).toBe('failure'); expect(chain4State('visit_act', {})).toBeNull();
    expect(VERIFICATION_BACK).toBe('/verification');
  });
});
