// apps/web-ops/src/test/ops3-refusals.spec.ts · PC-56 OPS-3 — the registry (features/ops3/refusals.ts): all 23 canon files, each ONE verdict and a
// note, each on disk; OPS-3c decides its 6 (W368 BUILT (read), W3338–W3339 DECOR, W3340–W3342 PARITY-DECOR); 9 pending_3a and 8 pending_3b, per
// the split in 05_OPS.md; the five canon chain groups hold 15 files, each exactly once; every refusal key ×3 and every English refusal a sentence
// that says no; the DELTAs (the FM drill-in on the linkless grid, the chain ids that do not exist, the earlier-cards premise) recorded.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { OPS3_CANON_FILES, OPS3_CHAINS, OPS3_CHAIN_GROUPS, OPS3_DELTAS, OPS3_REFUSALS, SURFACES_3A, SURFACES_3B, SURFACES_3C, ops3RefusalKeys } from '../features/ops3/refusals';

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
  // NAMED UPDATE (PC-56 OPS-3a): 3a decides its 9 — `pending_3a` is deleted from the type (the 4c-7 rule); OPS-3 is 15 decided / 8 pending_3b.
  // NAMED UPDATE (PC-56 OPS-3b): 3b decides its 8 (W366 read; W3282–W3285 REAL; W3286–W3288 PARITY-DECOR) — `pending_3b` is deleted from the
  // type too, so OPS-3 is 23 decided / 0 pending. Every earlier pin (3c's 6, 3a's 9) is kept unchanged.
  it('3c decides its 6, 3a its 9, 3b its 8 (W366 read, W3282–W3285 REAL, W3286–W3288 PARITY-DECOR); 23 decided, 0 pending', () => {
    expect(OPS3_CANON_FILES.filter((f) => f.wave === '3c').map((f) => [id(f.file), f.verdict])).toEqual([
      ['W368', 'BUILT (read)'], ['W3338', 'DECOR'], ['W3339', 'DECOR'], ['W3340', 'PARITY-DECOR'], ['W3341', 'PARITY-DECOR'], ['W3342', 'PARITY-DECOR']]);
    expect(OPS3_CANON_FILES.filter((f) => f.wave === '3a').map((f) => [id(f.file), f.verdict])).toEqual([
      ['W360', 'BUILT (read)'], ['W361', 'REAL'], ['W362', 'REAL'], ['W363', 'BUILT (read)'], ['W364', 'BUILT (honest)'], ['W365', 'BUILT (read)'],
      ['W3335', 'REAL'], ['W3336', 'REAL'], ['W3337', 'REAL']]);
    expect(OPS3_CANON_FILES.filter((f) => f.wave === '3b').map((f) => [id(f.file), f.verdict])).toEqual([
      ['W366', 'BUILT (read)'], ['W3282', 'REAL'], ['W3283', 'REAL'], ['W3284', 'REAL'], ['W3285', 'REAL'],
      ['W3286', 'PARITY-DECOR'], ['W3287', 'PARITY-DECOR'], ['W3288', 'PARITY-DECOR']]);
    expect(OPS3_CANON_FILES.filter((f) => !String(f.verdict).startsWith('pending_')).length).toBe(23);
    expect(OPS3_CANON_FILES.filter((f) => String(f.verdict).startsWith('pending_')).length).toBe(0);
    const src = fs.readFileSync(path.join(__dirname, '..', 'features', 'ops3', 'refusals.ts'), 'utf8');
    expect(/export type Ops3Verdict = [^;]*'pending_3a'/.test(src)).toBe(false);
    expect(/export type Ops3Verdict = [^;]*'pending_3b'/.test(src)).toBe(false);   // NAMED UPDATE (OPS-3b): the last pending value is deleted
    expect(/export type Ops3Verdict = [^;]*pending/.test(src)).toBe(false);
    expect(OPS3_CANON_FILES.find((f) => f.file.startsWith('W366-'))!.note).toMatch(/stated by a person at.*\(no %\).*REAL, labelled manual, no photo.*"Request tanker dispatch" refused by name.*one input/);
    expect(OPS3_CANON_FILES.find((f) => f.file.startsWith('W3285-'))!.note).toContain('DAIRY_CENTRE_NOT_IN_CUSTODY');
    expect(OPS3_CANON_FILES.find((f) => f.file.startsWith('W362-'))!.note).toMatch(/not read from a scale or an analyser.*Record this pour.*no accept, no per-kg rate, no retest/);
    expect(OPS3_CANON_FILES.find((f) => f.file.startsWith('W363-'))!.note).toContain('She can check this pour in her milk diary and object to her bill in its window.');
    expect(OPS3_CANON_FILES.find((f) => f.file.startsWith('W368-'))!.note).toContain('Rates are changed on your organisation\'s dairy console, not here.');
    expect(OPS3_CANON_FILES.find((f) => f.file.startsWith('W368-'))!.note).toMatch(/activeOnly=true.*per kg of fat \/ SNF \/ milk.*error.*no change button, no ready-reckoner, no poster, zero inputs/);
  });
  it('the five canon chain groups hold 15 files, each exactly once, each owned by its donor\'s wave; the two 3c chains are built', () => {
    const all = OPS3_CHAIN_GROUPS.flatMap((g) => g.files);
    expect(all.length).toBe(15); expect(new Set(all).size).toBe(15);
    for (const g of OPS3_CHAIN_GROUPS) for (const f of g.files) expect([f, OPS3_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.wave]).toEqual([f, g.wave]);
    // NAMED UPDATE (PC-56 OPS-3a): the pos chain is built — REAL, a query state of the check step /pos/quality.
    // NAMED UPDATE (PC-56 OPS-3b): the two bmc chains are built — the manual reading REAL (`?form=`), the mutate chain PARITY-DECOR (`?act=`), on /bmc.
    expect(OPS3_CHAINS.flatMap((c) => c.files)).toEqual(['W3338', 'W3339', 'W3340', 'W3341', 'W3342', 'W3335', 'W3336', 'W3337', 'W3282', 'W3283', 'W3284', 'W3285', 'W3286', 'W3287', 'W3288']);
    expect(OPS3_CHAINS.map((c) => [c.id, c.kind, c.param, c.page])).toEqual([['rate_export', 'DECOR', 'export', '/rates'], ['rate_act', 'PARITY-DECOR', 'act', '/rates'], ['pos_act', 'REAL', 'act', '/pos/quality'],
      ['bmc_form', 'REAL', 'form', '/bmc'], ['bmc_act', 'PARITY-DECOR', 'act', '/bmc']]);
    for (const c of OPS3_CHAINS) for (const f of c.files) expect([f, OPS3_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.verdict]).toEqual([f, c.kind]);
  });
  it('the DELTAs: the FM drill-in on the linkless grid, the chain ids that do not exist, no "prices today" marker, the earlier-cards premise', () => {
    for (const d of ['route_rates', 'fm_drill_in_reckoner', 'fm_chain_ids_3', 'no_prices_today_marker', 'earlier_cards_premise', 'rate_act_reread', 'rate_export_back',
      'slabs_paid_read', 'rule_in_words', 'currency_inr',
      // NAMED UPDATE (PC-56 OPS-3a): the counter's DELTAs
      'route_pos', 'pos_orphans', 'pos_chain_back', 'pos_confirm_is_check_step', 'pos_success_on_slip', 'slip_source', 'pos_retry', 'pos_fm_unregistered',
      'pos_centre_from_custody', 'pos_day_split', 'dairy_record_moved',
      // NAMED UPDATE (PC-56 OPS-3b): the tank's DELTAs
      'route_bmc', 'bmc_scope_custody', 'bmc_breaches_are_excursions', 'bmc_source_unknown', 'bmc_never_alarm', 'bmc_form_review_echo', 'bmc_form_back', 'bmc_act_reread',
      'shift_cooler_link']) expect([d, OPS3_DELTAS.some((x) => x.id === d)]).toEqual([d, true]);
    expect(OPS3_DELTAS.find((d) => d.id === 'bmc_never_alarm')!.built).toMatch(/PREMISE PARTLY FALSE.*never opens a breach.*alert rule counts/);
    expect(OPS3_DELTAS.find((d) => d.id === 'bmc_source_unknown')!.built).toMatch(/PREMISE PARTLY FALSE.*carries no source/);
    expect(OPS3_DELTAS.find((d) => d.id === 'slip_source')!.built).toMatch(/PREMISE PARTLY FALSE.*cannot list a member's pours.*SERVER's answer/);
    expect(OPS3_DELTAS.find((d) => d.id === 'fm_chain_ids_3')!.canon).toMatch(/W1770.*W1787/);
    // NAMED UPDATE (OPS-3c, same wave — lead decision 2026-11-09): the premise is now recorded as false at first build AND fixed in the API.
    expect(OPS3_DELTAS.find((d) => d.id === 'earlier_cards_premise')!.built).toMatch(/PREMISE WAS FALSE.*z\.coerce\.boolean.*FIXED IN THIS WAVE.*queryBoolean.*dairy\.manage.*no tenant "today"/);
  });
  // NAMED UPDATE (PC-56 OPS-3a): 20 → 72 refusals (52 for the counter); a refusal's surfaces are all 3c's or all 3a's.
  // NAMED UPDATE (PC-56 OPS-3b): 72 → 96 (24 for the tank); a refusal's surfaces are all 3c's, all 3a's or all 3b's.
  it('every refusal: unique id, a canon citation, a built surface, a key present and non-empty ×3, and the English says no', () => {
    expect(new Set(OPS3_REFUSALS.map((r) => r.id)).size).toBe(OPS3_REFUSALS.length);
    expect(OPS3_REFUSALS.length).toBe(96);
    for (const r of OPS3_REFUSALS) {
      expect([r.id, r.canon.length > 0, r.why.length > 0, r.surfaces.length > 0, r.surfaces.every((s) => SURFACES_3C.includes(s)) || r.surfaces.every((s) => SURFACES_3A.includes(s)) || r.surfaces.every((s) => SURFACES_3B.includes(s))]).toEqual([r.id, true, true, true, true]);
      for (const cat of [en, hi, gu]) expect([r.id, typeof cat[r.key] === 'string' && cat[r.key].length > 0]).toEqual([r.id, true]);
      expect([r.id, NEG.test(en[r.key])]).toEqual([r.id, true]);
    }
    for (const s of [...SURFACES_3C, ...SURFACES_3A, ...SURFACES_3B]) expect([s, ops3RefusalKeys(s).length > 0]).toEqual([s, true]);
    // the brief's 3b refused-by-name list (§E): dispatch, manifest, seals, weighbridge, reconciliation, agitator, CIP, the composite that "travels
    // with the manifest", "operator vs manager" / "centre manager", the photo; and the chains' zero-sum / audit-trail / on-call / maker-checker
    for (const rid of ['bmc_dispatch', 'bmc_manifest', 'bmc_seals', 'bmc_weighbridge', 'bmc_reconcile', 'bmc_agitator', 'bmc_cip', 'bmc_composite', 'bmc_operator_manager',
      'bmc_photo', 'bmc_fill_pct', 'bmc_form_maker_checker', 'bmc_form_zero_sum', 'bmc_form_audit_trail', 'bmc_form_on_call', 'bmc_act_zero_sum', 'bmc_act_on_call'])
      expect([rid, OPS3_REFUSALS.some((r) => r.id === rid)]).toEqual([rid, true]);
    expect(ops3RefusalKeys('bmc_act')).toEqual(expect.arrayContaining(['ops3.refusal.bmcDispatch', 'ops3.refusal.bmcActZeroSum']));
    expect(ops3RefusalKeys('bmc_form')).toEqual(expect.arrayContaining(['ops3.refusal.bmcPhoto', 'ops3.refusal.bmcFormZeroSum']));
    // the brief's 3a refused-by-name list (§E2): accept/joint, machine reading, slip number / QR / print / SMS, reprint, correction, witness / PIN,
    // second pour, close shift, variance, cash, name / photo / phone, zero-sum
    for (const rid of ['pos_joint_acceptance', 'pos_machine_read', 'pos_slip_number', 'pos_qr', 'pos_printed_slip', 'pos_sms_mirror', 'pos_reprint', 'pos_correction_record',
      'pos_manual_witness', 'pos_duplicate_override', 'pos_close_shift', 'pos_variance', 'pos_cash', 'pos_member_name', 'pos_find_by_name', 'pos_zero_sum', 'pos_per_kg_rate', 'pos_retest'])
      expect([rid, OPS3_REFUSALS.some((r) => r.id === rid)]).toEqual([rid, true]);
    expect(ops3RefusalKeys('pos_act')).toContain('ops3.refusal.posZeroSum');
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
    // NAMED UPDATE (PC-56 OPS-3a): 92 → 280 (+188 `ops3.` keys for the counter; the four nav labels are counted in claims-guard)
    // NAMED UPDATE (PC-56 OPS-3b): 280 → 398 (+119 for the tank, and W365's false "no cooler page" key replaced by its link, −1)
    expect(k(en).length).toBe(398); expect(k(hi)).toEqual(k(en)); expect(k(gu)).toEqual(k(en));
  });
});
