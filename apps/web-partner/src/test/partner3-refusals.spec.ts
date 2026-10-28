// apps/web-partner/src/test/partner3-refusals.spec.ts · PC-56 PARTNER-3a (survey E2) — the PARTNER-3 registry: all 26 canon files, each with ONE
// verdict (3a's 8 decided: W252 BUILT, W253 BUILT, W264 BUILT, W2855–W2856 DECOR, W2857–W2859 PARITY-DECOR; 3b's 18 `pending_3b`); every
// refusal and chain sentence exists in en, hi AND gu with the same placeholders; every English refusal says no; every surface prints at least
// one refusal; the DELTAs are recorded; the chains are query states; the i18n parity extended to every `partner3.*` key.
import * as fs from 'node:fs';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  CLAIMS_REDIRECTS, CLAIMS_SUBNAV, PARTNER3_CANON_FILES, PARTNER3_CHAINS, PARTNER3_DELTAS, PARTNER3_REFUSALS, chain3State, partner3RefusalKeys, type Partner3Surface,
} from '../features/partner3/refusals';

const CANON = '/Users/sanjayodedra/Documents/Personal/farmer/Phase-1 all screen design/Krishalaya_Design_System/web-screens';
const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
const SURVEY_C = ['W252-partner-claims.html', 'W253-partner-claim-detail.html', 'W255-partner-evidence-review.html', 'W256-partner-evidence-board.html', 'W257-partner-surveyors.html',
  'W258-partner-survey-scheduling.html', 'W259-partner-survey-report.html', 'W263-partner-fraud-flags.html', 'W264-partner-claims-insights.html', 'W2855-partner-claim-export-queued.html',
  'W2856-partner-claim-export-ready.html', 'W2857-partner-claim-mutate-confirm.html', 'W2858-partner-claim-mutate-success.html', 'W2859-partner-claim-mutate-failure.html',
  'W2866-partner-evidence-mutate-confirm.html', 'W2867-partner-evidence-mutate-success.html', 'W2868-partner-evidence-mutate-failure.html', 'W2904-partner-surveyors-mutate-confirm.html',
  'W2905-partner-surveyors-mutate-success.html', 'W2906-partner-surveyors-mutate-failure.html', 'W2934-partner-fraud-mutate-confirm.html', 'W2935-partner-fraud-mutate-success.html',
  'W2936-partner-fraud-mutate-failure.html', 'W3014-partner-survey-mutate-confirm.html', 'W3015-partner-survey-mutate-success.html', 'W3016-partner-survey-mutate-failure.html'];
const SURFACES: readonly Partner3Surface[] = ['claims', 'claim', 'claims_insights', 'evidence', 'evidence_board', 'surveyors', 'surveys', 'survey_report', 'fraud',
  'claims_act', 'claim_act', 'insights_act', 'insights_export',
  'evidence_act', 'evidence_board_act', 'surveyors_act', 'surveys_act', 'survey_report_act', 'fraud_act'];
/** A chain's i18n keys: a 3a chain carries `<key>.title` + `<key>.body`; a 3b chain's ONE state IS the founder's statement, keyed exactly. */
const chainKeys = (c: { states: readonly string[]; key: (s: string) => string; statement?: boolean }) =>
  c.states.flatMap((s) => (c.statement ? [c.key(s), 'partner3.chain.act3b.title'] : [`${c.key(s)}.title`, `${c.key(s)}.body`]));

