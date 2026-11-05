// apps/web-ops/src/test/ops1-refusals.spec.ts · PC-56 OPS-1 — the registry (features/ops1/refusals.ts): all 31 canon files, each ONE verdict
// and a note, each on disk; OPS-1a's 8 decided (W367 BUILT (read), W377 BUILT (honest), six chain files DECOR), 10 pending_1b, 13 pending_1c;
// W377 filed under the warehouse module; every refusal key ×3 and every English refusal a sentence that says no.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { OPS1_CANON_FILES, OPS1_CHAINS, OPS1_DELTAS, OPS1_REFUSALS, SURFACES_1A, ops1RefusalKeys } from '../features/ops1/refusals';

const CANON = '/Users/sanjayodedra/Documents/Personal/farmer/Phase-1 all screen design/Krishalaya_Design_System/web-screens';
const NEG = /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnone\b|\bcannot\b|\bnobody\b/i;

describe('PC-56 OPS-1 · the refusal registry', () => {
  it('31 canon files, unique, each one verdict + a non-empty note, each the ops slug shape and ON DISK', () => {
    const files = OPS1_CANON_FILES.map((f) => f.file);
    expect(files.length).toBe(31); expect(new Set(files).size).toBe(31);
    for (const f of OPS1_CANON_FILES) {
      expect([f.file, /^W\d{3,4}-ops-[a-z0-9-]+\.html$/.test(f.file), f.note.length > 0]).toEqual([f.file, true, true]);
      expect([f.file, fs.existsSync(path.join(CANON, f.file))]).toEqual([f.file, true]);
    }
    // the census of the slice, independently: the survey's own grep over the canon directory
    const onDisk = fs.readdirSync(CANON).filter((f) => /^(W367-|W377-|W38[0-9]-|W39[0-3]-|W39[7-9]-|W32(89|9[01])-|W33(29|3[0-4])-|W33(69|7[01])-)/.test(f)).sort();
    expect(onDisk).toEqual([...files].sort());
  });
  it('1a decides its 8 (W367 read, W377 honest, six DECOR); 10 pending_1b; 13 pending_1c; W377 is a warehouse screen', () => {
    expect(OPS1_CANON_FILES.filter((f) => f.wave === '1a').map((f) => [f.file.slice(0, f.file.indexOf('-')), f.verdict])).toEqual([
      ['W367', 'BUILT (read)'], ['W377', 'BUILT (honest)'], ['W3332', 'DECOR'], ['W3333', 'DECOR'], ['W3334', 'DECOR'], ['W3369', 'DECOR'], ['W3370', 'DECOR'], ['W3371', 'DECOR']]);
    expect([OPS1_CANON_FILES.filter((f) => f.verdict === 'pending_1b').length, OPS1_CANON_FILES.filter((f) => f.verdict === 'pending_1c').length]).toEqual([10, 13]);
    expect(OPS1_CANON_FILES.filter((f) => f.wave === '1b').every((f) => f.verdict === 'pending_1b')).toBe(true);
    expect(OPS1_CANON_FILES.filter((f) => f.wave === '1c').every((f) => f.verdict === 'pending_1c')).toBe(true);
    expect(OPS1_CANON_FILES.find((f) => f.file.startsWith('W377-'))!.module).toBe('warehouse');
    expect(OPS1_CANON_FILES.filter((f) => /^W33(69|7[01])-/.test(f.file)).every((f) => f.module === 'warehouse')).toBe(true);
    expect(OPS1_DELTAS.some((d) => d.id === 'w377_goods_release')).toBe(true);
  });
  it('the six chain files are recorded exactly once across the two chains, and each is a DECOR file of 1a', () => {
    const chainFiles = OPS1_CHAINS.flatMap((c) => c.files);
    expect(chainFiles.length).toBe(6); expect(new Set(chainFiles).size).toBe(6);
    for (const id of chainFiles) expect([id, OPS1_CANON_FILES.find((f) => f.file.startsWith(`${id}-`))?.verdict]).toEqual([id, 'DECOR']);
  });
  it('every refusal: unique id, a canon citation, at least one 1a surface, a key present and non-empty ×3, and the English says no', () => {
    expect(new Set(OPS1_REFUSALS.map((r) => r.id)).size).toBe(OPS1_REFUSALS.length);
    for (const r of OPS1_REFUSALS) {
      expect([r.id, r.canon.length > 0, r.why.length > 0, r.surfaces.length > 0, r.surfaces.every((s) => SURFACES_1A.includes(s))]).toEqual([r.id, true, true, true, true]);
      for (const cat of [en, hi, gu]) expect([r.id, typeof cat[r.key] === 'string' && cat[r.key].length > 0]).toEqual([r.id, true]);
      expect([r.id, NEG.test(en[r.key])]).toEqual([r.id, true]);
    }
    for (const id of ['send_to_desk', 'request_release', 'zero_sum', 'partial_release', 'lender_noc', 'wage_lane', 'page_count', 'cross_org']) expect(OPS1_REFUSALS.some((r) => r.id === id)).toBe(true);
    expect(ops1RefusalKeys('payout_act')).toContain('ops1.refusal.zeroSum'); expect(ops1RefusalKeys('withdrawal_act')).toContain('ops1.refusal.zeroSum');
  });
  it('every chain state key (title + body) and statement exists ×3', () => {
    for (const c of OPS1_CHAINS) for (const s of c.states) for (const part of ['title', 'body']) for (const cat of [en, hi, gu]) expect([c.id, s, part, !!cat[`${c.key(s)}.${part}`]]).toEqual([c.id, s, part, true]);
    for (const c of OPS1_CHAINS) for (const cat of [en, hi, gu]) expect(!!cat[c.statement]).toBe(true);
  });
});
