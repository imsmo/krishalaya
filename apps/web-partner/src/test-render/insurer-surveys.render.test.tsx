// apps/web-partner/src/test-render/insurer-surveys.render.test.tsx · PC-56 PARTNER-3b · W258 SURVEY SCHEDULING — A READ OF CLAIM FACTS BY SURVEY
// STATUS (founder Q4 + Q5 + 3b-1): the statement VERBATIM; the four stage tabs with their COUNTS OF CLAIMS, `survey_scheduled` current by
// default (M3 kills here); 3a's queue rows without a shred of identity, each linking to that claim's survey report; the keyset "older" link
// keeping the stage; "Confirm this week's visits" DECOR → the W3014 chain; "View claims" real; empty per tab; error / OFF / kind states.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerSurveysView } from '../components/partner3/InsurerSurveysView';
import { insurerFailureOf, wrongConsole } from '../features/partner2/figures';
import { listState, surveyStage } from '../features/partner3/figures';
import { partner3RefusalKeys } from '../features/partner3/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { FALSE_3A, percents, withoutRefusals } from './partner3a-fixtures';
import { COUNTS_3B, FALSE_3B, IDENTITY_FIELDS, MEDIA_FILES, STAGE_ROWS, mediaCount } from './partner3b-fixtures';

const render = (state: Parameters<typeof InsurerSurveysView>[0]['state'], cat = en, items = STAGE_ROWS,
  stage: Parameters<typeof InsurerSurveysView>[0]['stage'] = 'survey_scheduled', nextCursor: string | null = 'Y3Vyc29y', counts = COUNTS_3B) =>
  renderToStaticMarkup(<InsurerSurveysView t={tr(cat)} lang="en" state={state} items={items} counts={counts} stage={stage} nextCursor={nextCursor} computedAt="2026-10-28T06:30:00.000Z" />);