describe('PC-56 PARTNER-3a · the PARTNER-3 canon registry', () => {
  it('26 files — the survey §C list exactly — each with ONE verdict: 3a = 8 (3 BUILT, 2 DECOR, 3 PARITY-DECOR); 3b = 18 (5 honest, 1 read, 12 DECOR) — 26 of 26 decided, 0 pending', () => {
    const files = PARTNER3_CANON_FILES.map((f) => f.file);
    expect(files.length).toBe(26); expect(new Set(files).size).toBe(26);
    expect([...files].sort()).toEqual([...SURVEY_C].sort());
    const v = (f: string) => PARTNER3_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.verdict;
    expect([v('W252'), v('W253'), v('W264')]).toEqual(['BUILT', 'BUILT', 'BUILT']);
    for (const f of ['W2855', 'W2856']) expect([f, v(f)]).toEqual([f, 'DECOR']);
    for (const f of ['W2857', 'W2858', 'W2859']) expect([f, v(f)]).toEqual([f, 'PARITY-DECOR']);
    // PC-56 PARTNER-3b: the six real screens and the twelve chain pages
    for (const f of ['W255', 'W256', 'W257', 'W259', 'W263']) expect([f, v(f)]).toEqual([f, 'BUILT (honest)']);
    expect(v('W258')).toBe('BUILT (read)');
    for (const f of ['W2866', 'W2867', 'W2868', 'W2904', 'W2905', 'W2906', 'W2934', 'W2935', 'W2936', 'W3014', 'W3015', 'W3016']) expect([f, v(f)]).toEqual([f, 'DECOR']);
    expect(PARTNER3_CANON_FILES.filter((f) => f.wave === '3a').length).toBe(8);
    expect(PARTNER3_CANON_FILES.filter((f) => f.wave === '3b').length).toBe(18);
    // 26 of 26 DECIDED — nothing pending, in either wave, and the `pending_3b` verdict value is gone from the registry
    expect(PARTNER3_CANON_FILES.filter((f) => /pending/i.test(f.verdict))).toEqual([]);
    expect(new Set(PARTNER3_CANON_FILES.map((f) => f.verdict))).toEqual(new Set(['BUILT', 'BUILT (read)', 'BUILT (honest)', 'PARITY-DECOR', 'DECOR']));
    expect(fs.readFileSync(`${__dirname}/../features/partner3/refusals.ts`, 'utf8')).not.toContain('pending_3b');
    for (const f of PARTNER3_CANON_FILES) expect([f.file, /^W\d{3,4}-partner-[a-z0-9-]+\.html$/.test(f.file), f.note.length > 0]).toEqual([f.file, true, true]);
    if (fs.existsSync(CANON)) for (const f of files) expect([f, fs.existsSync(`${CANON}/${f}`)]).toEqual([f, true]);
  });
  it('TEN chains, all query states of their pages: the four 3a chains, then 3b\'s six — each `?act=confirm` with ONE state, the canon\'s files recorded once per chain', () => {
    expect(PARTNER3_CHAINS.map((c) => [c.id, c.wave, c.page, c.param, c.files])).toEqual([
      ['claims_act', '3a', '/insurer/claims', 'act', ['W2857', 'W2858', 'W2859']], ['claim_act', '3a', '/insurer/claims/[id]', 'act', []],
      ['insights_act', '3a', '/insurer/claims/insights', 'act', []], ['insights_export', '3a', '/insurer/claims/insights', 'export', ['W2855', 'W2856']],
      ['evidence_act', '3b', '/insurer/claims/evidence', 'act', ['W2866', 'W2867', 'W2868']],
      ['evidence_board_act', '3b', '/insurer/claims/evidence/[id]', 'act', []],
      ['surveyors_act', '3b', '/insurer/surveyors', 'act', ['W2904', 'W2905', 'W2906']],
      ['surveys_act', '3b', '/insurer/surveys', 'act', ['W3014', 'W3015', 'W3016']],
      ['survey_report_act', '3b', '/insurer/surveys/[id]/report', 'act', []],
      ['fraud_act', '3b', '/insurer/claims/fraud', 'act', ['W2934', 'W2935', 'W2936']]]);
    expect(PARTNER3_CHAINS.filter((c) => c.mailbox).map((c) => c.id)).toEqual(['insights_export']);
    // every 3b chain is ONE state, `confirm`, whose sentence IS the refusal — there is no success or failure to reach
    expect(PARTNER3_CHAINS.filter((c) => c.wave === '3b').map((c) => [c.id, c.states, c.statement === true, c.key('confirm')]))
      .toEqual(['evidence_act', 'evidence_board_act', 'surveyors_act', 'surveys_act', 'survey_report_act', 'fraud_act'].map((id) => [id, ['confirm'], true, 'partner3.chain.act3b.confirm']));
    expect(PARTNER3_CHAINS.filter((c) => c.wave === '3a').every((c) => c.statement === undefined)).toBe(true);
    expect(PARTNER3_CHAINS.flatMap((c) => c.files).length).toBe(17);   // every canon chain page of PARTNER-3, recorded exactly once
    expect(new Set(PARTNER3_CHAINS.flatMap((c) => c.files)).size).toBe(17);
    for (const c of PARTNER3_CHAINS) for (const id of c.files) {
      expect([id, PARTNER3_CANON_FILES.some((f) => f.file.startsWith(`${id}-`) && (f.verdict === 'DECOR' || f.verdict === 'PARITY-DECOR'))]).toEqual([id, true]);
    }
    expect([chain3State('claims_act', { act: 'confirm' }), chain3State('claims_act', { act: 'take' }), chain3State('insights_export', { export: 'ready' }), chain3State('insights_export', { act: 'ready' })])
      .toEqual(['confirm', null, 'ready', null]);
    for (const id of ['evidence_act', 'surveyors_act', 'surveys_act', 'fraud_act', 'evidence_board_act', 'survey_report_act'] as const) {
      expect([id, chain3State(id, { act: 'confirm' }), chain3State(id, { act: 'success' }), chain3State(id, { act: 'failure' }), chain3State(id, {})]).toEqual([id, 'confirm', null, null, null]);
    }
  });
  it('every refusal / chain key exists in en, hi and gu with the same placeholders; every English refusal says no; EVERY surface prints at least one', () => {
    const keys = [...PARTNER3_REFUSALS.map((r) => r.key), ...PARTNER3_CHAINS.flatMap(chainKeys),
      ...CLAIMS_SUBNAV.map((i) => i.key), 'partner3.claim.decideStatement', 'partner3.export.notAvailable',
      'partner3.evidence.statement', 'partner3.surveyors.statement', 'partner3.surveys.statement', 'partner3.report.statement', 'partner3.fraud.statement'];
    for (const k of keys) {
      expect([k, typeof en[k], typeof hi[k], typeof gu[k]]).toEqual([k, 'string', 'string', 'string']);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
    }
    for (const r of PARTNER3_REFUSALS) expect([r.id, /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnone\b|\bcannot\b/i.test(en[r.key])]).toEqual([r.id, true]);
    expect(new Set(PARTNER3_REFUSALS.map((r) => r.id)).size).toBe(PARTNER3_REFUSALS.length);
    for (const s of SURFACES) expect([s, partner3RefusalKeys(s).length > 0]).toEqual([s, true]);
    for (const r of PARTNER3_REFUSALS) expect([r.id, r.canon.length > 0, r.why.length > 0, r.key.startsWith('partner3.refusal.'), r.surfaces.every((x) => SURFACES.includes(x))]).toEqual([r.id, true, true, true, true]);
  });
  it('the refusals the brief names are registered (W252 / W253 / W264 / the chains / 3b\'s doors)', () => {
    const ids = PARTNER3_REFUSALS.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['paying_chip', 'payout_batch', 'named_holders', 'hour_counts', 'response_timers', 'claims_roles', 'two_person_rule', 'weather_absorbs', 'take_next',
      'plan_settings', 'claimant_contact', 'survey_block', 'claim_timeline', 'decision_pays', 'payout_link', 'pay_rate', 'contest_route', 'claimant_told', 'record_kept', 'claim_media',
      'claims_to_premium', 'event_to_payment', 'approval_headline', 'complaints_count', 'funded_programme', 'outcome_stories', 'claims_file', 'machine_checks', 'image_match', 'new_photos',
      'sealed_files', 'surveyor_roster', 'surveyor_people', 'surveyor_join', 'surveyor_pay', 'stepping_aside', 'grouped_visits', 'survey_deadlines', 'farmer_messages', 'survey_method',
      'payout_formula', 'report_accept', 'fraud_flags', 'cross_signal', 'hidden_records', 'auto_flagging']));
    expect(partner3RefusalKeys('claims')).toEqual(expect.arrayContaining(['partner3.refusal.payingChip', 'partner3.refusal.takeNext', 'partner3.refusal.twoPersonRule']));
    expect(partner3RefusalKeys('claim')).toEqual(expect.arrayContaining(['partner3.refusal.claimantContact', 'partner3.refusal.surveyBlock', 'partner3.refusal.claimTimeline', 'partner3.refusal.recordKept', 'partner3.refusal.claimMedia']));
    expect(partner3RefusalKeys('claims_insights')).toEqual(expect.arrayContaining(['partner3.refusal.claimsToPremium', 'partner3.refusal.eventToPayment', 'partner3.refusal.approvalHeadline', 'partner3.refusal.outcomeStories']));
    expect(partner3RefusalKeys('fraud')).toEqual(expect.arrayContaining(['partner3.refusal.fraudFlags', 'partner3.refusal.crossSignal', 'partner3.refusal.hiddenRecords']));
  });
  it('the DELTAs: the nine routes, the chains, F-16 FM omissions and mis-classes, the FM numbering, W259\'s [id], "other", the sub-navigation, the decide that is wired to nothing', () => {
    expect(PARTNER3_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['nine_routes', 'claims_chain_routes', 'chain_returns', 'fm_numbering', 'fm_misclass', 'fm_omissions',
      'claim_reference', 'decide_unwired', 'counts_window', 'other_event', 'w259_claim_id', 'claims_sub_nav', 'subject_type_only']));
    expect(PARTNER3_DELTAS.find((d) => d.id === 'fm_misclass')?.canon).toMatch(/"2d"/);
    expect(CLAIMS_REDIRECTS).toEqual({ '/insurance-claims': '/insurer/claims', '/insurance-claims/:id': '/insurer/claims/:id' });
  });
  // PC-56 PARTNER-3b — the sub-navigation is now SIX live rows (the four 3b pages exist), and the 3b DELTAs are recorded without duplicating
  // 3a's (`fm_numbering` already covers the FLOWMAP's non-existent W1439–W1447 / W1457–W1459; `fm_misclass` already covers W255's "2h",
  // W257's "Empanel surveyor" ×3 and its surveyor-name cells and W259's "Query surveyor"; `fm_omissions` already covers W255's "Review"
  // drill-ins and W257's "Actions for sv 1/2/3"). M1 (the evidence row's `live` flipped to false) kills here.
  it('the claims sub-navigation: SIX rows, every one live, in the built order — Queue · Insights · Evidence · Surveyors · Surveys · Fraud', () => {
    expect(CLAIMS_SUBNAV.map((i) => [i.href, i.wave, i.live])).toEqual([
      ['/insurer/claims', '3a', true], ['/insurer/claims/insights', '3a', true], ['/insurer/claims/evidence', '3b', true],
      ['/insurer/surveyors', '3b', true], ['/insurer/surveys', '3b', true], ['/insurer/claims/fraud', '3b', true]]);
    expect(CLAIMS_SUBNAV.filter((i) => i.live).length).toBe(6);
    expect(CLAIMS_SUBNAV.filter((i) => !i.live)).toEqual([]);
    expect(new Set(CLAIMS_SUBNAV.map((i) => i.key)).size).toBe(6);
  });
  it('PC-56 PARTNER-3b · the 3b DELTAs are recorded and none duplicates a 3a DELTA', () => {
    expect(PARTNER3_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['chain_returns_3b', 'fm_omissions_3b', 'evidence_counts_only', 'surveys_tabs', 'report_one_claim']));
    expect(new Set(PARTNER3_DELTAS.map((d) => d.id)).size).toBe(PARTNER3_DELTAS.length);
    for (const d of PARTNER3_DELTAS) expect([d.id, d.canon.length > 0, d.built.length > 0]).toEqual([d.id, true, true]);
    // the 3a DELTAs that already hold for 3b's defects are NOT re-recorded
    expect(PARTNER3_DELTAS.find((d) => d.id === 'fm_numbering')?.canon).toMatch(/W1433–W1461/);
    expect(PARTNER3_DELTAS.find((d) => d.id === 'fm_misclass')?.canon).toMatch(/W255 "2h"/);
    expect(PARTNER3_DELTAS.find((d) => d.id === 'fm_omissions')?.canon).toMatch(/W255 "Review" drill-ins/);
    expect(PARTNER3_DELTAS.find((d) => d.id === 'w259_claim_id')?.built).toMatch(/CLAIM id/);
  });
  it('i18n parity: every partner3.* key of en is in hi AND gu, non-empty, placeholders kept, not an English copy', () => {
    const fresh = Object.keys(en).filter((k) => k.startsWith('partner3.'));
    expect(fresh.length).toBe(231);   // PARTNER-3a left 168; PARTNER-3b adds 63
    for (const k of fresh) {
      expect([k, typeof hi[k] === 'string' && hi[k].length > 0, typeof gu[k] === 'string' && gu[k].length > 0]).toEqual([k, true, true]);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
      if (en[k].length > 12) expect([k, hi[k] !== en[k] && gu[k] !== en[k]]).toEqual([k, true]);
    }
    for (const k of [...Object.keys(hi), ...Object.keys(gu)]) expect([k, k in en]).toEqual([k, true]);
  });
  it('PC-56 PARTNER-3a · the DEV-24 claims keys are gone: no insBook. / claim. / policy. / insProducts. key in any catalogue', () => {
    for (const cat of [en, hi, gu]) expect(Object.keys(cat).filter((k) => /^(insBook|claim|policy|insProducts)\./.test(k))).toEqual([]);
  });
});
