// apps/web-partner/src/test/partner2-refusals.spec.ts · PC-56 PARTNER-2a (survey E1) — the PARTNER-2 registry: all 50 canon files, each with ONE
// verdict (2a's 22 decided; 2b's 19 and 2c's 9 pending their waves); every refusal and chain sentence exists in en, hi AND gu with the same
// placeholders; every English refusal says no; the DELTAs are recorded; the i18n parity spec extended to every `partner2.*` key.
import * as fs from 'node:fs';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { PARTNER2_CANON_FILES, PARTNER2_CHAINS, PARTNER2_DELTAS, PARTNER2_REFUSALS, partner2RefusalKeys, INSURANCE_REDIRECTS } from '../features/partner2/refusals';

const CANON = '/Users/sanjayodedra/Documents/Personal/farmer/Phase-1 all screen design/Krishalaya_Design_System/web-screens';
const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe('PC-56 PARTNER-2a · the PARTNER-2 canon registry', () => {
  it('50 files, unique, each with a verdict — 2a = 22 decided (4 BUILT, 1 BUILT (read-only), 9 PARITY-DECOR, 8 DECOR); 2b = 19 and 2c = 9 pending', () => {
    const files = PARTNER2_CANON_FILES.map((f) => f.file);
    expect(files.length).toBe(50); expect(new Set(files).size).toBe(50);
    const count = (w: string, v: string) => PARTNER2_CANON_FILES.filter((f) => f.wave === w && f.verdict === v).length;
    expect(PARTNER2_CANON_FILES.filter((f) => f.wave === '2a').length).toBe(22);
    expect([count('2a', 'BUILT'), count('2a', 'BUILT (read-only)'), count('2a', 'PARITY-DECOR'), count('2a', 'DECOR')]).toEqual([4, 1, 9, 8]);
    expect([PARTNER2_CANON_FILES.filter((f) => f.wave === '2b').length, count('2b', 'pending_2b')]).toEqual([19, 19]);
    expect([PARTNER2_CANON_FILES.filter((f) => f.wave === '2c').length, count('2c', 'pending_2c')]).toEqual([9, 9]);
    expect(PARTNER2_CANON_FILES.filter((f) => f.wave === '2a' && f.verdict.startsWith('pending'))).toEqual([]);
    const v = (f: string) => PARTNER2_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.verdict;
    expect([v('W245'), v('W246'), v('W247'), v('W248'), v('W250')]).toEqual(['BUILT', 'BUILT', 'BUILT (read-only)', 'BUILT', 'BUILT']);
    for (const f of ['W2869', 'W2870', 'W2871', 'W2872', 'W2881', 'W2882', 'W2886', 'W2887']) expect([f, v(f)]).toEqual([f, 'DECOR']);
    for (const f of ['W2873', 'W2874', 'W2875', 'W2883', 'W2884', 'W2885', 'W2888', 'W2889', 'W2890']) expect([f, v(f)]).toEqual([f, 'PARITY-DECOR']);
    for (const f of PARTNER2_CANON_FILES) expect([f.file, /^W\d{3,4}-partner-[a-z0-9-]+\.html$/.test(f.file), f.note.length > 0]).toEqual([f.file, true, true]);
    if (fs.existsSync(CANON)) for (const f of files) expect([f, fs.existsSync(`${CANON}/${f}`)]).toEqual([f, true]);
  });
  it('every chain page is a state of its parent page and a DECOR / PARITY-DECOR file of 2a — seventeen', () => {
    const chainFiles = PARTNER2_CHAINS.flatMap((c) => c.files);
    expect(chainFiles.length).toBe(17); expect(new Set(chainFiles).size).toBe(17);
    for (const id of chainFiles) expect([id, PARTNER2_CANON_FILES.some((f) => f.file.startsWith(`${id}-`) && f.wave === '2a' && (f.verdict === 'DECOR' || f.verdict === 'PARITY-DECOR'))]).toEqual([id, true]);
  });
  it('every refusal / chain key exists in en, hi and gu with the same placeholders; every English refusal says no; every surface prints some', () => {
    const keys = [...PARTNER2_REFUSALS.map((r) => r.key), ...PARTNER2_CHAINS.flatMap((c) => c.states.flatMap((s) => [`${c.key(s)}.title`, `${c.key(s)}.body`]))];
    for (const k of keys) {
      expect([k, typeof en[k], typeof hi[k], typeof gu[k]]).toEqual([k, 'string', 'string', 'string']);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
    }
    for (const r of PARTNER2_REFUSALS) expect([r.id, /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnone\b|\bcannot\b/i.test(en[r.key])]).toEqual([r.id, true]);
    expect(new Set(PARTNER2_REFUSALS.map((r) => r.id)).size).toBe(PARTNER2_REFUSALS.length);
    for (const s of ['ins_dashboard', 'ins_products', 'ins_product', 'ins_policies', 'ins_policy', 'ins_form', 'ins_retry', 'policies_export', 'policies_retry', 'policy_export', 'policy_act'] as const) {
      expect([s, partner2RefusalKeys(s).length > 0]).toEqual([s, true]);
    }
    // founder Q7's named refusal (the brief's key)
    expect(en['partner2.refusal.productsPlatformAuthored']).toMatch(/authored by the platform|the platform authors them/);
  });
  it('the DELTAs: routes, chains, read-only edit, FM numbering and mis-classes, chain defects, the lending files, the regulator ref, the kind nav', () => {
    expect(PARTNER2_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['insurer_routes', 'chain_routes', 'product_read_only', 'fm_numbering', 'fm_misclass',
      'chain_back_defect', 'lending_in_insurance', 'regulator_ref', 'kind_nav', 'subject_type_only']));
  });
  it('the four old insurance routes map to the built insurer routes (the claims pair is not among them)', () => {
    expect(INSURANCE_REDIRECTS).toEqual({ '/insurance-products': '/insurer/products', '/insurance-policies': '/insurer/policies', '/insurance-policies/:id': '/insurer/policies/:id', '/insurance-book': '/insurer/dashboard' });
    expect(Object.keys(INSURANCE_REDIRECTS).some((r) => r.startsWith('/insurance-claims'))).toBe(false);
  });
  it('i18n parity: every partner2.* key of en is in hi AND gu, non-empty, placeholders kept; hi and gu add nothing en lacks', () => {
    const fresh = Object.keys(en).filter((k) => k.startsWith('partner2.'));
    expect(fresh.length).toBe(181);
    for (const k of fresh) {
      expect([k, typeof hi[k] === 'string' && hi[k].length > 0, typeof gu[k] === 'string' && gu[k].length > 0]).toEqual([k, true, true]);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
    }
    for (const k of [...Object.keys(hi), ...Object.keys(gu)]) expect([k, k in en]).toEqual([k, true]);
  });
});
