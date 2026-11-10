// apps/web-ops/src/test/ops4-refusals.spec.ts · PC-56 OPS-4 — the registry (features/ops4/refusals.ts): all 30 canon files, each ONE verdict and a
// note, each on disk; OPS-4a decides its 10 (W405, W406, W407 BUILT (read); W409 BUILT (honest); W3304–W3306 and W3318–W3320 PARITY-DECOR); 11
// pending_4b and 9 pending_4c, per the split in 05_OPS.md; the six canon chain groups hold 19 files, each exactly once; every refusal key ×3 and
// every English refusal a sentence that says no; the DELTAs recorded.
// NAMED UPDATE (PC-56 OPS-4c): 4c decides its 9 (W400, W401, W404 BUILT (read); W3326–W3328 and W3307–W3309 PARITY-DECOR) — 30 decided, 0 pending; the
// `pending_*` verdicts are gone from the type; Q6-A's first sentence is recorded as NOT printed (premise false).
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
  // NAMED UPDATE (PC-56 OPS-4b): 4b decides its 11 — the 30 are now 21 decided and 9 pending_4c (the 4c-7 rule removed `pending_4b` from the type).
  // NAMED UPDATE (PC-56 OPS-4c): 4c decides its 9 — the 30 are now 30 decided and 0 pending (the `pending_*` verdicts are gone from the type: the
  // PARTNER-4c precedent). 4a's ten and 4b's eleven are pinned exactly as before; 4c's nine are pinned here.
  it('4a decides its 10, 4b its 11, 4c its 9; 30 decided, 0 pending', () => {
    expect(OPS4_CANON_FILES.filter((f) => f.wave === '4a').map((f) => [id(f.file), f.verdict])).toEqual([
      ['W405', 'BUILT (read)'], ['W406', 'BUILT (read)'], ['W407', 'BUILT (read)'], ['W409', 'BUILT (honest)'],
      ['W3304', 'PARITY-DECOR'], ['W3305', 'PARITY-DECOR'], ['W3306', 'PARITY-DECOR'], ['W3318', 'PARITY-DECOR'], ['W3319', 'PARITY-DECOR'], ['W3320', 'PARITY-DECOR']]);
    expect(OPS4_CANON_FILES.filter((f) => f.wave === '4b').map((f) => [id(f.file), f.verdict])).toEqual([
      ['W408', 'REAL'], ['W3300', 'REAL'], ['W3301', 'REAL'], ['W3302', 'REAL'], ['W3303', 'REAL'],
      ['W394', 'BUILT (honest)'], ['W395', 'BUILT (honest)'], ['W396', 'BUILT (honest)'], ['W3310', 'DECOR'], ['W3311', 'DECOR'], ['W3312', 'DECOR']]);
    expect(OPS4_CANON_FILES.filter((f) => f.wave === '4c').map((f) => [id(f.file), f.verdict])).toEqual([
      ['W400', 'BUILT (read)'], ['W401', 'BUILT (read)'], ['W404', 'BUILT (read)'],
      ['W3326', 'PARITY-DECOR'], ['W3327', 'PARITY-DECOR'], ['W3328', 'PARITY-DECOR'], ['W3307', 'PARITY-DECOR'], ['W3308', 'PARITY-DECOR'], ['W3309', 'PARITY-DECOR']]);
    expect(OPS4_CANON_FILES.filter((f) => !String(f.verdict).startsWith('pending_')).length).toBe(30);
    expect(OPS4_CANON_FILES.filter((f) => String(f.verdict).startsWith('pending_')).length).toBe(0);
    // the type carries no `pending_*` value any more (read as TEXT: a type is not a runtime value)
    const src = fs.readFileSync(path.join(__dirname, '..', 'features', 'ops4', 'refusals.ts'), 'utf8');
    expect(src.slice(src.indexOf('export type Ops4Verdict'), src.indexOf('export type Ops4Wave'))).not.toMatch(/pending_/);
    // Q6-A's first sentence: NOT printed (premise false), recorded in the DELTA and the notes
    expect(OPS4_DELTAS.find((d) => d.id === 'q6_first_sentence')!.built).toMatch(/^PREMISE FALSE — NOT PRINTED: a signed reading's time is the DEVICE's own clock/);
    expect(OPS4_CANON_FILES.find((f) => f.file.startsWith('W404-'))!.note).toMatch(/silence threshold is the server's own number \(silenceMinutes\), never written in the page/);
    expect(OPS4_CANON_FILES.find((f) => f.file.startsWith('W400-'))!.note).toMatch(/its source \("from the logger" \/ "typed by a person"\)/);
    // the founder's words / the stopped sentence, in the notes
    expect(OPS4_CANON_FILES.find((f) => f.file.startsWith('W394-'))!.note).toContain('"This desk does not look up animals by tag." ×3');
    expect(OPS4_CANON_FILES.find((f) => f.file.startsWith('W394-'))!.note).toContain('NOT printed: premise false');
    expect(OPS4_CANON_FILES.find((f) => f.file.startsWith('W395-'))!.note).toContain('"An animal is registered by its owner in her own app. This desk does not register animals."');
    expect(OPS4_CANON_FILES.find((f) => f.file.startsWith('W396-'))!.note).toContain('"Ownership transfer is not available on this platform yet. Nothing here changes who owns an animal."');
    expect(OPS4_CANON_FILES.find((f) => f.file.startsWith('W3303-'))!.note).toMatch(/Back → \/chc\/maintenance \(never W405\)/);
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
    // NAMED UPDATE (PC-56 OPS-4b): 4b's two chains join (chc_form REAL on `?form=`, eartag_act DECOR on `?act=`); 4a's two are unchanged.
    // NAMED UPDATE (PC-56 OPS-4c): 4c's two join (iot_act and device_act, PARITY-DECOR on `?act=`) — all six groups, 19 files, are now built.
    expect(OPS4_CHAINS.flatMap((c) => c.files)).toEqual(['W3304', 'W3305', 'W3306', 'W3318', 'W3319', 'W3320', 'W3300', 'W3301', 'W3302', 'W3303', 'W3310', 'W3311', 'W3312',
      'W3326', 'W3327', 'W3328', 'W3307', 'W3308', 'W3309']);
    expect(OPS4_CHAINS.map((c) => [c.id, c.kind, c.param])).toEqual([['chc_act', 'PARITY-DECOR', 'act'], ['equipment_act', 'PARITY-DECOR', 'act'], ['chc_form', 'REAL', 'form'], ['eartag_act', 'DECOR', 'act'],
      ['iot_act', 'PARITY-DECOR', 'act'], ['device_act', 'PARITY-DECOR', 'act']]);
    expect([...new Set(OPS4_CHAINS.flatMap((c) => c.files))].sort()).toEqual(OPS4_CHAIN_GROUPS.flatMap((g) => g.files).sort());
    expect([chain4State('chc_form', { form: 'review' }), chain4State('chc_form', { act: 'review' }), chain4State('eartag_act', { act: 'failure' })]).toEqual(['review', null, 'failure']);
    for (const c of OPS4_CHAINS) for (const f of c.files) expect([f, OPS4_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.verdict]).toEqual([f, c.kind]);
    expect([chain4State('chc_act', { act: 'confirm' }), chain4State('chc_act', { act: 'nope' }), chain4State('equipment_act', {})]).toEqual(['confirm', null, null]);
  });
  it('the DELTAs: the redirects, the money acts removed, the tag lookup gone with its route, the edges drawn, the found-on-the-way rate days', () => {
    for (const d of ['route_chc', 'equipment_redirect', 'money_acts_removed', 'tag_lookup_removed', 'owner_list_box', 'w406_edges', 'sidebar_built_only', 'fm_chain_ids_4',
      'chain_back', 'insights_retry_decor', 'statuses_seven', 'counts_latest_n', 'currency_inr', 'rate_days_text', 'times_utc',
      'route_4b', 'record_entry', 'chc_form_back', 'form_fields', 'maint_scope', 'maintenance_status_truth', 'animals_kiosk_chrome', 'animals_edges', 'eartag_decor', 'q4_second_sentence',
      // NAMED UPDATE (PC-56 OPS-4c): 4c's DELTAs join
      'route_4c', 'devices_redirect', 'device_truth', 'q6_first_sentence', 'soil_registry_counts', 'w401_edges', 'sidebar_sensors', 'cooler_label', 'iot_chains_back', 'times_utc_4c'])
      expect([d, OPS4_DELTAS.some((x) => x.id === d)]).toEqual([d, true]);
    expect(OPS4_DELTAS.find((d) => d.id === 'money_acts_removed')!.built).toMatch(/settleRental, quoteRental, startRental, completeRental, confirmRental or confirmRentalUsage/);
    expect(OPS4_DELTAS.find((d) => d.id === 'fm_chain_ids_4')!.canon).toMatch(/W1838.*W1859/);
  });
  it('every refusal: unique id, a canon citation, a 4a surface, a key present and non-empty ×3, and the English says no', () => {
    expect(new Set(OPS4_REFUSALS.map((r) => r.id)).size).toBe(OPS4_REFUSALS.length);
    // NAMED UPDATE (PC-56 OPS-4b): 29 refusals for 4b's surfaces join 4a's 36 (65); every refusal's surfaces are within the BUILT waves (4a ∪ 4b).
    // NAMED UPDATE (PC-56 OPS-4c): 27 refusals for 4c's surfaces join (92); every refusal's surfaces are within the built waves (4a ∪ 4b ∪ 4c).
    expect(OPS4_REFUSALS.length).toBe(92);
    for (const r of OPS4_REFUSALS) {
      expect([r.id, r.canon.length > 0, r.why.length > 0, r.surfaces.length > 0, r.surfaces.every((s) => SURFACES_4A.includes(s) || SURFACES_4B.includes(s) || SURFACES_4C.includes(s))]).toEqual([r.id, true, true, true, true]);
      for (const cat of [en, hi, gu]) expect([r.id, typeof cat[r.key] === 'string' && cat[r.key].length > 0]).toEqual([r.id, true]);
      expect([r.id, NEG.test(en[r.key])]).toEqual([r.id, true]);
    }
    // NAMED UPDATE (PC-56 OPS-4c): 4c's surfaces now carry their refusals (they had 0 while pending).
    for (const s of [...SURFACES_4A, ...SURFACES_4B, ...SURFACES_4C]) expect([s, ops4RefusalKeys(s).length > 0]).toEqual([s, true]);
    // the brief's sensor refusals (§E, survey §1F–§1H): battery, calibration, cadence, sync, the fleet sum / online, right now, soil readings, the
    // 30-minute alarm, the annotation, the drawn line, the own threshold, the cause, the field visit, paging, the centre manager, the chains' three
    for (const rid of ['iot_battery', 'iot_calibration', 'iot_cadence', 'iot_sync', 'iot_fleet_sum', 'iot_right_now', 'iot_soil_readings', 'iot_alarm_minutes', 'iot_annotation',
      'iot_line', 'iot_own_threshold', 'iot_likely_cause', 'iot_field_visit', 'iot_paged', 'iot_centre_manager', 'iot_incident_file', 'iot_zero_sum', 'iot_on_call', 'device_zero_sum', 'device_on_call'])
      expect([rid, OPS4_REFUSALS.some((r) => r.id === rid)]).toEqual([rid, true]);
    for (const s of ['iot_dashboard', 'iot_device', 'iot_health'] as const) for (const rid of ['iot_battery', 'iot_calibration', 'iot_centre_manager'])
      expect([s, rid, OPS4_REFUSALS.find((r) => r.id === rid)!.surfaces.includes(s)]).toEqual([s, rid, true]);
    for (const rid of ['days_down', 'preventive_pct', 'real_rent', 'off_calendar', 'log_completion', 'odometer_sync', 'technician_only', 'form_zero_sum', 'form_on_call',
      'kiosk_ambassador', 'tag_scanned', 'tag_photo', 'merge_desk', 'paravet', 'inaph_linked', 'inaph_handshake', 'insurance_follows', 'eartag_zero_sum']) expect([rid, OPS4_REFUSALS.some((r) => r.id === rid)]).toEqual([rid, true]);
    // the brief's refused-by-name list (§E): revenue, %, utilisation, calendar, next service, GPS, renter name, money buttons, disputed, waitlist,
    // the CHC manager, the chains' zero-sum / audit / on-call
    for (const rid of ['revenue_mtd', 'utilisation', 'calendar', 'next_service', 'gps', 'renter_name', 'money_buttons', 'disputed', 'waitlist', 'chc_manager',
      'chc_zero_sum', 'chc_on_call', 'eq_zero_sum', 'eq_on_call', 'smam', 'page_of', 'rate_times_qty']) expect([rid, OPS4_REFUSALS.some((r) => r.id === rid)]).toEqual([rid, true]);
  });
  it('every chain state key (title + body), the chain words and the statement exist ×3', () => {
    for (const c of OPS4_CHAINS) for (const s of c.states) for (const part of ['title', 'body']) for (const cat of [en, hi, gu]) expect([c.id, s, part, !!cat[`${c.key(s)}.${part}`]]).toEqual([c.id, s, part, true]);
    for (const k of ['ops4.readsOnly', 'ops4.chain.reread', 'ops4.chain.back', 'ops4.chain.readsNothing', 'ops4.upkeep.ownerOnly', 'ops4.q4.words', 'ops4.upkeep.back', 'ops4.iot.readsOnly']) for (const cat of [en, hi, gu]) expect([k, !!cat[k]]).toEqual([k, true]);
  });
  it('every ops4. key exists ×3 (counted)', () => {
    const k = (cat: Record<string, string>) => Object.keys(cat).filter((x) => x.startsWith('ops4.')).sort();
    // NAMED UPDATE (PC-56 OPS-4b): 96 keys added (166 → 262), at parity ×3.
    // NAMED UPDATE (PC-56 OPS-4c): 132 keys added (262 → 394), at parity ×3.
    expect(k(en).length).toBe(394); expect(k(hi)).toEqual(k(en)); expect(k(gu)).toEqual(k(en));
  });
});