describe('PC-56 PARTNER-3b · W258 the surveys page (render)', () => {
  const html = render(listState(STAGE_ROWS, null)); const w = text(html);
  it('the founder\'s surveys statement, verbatim and pinned to its key', () => {
    expect(html).toContain('data-kv-insurer="surveys"'); expect(html).toContain('data-kv-state="ok"');
    expect(html).toContain('data-kv-statement="partner3.surveys.statement"');
    expect(w).toContain('Surveys are scheduled and recorded by the organisation that serves the farmer, not from this console. Shown here are the claims on your products by survey status, as recorded.');
  });
  it('FOUR tabs in stage order, each with its COUNT OF CLAIMS; `survey_scheduled` is the default and is current (M3 kills here)', () => {
    expect([...html.matchAll(/data-kv-stage-tab="([^"]+)"/g)].map((m) => m[1])).toEqual(['survey_scheduled', 'intimated', 'docs_pending', 'surveyed']);
    expect(html).toContain('data-kv-stage="survey_scheduled"');
    expect(html).toMatch(/aria-current="page"[^>]*data-kv-stage-tab="survey_scheduled"/);
    expect(w).toContain('Survey scheduled 1'); expect(w).toContain('Intimated 2'); expect(w).toContain('Documents pending 3'); expect(w).toContain('Surveyed 4');
    expect(w).toContain('Financial year 2026-27 (April to March, India time)');
    expect(w).toContain('counts of CLAIMS');
    expect(html).toContain('data-kv-asof="2026-10-20T06:30:00.000Z"');   // the counts' own as-of
    expect(surveyStage({ status: 'approved' })).toBe('survey_scheduled');
    for (const s of ['survey_scheduled', 'intimated', 'docs_pending', 'surveyed']) expect([s, html.includes(`href="/insurer/surveys?status=${s}"`)]).toEqual([s, true]);
    expect(html).not.toMatch(/data-kv-stage-tab="(approved|rejected|paid|closed|partially_approved)"/);
  });
  it('the rows are 3a\'s claim facts, each linking to that claim\'s survey report — no name, phone, place, surveyor, note or media anywhere', () => {
    expect([...html.matchAll(/data-kv-claim="([^"]+)"/g)].map((m) => m[1])).toEqual(STAGE_ROWS.map((c) => c.id));
    for (const c of STAGE_ROWS) expect([c.id, html.includes(`href="/insurer/surveys/${c.id}/report"`)]).toEqual([c.id, true]);
    expect(w).toContain('12 days'); expect(w).toContain('3 days');
    expect(w).toContain('₹1,10,000.00'); expect(w).toContain('₹9,00,71,99,25,47,409.93');
    expect(html).toContain('data-kv-reported="false"'); expect(html).toContain('data-kv-reported="true"');
    for (const h of ['Waiting', 'Claim reference', 'Event', 'Covers', 'Sum insured', 'Reported within 72 hours', 'Status']) expect(w).toContain(h);
    expect(text(withoutRefusals(html))).not.toMatch(FALSE_3A); expect(text(withoutRefusals(html))).not.toMatch(FALSE_3B);
    expect(html).not.toMatch(IDENTITY_FIELDS);
    expect(html).not.toMatch(MEDIA_FILES); expect(mediaCount(text(withoutRefusals(html)))).toEqual([]);
    expect(percents(w)).toBe(0);
    for (const k of partner3RefusalKeys('surveys')) expect([k, w.includes(en[k])]).toEqual([k, true]);
  });
  it('"Confirm this week\'s visits" is DECOR → the W3014 chain; "View claims" real; the keyset link keeps the stage; no <form>, no <button>', () => {
    expect(html).toContain('href="/insurer/surveys?act=confirm"'); expect(html).toContain('data-kv-decor="confirm-visits"');
    expect(w).toContain('Confirm this week\'s visits'); expect(w).not.toMatch(/cluster/i);
    expect(html).toContain('href="/insurer/claims"'); expect(html).toContain('data-kv-real="claims"');
    expect(html).toContain('href="/insurer/surveys?status=survey_scheduled&amp;cursor=Y3Vyc29y"'); expect(html).toContain('data-kv-next="true"');
    expect(render('ok', en, STAGE_ROWS, 'surveyed')).toContain('href="/insurer/surveys?status=surveyed&amp;cursor=Y3Vyc29y"');
    expect(render('ok', en, STAGE_ROWS, 'surveyed', null)).not.toContain('data-kv-next');
    expect(html).not.toContain('<form'); expect(html).not.toContain('<button');
    expect([...html.matchAll(/data-kv-subnav-item="/g)].length).toBe(6);
    expect(html).toMatch(/aria-current="page"[^>]*data-kv-subnav-item="\/insurer\/surveys"/);
  });
  it('empty per tab: no claim has this survey status (the tab\'s own word); error: nothing is broken + the re-read; OFF; the kind rule', () => {
    const e = render('empty', en, [], 'docs_pending');
    expect(e).toContain('data-kv-state="empty"'); expect(text(e)).toContain('No claim has this survey status');
    expect(text(e)).toContain('No claim on your products is Documents pending now.');
    expect(e).not.toContain('<table');
    const x = render(listState(null, insurerFailureOf(500, 'INTERNAL', 'on')), en, []);
    expect(x).toContain('data-kv-state="error"'); expect(text(x)).toContain('Nothing is broken on the platform\'s side');
    expect(x).toContain('data-kv-retry="true"'); expect(x).not.toContain('data-kv-next');
    expect(render(listState(null, insurerFailureOf(404, 'NOT_FOUND', 'off')))).toContain('data-kv-state="off"');
    expect(render(listState(null, insurerFailureOf(404, 'PARTNER_INSURANCE_SWITCHED_OFF', 'unknown')))).toContain('data-kv-state="insurance_off"');
    for (const cat of [hi, gu]) expect(text(render('ok', cat))).toContain(cat['partner3.surveys.statement']);
    expect([wrongConsole('bank', 'insurer'), wrongConsole('insurer', 'insurer')]).toEqual([true, false]);
  });
});
