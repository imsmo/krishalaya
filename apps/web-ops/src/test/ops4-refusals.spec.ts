// apps/web-ops/src/test/ops4-refusals.spec.ts · PC-56 OPS-4 — the registry (features/ops4/refusals.ts): all 30 canon files, each ONE verdict and a
// note, each on disk; OPS-4a decides its 10 (W405, W406, W407 BUILT (read); W409 BUILT (honest); W3304–W3306 and W3318–W3320 PARITY-DECOR); 11
// pending_4b and 9 pending_4c, per the split in 05_OPS.md; the six canon chain groups hold 19 files, each exactly once; every refusal key ×3 and
// every English refusal a sentence that says no; the DELTAs recorded.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { OPS4_CANON_FILES, OPS4_CHAINS, OPS4_CHAIN_GROUPS, OPS4_DELTAS, OPS4_REFUSALS, SURFACES_4A, SURFACES_4B, SURFACES_4C, chain4State, ops4RefusalKeys } from '../features/ops4/refusals';

const CANON = '/Users/sanjayodedra/Documents/Personal/farmer/Phase-1 all screen design/Krishalaya_Design_System/web-screens';
const NEG = /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnone\b|\bcannot\b|\bnobody\b/i;
const id = (f: string) => f.slice(0, f.indexOf('-'));

