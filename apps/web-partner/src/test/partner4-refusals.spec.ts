// apps/web-partner/src/test/partner4-refusals.spec.ts · PC-56 PARTNER-4a (survey E4) — the PARTNER-4 registry: all 39 canon files, each with
// ONE verdict (4a's 14 decided: W206 / W207 / W212 / W215 BUILT, W2876–W2877 and W2891–W2892 DECOR, W2878–W2880 and W2893–W2895
// PARITY-DECOR; 4b's 14 `pending_4b` and 4c's 11 `pending_4c`); every refusal and chain sentence exists in en, hi AND gu with the same
// placeholders; every English refusal says no; every surface prints at least one refusal; the DELTAs are recorded; the chains are query
// states; the i18n parity extended to every `partner4.*` key; and the dead lending console's keys are gone from every catalogue.
import * as fs from 'node:fs';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  LENDER_BOOK_REDIRECTS, LENDING_SUBNAV, PARTNER4_CANON_FILES, PARTNER4_CHAINS, PARTNER4_DELTAS, PARTNER4_REFUSALS, chain4State,
  partner4RefusalKeys, type Partner4Surface,
} from '../features/partner4/refusals';

const CANON = '/Users/sanjayodedra/Documents/Personal/farmer/Phase-1 all screen design/Krishalaya_Design_System/web-screens';
const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
/** The survey's §C list for PARTNER-4, verbatim — 39 files. */
const SURVEY_C = [
  'W206-partner-loan-queue.html', 'W207-partner-loan-application.html', 'W210-partner-disbursements.html', 'W211-partner-repayments.html',
  'W212-partner-portfolio.html', 'W215-partner-loan-detail.html', 'W216-partner-kcc-account.html', 'W217-partner-kcc-drawls.html',
  'W218-partner-disbursement-batch.html',
  'W2860-partner-disbursement-mutate-confirm.html', 'W2861-partner-disbursement-mutate-success.html', 'W2862-partner-disbursement-mutate-failure.html',
  'W2863-partner-disbursements-mutate-confirm.html', 'W2864-partner-disbursements-mutate-success.html', 'W2865-partner-disbursements-mutate-failure.html',
  'W2876-partner-loan-export-queued.html', 'W2877-partner-loan-export-ready.html',
  'W2878-partner-loan-mutate-confirm.html', 'W2879-partner-loan-mutate-success.html', 'W2880-partner-loan-mutate-failure.html',
  'W2891-partner-portfolio-export-queued.html', 'W2892-partner-portfolio-export-ready.html',
  'W2893-partner-portfolio-mutate-confirm.html', 'W2894-partner-portfolio-mutate-success.html', 'W2895-partner-portfolio-mutate-failure.html',
  'W2951-partner-kcc-export-queued.html', 'W2952-partner-kcc-export-ready.html',
  'W2953-partner-kcc-form-form-error.html', 'W2954-partner-kcc-form-review.html', 'W2955-partner-kcc-form-success.html', 'W2956-partner-kcc-form-failure.html',
  'W2957-partner-kcc-mutate-confirm.html', 'W2958-partner-kcc-mutate-success.html', 'W2959-partner-kcc-mutate-failure.html',
  'W2994-partner-repayments-export-queued.html', 'W2995-partner-repayments-export-ready.html',
  'W2996-partner-repayments-mutate-confirm.html', 'W2997-partner-repayments-mutate-success.html', 'W2998-partner-repayments-mutate-failure.html',
];
const SURFACES: readonly Partner4Surface[] = ['queue', 'application', 'portfolio', 'loan',
  'queue_act', 'application_act', 'loan_act', 'loan_export', 'portfolio_export', 'portfolio_act'];
const chainKeys = (c: { states: readonly string[]; key: (s: string) => string }) => c.states.flatMap((s) => [`${c.key(s)}.title`, `${c.key(s)}.body`]);

