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
  'claims_act', 'claim_act', 'insights_act', 'insights_export'];

describe('PC-56 PARTNER-3a · the PARTNER-3 canon registry', () => {
  it('26 files — the survey §C list exactly — each with ONE verdict: 3a = 8 decided (3 BUILT, 2 DECOR, 3 PARITY-DECOR); 3b = 18 pending_3b', () => {
    const files = PARTNER3_CANON_FILES.map((f) => f.file);
    expect(files.length).toBe(26); expect(new Set(files).size).toBe(26);
    expect([...files].sort()).toEqual([...SURVEY_C].sort());
    const v = (f: string) => PARTNER3_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.verdict;
    expect([v('W252'), v('W253'), v('W264')]).toEqual(['BUILT', 'BUILT', 'BUILT']);
    for (const f of ['W2855', 'W2856']) expect([f, v(f)]).toEqual([f, 'DECOR']);
    for (const f of ['W2857', 'W2858', 'W2859']) expect([f, v(f)]).toEqual([f, 'PARITY-DECOR']);
    expect(PARTNER3_CANON_FILES.filter((f) => f.wave === '3a').length).toBe(8);
    expect(PARTNER3_CANON_FILES.filter((f) => f.wave === '3a' && f.verdict.startsWith('pending'))).toEqual([]);
    expect(PARTNER3_CANON_FILES.filter((f) => f.wave === '3b').map((f) => f.verdict)).toEqual(Array(18).fill('pending_3b'));
    for (const f of PARTNER3_CANON_FILES) expect([f.file, /^W\d{3,4}-partner-[a-z0-9-]+\.html$/.test(f.file), f.note.length > 0]).toEqual([f.file, true, true]);
    if (fs.existsSync(CANON)) for (const f of files) expect([f, fs.existsSync(`${CANON}/${f}`)]).toEqual([f, true]);
  });
  it('the chains are query states of their pages: ?act= on the queue, the claim and insights (W2857–W2859 recorded once), ?export= on insights (W2855–W2856, the mailbox line)', () => {
    expect(PARTNER3_CHAINS.map((c) => [c.id, c.page, c.param, c.files])).toEqual([
      ['claims_act', '/insurer/claims', 'act', ['W2857', 'W2858', 'W2859']], ['claim_act', '/insurer/claims/[id]', 'act', []],
      ['insights_act', '/insurer/claims/insights', 'act', []], ['insights_export', '/insurer/claims/insights', 'export', ['W2855', 'W2856']]]);
    expect(PARTNER3_CHAINS.filter((c) => c.mailbox).map((c) => c.id)).toEqual(['insights_export']);
    for (const c of PARTNER3_CHAINS) for (const id of c.files) {
      expect([id, PARTNER3_CANON_FILES.some((f) => f.file.startsWith(`${id}-`) && (f.verdict === 'DECOR' || f.verdict === 'PARITY-DECOR'))]).toEqual([id, true]);
    }
    expect([chain3State('claims_act', { act: 'confirm' }), chain3State('claims_act', { act: 'take' }), chain3State('insights_export', { export: 'ready' }), chain3State('insights_export', { act: 'ready' })])
      .toEqual(['confirm', null, 'ready', null]);
  });
  it('every refusal / chain key exists in en, hi and gu with the same placeholders; every English refusal says no; EVERY surface prints at least one', () => {
    const keys = [...PARTNER3_REFUSALS.map((r) => r.key), ...PARTNER3_CHAINS.flatMap((c) => c.states.flatMap((s) => [`${c.key(s)}.title`, `${c.key(s)}.body`])),
      ...CLAIMS_SUBNAV.map((i) => i.key), 'partner3.claim.decideStatement', 'partner3.export.notAvailable'];
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
    expect(CLAIMS_SUBNAV.filter((i) => i.live).map((i) => i.href)).toEqual(['/insurer/claims', '/insurer/claims/insights']);
    expect(CLAIMS_SUBNAV.filter((i) => !i.live).every((i) => i.wave === '3b')).toBe(true);
  });
  it('i18n parity: every partner3.* key of en is in hi AND gu, non-empty, placeholders kept, not an English copy', () => {
    const fresh = Object.keys(en).filter((k) => k.startsWith('partner3.'));
    expect(fresh.length).toBe(168);
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