describe('PC-56 OPS-4 · the refusal registry', () => {
  it('30 canon files, unique, each one verdict + a non-empty note, each the ops slug shape and ON DISK; the census agrees', () => {
    const files = OPS4_CANON_FILES.map((f) => f.file);
    expect(files.length).toBe(30); expect(new Set(files).size).toBe(30);
    for (const f of OPS4_CANON_FILES) {
      expect([f.file, /^W\d{3,4}-ops-[a-z0-9-]+\.html$/.test(f.file), f.note.length > 0]).toEqual([f.file, true, true]);
      expect([f.file, fs.existsSync(path.join(CANON, f.file))]).toEqual([f.file, true]);
    }
    const onDisk = fs.readdirSync(CANON).filter((f) => /^W(39[456]|40[01]|40[4-9]|330[0-9]|331[012]|331[89]|3320|332[678])-/.test(f)).sort();
    expect(onDisk).toEqual([...files].sort());
  });
  it('4a decides its 10; 20 pending — 11 pending_4b, 9 pending_4c', () => {
    expect(OPS4_CANON_FILES.filter((f) => f.wave === '4a').map((f) => [id(f.file), f.verdict])).toEqual([
      ['W405', 'BUILT (read)'], ['W406', 'BUILT (read)'], ['W407', 'BUILT (read)'], ['W409', 'BUILT (honest)'],
      ['W3304', 'PARITY-DECOR'], ['W3305', 'PARITY-DECOR'], ['W3306', 'PARITY-DECOR'], ['W3318', 'PARITY-DECOR'], ['W3319', 'PARITY-DECOR'], ['W3320', 'PARITY-DECOR']]);
    expect(OPS4_CANON_FILES.filter((f) => !String(f.verdict).startsWith('pending_')).length).toBe(10);
    expect(OPS4_CANON_FILES.filter((f) => String(f.verdict).startsWith('pending_')).length).toBe(20);
    expect(OPS4_CANON_FILES.filter((f) => f.verdict === 'pending_4b').map((f) => id(f.file)).sort()).toEqual(
      ['W3300', 'W3301', 'W3302', 'W3303', 'W3310', 'W3311', 'W3312', 'W394', 'W395', 'W396', 'W408'].sort());
    expect(OPS4_CANON_FILES.filter((f) => f.verdict === 'pending_4c').map((f) => id(f.file)).sort()).toEqual(
      ['W3307', 'W3308', 'W3309', 'W3326', 'W3327', 'W3328', 'W400', 'W401', 'W404'].sort());
    for (const f of OPS4_CANON_FILES) expect([f.file, f.wave === '4b' ? f.verdict === 'pending_4b' : f.wave === '4c' ? f.verdict === 'pending_4c' : true]).toEqual([f.file, true]);
    expect(OPS4_CANON_FILES.find((f) => f.file.startsWith('W407-'))!.note).toContain('No app for renters to confirm hours exists on this platform yet, so a hire billed above its deposit cannot be settled.');
    expect(OPS4_CANON_FILES.find((f) => f.file.startsWith('W407-'))!.note).toMatch(/no renter name, no money button/);
    expect(OPS4_CANON_FILES.find((f) => f.file.startsWith('W406-'))!.note).toMatch(/engine hours as entered by the owner.*no calendar, no next service, no GPS/);
    expect(OPS4_CANON_FILES.find((f) => f.file.startsWith('W405-'))!.note).toMatch(/no revenue, no %, no utilisation; the Q2 words/);
  });
  it('the six canon chain groups hold 19 files, each exactly once, each owned by its donor\'s wave; the two 4a chains are built', () => {
    expect(OPS4_CHAIN_GROUPS.length).toBe(6);
    const all = OPS4_CHAIN_GROUPS.flatMap((g) => g.files);
    expect(all.length).toBe(19); expect(new Set(all).size).toBe(19);
    for (const g of OPS4_CHAIN_GROUPS) for (const f of g.files) expect([f, OPS4_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.wave]).toEqual([f, g.wave]);
    expect(OPS4_CHAINS.flatMap((c) => c.files)).toEqual(['W3304', 'W3305', 'W3306', 'W3318', 'W3319', 'W3320']);
    expect(OPS4_CHAINS.map((c) => [c.id, c.kind, c.param])).toEqual([['chc_act', 'PARITY-DECOR', 'act'], ['equipment_act', 'PARITY-DECOR', 'act']]);
    for (const c of OPS4_CHAINS) for (const f of c.files) expect([f, OPS4_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.verdict]).toEqual([f, c.kind]);
    expect([chain4State('chc_act', { act: 'confirm' }), chain4State('chc_act', { act: 'nope' }), chain4State('equipment_act', {})]).toEqual(['confirm', null, null]);
  });
  it('the DELTAs: the redirects, the money acts removed, the tag lookup gone with its route, the edges drawn, the found-on-the-way rate days', () => {
    for (const d of ['route_chc', 'equipment_redirect', 'money_acts_removed', 'tag_lookup_removed', 'owner_list_box', 'w406_edges', 'sidebar_built_only', 'fm_chain_ids_4',
      'chain_back', 'insights_retry_decor', 'statuses_seven', 'counts_latest_n', 'currency_inr', 'rate_days_text', 'times_utc'])
      expect([d, OPS4_DELTAS.some((x) => x.id === d)]).toEqual([d, true]);
    expect(OPS4_DELTAS.find((d) => d.id === 'money_acts_removed')!.built).toMatch(/settleRental, quoteRental, startRental, completeRental, confirmRental or confirmRentalUsage/);
    expect(OPS4_DELTAS.find((d) => d.id === 'fm_chain_ids_4')!.canon).toMatch(/W1838.*W1859/);
  });
  it('every refusal: unique id, a canon citation, a 4a surface, a key present and non-empty ×3, and the English says no', () => {
    expect(new Set(OPS4_REFUSALS.map((r) => r.id)).size).toBe(OPS4_REFUSALS.length);
    expect(OPS4_REFUSALS.length).toBe(36);
    for (const r of OPS4_REFUSALS) {
      expect([r.id, r.canon.length > 0, r.why.length > 0, r.surfaces.length > 0, r.surfaces.every((s) => SURFACES_4A.includes(s))]).toEqual([r.id, true, true, true, true]);
      for (const cat of [en, hi, gu]) expect([r.id, typeof cat[r.key] === 'string' && cat[r.key].length > 0]).toEqual([r.id, true]);
      expect([r.id, NEG.test(en[r.key])]).toEqual([r.id, true]);
    }
    for (const s of SURFACES_4A) expect([s, ops4RefusalKeys(s).length > 0]).toEqual([s, true]);
    for (const s of [...SURFACES_4B, ...SURFACES_4C]) expect([s, ops4RefusalKeys(s).length]).toEqual([s, 0]);   // decided by their own waves
    // the brief's refused-by-name list (§E): revenue, %, utilisation, calendar, next service, GPS, renter name, money buttons, disputed, waitlist,
    // the CHC manager, the chains' zero-sum / audit / on-call
    for (const rid of ['revenue_mtd', 'utilisation', 'calendar', 'next_service', 'gps', 'renter_name', 'money_buttons', 'disputed', 'waitlist', 'chc_manager',
      'chc_zero_sum', 'chc_on_call', 'eq_zero_sum', 'eq_on_call', 'smam', 'page_of', 'rate_times_qty']) expect([rid, OPS4_REFUSALS.some((r) => r.id === rid)]).toEqual([rid, true]);
  });
  it('every chain state key (title + body), the chain words and the statement exist ×3', () => {
    for (const c of OPS4_CHAINS) for (const s of c.states) for (const part of ['title', 'body']) for (const cat of [en, hi, gu]) expect([c.id, s, part, !!cat[`${c.key(s)}.${part}`]]).toEqual([c.id, s, part, true]);
    for (const k of ['ops4.readsOnly', 'ops4.chain.reread', 'ops4.chain.back', 'ops4.chain.readsNothing']) for (const cat of [en, hi, gu]) expect([k, !!cat[k]]).toEqual([k, true]);
  });
  it('every ops4. key exists ×3 (counted)', () => {
    const k = (cat: Record<string, string>) => Object.keys(cat).filter((x) => x.startsWith('ops4.')).sort();
    expect(k(en).length).toBe(166); expect(k(hi)).toEqual(k(en)); expect(k(gu)).toEqual(k(en));
  });
});
