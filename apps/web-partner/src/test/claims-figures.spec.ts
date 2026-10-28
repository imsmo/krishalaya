// apps/web-partner/src/test/claims-figures.spec.ts · PC-56 PARTNER-3a — the claims console's pure figures: the queue row model (the reference,
// waiting days, the event label or "not recorded", the recorded 72-hour yes / no), the ONE percentage (the survey's recorded damage, a whole
// number 0–100), the count chips (approved = approved + partially approved; paid or closed together), the insights rows (eight codes + any
// other + not recorded), the FY label from the server's window, the links (only the status and the cursor enter the URL).
import {
  CLAIM_EVENT_CODES, CLAIM_STATUSES, SURVEY_STAGES, chipCounts, claimRef, claimStatusKey, claimsHref, claimsQuery, countsState, damageText, decidedRows, eventLabel, eventRows,
  isSurveyStage, reportText, reportedKey, stageCountsState, stageTabCount, statusRows, surveyStage, surveyStageCounts, surveysHref, waitingText, windowLabel,
} from '../features/partner3/figures';

describe('PC-56 PARTNER-3a · the claims figures', () => {
  it('the statuses are the machine\'s nine; an unknown one prints as unrecognised; the reference is the id\'s head', () => {
    expect([...CLAIM_STATUSES]).toEqual(['intimated', 'docs_pending', 'survey_scheduled', 'surveyed', 'approved', 'partially_approved', 'rejected', 'paid', 'closed']);
    expect([claimStatusKey('surveyed'), claimStatusKey('paying')]).toEqual(['partner3.status.surveyed', 'partner3.status.unknown']);
    expect(claimRef('0192d2c4-0001-7000-8000-000000000001')).toBe('0192d2c4…');
  });
  it('the event label: the eight platform codes, any other code as itself, none as "not recorded"', () => {
    expect([...CLAIM_EVENT_CODES]).toEqual(['drought', 'flood', 'hail', 'pest', 'death', 'theft', 'fire', 'accident']);
    expect([eventLabel('hail'), eventLabel(null), eventLabel('not_recorded'), eventLabel('cyclone')]).toEqual([{ key: 'partner3.event.hail' }, { key: 'partner3.event.notRecorded' },
      { key: 'partner3.event.notRecorded' }, { raw: 'cyclone' }]);
  });
  it('reported within 72 hours as RECORDED (yes / no / not recorded) — never an hour count; waiting days from the server\'s integer', () => {
    expect([reportedKey(true), reportedKey(false), reportedKey(null)]).toEqual(['partner3.claims.reportedYes', 'partner3.claims.reportedNo', 'partner3.claims.reportedUnknown']);
    expect([waitingText(9), waitingText(0), waitingText(null), waitingText(-1), waitingText(2.5)]).toEqual([
      { key: 'partner3.claims.waitingDays', vars: { days: '9' } }, { key: 'partner3.claims.waitingToday', vars: { days: '0' } }, null, null, null]);
  });
  it('the damage percentage: a whole number 0–100 with "%" — the ONLY percentage a 3a page prints; anything else prints nothing', () => {
    expect([damageText(62), damageText(0), damageText(100)]).toEqual(['62%', '0%', '100%']);
    expect([damageText(null), damageText(62.5), damageText(101), damageText(-1), damageText(undefined)]).toEqual([null, null, null, null, null]);
  });
  it('the chips: seven integer counts — approved includes partially approved, paid and closed together; nonsense counts as 0', () => {
    const c = chipCounts({ intimated: 2, docs_pending: 1, survey_scheduled: 0, surveyed: 3, approved: 1, partially_approved: 2, rejected: 1, paid: 4, closed: 60, bogus: 9 });
    expect(c.map((x) => [x.id, x.n])).toEqual([['intimated', 2], ['docs_pending', 1], ['survey_scheduled', 0], ['surveyed', 3], ['approved', 3], ['rejected', 1], ['paid_closed', 64]]);
    expect(chipCounts({ approved: -5, paid: 1.5 } as never).every((x) => x.n === 0)).toBe(true);
    expect(chipCounts(null).map((x) => x.n)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(c.find((x) => x.id === 'approved')?.key).toBe('partner3.chip.approved');
  });
  it('the insights rows: nine statuses; the eight codes, any other code, then not recorded; three decided counts', () => {
    expect(statusRows({ surveyed: 2 }).map((r) => [r.status, r.n]).slice(2, 4)).toEqual([['survey_scheduled', 0], ['surveyed', 2]]);
    const ev = eventRows({ hail: 2, not_recorded: 1, cyclone: 1, 'Kesar Ben': 5 });
    expect(ev.map((r) => r.code)).toEqual(['drought', 'flood', 'hail', 'pest', 'death', 'theft', 'fire', 'accident', 'cyclone', 'not_recorded']);
    expect(ev.map((r) => r.n)).toEqual([0, 0, 2, 0, 0, 0, 0, 0, 1, 1]);
    expect(decidedRows({ approved: 1, partiallyApproved: 2, rejected: 3 }).map((r) => r.n)).toEqual([1, 2, 3]);
  });
  it('the window label comes from the SERVER\'s window: an FY prints "FY", any other window its two days; the counts state', () => {
    expect(windowLabel({ from: '2026-04-01', to: '2027-04-01', fy: '2026-27' })).toEqual({ key: 'partner3.insights.fy', vars: { fy: '2026-27' } });
    expect(windowLabel({ from: '2025-11-01', to: '2026-11-01', fy: null })).toEqual({ key: 'partner3.insights.window', vars: { from: '2025-11-01', to: '2026-11-01' } });
    expect(windowLabel(null)).toBeNull();
    expect([countsState({ total: 3 }, null), countsState({ total: 0 }, null), countsState(null, null), countsState(null, 'insurance_off')]).toEqual(['ok', 'empty', 'error', 'insurance_off']);
  });
  // ── PC-56 PARTNER-3b · the survey stages, their counts of CLAIMS, the surveys links and W259's report block ──
  it('the four survey stages, in tab order, with `survey_scheduled` the DEFAULT — the whitelist is STRICT (M3 kills here)', () => {
    expect([...SURVEY_STAGES]).toEqual(['survey_scheduled', 'intimated', 'docs_pending', 'surveyed']);
    for (const s of SURVEY_STAGES) expect([s, surveyStage({ status: s })]).toEqual([s, s]);
    // anything else — including a real claim status outside the four, a list, a wrong case, nothing at all — is the default
    for (const bad of ['approved', 'partially_approved', 'rejected', 'paid', 'closed', 'paying', '', 'SURVEYED', 'surveyed ', 'survey_scheduled;drop'])
      expect([bad, surveyStage({ status: bad })]).toEqual([bad, 'survey_scheduled']);
    expect([surveyStage({}), surveyStage(undefined), surveyStage({ status: undefined })]).toEqual(['survey_scheduled', 'survey_scheduled', 'survey_scheduled']);
    expect(surveyStage({ status: ['surveyed', 'approved'] })).toBe('surveyed');
    expect([isSurveyStage('surveyed'), isSurveyStage('approved'), isSurveyStage(7)]).toEqual([true, false, false]);
  });
  it('the stage counts are counts of CLAIMS: awaiting = intimated + documents pending; scheduled; surveyed — integers, nonsense as 0', () => {
    const c = surveyStageCounts({ intimated: 2, docs_pending: 3, survey_scheduled: 1, surveyed: 4, approved: 9, paid: 7, bogus: 5 });
    expect(c.map((x) => [x.id, x.n])).toEqual([['awaiting', 5], ['scheduled', 1], ['surveyed', 4]]);
    expect(c.map((x) => x.key)).toEqual(['partner3.surveys.countAwaiting', 'partner3.surveys.countScheduled', 'partner3.surveys.countSurveyed']);
    expect(surveyStageCounts({ intimated: -4, docs_pending: 1.5, surveyed: Number.NaN } as never).every((x) => x.n === 0)).toBe(true);
    expect(surveyStageCounts(null).map((x) => x.n)).toEqual([0, 0, 0]);
    expect([stageTabCount({ surveyed: 4 }, 'surveyed'), stageTabCount({ surveyed: 4 }, 'intimated'), stageTabCount(null, 'survey_scheduled')]).toEqual([4, 0, 0]);
    // the page is EMPTY only when no claim is in any of the three stages, whatever else was filed in the window
    expect([stageCountsState({ byStatus: { surveyed: 1 } }, null), stageCountsState({ byStatus: { approved: 9, paid: 3 } }, null),
      stageCountsState(null, null), stageCountsState({ byStatus: {} }, 'off')]).toEqual(['ok', 'empty', 'error', 'off']);
  });
  it('the surveys links carry only a whitelisted stage and an opaque cursor', () => {
    expect([surveysHref('surveyed'), surveysHref('paying'), surveysHref('survey_scheduled', 'Y3Vy'), surveysHref('intimated', 'bad cursor!')]).toEqual([
      '/insurer/surveys?status=surveyed', '/insurer/surveys?status=survey_scheduled', '/insurer/surveys?status=survey_scheduled&cursor=Y3Vy', '/insurer/surveys?status=intimated']);
  });
  it('W259\'s report block has exactly three branches, and the ONLY "%" in the whole file comes from damageText', () => {
    expect(reportText({ status: 'surveyed', damagePercent: 62 })).toEqual({ key: 'partner3.report.damage', vars: { value: '62%' } });
    expect(reportText({ status: 'approved', damagePercent: 0 })).toEqual({ key: 'partner3.report.damage', vars: { value: '0%' } });
    for (const s of ['intimated', 'docs_pending', 'survey_scheduled']) expect([s, reportText({ status: s, damagePercent: null })]).toEqual([s, { key: 'partner3.report.noSurveyYet' }]);
    for (const s of ['surveyed', 'approved', 'partially_approved', 'rejected', 'paid', 'closed']) expect([s, reportText({ status: s, damagePercent: null })]).toEqual([s, { key: 'partner3.report.noDamageRecorded' }]);
    // a figure the survey did not record as a whole 0–100 is not a figure: the branch falls to the status rule
    expect([reportText({ status: 'surveyed', damagePercent: 62.5 }), reportText({ status: 'surveyed', damagePercent: 101 })])
      .toEqual([{ key: 'partner3.report.noDamageRecorded' }, { key: 'partner3.report.noDamageRecorded' }]);
    expect([reportText({ status: 'unknown_status', damagePercent: null }), reportText(null)]).toEqual([{ key: 'partner3.report.noSurveyYet' }, null]);
    // the source scan: `damageText` is the only producer of a "%" in the whole figures module (M2's neighbourhood)
    const src = require('node:fs').readFileSync(`${__dirname}/../features/partner3/figures.ts`, 'utf8') as string;
    const body = src.split('\n').filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect([...body.matchAll(/%/g)].length).toBe(1);
    expect(body).toMatch(/return Number\.isInteger\(v\)[^\n]*\$\{v\}%/);
  });
  it('the queue links carry only the status (of the machine) and an opaque cursor', () => {
    expect([claimsHref(), claimsHref('surveyed'), claimsHref('paying'), claimsHref('approved', 'Y3Vy')]).toEqual(['/insurer/claims', '/insurer/claims?status=surveyed', '/insurer/claims',
      '/insurer/claims?status=approved&cursor=Y3Vy']);
    expect(claimsQuery({ status: 'surveyed', cursor: 'Y3Vy', claimant: 'x' })).toEqual({ status: 'surveyed', cursor: 'Y3Vy' });
    expect(claimsQuery({ status: 'paying', cursor: 'bad cursor!' })).toEqual({ status: undefined, cursor: undefined });
  });
});
