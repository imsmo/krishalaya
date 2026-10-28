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
const SURFACES: readonly Partner4Surface[] = ['queue', 'application', 'portfolio', 'loan', 'disbursements', 'repayments', 'disbursement_batch',
  'kcc', 'kcc_drawls',
  'queue_act', 'application_act', 'loan_act', 'loan_export', 'portfolio_export', 'portfolio_act',
  'disbursements_act', 'disbursement_act', 'repayments_export', 'repayments_act',
  'kcc_export', 'kcc_form', 'kcc_act'];
/** PC-56 PARTNER-4c · the two verdict values that carried the waiting must be GONE from the source, not merely unused. */
const REGISTRY_SRC = fs.readFileSync(`${__dirname}/../features/partner4/refusals.ts`, 'utf8');

// ── PC-56 PARTNER-4c · W217'S READLESSNESS, PINNED AS SOURCE (the lead's gap) ───────────────────────────────────────────────────────────────
// The registry's own note for W217 says the page makes NO READ, and that is WHY it writes no audit row and has no error state of its own.
// Those two CONSEQUENCES are asserted elsewhere (`lender-kcc-drawls.render`, and the live spec's single audit row for W216). The CAUSE was
// not asserted anywhere: nothing failed if somebody added a read to the drawls page tomorrow. This block reads the page as SOURCE and fails
// if it can read anything — the programme's own precedent for a source assertion (0232's `pg_get_functiondef` block, the claims guard's
// per-file scan, the dead-key scans).
//
// WHY THE PAGE IS READLESS, in one sentence about the product: an entry on the drawl ledger records a farmer's DEBT and moves no money — no
// wallet posting, no key that makes a repeat safe, no second person, no switch that could stop it — so under founder 4c-1 nothing about it
// may reach a lender, and the honest way to show nothing is to ask for nothing.
const readSrc = (rel: string) => fs.readFileSync(`${__dirname}/../${rel}`, 'utf8')
  // code only: a comment may legitimately DISCUSS a read (this file's own header does), and the claim is about what the page DOES
  .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const DRAWLS_PAGE = 'app/lender/kcc/[id]/drawls/page.tsx';
