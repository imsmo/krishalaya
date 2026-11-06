// apps/web-ops/src/test/ops2-refusals.spec.ts · PC-56 OPS-2 — the registry (features/ops2/refusals.ts): all 45 canon files, each ONE verdict and a
// note, each on disk; OPS-2c decides its 9 (W378 BUILT (read), W379 BUILT (honest), seven chain files DECOR); 14 pending_2b and 22 pending_2a,
// per the split in 05_OPS.md; the six canon chain groups hold 36 files, each exactly once; every refusal key ×3 and every English refusal a
// sentence that says no; the DELTAs (the wh export Back defect, the F-9 SDK note) recorded.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { OPS2_CANON_FILES, OPS2_CHAINS, OPS2_CHAIN_GROUPS, OPS2_DELTAS, OPS2_REFUSALS, SURFACES_2C, HONEST_2C, ops2RefusalKeys } from '../features/ops2/refusals';

const CANON = '/Users/sanjayodedra/Documents/Personal/farmer/Phase-1 all screen design/Krishalaya_Design_System/web-screens';
const NEG = /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnone\b|\bcannot\b|\bnobody\b/i;
const id = (f: string) => f.slice(0, f.indexOf('-'));

describe('PC-56 OPS-2 · the refusal registry', () => {
  it('45 canon files, unique, each one verdict + a non-empty note, each the ops slug shape and ON DISK; the census agrees', () => {
    const files = OPS2_CANON_FILES.map((f) => f.file);
    expect(files.length).toBe(45); expect(new Set(files).size).toBe(45);
    for (const f of OPS2_CANON_FILES) {
      expect([f.file, /^W\d{3,4}-ops-[a-z0-9-]+\.html$/.test(f.file), f.note.length > 0, f.module]).toEqual([f.file, true, true, 'warehouse']);
      expect([f.file, fs.existsSync(path.join(CANON, f.file))]).toEqual([f.file, true]);
    }
    const onDisk = fs.readdirSync(CANON).filter((f) => /^(W37[0-6]-|W37[89]-|W329[5-9]-|W331[3-7]-|W334[3-9]-|W335\d-|W336[0-8]-)/.test(f)).sort();
    expect(onDisk).toEqual([...files].sort());
  });
  it('2c decides its 9 (W378 read, W379 honest, seven DECOR); 14 pending_2b, 22 pending_2a — 9 decided, 36 pending', () => {
    expect(OPS2_CANON_FILES.filter((f) => f.wave === '2c').map((f) => [id(f.file), f.verdict])).toEqual([
      ['W378', 'BUILT (read)'], ['W379', 'BUILT (honest)'], ['W3350', 'DECOR'], ['W3351', 'DECOR'], ['W3352', 'DECOR'], ['W3353', 'DECOR'], ['W3354', 'DECOR'], ['W3360', 'DECOR'], ['W3361', 'DECOR']]);
    const DECIDED = ['BUILT (read)', 'BUILT (honest)', 'REAL', 'DECOR', 'PARITY-DECOR'];
    expect([OPS2_CANON_FILES.filter((f) => DECIDED.includes(f.verdict)).length, OPS2_CANON_FILES.filter((f) => f.verdict === 'pending_2b').length,
      OPS2_CANON_FILES.filter((f) => f.verdict === 'pending_2a').length]).toEqual([9, 14, 22]);
    expect(OPS2_CANON_FILES.filter((f) => f.wave === '2b').map((f) => id(f.file)).sort()).toEqual(['W372', 'W373', 'W375', 'W376', 'W3295', 'W3296', 'W3297', 'W3298', 'W3299', 'W3313', 'W3314', 'W3315', 'W3316', 'W3317'].sort());
    expect(OPS2_CANON_FILES.filter((f) => f.wave === '2a').every((f) => f.verdict === 'pending_2a')).toBe(true);
    expect(OPS2_CANON_FILES.filter((f) => f.wave === '2b').every((f) => f.verdict === 'pending_2b')).toBe(true);
    expect(OPS2_CANON_FILES.find((f) => f.file.startsWith('W378-'))!.note).toContain('into the warehouse operator\'s own wallet');
    expect(OPS2_CANON_FILES.find((f) => f.file.startsWith('W378-'))!.note).toMatch(/box=mine/);
    expect(HONEST_2C).toEqual(['wh_insights']); expect(HONEST_2C.every((s) => SURFACES_2C.includes(s))).toBe(true);
  });
  it('the six canon chain groups hold 36 files, each exactly once, and each owned by the wave its donor belongs to; the 2c built chains are DECOR', () => {
    const all = OPS2_CHAIN_GROUPS.flatMap((g) => g.files);
    expect(all.length).toBe(36); expect(new Set(all).size).toBe(36);
    for (const g of OPS2_CHAIN_GROUPS) for (const f of g.files) expect([f, OPS2_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.wave]).toEqual([f, g.wave]);
    const built = OPS2_CHAINS.flatMap((c) => c.files);
    expect(built).toEqual(['W3350', 'W3351', 'W3352', 'W3353', 'W3354', 'W3360', 'W3361']);
    for (const c of OPS2_CHAINS) for (const f of c.files) expect([f, OPS2_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.verdict]).toEqual([f, c.kind]);
  });
  it('the DELTAs: the wh export Back defect (→ the trigger, never W370), the F-9 minimal SDK fix, the payee, the assay sentence', () => {
    for (const d of ['route_billing', 'route_insights', 'f9_box_mine', 'wh_export_back', 'storage_chain_back', 'fm_chain_ids_2', 'w379_assay_link', 'w378_payee_today'])
      expect([d, OPS2_DELTAS.some((x) => x.id === d)]).toEqual([d, true]);
    expect(OPS2_DELTAS.find((d) => d.id === 'wh_export_back')!.built).toMatch(/\/warehouse\/insights/);
    expect(OPS2_CHAINS.find((c) => c.id === 'wh_export')!.page).toBe('/warehouse/insights');
  });
  it('every refusal: unique id, a canon citation, a 2c surface, a key present and non-empty ×3, and the English says no', () => {
    expect(new Set(OPS2_REFUSALS.map((r) => r.id)).size).toBe(OPS2_REFUSALS.length);
    expect(OPS2_REFUSALS.length).toBe(27);
    for (const r of OPS2_REFUSALS) {
      expect([r.id, r.canon.length > 0, r.why.length > 0, r.surfaces.length > 0, r.surfaces.every((s) => SURFACES_2C.includes(s))]).toEqual([r.id, true, true, true, true]);
      for (const cat of [en, hi, gu]) expect([r.id, typeof cat[r.key] === 'string' && cat[r.key].length > 0]).toEqual([r.id, true]);
      expect([r.id, NEG.test(en[r.key])]).toEqual([r.id, true]);
    }
    for (const s of SURFACES_2C) expect([s, ops2RefusalKeys(s).length > 0]).toEqual([s, true]);
    // the brief's named refusals: W378's seven and W379's six
    for (const rid of ['month_revenue', 'versioned_tariff', 'free_promo', 'lot_arithmetic', 'disputed_line', 'billing_run', 'monthly_arrears',
      'occupancy', 'intake_month', 'assay_turnaround', 'pledge_rate', 'reassay_due', 'insights_export', 'export_month_to_date']) expect([rid, OPS2_REFUSALS.some((r) => r.id === rid)]).toEqual([rid, true]);
    expect(ops2RefusalKeys('storage_act')).toContain('ops2.refusal.storageZeroSum');
  });
  it('every chain state key (title + body) and statement exists ×3', () => {
    for (const c of OPS2_CHAINS) for (const s of c.states) for (const part of ['title', 'body']) for (const cat of [en, hi, gu]) expect([c.id, s, part, !!cat[`${c.key(s)}.${part}`]]).toEqual([c.id, s, part, true]);
    for (const c of OPS2_CHAINS) for (const cat of [en, hi, gu]) expect(!!cat[c.statement]).toBe(true);
  });
  it('every ops2. key exists ×3 (counted)', () => {
    const k = (cat: Record<string, string>) => Object.keys(cat).filter((x) => x.startsWith('ops2.')).sort();
    expect(k(en).length).toBe(74); expect(k(hi)).toEqual(k(en)); expect(k(gu)).toEqual(k(en));
  });
});
