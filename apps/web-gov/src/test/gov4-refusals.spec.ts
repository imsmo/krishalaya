// apps/web-gov/src/test/gov4-refusals.spec.ts · PC-56 GOV-4a · E5 (GOV-4b: 19/19 decided, 0 pending) — the GOV-4 registry
// (features/gov4/refusals.ts): ALL 19 canon files, one verdict each (4a's 13 and 4b's 6 — `pending_4b` no longer exists); the 14 chain files
// in exactly one of FIVE groups each; every group built by a chain; every refusal / chain / "does not do" key in en, hi and gu; every surface
// prints a refusal; every English refusal says no; the chains' query states, per page; Back is /verification or /access.
import { ACCESS_BACK, chain4For, chain4State, GOV4_CANON_FILES, GOV4_CHAIN_GROUPS, GOV4_CHAINS, GOV4_DELTAS, GOV4_NOT_DONE, GOV4_REFUSALS, SURFACES_4A, SURFACES_4B, VERIFICATION_BACK } from '../features/gov4/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const DECIDED = ['BUILT (honest)', 'BUILT (read)', 'REAL', 'PARITY-DECOR', 'DECOR'];

describe('PC-56 GOV-4 · the registry', () => {
  it('19 canon files, each once, one verdict; 19 decided, 0 pending (4a 13, 4b 6)', () => {
    expect(GOV4_CANON_FILES).toHaveLength(19);
    expect(new Set(GOV4_CANON_FILES.map((f) => f.file)).size).toBe(19);
    const a = GOV4_CANON_FILES.filter((f) => f.wave === '4a'); const b = GOV4_CANON_FILES.filter((f) => f.wave === '4b');
    expect([a.length, b.length]).toEqual([13, 6]);
    expect(a.every((f) => DECIDED.includes(f.verdict))).toBe(true);
    expect(b.every((f) => DECIDED.includes(f.verdict))).toBe(true);
    expect(GOV4_CANON_FILES.filter((f) => DECIDED.includes(f.verdict))).toHaveLength(19);
    expect(GOV4_CANON_FILES.filter((f) => !DECIDED.includes(f.verdict))).toHaveLength(0);
    expect(JSON.stringify(GOV4_CANON_FILES)).not.toMatch(/pending/);
    expect(Object.fromEntries(a.map((f) => [f.file.split('-')[0], f.verdict]))).toEqual({
      W335: 'BUILT (honest)', W336: 'BUILT (honest)', W337: 'BUILT (honest)', W338: 'BUILT (honest)',
      W3189: 'DECOR', W3190: 'DECOR', W3191: 'DECOR', W3192: 'DECOR', W3193: 'DECOR', W3194: 'DECOR', W3195: 'DECOR', W3196: 'DECOR', W3197: 'DECOR',
    });
    expect(Object.fromEntries(b.map((f) => [f.file.split('-')[0], f.verdict]))).toEqual({
      W356: 'BUILT (honest)', W3262: 'DECOR', W3263: 'DECOR', W3264: 'PARITY-DECOR', W3265: 'PARITY-DECOR', W3266: 'PARITY-DECOR',
    });
  });
  it('14 chain files in 5 groups (the canon\'s route comments), each file exactly once, each in a group of its own wave; 5 real screens', () => {
    expect(GOV4_CHAIN_GROUPS).toHaveLength(5);
    const all = GOV4_CHAIN_GROUPS.flatMap((g) => g.files);
    expect(all).toHaveLength(14); expect(new Set(all).size).toBe(14);
    for (const g of GOV4_CHAIN_GROUPS) for (const f of g.files) expect([f, GOV4_CANON_FILES.find((y) => y.file.startsWith(`${f}-`))?.wave]).toEqual([f, g.wave]);
    expect(GOV4_CANON_FILES.length - all.length).toBe(5);
  });
  it('the built chains: five, one per group; 4a\'s DECOR on /verification, 4b\'s file DECOR and re-read PARITY-DECOR on /access; files map one-to-one onto states', () => {
    expect(GOV4_CHAINS.map((c) => [c.id, c.wave, c.kind, c.group, c.statement, c.page, c.back])).toEqual([
      ['visit_file', '4a', 'DECOR', 'verification_export', 'gov4.download', 'verification', '/verification'], ['visit_draft', '4a', 'DECOR', 'verification_form', 'gov4.q2', 'verification', '/verification'],
      ['visit_act', '4a', 'DECOR', 'verification_mutate', 'gov4.q2', 'verification', '/verification'],
      ['signins_file', '4b', 'DECOR', 'session_export', 'gov4.signins.download', 'access', '/access'], ['signins_reread', '4b', 'PARITY-DECOR', 'session_mutate', 'gov4.q4', 'access', '/access'],
    ]);
    for (const g of GOV4_CHAIN_GROUPS) expect([g.id, GOV4_CHAINS.filter((c) => c.group === g.id).length]).toEqual([g.id, 1]);
    for (const c of GOV4_CHAINS) expect([c.id, c.states.length]).toEqual([c.id, GOV4_CHAIN_GROUPS.find((g) => g.id === c.group)?.files.length]);
    for (const c of GOV4_CHAINS) for (const f of GOV4_CHAIN_GROUPS.find((g) => g.id === c.group)?.files ?? [])
      expect([c.id, f, GOV4_CANON_FILES.find((y) => y.file.startsWith(`${f}-`))?.verdict]).toEqual([c.id, f, c.kind]);
  });
  it('"What this console does not do" names W335\'s acts, W336, W337 and W338 — each canon file at least once, each item once', () => {
    expect([...new Set(GOV4_NOT_DONE.map((n) => n.file))].sort()).toEqual(['W335', 'W336', 'W337', 'W338']);
    expect(new Set(GOV4_NOT_DONE.map((n) => n.id)).size).toBe(GOV4_NOT_DONE.length);
    expect(GOV4_DELTAS.some((d) => d.id === 'no_retry') && GOV4_DELTAS.some((d) => d.id === 'one_route')).toBe(true);
  });
  it('every key in en/hi/gu; every refusal id once; refusals only on built surfaces; every surface prints one', () => {
    expect(new Set(GOV4_REFUSALS.map((r) => r.id)).size).toBe(GOV4_REFUSALS.length);
    for (const [l, cat] of Object.entries(CATS)) {
      const keys = [...GOV4_REFUSALS.map((r) => r.key), ...GOV4_NOT_DONE.map((n) => n.key), 'gov4.refused.title', 'gov4.notDone.title', 'gov4.chain.back',
        'gov4.q1', 'gov4.q2', 'gov4.q3', 'gov4.q5', 'gov4.download', 'gov4.nav.verification', 'gov4.verification.title',
        'gov4.q4', 'gov4.signins.title', 'gov4.signins.lock', 'gov4.signins.download', 'gov4.chain.backAccess', 'gov4.chain.reread', ...GOV4_CHAINS.map((c) => c.backKey), ...GOV4_CHAINS.flatMap((c) => c.states.flatMap((s) => [`${c.key(s)}.title`, `${c.key(s)}.body`]))];
      for (const k of keys) expect([l, k, typeof (cat as Record<string, string>)[k]]).toEqual([l, k, 'string']);
    }
    for (const r of GOV4_REFUSALS) for (const s of r.surfaces) expect([r.id, SURFACES_4A.includes(s) !== SURFACES_4B.includes(s)]).toEqual([r.id, true]);
    for (const s of [...SURFACES_4A, ...SURFACES_4B]) expect([s, GOV4_REFUSALS.some((r) => r.surfaces.includes(s))]).toEqual([s, true]);
  });
  it('every English refusal and "does not do" item says no (the negative-word rule)', () => {
    const NEG = /\b(no|not|never|nobody|nothing|cannot|only)\b|n't\b/i;
    for (const r of GOV4_REFUSALS) expect([r.id, NEG.test(en[r.key])]).toEqual([r.id, true]);
    for (const n of GOV4_NOT_DONE) expect([n.id, NEG.test(en[n.key])]).toEqual([n.id, true]);
  });
});

