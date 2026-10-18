// apps/web-partner/src/test/partner2-refusals.spec.ts · PC-56 PARTNER-2a (survey E1) — the PARTNER-2 registry: all 50 canon files, each with ONE
// verdict (2a's 22 decided; 2b's 19 and 2c's 9 pending their waves); every refusal and chain sentence exists in en, hi AND gu with the same
// placeholders; every English refusal says no; the DELTAs are recorded; the i18n parity spec extended to every `partner2.*` key.
import * as fs from 'node:fs';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { PARTNER2_CANON_FILES, PARTNER2_CHAINS, PARTNER2_DELTAS, PARTNER2_REFUSALS, partner2RefusalKeys, INSURANCE_REDIRECTS, LENDER_REDIRECTS } from '../features/partner2/refusals';

const CANON = '/Users/sanjayodedra/Documents/Personal/farmer/Phase-1 all screen design/Krishalaya_Design_System/web-screens';
const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe('PC-56 PARTNER-2a · the PARTNER-2 canon registry', () => {
  it('50 files, unique, each with a verdict — 2a = 22 decided (4 BUILT, 1 BUILT (read-only), 9 PARITY-DECOR, 8 DECOR); 2b = 19 decided; 2c = 9 decided — 0 pending', () => {
    const files = PARTNER2_CANON_FILES.map((f) => f.file);
    expect(files.length).toBe(50); expect(new Set(files).size).toBe(50);
    const count = (w: string, v: string) => PARTNER2_CANON_FILES.filter((f) => f.wave === w && f.verdict === v).length;
    expect(PARTNER2_CANON_FILES.filter((f) => f.wave === '2a').length).toBe(22);
    expect([count('2a', 'BUILT'), count('2a', 'BUILT (read-only)'), count('2a', 'PARITY-DECOR'), count('2a', 'DECOR')]).toEqual([4, 1, 9, 8]);
    // PC-56 PARTNER-2b: 19 decided — 1 BUILT (read), 3 BUILT (honest), 9 DECOR (W2896–W2897, W2944–W2947, W2977–W2979), 6 PARITY-DECOR
    expect(PARTNER2_CANON_FILES.filter((f) => f.wave === '2b').length).toBe(19);
    expect([count('2b', 'BUILT (read)'), count('2b', 'BUILT (honest)'), count('2b', 'DECOR'), count('2b', 'PARITY-DECOR'), count('2b', 'pending_2b')]).toEqual([1, 3, 9, 6, 0]);
    // PC-56 PARTNER-2c: 9 decided — 1 BUILT (W208), 1 BUILT (read-only) (W209), 4 DECOR (W2980–W2983), 3 PARITY-DECOR (W2984–W2986); PARTNER-2 at 50 of 50
    expect(PARTNER2_CANON_FILES.filter((f) => !f.verdict.startsWith('pending')).length).toBe(50);
    expect(PARTNER2_CANON_FILES.filter((f) => f.wave === '2c').length).toBe(9);
    expect([count('2c', 'BUILT'), count('2c', 'BUILT (read-only)'), count('2c', 'DECOR'), count('2c', 'PARITY-DECOR'), count('2c', 'pending_2c')]).toEqual([1, 1, 4, 3, 0]);
    expect(PARTNER2_CANON_FILES.filter((f) => f.verdict.startsWith('pending'))).toEqual([]);
    const v = (f: string) => PARTNER2_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.verdict;
    expect([v('W245'), v('W246'), v('W247'), v('W248'), v('W250')]).toEqual(['BUILT', 'BUILT', 'BUILT (read-only)', 'BUILT', 'BUILT']);
    for (const f of ['W2869', 'W2870', 'W2871', 'W2872', 'W2881', 'W2882', 'W2886', 'W2887']) expect([f, v(f)]).toEqual([f, 'DECOR']);
    for (const f of ['W2873', 'W2874', 'W2875', 'W2883', 'W2884', 'W2885', 'W2888', 'W2889', 'W2890']) expect([f, v(f)]).toEqual([f, 'PARITY-DECOR']);
    expect([v('W249'), v('W251'), v('W254'), v('W262')]).toEqual(['BUILT (read)', 'BUILT (honest)', 'BUILT (honest)', 'BUILT (honest)']);
    for (const f of ['W2896', 'W2897', 'W2944', 'W2945', 'W2946', 'W2947', 'W2977', 'W2978', 'W2979']) expect([f, v(f)]).toEqual([f, 'DECOR']);
    for (const f of ['W2898', 'W2899', 'W2900', 'W2948', 'W2949', 'W2950']) expect([f, v(f)]).toEqual([f, 'PARITY-DECOR']);
    expect([v('W208'), v('W209')]).toEqual(['BUILT', 'BUILT (read-only)']);
    for (const f of ['W2980', 'W2981', 'W2982', 'W2983']) expect([f, v(f)]).toEqual([f, 'DECOR']);
    for (const f of ['W2984', 'W2985', 'W2986']) expect([f, v(f)]).toEqual([f, 'PARITY-DECOR']);
    for (const f of PARTNER2_CANON_FILES) expect([f.file, /^W\d{3,4}-partner-[a-z0-9-]+\.html$/.test(f.file), f.note.length > 0]).toEqual([f.file, true, true]);
    if (fs.existsSync(CANON)) for (const f of files) expect([f, fs.existsSync(`${CANON}/${f}`)]).toEqual([f, true]);
  });
  it('every chain page is a state of its parent page and a DECOR / PARITY-DECOR file of its wave — 2a seventeen, 2b fifteen (the reports pack owns none), 2c seven', () => {
    const chainFiles = PARTNER2_CHAINS.flatMap((c) => c.files);
    expect(chainFiles.length).toBe(39); expect(new Set(chainFiles).size).toBe(39);
    expect(PARTNER2_CHAINS.filter((c) => c.wave === '2c').flatMap((c) => c.files)).toEqual(['W2980', 'W2981', 'W2982', 'W2983', 'W2984', 'W2985', 'W2986']);
    expect(PARTNER2_CHAINS.filter((c) => c.wave === '2a').flatMap((c) => c.files).length).toBe(17);
    expect(PARTNER2_CHAINS.filter((c) => c.wave === '2b').flatMap((c) => c.files).length).toBe(15);
    for (const c of PARTNER2_CHAINS) for (const id of c.files) {
      expect([id, PARTNER2_CANON_FILES.some((f) => f.file.startsWith(`${id}-`) && f.wave === c.wave && (f.verdict === 'DECOR' || f.verdict === 'PARITY-DECOR'))]).toEqual([id, true]);
    }
    // the four 2b chain shapes the brief names: ?form= on issuance and reports, ?export= on premiums, ?act= on parametric and the three mutate chains
    const p = (id: string) => PARTNER2_CHAINS.find((c) => c.id === id);
    expect(['issuance_form', 'reports_form', 'premiums_export', 'issuance_act', 'premiums_act', 'parametric_act'].map((id) => [p(id)?.page, p(id)?.param])).toEqual([
      ['/insurer/issuance', 'form'], ['/insurer/reports', 'form'], ['/insurer/premiums', 'export'], ['/insurer/issuance', 'act'], ['/insurer/premiums', 'act'], ['/insurer/parametric', 'act']]);
    expect(p('reports_form')?.files).toEqual([]);
    // every export / pack chain prints the "write to the partners mailbox" line (founder 2b-1)
    expect(PARTNER2_CHAINS.filter((c) => c.mailbox).map((c) => c.id).sort()).toEqual(['lender_form', 'policies_export', 'policy_export', 'premiums_export', 'reports_form']);
    // PC-56 PARTNER-2c: the lender's two chains — ?form= (W2980–W2983) and ?act= (W2984–W2986) — on the shelf (and on the product page, back to itself)
    expect(['lender_form', 'lender_act'].map((id) => [p(id)?.page, p(id)?.param, p(id)?.wave])).toEqual([['/lender/products', 'form', '2c'], ['/lender/products', 'act', '2c']]);
    expect(p('lender_form')?.mailboxKey).toBe('partner2.loanProducts.proposeChange');
  });
  it('every refusal / chain key exists in en, hi and gu with the same placeholders; every English refusal says no; every surface prints some', () => {
    const keys = [...PARTNER2_REFUSALS.map((r) => r.key), ...PARTNER2_CHAINS.flatMap((c) => c.states.flatMap((s) => [`${c.key(s)}.title`, `${c.key(s)}.body`]))];
    for (const k of keys) {
      expect([k, typeof en[k], typeof hi[k], typeof gu[k]]).toEqual([k, 'string', 'string', 'string']);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
    }
    for (const r of PARTNER2_REFUSALS) expect([r.id, /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnone\b|\bcannot\b/i.test(en[r.key])]).toEqual([r.id, true]);
    expect(new Set(PARTNER2_REFUSALS.map((r) => r.id)).size).toBe(PARTNER2_REFUSALS.length);
    for (const s of ['ins_dashboard', 'ins_products', 'ins_product', 'ins_policies', 'ins_policy', 'ins_form', 'ins_retry', 'policies_export', 'policies_retry', 'policy_export', 'policy_act',
      'ins_issuance', 'ins_premiums', 'ins_reports', 'ins_parametric', 'issuance_form', 'issuance_act', 'premiums_export', 'premiums_act', 'reports_form', 'parametric_act',
      'loan_products', 'loan_product', 'lender_form', 'lender_act'] as const) {
      expect([s, partner2RefusalKeys(s).length > 0]).toEqual([s, true]);
    }
    // founder Q7's named refusal (the brief's key)
    expect(en['partner2.refusal.productsPlatformAuthored']).toMatch(/authored by the platform|the platform authors them/);
    // PC-56 PARTNER-2c · founder Q7's lending sentence (the brief's words, with "not from this console" — every refusal says no)
    expect(en['partner2.refusal.loanProductsPlatformAuthored']).toBe('Loan products are authored by the platform\'s partner operations after a signed agreement, not from this console; write to the partners mailbox to propose a change.');
  });
  it('the DELTAs: routes, chains, read-only edit, FM numbering and mis-classes, chain defects, the lending files, the regulator ref, the kind nav', () => {
    expect(PARTNER2_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['insurer_routes', 'chain_routes', 'product_read_only', 'fm_numbering', 'fm_misclass',
      'chain_back_defect', 'lending_in_insurance', 'regulator_ref', 'kind_nav', 'subject_type_only']));
  });
  it('PC-56 PARTNER-2b · the 2b DELTAs (F-17, F-18, the streamed redirects, Parametric off the nav) and the 2b refusals the brief names', () => {
    expect(PARTNER2_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['honest_routes', 'issuance_read', 'report_pack_chain', 'form_retry_defect',
      'trigger_trail_misclass', 'date_cell_misclass', 'mutate_as_act', 'parametric_not_in_nav', 'streamed_redirects', 'premiums_counts']));
    const ids = PARTNER2_REFUSALS.map((r) => r.id);
    // W249 (Q5)
    expect(ids).toEqual(expect.arrayContaining(['pre_verified', 'issue_act', 'reject_rate', 'proposal_latency', 'holder_document', 'parked_rows', 'clock_pause', 'partner_roles', 'unissued_guarantee']));
    // W251 (Q1)
    expect(ids).toEqual(expect.arrayContaining(['collected_sum', 'settles_next_day', 'subsidy_owed', 'refunds_line', 'remit_batches', 'rupee_policy_no', 'premiums_file']));
    // W254 (Q2/Q3)
    expect(ids).toEqual(expect.arrayContaining(['rural_quota', 'claims_time', 'complaints', 'extracts_table', 'replay', 'schedule', 'download_mark', 'drill_ins']));
    // W262 (Q3)
    expect(ids).toEqual(expect.arrayContaining(['season_armed', 'index_feed', 'run_figures', 'set_aside', 'no_human', 'payout_promise', 'run_states', 'trigger_trail']));
    for (const r of PARTNER2_REFUSALS) expect([r.id, r.canon.length > 0, r.why.length > 0, r.key.startsWith('partner2.refusal.')]).toEqual([r.id, true, true, true]);
  });
  it('PC-56 PARTNER-2c · the 2c DELTAs (routes, chains, read-only, F-17, F-18, bps, decor, identity) and the 2c refusals the brief names', () => {
    expect(PARTNER2_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['lender_routes', 'lender_chain_routes', 'loan_product_read_only', 'fm_drill_misclass', 'lender_chain_defects',
      'apr_as_bps', 'shelf_decor', 'lender_identity']));
    expect(PARTNER2_DELTAS.find((d) => d.id === 'lending_in_insurance')?.built).toMatch(/built in PARTNER-2c/);
    const ids = PARTNER2_REFUSALS.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['loan_products_platform_authored', 'loan_kinds_count', 'terms_compared', 'eligibility_evaluated', 'listed_same_day',
      'new_applications_only', 'farmer_display', 'members_qualify', 'fee_charged', 'loan_changes_recorded', 'rate_limit']));
    // the founder's Q7 refusal is printed on both lender pages and the form chain; the member estimate (Q6's spirit) on the product page
    expect(partner2RefusalKeys('loan_products')).toEqual(expect.arrayContaining(['partner2.refusal.loanProductsPlatformAuthored', 'partner2.refusal.loanKindsCount', 'partner2.refusal.termsCompared']));
    expect(partner2RefusalKeys('loan_product')).toEqual(expect.arrayContaining(['partner2.refusal.loanProductsPlatformAuthored', 'partner2.refusal.membersQualify', 'partner2.refusal.feeCharged', 'partner2.refusal.rateLimit']));
    expect(partner2RefusalKeys('lender_form')).toContain('partner2.refusal.loanProductsPlatformAuthored');
    // no lending refusal is printed on an insurer surface, and no insurance-only refusal on a lender surface
    for (const r of PARTNER2_REFUSALS.filter((x) => ['loan_products_platform_authored', 'loan_kinds_count', 'loan_changes_recorded', 'terms_compared', 'eligibility_evaluated', 'listed_same_day', 'new_applications_only', 'farmer_display', 'members_qualify', 'fee_charged', 'rate_limit'].includes(x.id))) {
      expect([r.id, r.surfaces.every((s) => ['loan_products', 'loan_product', 'lender_form', 'lender_act'].includes(s))]).toEqual([r.id, true]);
    }
    expect(LENDER_REDIRECTS).toEqual({ '/products': '/lender/products', '/products/:id': '/lender/products/:id' });
  });
  it('the four old insurance routes map to the built insurer routes (the claims pair is not among them)', () => {
    expect(INSURANCE_REDIRECTS).toEqual({ '/insurance-products': '/insurer/products', '/insurance-policies': '/insurer/policies', '/insurance-policies/:id': '/insurer/policies/:id', '/insurance-book': '/insurer/dashboard' });
    expect(Object.keys(INSURANCE_REDIRECTS).some((r) => r.startsWith('/insurance-claims'))).toBe(false);
  });
  it('i18n parity: every partner2.* key of en is in hi AND gu, non-empty, placeholders kept; hi and gu add nothing en lacks', () => {
    const fresh = Object.keys(en).filter((k) => k.startsWith('partner2.'));
    expect(fresh.length).toBe(387);   // 2a 181 + 2b 119 + 2c 87
    for (const k of fresh) {
      expect([k, typeof hi[k] === 'string' && hi[k].length > 0, typeof gu[k] === 'string' && gu[k].length > 0]).toEqual([k, true, true]);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
    }
    for (const k of [...Object.keys(hi), ...Object.keys(gu)]) expect([k, k in en]).toEqual([k, true]);
  });
});
