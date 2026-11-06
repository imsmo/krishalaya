// apps/web-ops/src/test/ops1-refusals.spec.ts · PC-56 OPS-1 — the registry (features/ops1/refusals.ts): all 31 canon files, each ONE verdict
// and a note, each on disk; OPS-1a's 8 decided (W367 BUILT (read), W377 BUILT (honest), six chain files DECOR), 10 pending_1b, 13 pending_1c;
// W377 filed under the warehouse module; every refusal key ×3 and every English refusal a sentence that says no.
// NAMED UPDATE (PC-56 OPS-1b): 1b decides its 10 — 18 decided, 13 pending_1c, NO pending_1b left (the value is deleted from the type); a third
// chain (aeps_act, REAL, W3289–W3291) joins the two DECOR chains; a refusal's surfaces are 1a's or 1b's.
// NAMED UPDATE (PC-56 OPS-1c): 1c decides its 13 — 31 decided, NO pending_* left (`pending_1c` is deleted from the type); a fourth chain
// (kiosk_act, REAL, W3329–W3331 → /kiosk/session-start) makes 12 chain files across four chains; a refusal's surfaces are 1a's, 1b's or 1c's.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { OPS1_CANON_FILES, OPS1_CHAINS, OPS1_DELTAS, OPS1_REFUSALS, SURFACES_1A, SURFACES_1B, SURFACES_1C, HONEST_1B, HONEST_1C, ops1RefusalKeys } from '../features/ops1/refusals';

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
  it('1a decides its 8 (W367 read, W377 honest, six DECOR); 31 decided, 0 pending of any wave; W377 is a warehouse screen', () => {
    expect(OPS1_CANON_FILES.filter((f) => f.wave === '1a').map((f) => [f.file.slice(0, f.file.indexOf('-')), f.verdict])).toEqual([
      ['W367', 'BUILT (read)'], ['W377', 'BUILT (honest)'], ['W3332', 'DECOR'], ['W3333', 'DECOR'], ['W3334', 'DECOR'], ['W3369', 'DECOR'], ['W3370', 'DECOR'], ['W3371', 'DECOR']]);
    // NAMED UPDATE (OPS-1c): was [18 decided, 0 pending_1b, 13 pending_1c]
    const DECIDED = ['BUILT (read)', 'BUILT (honest)', 'REAL', 'DECOR'];
    expect([OPS1_CANON_FILES.filter((f) => DECIDED.includes(f.verdict)).length, OPS1_CANON_FILES.filter((f) => /^pending/.test(f.verdict as string)).length]).toEqual([31, 0]);
    expect(OPS1_CANON_FILES.find((f) => f.file.startsWith('W377-'))!.module).toBe('warehouse');
    expect(OPS1_CANON_FILES.filter((f) => /^W33(69|7[01])-/.test(f.file)).every((f) => f.module === 'warehouse')).toBe(true);
    expect(OPS1_DELTAS.some((d) => d.id === 'w377_goods_release')).toBe(true);
    expect(fs.readFileSync(path.join(__dirname, '..', 'features/ops1/refusals.ts'), 'utf8')).not.toMatch(/\| 'pending_1c'|verdict: 'pending/);
  });
  it('1c decides its 13: W380 / W389 BUILT (read), W381 + the kiosk chain REAL, W382–W388 BUILT (honest); the deviation and the deltas recorded', () => {
    expect(OPS1_CANON_FILES.filter((f) => f.wave === '1c').map((f) => [f.file.slice(0, f.file.indexOf('-')), f.verdict])).toEqual([
      ['W380', 'BUILT (read)'], ['W381', 'REAL'], ['W382', 'BUILT (honest)'], ['W383', 'BUILT (honest)'], ['W384', 'BUILT (honest)'], ['W385', 'BUILT (honest)'],
      ['W386', 'BUILT (honest)'], ['W387', 'BUILT (honest)'], ['W388', 'BUILT (honest)'], ['W389', 'BUILT (read)'], ['W3329', 'REAL'], ['W3330', 'REAL'], ['W3331', 'REAL']]);
    expect(OPS1_CANON_FILES.filter((f) => f.wave === '1c').every((f) => f.module === 'kiosk')).toBe(true);
    expect(OPS1_CANON_FILES.find((f) => f.file.startsWith('W382-'))!.note).toMatch(/DEVIATION from survey §1D/);
    expect(OPS1_CANON_FILES.find((f) => f.file.startsWith('W388-'))!.note).toContain('Creating your account at this desk pays the helper nothing, and you pay nothing.');
    expect(OPS1_CANON_FILES.find((f) => f.file.startsWith('W389-'))!.note).toMatch(/no pay-run read/);
    for (const id of ['route_kiosk_home', 'w382_on_w381', 'kiosk_chain_back', 'fm_kiosk_chain_ids', 'orphans_1c', 'w389_no_runs', 'kiosk_no_totals']) expect([id, OPS1_DELTAS.some((d) => d.id === id)]).toEqual([id, true]);
    expect(HONEST_1C.every((s) => SURFACES_1C.includes(s))).toBe(true);
    expect(HONEST_1C).toEqual(['kiosk_profile', 'kiosk_land', 'kiosk_kyc', 'kiosk_bank', 'kiosk_listing', 'kiosk_schemes', 'kiosk_summary']);
  });
  it('1b decides its 10: W390 / W393 / W397 / W398 / W399 BUILT (honest), W392 BUILT (read), W391 + the aeps chain REAL', () => {
    expect(OPS1_CANON_FILES.filter((f) => f.wave === '1b').map((f) => [f.file.slice(0, f.file.indexOf('-')), f.verdict])).toEqual([
      ['W390', 'BUILT (honest)'], ['W391', 'REAL'], ['W392', 'BUILT (read)'], ['W393', 'BUILT (honest)'], ['W397', 'BUILT (honest)'], ['W398', 'BUILT (honest)'],
      ['W399', 'BUILT (honest)'], ['W3289', 'REAL'], ['W3290', 'REAL'], ['W3291', 'REAL']]);
    expect(OPS1_CANON_FILES.find((f) => f.file.startsWith('W398-'))!.note).toMatch(/attendance\.repository\.ts:151-167/);
    expect(OPS1_CANON_FILES.find((f) => f.file.startsWith('W367-'))!.note).toMatch(/with two people.*RESTORED.*HOTFIX-11 `8529d5d4`/);
    for (const id of ['route_aeps_record', 'route_aeps_exceptions', 'orphans_1b', 'aeps_chain_back', 'w398_honest']) expect([id, OPS1_DELTAS.some((d) => d.id === id)]).toEqual([id, true]);
    expect(HONEST_1B.every((s) => SURFACES_1B.includes(s))).toBe(true);
  });
  // NAMED UPDATE (OPS-1c): nine files across three chains → twelve across four (kiosk_act REAL → /kiosk/session-start).
  it('the twelve chain files are recorded exactly once across four chains: six DECOR (1a), three REAL (1b aeps_act), three REAL (1c kiosk_act)', () => {
    const chainFiles = OPS1_CHAINS.flatMap((c) => c.files);
    expect(chainFiles.length).toBe(12); expect(new Set(chainFiles).size).toBe(12);
    for (const c of OPS1_CHAINS) for (const id of c.files) expect([id, OPS1_CANON_FILES.find((f) => f.file.startsWith(`${id}-`))?.verdict]).toEqual([id, c.kind]);
    expect(OPS1_CHAINS.map((c) => [c.id, c.kind, c.page])).toEqual([['payout_act', 'DECOR', '/payout'], ['withdrawal_act', 'DECOR', '/warehouse/withdrawal'], ['aeps_act', 'REAL', '/aeps/withdrawal'], ['kiosk_act', 'REAL', '/kiosk/session-start']]);
  });
  it('every refusal: unique id, a canon citation, at least one 1a surface, a key present and non-empty ×3, and the English says no', () => {
    expect(new Set(OPS1_REFUSALS.map((r) => r.id)).size).toBe(OPS1_REFUSALS.length);
    for (const r of OPS1_REFUSALS) {
      expect([r.id, r.canon.length > 0, r.why.length > 0, r.surfaces.length > 0, r.surfaces.every((s) => SURFACES_1A.includes(s) || SURFACES_1B.includes(s) || SURFACES_1C.includes(s))]).toEqual([r.id, true, true, true, true]);
      for (const cat of [en, hi, gu]) expect([r.id, typeof cat[r.key] === 'string' && cat[r.key].length > 0]).toEqual([r.id, true]);
      expect([r.id, NEG.test(en[r.key])]).toEqual([r.id, true]);
    }
    for (const id of ['send_to_desk', 'request_release', 'zero_sum', 'partial_release', 'lender_noc', 'wage_lane', 'page_count', 'cross_org']) expect(OPS1_REFUSALS.some((r) => r.id === id)).toBe(true);
    expect(ops1RefusalKeys('payout_act')).toContain('ops1.refusal.zeroSum'); expect(ops1RefusalKeys('withdrawal_act')).toContain('ops1.refusal.zeroSum');
    // OPS-1b: the survey §1M W390–W393 / W397–W399 refusals, each present; every 1b surface prints at least one; W3290's zero-sum refused by name
    for (const id of ['micro_atm_auth', 'finger_travels', 'kpi_figures', 'txn_cap', 'auto_retry', 'legal_line', 'backup_device', 'balance_before', 'free_stealing',
      'farmer_column', 'backup_switched', 'retried_resolved', 'grouped_farmer', 'slip', 'sms_mirror', 'bank_ledger', 'settled_with_bank', 'reprint_by_name',
      'family_phone', 'masked_ref', 'aeps_plan_settings', 'face_template_device', 'same_wage_same_day', 'face_consent_script', 'template_travels', 'face_otp_counts',
      'wage_arithmetic', 'supervisor_biometric', 'regardless', 'lantern', 'delayed_payday', 'never_face_itself', 'biometric_trail', 'same_cap', 'both_switched_off',
      'aeps_zero_sum', 'aeps_on_call', 'aeps_audit_view']) expect([id, OPS1_REFUSALS.some((r) => r.id === id)]).toEqual([id, true]);
    for (const s of SURFACES_1B) expect([s, ops1RefusalKeys(s).length > 0]).toEqual([s, true]);
    expect(ops1RefusalKeys('aeps_act')).toContain('ops1.refusal.aepsZeroSum');
    // OPS-1c: the survey §1C–§1E W380–W389 refusals and the kiosk chain's, each present; every 1c surface prints at least one; W3330's zero-sum
    // refused by name
    for (const id of ['assisted_session', 'session_schedule', 'sync_chip', 'canon_rates', 'kiosk_flips', 'offline_queue', 'cluster_reassign', 'battery',
      'kiosk_plan_settings', 'otp_before_open', 'phone_found', 'steps_back', 'voice_note_consent', 'voice_call_code', 'out_of_cluster', 'attempt_log', 'ambassador_pin',
      'voice_capture', 'photo_consent', 'masked_candidates', 'transcription', 'bigha_factor', 'seven_twelve', 'read_back_aloud', 'revisit_list', 'aadhaar_capture',
      'kyc_consent_script', 'never_touches', 'mask_policy', 'kept_on_device', 'penny_drop', 'bank_sms_code', 'bank_mitra', 'family_account', 'bags_photo',
      'mandi_figure', 'publish_voice', 'assisted_by_tag', 'member_created', 'access_ended', 'helpline_ussd', 'pay_amount', 'sms_receipt', 'reversible_now',
      'summary_only', 'weekday_wage_lane', 'never_twice', 'pass_rate', 'published_ladder', 'never_at_risk', 'earnings_dispute', 'ambassador_only',
      'kiosk_zero_sum', 'kiosk_on_call', 'kiosk_audit_view']) expect([id, OPS1_REFUSALS.some((r) => r.id === id)]).toEqual([id, true]);
    for (const s of SURFACES_1C) expect([s, ops1RefusalKeys(s).length > 0]).toEqual([s, true]);
    expect(ops1RefusalKeys('kiosk_act')).toContain('ops1.refusal.kioskZeroSum');
  });
  it('every chain state key (title + body) and statement exists ×3', () => {
    for (const c of OPS1_CHAINS) for (const s of c.states) for (const part of ['title', 'body']) for (const cat of [en, hi, gu]) expect([c.id, s, part, !!cat[`${c.key(s)}.${part}`]]).toEqual([c.id, s, part, true]);
    for (const c of OPS1_CHAINS) for (const cat of [en, hi, gu]) expect(!!cat[c.statement]).toBe(true);
  });
});