describe('PC-56 GOV-4a · the chains\' query states (pure); Back is /verification', () => {
  it('do=file / draft / act open their chains on /verification; anything else → the page', () => {
    expect([chain4For({ do: 'file' }), chain4For({ do: 'draft' }), chain4For({ do: 'act' }), chain4For({ do: 'assign' }), chain4For({}), chain4For(undefined)])
      .toEqual(['visit_file', 'visit_draft', 'visit_act', null, null, null]);
    expect(chain4For({ do: ['act'] })).toBe('visit_act');
    expect(chain4For({ do: 'signins-file' })).toBeNull(); expect(chain4For({ do: 'signins-reread' }, 'verification')).toBeNull();
  });
  it('GOV-4b: on /access, do=signins-file / signins-reread open their chains; GOV-1a\'s own do= values and 4a\'s are left alone', () => {
    expect([chain4For({ do: 'signins-file' }, 'access'), chain4For({ do: 'signins-reread' }, 'access'), chain4For({ do: 'reread' }, 'access'),
      chain4For({ do: 'request' }, 'access'), chain4For({ do: 'file' }, 'access'), chain4For({}, 'access')]).toEqual(['signins_file', 'signins_reread', null, null, null, null]);
    expect(chain4State('signins_file', { act: 'queued' })).toBe('queued'); expect(chain4State('signins_file', { act: 'confirm' })).toBeNull();
    expect(chain4State('signins_reread', { act: 'confirm' })).toBe('confirm'); expect(chain4State('signins_reread', { act: 'ready' })).toBeNull();
    expect(ACCESS_BACK).toBe('/access');
  });
  it('states: file queued / ready; draft form-error / review / success / failure; act confirm / success / failure', () => {
    expect(chain4State('visit_file', { act: 'ready' })).toBe('ready'); expect(chain4State('visit_file', { act: 'confirm' })).toBeNull();
    expect(chain4State('visit_draft', { act: 'form-error' })).toBe('form-error'); expect(chain4State('visit_draft', { act: 'queued' })).toBeNull();
    expect(chain4State('visit_act', { act: 'failure' })).toBe('failure'); expect(chain4State('visit_act', {})).toBeNull();
    expect(VERIFICATION_BACK).toBe('/verification');
  });
});
