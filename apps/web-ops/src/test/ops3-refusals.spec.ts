// apps/web-ops/src/test/ops3-refusals.spec.ts · PC-56 OPS-3 — the registry (features/ops3/refusals.ts): all 23 canon files, each ONE verdict and a
// note, each on disk; OPS-3c decides its 6 (W368 BUILT (read), W3338–W3339 DECOR, W3340–W3342 PARITY-DECOR); 9 pending_3a and 8 pending_3b, per
// the split in 05_OPS.md; the five canon chain groups hold 15 files, each exactly once; every refusal key ×3 and every English refusal a sentence
// that says no; the DELTAs (the FM drill-in on the linkless grid, the chain ids that do not exist, the earlier-cards premise) recorded.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { OPS3_CANON_FILES, OPS3_CHAINS, OPS3_CHAIN_GROUPS, OPS3_DELTAS, OPS3_REFUSALS, SURFACES_3C, ops3RefusalKeys } from '../features/ops3/refusals';

const CANON = '/Users/sanjayodedra/Documents/Personal/farmer/Phase-1 all screen design/Krishalaya_Design_System/web-screens';
const NEG = /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnone\b|\bcannot\b|\bnobody\b/i;
const id = (f: string) => f.slice(0, f.indexOf('-'));

describe('PC-56 OPS-3 · the refusal registry', () => {
  it('23 canon files, unique, each one verdict + a non-empty note, each the ops slug shape and ON DISK; the census agrees', () => {
    const files = OPS3_CANON_FILES.map((f) => f.file);
    expect(files.length).toBe(23); expect(new Set(files).size).toBe(23);
    for (const f of OPS3_CANON_FILES) {
      expect([f.file, /^W\d{3,4}-ops-[a-z0-9-]+\.html$/.test(f.file), f.note.length > 0, f.module]).toEqual([f.file, true, true, 'dairy']);
      expect([f.file, fs.existsSync(path.join(CANON, f.file))]).toEqual([f.file, true]);
    }
    const onDisk = fs.readdirSync(CANON).filter((f) => /^W(36[0-6]|368|328[2-8]|333[5-9]|334[0-2])-/.test(f)).sort();
    expect(onDisk).toEqual([...files].sort());
  });
  it('3c decides its 6 (W368 read, W3338–W3339 DECOR, W3340–W3342 PARITY-DECOR); 9 pending_3a; 8 pending_3b', () => {
    expect(OPS3_CANON_FILES.filter((f) => f.wave === '3c').map((f) => [id(f.file), f.verdict])).toEqual([
      ['W368', 'BUILT (read)'], ['W3338', 'DECOR'], ['W3339', 'DECOR'], ['W3340', 'PARITY-DECOR'], ['W3341', 'PARITY-DECOR'], ['W3342', 'PARITY-DECOR']]);
    expect(OPS3_CANON_FILES.filter((f) => f.verdict === 'pending_3a').map((f) => id(f.file))).toEqual(['W360', 'W361', 'W362', 'W363', 'W364', 'W365', 'W3335', 'W3336', 'W3337']);
    expect(OPS3_CANON_FILES.filter((f) => f.verdict === 'pending_3b').map((f) => id(f.file))).toEqual(['W366', 'W3282', 'W3283', 'W3284', 'W3285', 'W3286', 'W3287', 'W3288']);
    for (const f of OPS3_CANON_FILES) expect([f.file, f.verdict.startsWith('pending_') ? f.verdict === `pending_${f.wave}` : f.wave === '3c']).toEqual([f.file, true]);
    expect(OPS3_CANON_FILES.find((f) => f.file.startsWith('W368-'))!.note).toContain('Rates are changed on your organisation\'s dairy console, not here.');
    expect(OPS3_CANON_FILES.find((f) => f.file.startsWith('W368-'))!.note).toMatch(/activeOnly=true.*per kg of fat \/ SNF \/ milk.*error.*no change button, no ready-reckoner, no poster, zero inputs/);
  });
  it('the five canon chain groups hold 15 files, each exactly once, each owned by its donor\'s wave; the two 3c chains are built', () => {
    const all = OPS3_CHAIN_GROUPS.flatMap((g) => g.files);
    expect(all.length).toBe(15); expect(new Set(all).size).toBe(15);
    for (const g of OPS3_CHAIN_GROUPS) for (const f of g.files) expect([f, OPS3_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.wave]).toEqual([f, g.wave]);
    expect(OPS3_CHAINS.flatMap((c) => c.files)).toEqual(['W3338', 'W3339', 'W3340', 'W3341', 'W3342']);
    expect(OPS3_CHAINS.map((c) => [c.id, c.kind, c.param, c.page])).toEqual([['rate_export', 'DECOR', 'export', '/rates'], ['rate_act', 'PARITY-DECOR', 'act', '/rates']]);
    for (const c of OPS3_CHAINS) for (const f of c.files) expect([f, OPS3_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.verdict]).toEqual([f, c.kind]);
  });
  it('the DELTAs: the FM drill-in on the linkless grid, the chain ids that do not exist, no "prices today" marker, the earlier-cards premise', () => {
    for (const d of ['route_rates', 'fm_drill_in_reckoner', 'fm_chain_ids_3', 'no_prices_today_marker', 'earlier_cards_premise', 'rate_act_reread', 'rate_export_back',
      'slabs_paid_read', 'rule_in_words', 'currency_inr']) expect([d, OPS3_DELTAS.some((x) => x.id === d)]).toEqual([d, true]);
    expect(OPS3_DELTAS.find((d) => d.id === 'fm_chain_ids_3')!.canon).toMatch(/W1770.*W1787/);
    // NAMED UPDATE (OPS-3c, same wave — lead decision 2026-11-09): the premise is now recorded as false at first build AND fixed in the API.
    expect(OPS3_DELTAS.find((d) => d.id === 'earlier_cards_premise')!.built).toMatch(/PREMISE WAS FALSE.*z\.coerce\.boolean.*FIXED IN THIS WAVE.*queryBoolean.*dairy\.manage.*no tenant "today"/);
  });
  it('every refusal: unique id, a canon citation, a 3c surface, a key present and non-empty ×3, and the English says no', () => {
    expect(new Set(OPS3_REFUSALS.map((r) => r.id)).size).toBe(OPS3_REFUSALS.length);
    expect(OPS3_REFUSALS.length).toBe(20);
    for (const r of OPS3_REFUSALS) {
      expect([r.id, r.canon.length > 0, r.why.length > 0, r.surfaces.length > 0, r.surfaces.every((s) => SURFACES_3C.includes(s))]).toEqual([r.id, true, true, true, true]);
      for (const cat of [en, hi, gu]) expect([r.id, typeof cat[r.key] === 'string' && cat[r.key].length > 0]).toEqual([r.id, true]);
      expect([r.id, NEG.test(en[r.key])]).toEqual([r.id, true]);
    }
    for (const s of SURFACES_3C) expect([s, ops3RefusalKeys(s).length > 0]).toEqual([s, true]);
    // the brief's refused-by-name list: the A2 poster, the ready-reckoner, "versioned"/"v3", "announced 7 days ahead", "board minute", SMS,
    // "cached card", "never change quietly"; W3341's zero-sum
    for (const rid of ['poster', 'ready_reckoner', 'versioned', 'announced_ahead', 'board_minute', 'sms', 'cached_card', 'never_quietly', 'worked_example', 'change_here', 'rate_zero_sum'])
      expect([rid, OPS3_REFUSALS.some((r) => r.id === rid)]).toEqual([rid, true]);
    expect(ops3RefusalKeys('rate_act')).toContain('ops3.refusal.rateZeroSum');
    expect(ops3RefusalKeys('rate_export')).toContain('ops3.refusal.poster');
  });
  it('every chain state key (title + body) and statement exists ×3', () => {
    for (const c of OPS3_CHAINS) for (const s of c.states) for (const part of ['title', 'body']) for (const cat of [en, hi, gu]) expect([c.id, s, part, !!cat[`${c.key(s)}.${part}`]]).toEqual([c.id, s, part, true]);
    for (const c of OPS3_CHAINS) for (const cat of [en, hi, gu]) expect(!!cat[c.statement]).toBe(true);
  });
  it('every ops3. key exists ×3 (counted)', () => {
    const k = (cat: Record<string, string>) => Object.keys(cat).filter((x) => x.startsWith('ops3.')).sort();
    expect(k(en).length).toBe(92); expect(k(hi)).toEqual(k(en)); expect(k(gu)).toEqual(k(en));
  });
});
