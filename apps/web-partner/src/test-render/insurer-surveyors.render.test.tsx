// apps/web-partner/src/test-render/insurer-surveyors.render.test.tsx · PC-56 PARTNER-3b · W257 SURVEYOR NETWORK — AN HONEST PAGE (founder Q5):
// the statement VERBATIM; NO read, NO count, NO row, NO person, NO phone — a surveyor is not an entity on the platform; "Add a surveyor"
// (the canon's "Empanel surveyor" ×3) and "Retry" DECOR → the W2904 chain; "View claims" real; OFF and kind states. The page has no error state
// because it has no read to fail: an unreadable flag map prints exactly the same true page.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerSurveyorsView } from '../components/partner3/InsurerSurveyorsView';
import { wrongConsole } from '../features/partner2/figures';
import { partner3RefusalKeys } from '../features/partner3/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { FALSE_3A, percents, withoutRefusals } from './partner3a-fixtures';
import { FALSE_3B, MEDIA_FILES } from './partner3b-fixtures';

const render = (state: Parameters<typeof InsurerSurveyorsView>[0]['state'], cat = en) => renderToStaticMarkup(<InsurerSurveyorsView t={tr(cat)} state={state} />);

describe('PC-56 PARTNER-3b · W257 the surveyors page (render)', () => {
  const html = render('ok'); const w = text(html);
  it('the founder\'s surveyors statement, verbatim and pinned to its key', () => {
    expect(html).toContain('data-kv-insurer="surveyors"'); expect(html).toContain('data-kv-state="ok"');
    expect(html).toContain('data-kv-statement="partner3.surveyors.statement"');
    expect(w).toContain('There is no surveyor roster on the platform and this console manages nobody\'s staff. Surveys are arranged by the organisation that serves the farmer.');
  });
  it('NO row, NO count, NO person, NO phone, NO money, NO percentage — there is nothing on the platform to count', () => {
    expect(html).not.toContain('<table'); expect(html).not.toContain('<dl'); expect(html).not.toMatch(/data-kv-count|data-kv-counts|data-kv-row/);
    expect(w).not.toMatch(/\d/);                                    // not one digit anywhere on the page
    expect(percents(w)).toBe(0); expect(w).not.toMatch(MONEY);
    expect(text(withoutRefusals(html))).not.toMatch(FALSE_3A); expect(text(withoutRefusals(html))).not.toMatch(FALSE_3B);
    expect(html).not.toMatch(MEDIA_FILES);
    expect(w).toContain('There is nothing to count on this page');
    for (const k of partner3RefusalKeys('surveyors')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(w).toContain(en['partner3.refusal.surveyorJoin']); expect(w).toContain(en['partner3.refusal.surveyorPay']);
  });
  it('"Add a surveyor" and "Retry" are DECOR → the W2904 chain; "View claims" and "View surveys" are real; no <form>, no <button>', () => {
    expect([...html.matchAll(/href="\/insurer\/surveyors\?act=confirm"/g)].length).toBe(2);
    expect(html).toContain('data-kv-decor="empanel"'); expect(html).toContain('data-kv-decor="retry"');
    expect(w).toContain('Add a surveyor'); expect(w).not.toMatch(/empanel/i);
    expect(html).toContain('href="/insurer/claims"'); expect(html).toContain('href="/insurer/surveys"');
    expect(html).not.toContain('<form'); expect(html).not.toContain('<button');
  });
  it('the sub-navigation: six live rows, Surveyors current', () => {
    expect([...html.matchAll(/data-kv-subnav-item="/g)].length).toBe(6);
    expect(html).toMatch(/aria-current="page"[^>]*data-kv-subnav-item="\/insurer\/surveyors"/);
  });
  it('switched off (both switches); an unreadable flag map prints the SAME true page, with no alert; hi and gu carry their own words; the kind rule', () => {
    expect(render('off')).toContain('data-kv-state="off"'); expect(text(render('off'))).toContain('Nothing is broken');
    expect(render('insurance_off')).toContain('data-kv-state="insurance_off"');
    const x = render('error');
    expect(x).toContain('data-kv-state="error"'); expect(x).not.toContain('role="alert"');
    expect(text(x)).toContain(en['partner3.surveyors.statement']);
    expect(text(x)).toBe(w);                                        // the only difference is the data-kv-state attribute
    expect(x.replace('data-kv-state="error"', 'data-kv-state="ok"')).toBe(html);
    for (const cat of [hi, gu]) expect(text(render('ok', cat))).toContain(cat['partner3.surveyors.statement']);
    expect([wrongConsole('bank', 'insurer'), wrongConsole('amc', 'insurer'), wrongConsole('insurer', 'insurer')]).toEqual([true, true, false]);
  });
});
