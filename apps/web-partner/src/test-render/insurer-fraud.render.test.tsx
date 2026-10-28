// apps/web-partner/src/test-render/insurer-fraud.render.test.tsx · PC-56 PARTNER-3b · W263 FRAUD FLAGS — AN HONEST PAGE, REFUSED BY NAME
// (founder Q6): the statement VERBATIM; NO flag row, NO signal, NO score, NO rate, NO risk desk, NO police referral, NO count, NO read;
// "Retry" DECOR → the W2934 chain; "View claims" real. M4 (the canon's "Suspicious claim patterns are flagged automatically for review"
// planted in the statement) is killed by the claims guard; this file pins the statement on the page.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerFraudView } from '../components/partner3/InsurerFraudView';
import { wrongConsole } from '../features/partner2/figures';
import { partner3RefusalKeys } from '../features/partner3/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { FALSE_3A, percents, withoutRefusals } from './partner3a-fixtures';
import { FALSE_3B } from './partner3b-fixtures';

const render = (state: Parameters<typeof InsurerFraudView>[0]['state'], cat = en) => renderToStaticMarkup(<InsurerFraudView t={tr(cat)} state={state} />);

describe('PC-56 PARTNER-3b · W263 the fraud flags page (render)', () => {
  const html = render('ok'); const w = text(html);
  it('the founder\'s fraud statement, verbatim and pinned to its key', () => {
    expect(html).toContain('data-kv-insurer="fraud"'); expect(html).toContain('data-kv-state="ok"');
    expect(html).toContain('data-kv-statement="partner3.fraud.statement"');
    expect(w).toContain('There are no fraud flags on the platform and none is raised from this console.');
  });
  it('NO flag row, rate, score, signal, risk desk, police referral or count — and not one digit on the page', () => {
    expect(html).not.toContain('<table'); expect(html).not.toMatch(/data-kv-count|data-kv-row|data-kv-flag/);
    expect(w).not.toMatch(/\d/); expect(percents(w)).toBe(0); expect(w).not.toMatch(MONEY);
    expect(text(withoutRefusals(html))).not.toMatch(FALSE_3A); expect(text(withoutRefusals(html))).not.toMatch(FALSE_3B);
    expect(w).not.toMatch(/flagged automatically|risk desk|\bFIR\b|flag rate|false-?flag|\bserial\b|marketplace activity is ever/i);
    expect(w).toContain('There is nothing to count and nothing to list on this page');
    for (const k of partner3RefusalKeys('fraud')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(w).toContain(en['partner3.refusal.crossSignal']); expect(w).toContain(en['partner3.refusal.hiddenRecords']);
  });
  it('"Retry" is DECOR → the W2934 chain; "View claims" is real; no <form>, no <button>; the sub-navigation marks Fraud', () => {
    expect(html).toContain('href="/insurer/claims/fraud?act=confirm"'); expect(html).toContain('data-kv-decor="retry"');
    expect(html).toContain('href="/insurer/claims"'); expect(html).toContain('data-kv-real="claims"');
    expect(html).not.toContain('<form'); expect(html).not.toContain('<button');
    expect([...html.matchAll(/data-kv-subnav-item="/g)].length).toBe(6);
    expect(html).toMatch(/aria-current="page"[^>]*data-kv-subnav-item="\/insurer\/claims\/fraud"/);
  });
  it('switched off (both switches); an unreadable flag map prints the SAME true page; hi and gu carry their own words; the kind rule', () => {
    expect(render('off')).toContain('data-kv-state="off"'); expect(text(render('off'))).toContain('Nothing is broken');
    expect(render('insurance_off')).toContain('data-kv-state="insurance_off"');
    expect(render('error').replace('data-kv-state="error"', 'data-kv-state="ok"')).toBe(html);
    expect(render('error')).not.toContain('role="alert"');
    for (const cat of [hi, gu]) expect(text(render('ok', cat))).toContain(cat['partner3.fraud.statement']);
    expect([wrongConsole('bank', 'insurer'), wrongConsole('insurer', 'insurer')]).toEqual([true, false]);
  });
});