describe('PC-56 PARTNER-4a · the PARTNER-4 canon registry', () => {
  it('39 files — the survey §C list exactly — each with ONE verdict: 4a = 14 (4 BUILT, 4 DECOR, 6 PARITY-DECOR); 4b = 14 pending; 4c = 11 pending', () => {
    const files = PARTNER4_CANON_FILES.map((f) => f.file);
    expect(files.length).toBe(39); expect(new Set(files).size).toBe(39);
    expect([...files].sort()).toEqual([...SURVEY_C].sort());
    const v = (f: string) => PARTNER4_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.verdict;
    for (const f of ['W206', 'W207', 'W212', 'W215']) expect([f, v(f)]).toEqual([f, 'BUILT']);
    for (const f of ['W2876', 'W2877', 'W2891', 'W2892']) expect([f, v(f)]).toEqual([f, 'DECOR']);
    for (const f of ['W2878', 'W2879', 'W2880', 'W2893', 'W2894', 'W2895']) expect([f, v(f)]).toEqual([f, 'PARITY-DECOR']);
    expect(PARTNER4_CANON_FILES.filter((f) => f.wave === '4a').length).toBe(14);
    expect(PARTNER4_CANON_FILES.filter((f) => f.wave === '4b').length).toBe(14);
    expect(PARTNER4_CANON_FILES.filter((f) => f.wave === '4c').length).toBe(11);
    // the other 25 are PENDING, by their own wave, and are flipped there — never here
    expect(PARTNER4_CANON_FILES.filter((f) => f.verdict === 'pending_4b').map((f) => f.wave)).toEqual(Array(14).fill('4b'));
    expect(PARTNER4_CANON_FILES.filter((f) => f.verdict === 'pending_4c').map((f) => f.wave)).toEqual(Array(11).fill('4c'));
    expect(PARTNER4_CANON_FILES.filter((f) => f.wave === '4a' && /pending/.test(f.verdict))).toEqual([]);
    for (const f of PARTNER4_CANON_FILES) expect([f.file, /^W\d{3,4}-partner-[a-z0-9-]+\.html$/.test(f.file), f.note.length > 0]).toEqual([f.file, true, true]);
    if (fs.existsSync(CANON)) for (const f of files) expect([f, fs.existsSync(`${CANON}/${f}`)]).toEqual([f, true]);
  });
  it('SIX chain entries over FOUR canon chains, all query states of their pages; this wave\'s ten chain files recorded exactly once', () => {
    expect(PARTNER4_CHAINS.map((c) => [c.id, c.wave, c.page, c.param, c.files])).toEqual([
      ['queue_act', '4a', '/lender/queue', 'act', ['W2878', 'W2879', 'W2880']],
      ['application_act', '4a', '/lender/queue/[id]', 'act', []],
      ['loan_act', '4a', '/lender/portfolio/[id]', 'act', []],
      ['loan_export', '4a', '/lender/portfolio/[id]', 'export', ['W2876', 'W2877']],
      ['portfolio_export', '4a', '/lender/portfolio', 'export', ['W2891', 'W2892']],
      ['portfolio_act', '4a', '/lender/portfolio', 'act', ['W2893', 'W2894', 'W2895']],
    ]);
    // the two EXPORT chains carry the mailbox line; the four act chains do not
    expect(PARTNER4_CHAINS.filter((c) => c.mailbox).map((c) => c.id)).toEqual(['loan_export', 'portfolio_export']);
    // the loan export chain's files sit on the LOAN page, which is its only trigger — not on the queue, where the canon's own crumb points
    expect(PARTNER4_CHAINS.find((c) => c.id === 'loan_export')?.page).toBe('/lender/portfolio/[id]');
    expect(PARTNER4_CHAINS.flatMap((c) => c.files).length).toBe(10);
    expect(new Set(PARTNER4_CHAINS.flatMap((c) => c.files)).size).toBe(10);
    for (const c of PARTNER4_CHAINS) for (const id of c.files) {
      expect([id, PARTNER4_CANON_FILES.some((f) => f.file.startsWith(`${id}-`) && (f.verdict === 'DECOR' || f.verdict === 'PARITY-DECOR'))]).toEqual([id, true]);
    }
    // a chain state is a whitelist: anything else is the page itself
    expect([chain4State('queue_act', { act: 'confirm' }), chain4State('queue_act', { act: 'take' }), chain4State('queue_act', {}), chain4State('queue_act', undefined)]).toEqual(['confirm', null, null, null]);
    expect([chain4State('portfolio_export', { export: 'ready' }), chain4State('portfolio_export', { act: 'ready' }), chain4State('portfolio_export', { export: 'confirm' })]).toEqual(['ready', null, null]);
    expect(chain4State('loan_export', { export: ['queued', 'ready'] })).toBe('queued');   // an array param takes the first
  });
  it('every refusal / chain key exists in en, hi and gu with the same placeholders; every English refusal says no; EVERY surface prints at least one', () => {
    const keys = [...PARTNER4_REFUSALS.map((r) => r.key), ...PARTNER4_CHAINS.flatMap(chainKeys), ...LENDING_SUBNAV.map((i) => i.key),
      'partner4.export.notAvailable', 'partner4.chain.back', 'partner4.refused.title',
      'partner4.application.consentNone', 'partner4.application.consentGate', 'partner4.application.disburseStatement',
      'partner4.loan.noForeclosureFee', 'partner4.loan.noMaturity', 'partner4.loan.noNextDue', 'partner4.loan.servicingConsent',
      'partner4.portfolio.windowNote', 'partner4.portfolio.countsOnly'];
    for (const k of keys) {
      expect([k, typeof en[k], typeof hi[k], typeof gu[k]]).toEqual([k, 'string', 'string', 'string']);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
    }
    for (const r of PARTNER4_REFUSALS) expect([r.id, /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnone\b|\bcannot\b/i.test(en[r.key])]).toEqual([r.id, true]);
    expect(new Set(PARTNER4_REFUSALS.map((r) => r.id)).size).toBe(PARTNER4_REFUSALS.length);
    for (const s of SURFACES) expect([s, partner4RefusalKeys(s).length > 0]).toEqual([s, true]);
    for (const r of PARTNER4_REFUSALS) {
      expect([r.id, r.canon.length > 0, r.why.length > 0, r.key.startsWith('partner4.refusal.'), r.surfaces.every((x) => SURFACES.includes(x))]).toEqual([r.id, true, true, true, true]);
    }
  });
  it('the refusals the brief names are registered (W206 ≥12, W207 ≥19, W212 ≥10, W215 ≥12, plus the shared chain sentences)', () => {
    const ids = PARTNER4_REFUSALS.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([
      // W206
      'docs_pending_state', 'sla_clock', 'take_next', 'credit_score', 'collateral_column', 'borrower_identity', 'clarification', 'routed', 'platform_roles', 'bulk_select', 'plan_settings',
      // W207
      'score_factors', 'platform_income', 'score_explained', 'document_rows', 'voice_consent', 'effective_rate', 'note_mandatory', 'reason_delivered',
      'predisclosure', 'recovery_cap', 'documents_awaited', 'terms_snapshot', 'consent_written',
      // W212
      'transferred_state', 'off_platform_book', 'par_rate', 'kind_chart', 'written_off_share', 'honest_attribution', 'board_numbers',
      // W215
      'maturity_term', 'next_due', 'repayment_plan', 'on_time', 'milk_bill_figure', 'destination', 'ledger_anchors', 'origination_fee',
      'foreclosure_fee', 'retention_promise', 'contact_tools', 'disbursal_act',
      // the chains
      'export_file', 'chain_zero_sum', 'chain_on_call', 'chain_audit',
    ]));
    expect(partner4RefusalKeys('queue').length).toBeGreaterThanOrEqual(12);
    expect(partner4RefusalKeys('application').length).toBeGreaterThanOrEqual(19);
    expect(partner4RefusalKeys('portfolio').length).toBeGreaterThanOrEqual(10);
    expect(partner4RefusalKeys('loan').length).toBeGreaterThanOrEqual(12);
    expect(partner4RefusalKeys('queue')).toEqual(expect.arrayContaining(['partner4.refusal.slaClock', 'partner4.refusal.takeNext', 'partner4.refusal.creditScore', 'partner4.refusal.docsPendingState']));
    expect(partner4RefusalKeys('application')).toEqual(expect.arrayContaining(['partner4.refusal.scoreFactors', 'partner4.refusal.platformIncome', 'partner4.refusal.documentRows', 'partner4.refusal.voiceConsent', 'partner4.refusal.effectiveRate']));
    expect(partner4RefusalKeys('portfolio')).toEqual(expect.arrayContaining(['partner4.refusal.parRate', 'partner4.refusal.kindChart', 'partner4.refusal.honestAttribution', 'partner4.refusal.offPlatformBook']));
    expect(partner4RefusalKeys('loan')).toEqual(expect.arrayContaining(['partner4.refusal.milkBillFigure', 'partner4.refusal.ledgerAnchors', 'partner4.refusal.maturityTerm', 'partner4.refusal.onTime']));
  });
  it('the DELTAs: the four routes, the chains as query states, the chain returns, W215\'s orphanhood, the FM numbering / mis-classes / omissions, the FY caveat, the nine kinds, the sub-navigation, the dead console', () => {
    expect(PARTNER4_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['four_routes', 'loan_chain_routes', 'chain_returns', 'w215_orphan',
      'fm_numbering', 'fm_misclass', 'fm_omissions', 'loan_reference', 'status_chips_seven', 'counts_window', 'kind_mix_nine', 'lending_sub_nav', 'dead_lending_console']));
    expect(new Set(PARTNER4_DELTAS.map((d) => d.id)).size).toBe(PARTNER4_DELTAS.length);
    for (const d of PARTNER4_DELTAS) expect([d.id, d.canon.length > 0, d.built.length > 0]).toEqual([d.id, true, true]);
    expect(PARTNER4_DELTAS.find((d) => d.id === 'fm_numbering')?.canon).toMatch(/W14xx/);
    expect(PARTNER4_DELTAS.find((d) => d.id === 'w215_orphan')?.canon).toMatch(/ZERO inbound references/);
    expect(PARTNER4_DELTAS.find((d) => d.id === 'counts_window')?.built).toMatch(/OPENED in the FY window/);
  });
  it('the lending sub-navigation: FOUR rows, the two 4a ones live, PARTNER-4b\'s two dark until that wave builds them', () => {
    expect(LENDING_SUBNAV.map((i) => [i.href, i.wave, i.live])).toEqual([
      ['/lender/queue', '4a', true], ['/lender/portfolio', '4a', true],
      ['/lender/disbursements', '4b', false], ['/lender/repayments', '4b', false]]);
    expect(LENDING_SUBNAV.filter((i) => i.live).length).toBe(2);
    expect(new Set(LENDING_SUBNAV.map((i) => i.key)).size).toBe(4);
  });
  it('the five 307s of the lender\'s book', () => {
    expect(LENDER_BOOK_REDIRECTS).toEqual({
      '/loan-queue': '/lender/queue', '/loan-queue/:id': '/lender/queue/:id',
      '/portfolio': '/lender/portfolio', '/portfolio/:id': '/lender/portfolio/:id',
      '/servicing': '/lender/portfolio',
    });
    expect(Object.keys(LENDER_BOOK_REDIRECTS).length).toBe(5);
  });
  it('i18n parity: every partner4.* key of en is in hi AND gu, non-empty, placeholders kept, not an English copy; and no value carries "%"', () => {
    const fresh = Object.keys(en).filter((k) => k.startsWith('partner4.'));
    expect(fresh.length).toBe(225);
    for (const k of fresh) {
      expect([k, typeof hi[k] === 'string' && hi[k].length > 0, typeof gu[k] === 'string' && gu[k].length > 0]).toEqual([k, true, true]);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
      if (en[k].length > 12) expect([k, hi[k] !== en[k] && gu[k] !== en[k]]).toEqual([k, true]);
      for (const cat of [en, hi, gu]) expect([k, cat[k].includes('%')]).toEqual([k, false]);
    }
    for (const k of [...Object.keys(hi), ...Object.keys(gu)]) expect([k, k in en]).toEqual([k, true]);
  });
  it('PC-56 PARTNER-4a · the dead lending console\'s keys are gone: no sv. / prod. / pf. / repay. / settle. / lender. / loan2. key in any catalogue, and no loan. key but the eight statuses', () => {
    for (const cat of [en, hi, gu]) {
      expect(Object.keys(cat).filter((k) => /^(sv|prod|pf|repay|settle|lender|loan2)\./.test(k))).toEqual([]);
      expect(Object.keys(cat).filter((k) => /^loan\./.test(k) && !/^loan\.st\./.test(k))).toEqual([]);
    }
    // the three shipped sentences that OFFERED the one act the platform refuses by name (survey C-19) are gone from all three
    for (const cat of [en, hi, gu]) for (const k of ['loan.disburseSubmit', 'loan.disburseHint', 'loan.ok.disburse']) expect([k, k in cat]).toEqual([k, false]);
    // the eight surviving status keys are now translated too (survey F-25: a Hindi lender read the queue in English)
    expect(Object.keys(en).filter((k) => k.startsWith('loan.st.')).length).toBe(8);
    for (const k of Object.keys(en).filter((x) => x.startsWith('loan.st.'))) {
      expect([k, typeof hi[k], typeof gu[k]]).toEqual([k, 'string', 'string']);
      expect([k, hi[k] !== en[k], gu[k] !== en[k]]).toEqual([k, true, true]);
    }
    // and the two dead not-yet surfaces with them
    for (const cat of [en, hi, gu]) for (const k of ['partner.surface.products', 'partner.surface.insurance']) expect([k, k in cat]).toEqual([k, false]);
  });
});