const KCC_PAGE = 'app/lender/kcc/[id]/page.tsx';
/** Each pattern is a way this page could come to read something, with the reason it is banned. */
const NO_READ: readonly [string, RegExp, string][] = [
  ['partnerClient(', /partnerClient\s*\(/,
    'every audited read of the partner console goes through this one client (lib/api-client.ts); W216 calls it exactly once, and this page may not call it at all'],
  ['a partner SDK resource', /partner\.(loans|applications|loanProducts|claims|dashboard|insurance)\b/,
    'these are the resources of the lender\'s own book — the only things this axis can read — and none of them holds a drawl entry anyway'],
  ['a read verb', /\.(get|list|repayments|counts|dpd|collected|pipeline)\s*\(/,
    'the read verbs of those resources: a page that calls none of them fetched nothing'],
  ['a dynamic import', /\bimport\s*\(/,
    'a static import scan is defeated by `await import(...)`, which could reach a client at runtime'],
  ['a raw HTTP call', /\bfetch\s*\(|\.request\s*\(/,
    'the SDK is not the only way out of a server component; a bare request would bypass every wall the SDK carries'],
  ['the ledger itself', /kcc_drawl_ledger|partner_kcc/i,
    'the table this console holds no privilege on (42501 on the axis, every column) and the definer name that exists nowhere in pg_proc'],
];
/** What the page DOES call, named so this case does not over-claim: none of these reads this lender's BOOK, and none writes an audit row. */
const READLESS_ALLOWED = ['requirePartner(', 'lenderGate(', 'lenderSwitches(', 'partnersMailbox(', 'getTranslator(', 'chain4State('];
const chainKeys = (c: { states: readonly string[]; key: (s: string) => string }) => c.states.flatMap((s) => [`${c.key(s)}.title`, `${c.key(s)}.body`]);

describe('PC-56 PARTNER-4a · the PARTNER-4 canon registry', () => {
  it('39 files — the survey §C list exactly — each with ONE verdict: 4a = 14, 4b = 14, 4c = 11 (2 BUILT (honest), 9 DECOR) → PARTNER-4 CLOSES at 39 decided, 0 pending, and both pending_* values gone from the source', () => {
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
    // PC-56 PARTNER-4b decides its own 14: W210 and W211 are READS, W218 is an HONEST page, the two pay chains and the export chain are
    // DECOR, and only the repayments mutate chain is PARITY-DECOR (a Retry that re-reads). `pending_4b` is GONE from the registry.
    for (const f of ['W210', 'W211']) expect([f, v(f)]).toEqual([f, 'BUILT (read)']);
    expect(['W218', v('W218')]).toEqual(['W218', 'BUILT (honest)']);
    for (const f of ['W2860', 'W2861', 'W2862', 'W2863', 'W2864', 'W2865', 'W2994', 'W2995']) expect([f, v(f)]).toEqual([f, 'DECOR']);
    for (const f of ['W2996', 'W2997', 'W2998']) expect([f, v(f)]).toEqual([f, 'PARITY-DECOR']);
    // PC-56 PARTNER-4c · PARTNER-4 CLOSES: the last 11 are decided, the registry reads 39 decided / 0 pending, and BOTH verdict values that
    // carried the waiting are gone from the type AND from the source of this module (M4 kills here).
    expect(['W216', v('W216')]).toEqual(['W216', 'BUILT (honest)']);
    expect(['W217', v('W217')]).toEqual(['W217', 'BUILT (honest)']);
    for (const f of ['W2951', 'W2952', 'W2953', 'W2954', 'W2955', 'W2956', 'W2957', 'W2958', 'W2959']) expect([f, v(f)]).toEqual([f, 'DECOR']);
    expect(PARTNER4_CANON_FILES.filter((f) => /pending/.test(f.verdict))).toEqual([]);
    expect(PARTNER4_CANON_FILES.filter((f) => !/pending/.test(f.verdict)).length).toBe(39);
    expect(new Set(PARTNER4_CANON_FILES.map((f) => f.verdict))).toEqual(new Set(['BUILT', 'BUILT (read)', 'BUILT (honest)', 'PARITY-DECOR', 'DECOR']));
    for (const dead of ['pending_4b', 'pending_4c']) expect([dead, REGISTRY_SRC.includes(dead)]).toEqual([dead, false]);
    // the 4c verdicts by kind: two honest pages and nine DECOR chain pages
    expect(PARTNER4_CANON_FILES.filter((f) => f.wave === '4c' && f.verdict === 'DECOR').length).toBe(9);
    expect(PARTNER4_CANON_FILES.filter((f) => f.wave === '4c' && f.verdict === 'BUILT (honest)').length).toBe(2);
    // NO 4c chain page is PARITY-DECOR: W217 reads nothing, so there is nothing to re-read (founder 4c-1)
    expect(PARTNER4_CANON_FILES.filter((f) => f.wave === '4c' && f.verdict === 'PARITY-DECOR')).toEqual([]);
    for (const f of PARTNER4_CANON_FILES) expect([f.file, /^W\d{3,4}-partner-[a-z0-9-]+\.html$/.test(f.file), f.note.length > 0]).toEqual([f.file, true, true]);
    if (fs.existsSync(CANON)) for (const f of files) expect([f, fs.existsSync(`${CANON}/${f}`)]).toEqual([f, true]);
  });
  it('THIRTEEN chain entries over ELEVEN canon chains, all query states of their pages; THE THIRTY chain files of 4a (10), 4b (11) and 4c (9) recorded exactly once', () => {
    expect(PARTNER4_CHAINS.map((c) => [c.id, c.wave, c.page, c.param, c.files])).toEqual([
      ['queue_act', '4a', '/lender/queue', 'act', ['W2878', 'W2879', 'W2880']],
      ['application_act', '4a', '/lender/queue/[id]', 'act', []],
      ['loan_act', '4a', '/lender/portfolio/[id]', 'act', []],
      ['loan_export', '4a', '/lender/portfolio/[id]', 'export', ['W2876', 'W2877']],
      ['portfolio_export', '4a', '/lender/portfolio', 'export', ['W2891', 'W2892']],
      ['portfolio_act', '4a', '/lender/portfolio', 'act', ['W2893', 'W2894', 'W2895']],
      // PC-56 PARTNER-4b: the canon keeps the singular and the plural pay chains SEPARATE, and so does this registry
      ['disbursements_act', '4b', '/lender/disbursements', 'act', ['W2863', 'W2864', 'W2865']],
      ['disbursement_act', '4b', '/lender/disbursements/[id]', 'act', ['W2860', 'W2861', 'W2862']],
      ['repayments_export', '4b', '/lender/repayments', 'export', ['W2994', 'W2995']],
      ['repayments_act', '4b', '/lender/repayments', 'act', ['W2996', 'W2997', 'W2998']],
      // PC-56 PARTNER-4c: the export chain's files sit on the DRAWLS page (its only trigger), the FORM chain's four on the KCC page
      ['kcc_export', '4c', '/lender/kcc/[id]/drawls', 'export', ['W2951', 'W2952']],
      ['kcc_form', '4c', '/lender/kcc/[id]', 'form', ['W2953', 'W2954', 'W2955', 'W2956']],
      ['kcc_act', '4c', '/lender/kcc/[id]', 'act', ['W2957', 'W2958', 'W2959']],
    ]);
    // the four EXPORT chains carry the mailbox line, and so does the FORM chain — with its OWN line (the 2c `lender_form` precedent)
    expect(PARTNER4_CHAINS.filter((c) => c.mailbox).map((c) => c.id)).toEqual(['loan_export', 'portfolio_export', 'repayments_export', 'kcc_export', 'kcc_form']);
    expect(PARTNER4_CHAINS.filter((c) => c.mailboxKey).map((c) => [c.id, c.mailboxKey])).toEqual([['kcc_form', 'partner4.kcc.proposeLimitChange']]);
    // the FOUR states of the panel's first form chain, in the canon's own order
    expect(PARTNER4_CHAINS.find((c) => c.id === 'kcc_form')?.states).toEqual(['error', 'review', 'success', 'failure']);
    expect(PARTNER4_CHAINS.find((c) => c.id === 'kcc_form')?.param).toBe('form');
    // a chain of an HONEST page prints that page's founder-approved statement first (the 2b precedent)
    expect(PARTNER4_CHAINS.filter((c) => c.statement).map((c) => [c.id, c.statement])).toEqual([
      ['kcc_export', 'partner4.drawls.statement'], ['kcc_form', 'partner4.kcc.statement'], ['kcc_act', 'partner4.kcc.statement']]);
    expect(chain4State('kcc_form', { form: 'review' })).toBe('review');
    expect(chain4State('kcc_form', { form: 'confirm' })).toBeNull();     // a form chain has NO confirm state (W2956's canon defect)
    expect(chain4State('kcc_act', { act: 'confirm' })).toBe('confirm');
    expect(chain4State('kcc_export', { export: 'ready' })).toBe('ready');
    // the two pay chains print the REFUSAL, not the `act` chains' "we read it again"
    expect(PARTNER4_CHAINS.filter((c) => c.key('confirm') === 'partner4.chain.pay.confirm').map((c) => c.id)).toEqual(['disbursements_act', 'disbursement_act']);
    // the loan export chain's files sit on the LOAN page, which is its only trigger — not on the queue, where the canon's own crumb points
    expect(PARTNER4_CHAINS.find((c) => c.id === 'loan_export')?.page).toBe('/lender/portfolio/[id]');
    expect(PARTNER4_CHAINS.flatMap((c) => c.files).length).toBe(30);         // 4a's ten + 4b's eleven + 4c's nine = EVERY canon chain page
    expect(new Set(PARTNER4_CHAINS.flatMap((c) => c.files)).size).toBe(30);
    expect(PARTNER4_CHAINS.filter((c) => c.wave === '4b').flatMap((c) => c.files).length).toBe(11);
    expect(PARTNER4_CHAINS.filter((c) => c.wave === '4c').flatMap((c) => c.files).length).toBe(9);
    // the thirty chain files of the registry are the thirty chain files of the survey's §C list
    expect([...PARTNER4_CHAINS.flatMap((c) => c.files)].sort()).toEqual(SURVEY_C.filter((f) => /^W2[89]/.test(f)).map((f) => f.slice(0, f.indexOf('-'))).sort());
    // each 4b chain's files sit on the page the canon returns to — the singular chain on the BATCH page, the plural one on the pay-outs page
    expect(PARTNER4_CHAINS.find((c) => c.id === 'disbursement_act')?.page).toBe('/lender/disbursements/[id]');
    expect(chain4State('disbursements_act', { act: 'confirm' })).toBe('confirm');
    expect(chain4State('repayments_export', { export: 'queued' })).toBe('queued');
    expect(chain4State('disbursement_act', { act: 'pay' })).toBeNull();
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
      'partner4.portfolio.windowNote', 'partner4.portfolio.countsOnly',
      // PC-56 PARTNER-4c
      'partner4.kcc.title', 'partner4.kcc.lead', 'partner4.kcc.statementTitle', 'partner4.kcc.statement', 'partner4.kcc.notSetHere',
      'partner4.kcc.zeroTruth', 'partner4.kcc.factsTitle', 'partner4.kcc.factsNote', 'partner4.kcc.kindNote', 'partner4.kcc.loanLabel',
      'partner4.kcc.ledgerLink', 'partner4.kcc.limitReviewAct', 'partner4.kcc.viewLoan', 'partner4.kcc.notFound.title',
      'partner4.kcc.notFound.body', 'partner4.kcc.error.title', 'partner4.kcc.error.body', 'partner4.kcc.proposeLimitChange',
      'partner4.drawls.title', 'partner4.drawls.lead', 'partner4.drawls.statementTitle', 'partner4.drawls.statement',
      'partner4.drawls.notMoney', 'partner4.drawls.whenShown', 'partner4.drawls.ownRecordTitle', 'partner4.drawls.ownRecord',
      'partner4.drawls.integrityOwed', 'partner4.drawls.zeroTruth', 'partner4.drawls.exportAct', 'partner4.drawls.backToKcc'];
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
    // PC-56 PARTNER-4b · the brief's counts: W210 11, W211 15, W218 12 (the registry carries more, because the shared refusals of 4a name
    // these screens' canon too — every one of them is printed on the page)
    expect(ids).toEqual(expect.arrayContaining([
      // W210
      'money_destination', 'ready_batch_act', 'borrower_destination_columns', 'auto_moves_to_ready', 'loan_with_schedule', 'sanction_letter',
      'double_funding_absolute', 'bank_maker_checker', 'preflight_not_yours', 'bank_limit_delegation', 'pipeline_bulk_select',
      // W211
      'channel_vocabulary', 'due_this_week', 'auto_deduction_share', 'nudge_stage', 'mediation_first', 'collections_privacy_rule',
      'reminder_sent', 'code_of_conduct', 'contact_hours', 'contact_log', 'third_party_agents', 'partner_suspension', 'rides_dairy_cycle',
      'repayments_bulk_select',
      // W218
      'awaiting_coapproval', 'maker_checker_claim', 'second_signature', 'coapprove_act', 'batch_contents_table', 'product_rule_engine',
      'cattle_insurance_rule', 'auto_retries', 'batch_added_to',
    ]));
    expect(partner4RefusalKeys('disbursements').length).toBeGreaterThanOrEqual(11);
    expect(partner4RefusalKeys('repayments').length).toBeGreaterThanOrEqual(15);
    expect(partner4RefusalKeys('disbursement_batch').length).toBeGreaterThanOrEqual(12);
    expect(partner4RefusalKeys('repayments')).toEqual(expect.arrayContaining(['partner4.refusal.codeOfConduct', 'partner4.refusal.contactHours',
      'partner4.refusal.contactLog', 'partner4.refusal.thirdPartyAgents', 'partner4.refusal.partnerSuspension', 'partner4.refusal.channelVocabulary']));
    expect(partner4RefusalKeys('disbursements')).toEqual(expect.arrayContaining(['partner4.refusal.readyBatchAct', 'partner4.refusal.moneyDestination',
      'partner4.refusal.borrowerDestinationColumns', 'partner4.refusal.disbursalAct']));
    expect(partner4RefusalKeys('disbursement_batch')).toEqual(expect.arrayContaining(['partner4.refusal.secondSignature', 'partner4.refusal.coApproveAct',
      'partner4.refusal.batchContentsTable', 'partner4.refusal.cattleInsuranceRule']));
    expect(partner4RefusalKeys('queue').length).toBeGreaterThanOrEqual(12);
    expect(partner4RefusalKeys('application').length).toBeGreaterThanOrEqual(19);
    expect(partner4RefusalKeys('portfolio').length).toBeGreaterThanOrEqual(10);
    expect(partner4RefusalKeys('loan').length).toBeGreaterThanOrEqual(12);
    expect(partner4RefusalKeys('queue')).toEqual(expect.arrayContaining(['partner4.refusal.slaClock', 'partner4.refusal.takeNext', 'partner4.refusal.creditScore', 'partner4.refusal.docsPendingState']));
    expect(partner4RefusalKeys('application')).toEqual(expect.arrayContaining(['partner4.refusal.scoreFactors', 'partner4.refusal.platformIncome', 'partner4.refusal.documentRows', 'partner4.refusal.voiceConsent', 'partner4.refusal.effectiveRate']));
    expect(partner4RefusalKeys('portfolio')).toEqual(expect.arrayContaining(['partner4.refusal.parRate', 'partner4.refusal.kindChart', 'partner4.refusal.honestAttribution', 'partner4.refusal.offPlatformBook']));
    expect(partner4RefusalKeys('loan')).toEqual(expect.arrayContaining(['partner4.refusal.milkBillFigure', 'partner4.refusal.ledgerAnchors', 'partner4.refusal.maturityTerm', 'partner4.refusal.onTime']));
  });
  it('PC-56 PARTNER-4c · W216\'s sixteen and W217\'s eight are registered, and the shared refusals of 4a reach the KCC pair too', () => {
    const ids = PARTNER4_REFUSALS.map((r) => r.id);
    const W216 = ['kcc_account_entity', 'credit_limit', 'available_headroom', 'renewal_concept', 'scale_of_finance', 'seasonal_drawls',
      'interest_engine', 'subvention_credited', 'utilisation_ratio', 'limit_review_block', 'limit_change_notice', 'limit_review_act',
      'kcc_accounts_opened', 'drawn_balance', 'borrower_ledger_mirror', 'no_limit_reviews_state'];
    const W217 = ['drawl_ledger_rows', 'drawl_narrative', 'accrual_arithmetic', 'interest_on_drawn_only', 'drawl_purpose_check',
      'append_only_safe', 'borrower_sees_always', 'entries_since_opening'];
    expect(W216.length).toBe(16); expect(W217.length).toBe(8);
    expect(ids).toEqual(expect.arrayContaining([...W216, ...W217]));
    expect(partner4RefusalKeys('kcc').length).toBeGreaterThanOrEqual(16);
    expect(partner4RefusalKeys('kcc_drawls').length).toBeGreaterThanOrEqual(8);
    // the wall and the shared chain sentences hold on the new surfaces as well
    for (const s of ['kcc', 'kcc_drawls'] as const) {
      expect([s, partner4RefusalKeys(s)]).toEqual([s, expect.arrayContaining(['partner4.refusal.borrowerIdentity', 'partner4.refusal.platformRoles', 'partner4.refusal.planSettings'])]);
    }
    for (const s of ['kcc_export', 'kcc_form', 'kcc_act'] as const) {
      expect([s, partner4RefusalKeys(s)]).toEqual([s, expect.arrayContaining(['partner4.refusal.chainZeroSum', 'partner4.refusal.chainOnCall', 'partner4.refusal.chainAudit'])]);
    }
    expect(partner4RefusalKeys('kcc_export')).toEqual(expect.arrayContaining(['partner4.refusal.exportFile']));
    // the founder's own doors, pinned in English: the account that does not exist, and the ledger that moves no money
    expect(en['partner4.kcc.statement']).toMatch(/^There is no KCC account on this platform\./);
    expect(en['partner4.drawls.statement']).toMatch(/not a money movement on this platform, and it is not shown here/);
    expect(en['partner4.kcc.zeroTruth']).toBe('A fresh KCC sits at zero until the season starts — no drawl, no interest, no cost.');
    expect(en['partner4.drawls.zeroTruth']).toBe(en['partner4.kcc.zeroTruth']);
    // and the two sentences this wave refuses to say: the canon's stale banner and "append-only and safe"
    expect(en['partner4.refusal.appendOnlySafe']).toMatch(/privilege rather than a guarantee/);
    for (const cat of [en, hi, gu]) expect(/DELTA-032|Backend pending/i.test(Object.values(cat).join(' '))).toBe(false);
  });
  it('PC-56 PARTNER-4c · W217 IS READLESS IN ITS OWN SOURCE: the drawls page cannot read anything, because an entry on that ledger moves no money (founder 4c-1)', () => {
    // the registry CLAIMS it; this case proves the file matches the claim
    const note = PARTNER4_CANON_FILES.find((f) => f.file.startsWith('W217-'))?.note ?? '';
    expect(note).toMatch(/NO READ/);
    expect(note).toMatch(/no audit row and no error state/);

    // (a) THE POSITIVE CONTROL, FIRST — the same pattern set, applied to W216, MUST fire. A ban list that matches nothing is not a test, and
    // this is what stops the case rotting into a regex that can never fail: W216 reads one loan through 4a's audited `partner_loan`.
    const kcc = readSrc(KCC_PAGE);
    const fired = NO_READ.filter(([, re]) => re.test(kcc)).map(([name]) => name);
    expect(fired).toEqual(expect.arrayContaining(['partnerClient(', 'a partner SDK resource', 'a read verb']));

    // (b) AND THE DRAWLS PAGE FIRES NONE OF THEM
    const drawls = readSrc(DRAWLS_PAGE);
    expect(drawls.length).toBeGreaterThan(200);                       // the file was really read, not silently empty
    for (const [name, re, why] of NO_READ) expect([name, re.test(drawls), why]).toEqual([name, false, why]);

    // (c) what it DOES call, listed — so this case says "it reads nothing of the book", not the untruth "it makes no request at all":
    //     `requirePartner` is the session, `lenderGate` sends an insurer to its own console (it reads `/me`), `lenderSwitches` reads the
    //     platform's PUBLIC flag map so OFF can be printed as OFF, and `partnersMailbox` reads a platform FACT for the export chain's line.
    //     None of the four reads this lender's book; none writes an audit row; none can reach a drawl entry.
    for (const call of READLESS_ALLOWED) expect([call, drawls.includes(call)]).toEqual([call, true]);
    expect(drawls).toMatch(/lenderSwitches\(\)/);                     // its state is the flag map — the only "read" it makes
    expect(drawls).not.toMatch(/let\s+\w+\s*:.*\|\s*null|try\s*{/);   // no read to hold, so no variable to hold it and nothing to catch
  });
  it('PC-56 PARTNER-4c · the 4c DELTAs are recorded: the two routes, the loan id, the stale banner, the omitted links and the form chain\'s own defects', () => {
    const ids = PARTNER4_DELTAS.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['two_4c_routes', 'w217_id_is_a_loan', 'w217_stale_banner', 'fm_omits_kcc_links',
      'kcc_form_without_form', 'w2956_two_defects', 'w2954_back_to_edit', 'kcc_chains_return_w216', 'kcc_mutate_no_trigger', 'kcc_act_words']));
    expect(PARTNER4_DELTAS.find((d) => d.id === 'w217_stale_banner')?.canon).toMatch(/DELTA-032/);
    expect(PARTNER4_DELTAS.find((d) => d.id === 'w217_stale_banner')?.built).toMatch(/NEVER COPIED/);
    expect(PARTNER4_DELTAS.find((d) => d.id === 'w217_id_is_a_loan')?.built).toMatch(/LOAN id/);
    expect(PARTNER4_DELTAS.find((d) => d.id === 'kcc_mutate_no_trigger')?.built).toMatch(/DECOR, and reached from NO control/);
    expect(PARTNER4_DELTAS.find((d) => d.id === 'w2956_two_defects')?.canon).toMatch(/no CONFIRM page/);
  });
  it('the DELTAs: the four routes, the chains as query states, the chain returns, W215\'s orphanhood, the FM numbering / mis-classes / omissions, the FY caveat, the nine kinds, the sub-navigation, the dead console', () => {
    expect(PARTNER4_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['four_routes', 'loan_chain_routes', 'chain_returns', 'w215_orphan',
      'fm_numbering', 'fm_misclass', 'fm_omissions', 'loan_reference', 'status_chips_seven', 'counts_window', 'kind_mix_nine', 'lending_sub_nav', 'dead_lending_console',
      // PC-56 PARTNER-4b
      'three_4b_routes', 'w218_id_is_a_run', 'arrears_six_buckets', 'collected_recorded_window', 'pipeline_four_counts', 'disbursal_word']));
    expect(PARTNER4_DELTAS.find((d) => d.id === 'w218_id_is_a_run')?.built).toMatch(/\/lender\/disbursements\/pending/);
    expect(PARTNER4_DELTAS.find((d) => d.id === 'arrears_six_buckets')?.built).toMatch(/NO DUE DATE RECORDED/);
    expect(new Set(PARTNER4_DELTAS.map((d) => d.id)).size).toBe(PARTNER4_DELTAS.length);
    for (const d of PARTNER4_DELTAS) expect([d.id, d.canon.length > 0, d.built.length > 0]).toEqual([d.id, true, true]);
    expect(PARTNER4_DELTAS.find((d) => d.id === 'fm_numbering')?.canon).toMatch(/W14xx/);
    expect(PARTNER4_DELTAS.find((d) => d.id === 'w215_orphan')?.canon).toMatch(/ZERO inbound references/);
    expect(PARTNER4_DELTAS.find((d) => d.id === 'counts_window')?.built).toMatch(/OPENED in the FY window/);
  });
  it('the lending sub-navigation: FIVE rows, all five LIVE — and PARTNER-4c\'s KCC row is the one that needs a loan id', () => {
    expect(LENDING_SUBNAV.map((i) => [i.href, i.wave, i.live])).toEqual([
      ['/lender/queue', '4a', true], ['/lender/portfolio', '4a', true],
      ['/lender/disbursements', '4b', true], ['/lender/repayments', '4b', true],
      ['/lender/kcc/[id]', '4c', true]]);
    expect(LENDING_SUBNAV.filter((i) => i.live).length).toBe(5);
    expect(new Set(LENDING_SUBNAV.map((i) => i.key)).size).toBe(5);
    // exactly ONE row is addressed by a loan — and it is the only one whose href is a route pattern
    expect(LENDING_SUBNAV.filter((i) => i.needsLoanId).map((i) => i.href)).toEqual(['/lender/kcc/[id]']);
    expect(LENDING_SUBNAV.filter((i) => i.href.includes('[')).map((i) => i.needsLoanId)).toEqual([true]);
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
    expect(fresh.length).toBe(396);   // 4a's 225 + 4b's 102 + PARTNER-4c's 69, at parity in all three catalogues
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
