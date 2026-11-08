// apps/web-ops/src/test/ops2-refusals.spec.ts · PC-56 OPS-2 — the registry (features/ops2/refusals.ts): all 45 canon files, each ONE verdict and a
// note, each on disk; OPS-2c decides its 9 (W378 BUILT (read), W379 BUILT (honest), seven chain files DECOR); 14 pending_2b and 22 pending_2a,
// per the split in 05_OPS.md; the six canon chain groups hold 36 files, each exactly once; every refusal key ×3 and every English refusal a
// sentence that says no; the DELTAs (the wh export Back defect, the F-9 SDK note) recorded.
// PC-56 OPS-2b · NAMED UPDATE: 2b decides its 14 (W372 REAL, W373 / W376 BUILT (read), W375 BUILT (honest), W3297–W3299 REAL, the other seven
// chain files DECOR) → 23 decided / 22 pending_2a; `pending_2b` is gone from the type; refusals 27 → 68; the 2b surfaces join the scope.
// PC-56 OPS-2a · NAMED UPDATE: 2a decides its 22 (W370 BUILT (read), W371 / W374 BUILT (honest), W3366–W3368 PARITY-DECOR, the other sixteen chain
// files DECOR) → 45 decided / 0 pending; `pending_2a` is gone from the type; refusals 68 → 99; the 2a surfaces join the scope; the six 2a chains built.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { OPS2_CANON_FILES, OPS2_CHAINS, OPS2_CHAIN_GROUPS, OPS2_DELTAS, OPS2_REFUSALS, SURFACES_2C, SURFACES_2B, SURFACES_2A, HONEST_2C, HONEST_2B, HONEST_2A, ops2RefusalKeys } from '../features/ops2/refusals';

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
  it('2c decides its 9 (W378 read, W379 honest, seven DECOR); 2b its 14; 2a its 22 — 45 decided, 0 pending', () => {
    expect(OPS2_CANON_FILES.filter((f) => f.wave === '2c').map((f) => [id(f.file), f.verdict])).toEqual([
      ['W378', 'BUILT (read)'], ['W379', 'BUILT (honest)'], ['W3350', 'DECOR'], ['W3351', 'DECOR'], ['W3352', 'DECOR'], ['W3353', 'DECOR'], ['W3354', 'DECOR'], ['W3360', 'DECOR'], ['W3361', 'DECOR']]);
    const DECIDED = ['BUILT (read)', 'BUILT (honest)', 'REAL', 'DECOR', 'PARITY-DECOR'];
    expect([OPS2_CANON_FILES.filter((f) => DECIDED.includes(f.verdict)).length, OPS2_CANON_FILES.filter((f) => (f.verdict as string) === 'pending_2b').length,
      OPS2_CANON_FILES.filter((f) => (f.verdict as string) === 'pending_2a').length]).toEqual([45, 0, 0]);
    expect(OPS2_CANON_FILES.filter((f) => f.wave === '2a').map((f) => [id(f.file), f.verdict])).toEqual([
      ['W370', 'BUILT (read)'], ['W3362', 'DECOR'], ['W3363', 'DECOR'], ['W3364', 'DECOR'], ['W3365', 'DECOR'], ['W3366', 'PARITY-DECOR'], ['W3367', 'PARITY-DECOR'], ['W3368', 'PARITY-DECOR'],
      ['W371', 'BUILT (honest)'], ['W3355', 'DECOR'], ['W3356', 'DECOR'], ['W3357', 'DECOR'], ['W3358', 'DECOR'], ['W3359', 'DECOR'],
      ['W374', 'BUILT (honest)'], ['W3343', 'DECOR'], ['W3344', 'DECOR'], ['W3345', 'DECOR'], ['W3346', 'DECOR'], ['W3347', 'DECOR'], ['W3348', 'DECOR'], ['W3349', 'DECOR']]);
    expect(OPS2_CANON_FILES.find((f) => f.file.startsWith('W370-'))!.note).toContain('A booking is the depositor\'s own request. She cannot yet make one on this platform.');
    expect(OPS2_CANON_FILES.find((f) => f.file.startsWith('W370-'))!.note).toMatch(/box=mine.*box=warehouse&warehouseId=.*no depositor name or id/);
    expect(OPS2_CANON_FILES.find((f) => f.file.startsWith('W371-'))!.note).toContain('"This platform records no weighment." "Marking goods stored records no weight." "The quantity on a booking and on its receipt is the quantity the depositor asked to store."');
    expect(OPS2_CANON_FILES.find((f) => f.file.startsWith('W374-'))!.note).toContain('"Where goods sit in the warehouse is not recorded on this platform, and neither is pest control." "No receipt on this platform carries a location."');
    expect(HONEST_2A).toEqual(['weighbridge', 'stacking']); expect(HONEST_2A.every((s) => SURFACES_2A.includes(s))).toBe(true);
    expect(OPS2_CANON_FILES.filter((f) => f.wave === '2b').map((f) => [id(f.file), f.verdict])).toEqual([
      ['W372', 'REAL'], ['W373', 'BUILT (read)'], ['W3295', 'DECOR'], ['W3296', 'DECOR'], ['W3297', 'REAL'], ['W3298', 'REAL'], ['W3299', 'REAL'],
      ['W375', 'BUILT (honest)'], ['W376', 'BUILT (read)'], ['W3313', 'DECOR'], ['W3314', 'DECOR'], ['W3315', 'DECOR'], ['W3316', 'DECOR'], ['W3317', 'DECOR']]);
    expect(OPS2_CANON_FILES.find((f) => f.file.startsWith('W372-'))!.note).toContain('the warehouse\'s own entry — not a lab certificate, and it sets no price');
    expect(OPS2_CANON_FILES.find((f) => f.file.startsWith('W373-'))!.note).toContain('titled "Assay record", never "certificate"');
    expect(OPS2_CANON_FILES.find((f) => f.file.startsWith('W375-'))!.note).toContain('This platform does not issue an eNWR. No receipt is recorded here in a depositor\'s name.');
    expect(OPS2_CANON_FILES.find((f) => f.file.startsWith('W376-'))!.note).toMatch(/box=all.*recorded, not confirmed.*no holder, no value/);
    expect(HONEST_2B).toEqual(['enwr_issue']); expect(HONEST_2B.every((s) => SURFACES_2B.includes(s))).toBe(true);
    expect(OPS2_CANON_FILES.filter((f) => f.wave === '2b').map((f) => id(f.file)).sort()).toEqual(['W372', 'W373', 'W375', 'W376', 'W3295', 'W3296', 'W3297', 'W3298', 'W3299', 'W3313', 'W3314', 'W3315', 'W3316', 'W3317'].sort());
    expect(OPS2_CANON_FILES.find((f) => f.file.startsWith('W378-'))!.note).toContain('into the warehouse operator\'s own wallet');
    expect(OPS2_CANON_FILES.find((f) => f.file.startsWith('W378-'))!.note).toMatch(/box=mine/);
    expect(HONEST_2C).toEqual(['wh_insights']); expect(HONEST_2C.every((s) => SURFACES_2C.includes(s))).toBe(true);
  });
  it('the six canon chain groups hold 36 files, each exactly once, and each owned by the wave its donor belongs to; the 2c built chains are DECOR', () => {
    const all = OPS2_CHAIN_GROUPS.flatMap((g) => g.files);
    expect(all.length).toBe(36); expect(new Set(all).size).toBe(36);
    for (const g of OPS2_CHAIN_GROUPS) for (const f of g.files) expect([f, OPS2_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.wave]).toEqual([f, g.wave]);
    const built = OPS2_CHAINS.flatMap((c) => c.files);
    // NAMED UPDATE (OPS-2a): the six 2a chains are built — all 36 chain files now have a built state, each exactly once.
    expect(built).toEqual(['W3350', 'W3351', 'W3352', 'W3353', 'W3354', 'W3360', 'W3361', 'W3297', 'W3298', 'W3299', 'W3295', 'W3296', 'W3313', 'W3314', 'W3315', 'W3316', 'W3317',
      'W3362', 'W3363', 'W3364', 'W3365', 'W3366', 'W3367', 'W3368', 'W3355', 'W3356', 'W3357', 'W3358', 'W3359', 'W3343', 'W3344', 'W3345', 'W3346', 'W3347', 'W3348', 'W3349']);
    expect([...built].sort()).toEqual([...all].sort());
    expect(OPS2_CHAINS.filter((c) => c.kind === 'REAL').map((c) => c.id)).toEqual(['assay_act']);
    expect(OPS2_CHAINS.filter((c) => c.kind === 'PARITY-DECOR').map((c) => c.id)).toEqual(['wh_act']);
    expect(OPS2_CHAINS.filter((c) => c.wave === '2a').map((c) => [c.id, c.page, c.param])).toEqual([['wh_form', '/warehouse/dashboard', 'form'], ['wh_act', '/warehouse/dashboard', 'act'],
      ['weighbridge_export', '/warehouse/weighbridge', 'export'], ['weighbridge_act', '/warehouse/weighbridge', 'act'], ['stacking_form', '/warehouse/stacking', 'form'], ['stacking_act', '/warehouse/stacking', 'act']]);
    expect(OPS2_CHAINS.filter((c) => c.wave === '2b').map((c) => [c.id, c.page])).toEqual([['assay_act', '/warehouse/assay'], ['assay_export', '/warehouse/assay/certificate'],
      ['enwr_export', '/warehouse/enwr/registry'], ['enwr_act', '/warehouse/enwr/issue']]);
    for (const c of OPS2_CHAINS) for (const f of c.files) expect([f, OPS2_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.verdict]).toEqual([f, c.kind]);
  });
  it('the DELTAs: the wh export Back defect (→ the trigger, never W370), the F-9 minimal SDK fix, the payee, the assay sentence', () => {
    for (const d of ['route_billing', 'route_insights', 'f9_box_mine', 'wh_export_back', 'storage_chain_back', 'fm_chain_ids_2', 'w379_assay_link', 'w378_payee_today',
      'route_assay', 'route_assay_record', 'route_enwr', 'assay_export_back', 'enwr_export_back', 'w372_retry', 'enwr_cancel_not_offered', 'receipt_quantity_unit', 'issue_form_removed', 'fm_filter_cells_2b',
      'route_dashboard', 'route_weighbridge_stacking', 'c3_box_warehouse', 'commodity_name', 'dashboard_per_warehouse', 'wh_act_reread', 'wh_form_back', 'fm_chain_ids_2a', 'fm_filter_spans_2a', 'drill_in_operator'])
      expect([d, OPS2_DELTAS.some((x) => x.id === d)]).toEqual([d, true]);
    expect(OPS2_DELTAS.find((d) => d.id === 'wh_export_back')!.built).toMatch(/\/warehouse\/insights/);
    expect(OPS2_CHAINS.find((c) => c.id === 'wh_export')!.page).toBe('/warehouse/insights');
  });
  it('every refusal: unique id, a canon citation, a 2c surface, a key present and non-empty ×3, and the English says no', () => {
    expect(new Set(OPS2_REFUSALS.map((r) => r.id)).size).toBe(OPS2_REFUSALS.length);
    expect(OPS2_REFUSALS.length).toBe(99);   // NAMED UPDATE (OPS-2a): 68 + 31
    for (const r of OPS2_REFUSALS) {
      expect([r.id, r.canon.length > 0, r.why.length > 0, r.surfaces.length > 0, r.surfaces.every((s) => SURFACES_2C.includes(s) || SURFACES_2B.includes(s) || SURFACES_2A.includes(s))]).toEqual([r.id, true, true, true, true]);
      for (const cat of [en, hi, gu]) expect([r.id, typeof cat[r.key] === 'string' && cat[r.key].length > 0]).toEqual([r.id, true]);
      expect([r.id, NEG.test(en[r.key])]).toEqual([r.id, true]);
    }
    for (const s of [...SURFACES_2C, ...SURFACES_2B, ...SURFACES_2A]) expect([s, ops2RefusalKeys(s).length > 0]).toEqual([s, true]);
    // the brief's named 2a refusals: W371 slip, print, gross/tare/net, calibration (+ Legal Metrology), dual-confirm, manual reading, vehicle, supervisor
    // reprint; W374 bay, stack, bag arithmetic, pest-control log, quarantine, the bay suggestion, the audit-count hold; W370 "New booking" and the KPIs
    for (const rid of ['weighbridge_slip', 'print_slip', 'gross_tare_net', 'calibration', 'dual_confirm', 'vehicle_mismatch', 'supervisor_reprint', 'bay_stack', 'bag_arithmetic',
      'pest_log', 'quarantine', 'bay_suggestion', 'audit_hold', 'new_booking', 'net_received', 'enwr_pending', 'page_total', 'farmer_column', 'maker_checker']) expect([rid, OPS2_REFUSALS.some((r) => r.id === rid)]).toEqual([rid, true]);
    for (const s of ['wh_form', 'wh_act', 'weighbridge_act', 'stacking_form', 'stacking_act']) expect([s, ops2RefusalKeys(s as never).some((k) => /ZeroSum$/.test(k))]).toEqual([s, true]);
    // the brief's named 2b refusals: W375 "Send OTP to farmer", the issue button, valuation, "repository confirmed"; W376/drill-in pledge, transfer,
    // partial release; W373 QR/verify, PDF, accreditation, "sets the price", the certificate title
    for (const rid of ['send_otp', 'issue_act', 'receipt_value', 'repository_confirmed', 'holder_name', 'pledged_loan', 'holding_transfer', 'partly_released',
      'verify_code', 'download_pdf', 'accredited_lab', 'price_birth', 'certificate_title', 'export_register', 'receipt_acts']) expect([rid, OPS2_REFUSALS.some((r) => r.id === rid)]).toEqual([rid, true]);
    for (const s of ['assay_act', 'enwr_act']) expect(ops2RefusalKeys(s as never).some((k) => /ZeroSum$/.test(k))).toBe(true);
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
    expect(k(en).length).toBe(362); expect(k(hi)).toEqual(k(en)); expect(k(gu)).toEqual(k(en));   // NAMED UPDATE (OPS-2b): 74 + 167; (OPS-2a): + 121
  });
});
