// apps/web-partner/src/test-render/insurer-survey-report.render.test.tsx · PC-56 PARTNER-3b · W259 SURVEY REPORT — AN HONEST PAGE (founder Q4 +
// Q5): the statement VERBATIM; the claim's facts from the shared wall; the report block's THREE branches, of which only one prints a figure —
// the recorded damage percentage, and it is the only "%" on the page; no holder, area, indicated payout, methodology, field sheet, acceptance or
// surveyor; "Accept the report", "Ask the surveyor a question" and "Retry" DECOR → the W3014 chain; "View surveys" and "Open the claim" real;
// the not-found state.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerSurveyReportView } from '../components/partner3/InsurerSurveyReportView';
import { insurerFailureOf, wrongConsole } from '../features/partner2/figures';
import { partner3RefusalKeys } from '../features/partner3/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { FALSE_3A, percents, withoutRefusals } from './partner3a-fixtures';
import { CLAIM_SCHEDULED, CLAIM_SURVEYED, CLAIM_SURVEYED_NO_DAMAGE, FALSE_3B, IDENTITY_FIELDS, MEDIA_FILES, mediaCount } from './partner3b-fixtures';

const render = (c: Parameters<typeof InsurerSurveyReportView>[0]['c'], failure: Parameters<typeof InsurerSurveyReportView>[0]['failure'] = null, notFound = false, cat = en) =>
  renderToStaticMarkup(<InsurerSurveyReportView t={tr(cat)} lang="en" c={c} failure={failure} notFound={notFound} />);

describe('PC-56 PARTNER-3b · W259 the survey report page (render)', () => {
  const html = render(CLAIM_SURVEYED); const w = text(html);
  it('the founder\'s report statement, verbatim and pinned to its key; the claim\'s facts from the shared wall', () => {
    expect(html).toContain('data-kv-insurer="survey_report"'); expect(html).toContain('data-kv-state="ok"');
    expect(html).toContain('data-kv-statement="partner3.report.statement"');
    expect(w).toContain('The survey report is recorded by the organisation that serves the farmer. The insurer sees the recorded damage percentage and nothing else of the report; there is no report-acceptance step on the platform.');
    expect(html).toContain(`data-kv-facts="${CLAIM_SURVEYED.id}"`);
    for (const f of ['reference', 'policy', 'product', 'fpo', 'subject', 'event', 'event_date', 'reported', 'sum_insured', 'approved', 'filed', 'changed', 'closed']) {
      expect([f, html.includes(`data-kv-fact="${f}"`)]).toEqual([f, true]);
    }
    expect(html).not.toContain('data-kv-fact="damage"');            // the damage figure belongs to the report block on this page
  });
  it('the report block\'s THREE branches — and the recorded damage percentage is the ONLY "%" on the page', () => {
    expect(html).toContain('data-kv-report="damage"');
    expect(w).toContain('What the survey recorded'); expect(w).toContain('Recorded damage: 62%');
    expect(percents(w)).toBe(1);
    const noneYet = render(CLAIM_SCHEDULED);
    expect(noneYet).toContain('data-kv-report="noSurveyYet"');
    expect(text(noneYet)).toContain('No survey is recorded on this claim yet.');
    expect(percents(text(noneYet))).toBe(0);
    const noDamage = render(CLAIM_SURVEYED_NO_DAMAGE);
    expect(noDamage).toContain('data-kv-report="noDamageRecorded"');
    expect(text(noDamage)).toContain('The recorded report carries no damage percentage.');
    expect(percents(text(noDamage))).toBe(0);
  });
  it('NO holder, area, indicated payout, methodology, field sheet, acceptance, surveyor, note or media; the refusals printed by name', () => {
    expect(text(withoutRefusals(html))).not.toMatch(FALSE_3A); expect(text(withoutRefusals(html))).not.toMatch(FALSE_3B);
    expect(html).not.toMatch(IDENTITY_FIELDS);
    expect(html).not.toMatch(MEDIA_FILES); expect(mediaCount(text(withoutRefusals(html)))).toEqual([]);
    expect(text(withoutRefusals(html))).not.toMatch(/indicated|methodolog|\bplot\b|hectare/i);
    for (const k of partner3RefusalKeys('survey_report')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(w).toContain(en['partner3.refusal.reportHolders']); expect(w).toContain(en['partner3.refusal.reportFiling']);
    expect(w).toContain(en['partner3.claim.factsOnly']);
  });
  it('the three DECOR acts land on the W3014 chain; "Open the claim" and "View surveys" are real; "Back to surveys"; no <form>, no <button>', () => {
    expect([...html.matchAll(new RegExp(`href="/insurer/surveys/${CLAIM_SURVEYED.id}/report\\?act=confirm"`, 'g'))].length).toBe(3);
    for (const d of ['accept', 'query', 'retry']) expect([d, html.includes(`data-kv-decor="${d}"`)]).toEqual([d, true]);
    expect(w).toContain('Accept the report'); expect(w).toContain('Ask the surveyor a question');
    expect(html).toContain(`href="/insurer/claims/${CLAIM_SURVEYED.id}"`); expect(html).toContain('data-kv-real="claim"');
    expect(html).toContain('data-kv-back="/insurer/surveys"');
    expect(html).not.toContain('<form'); expect(html).not.toContain('<button');
    expect([...html.matchAll(/data-kv-subnav-item="/g)].length).toBe(6);
  });
  it('not found — never "not yours"; the error state re-reads; switched off (both switches); hi and gu; the kind rule', () => {
    const nf = render(null, null, true);
    expect(nf).toContain('data-kv-state="not_found"'); expect(text(nf)).toContain('No claim with this reference is on your products.');
    expect(text(nf)).not.toMatch(/not yours|another insurer|forbidden|403/i);
    const x = render(null, insurerFailureOf(500, 'INTERNAL', 'on'));
    expect(x).toContain('data-kv-state="error"'); expect(x).toContain('href="/insurer/surveys?act=confirm"');
    expect(render(null, insurerFailureOf(404, 'NOT_FOUND', 'off'))).toContain('data-kv-state="off"');
    expect(render(null, insurerFailureOf(404, 'PARTNER_INSURANCE_SWITCHED_OFF', 'unknown'))).toContain('data-kv-state="insurance_off"');
    for (const cat of [hi, gu]) expect(text(render(CLAIM_SURVEYED, null, false, cat))).toContain(cat['partner3.report.statement']);
    expect([wrongConsole('bank', 'insurer'), wrongConsole('insurer', 'insurer')]).toEqual([true, false]);
  });
});
