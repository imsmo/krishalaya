// apps/web-partner/src/test-render/lender-loan.render.test.tsx · PC-56 PARTNER-4a · W215 ONE LOAN (canon `lender/portfolio/[id]`) — the
// loan's own facts, the RECORDED repayment history, and the three sentences this page exists to print: "no maturity date recorded · no next
// due date recorded", "no charge is made for closing this loan early", and the servicing-consent sentence that 0231's narrowing finally made
// TRUE. The borrower, her dairy income, her animals, the money-record anchors, the charge, the term and every "punctual" are refused by name.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderLoanView } from '../components/partner4/LenderLoanView';
import { partner4RefusalKeys } from '../features/partner4/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { FALSE_4A, IDENTITY_4A, LOAN, REPAYMENTS, percents, withoutRefusals } from './partner4a-fixtures';

type Props = Parameters<typeof LenderLoanView>[0];
const r = (over: Partial<Props> = {}) => renderToStaticMarkup(
  <LenderLoanView t={tr(en)} lang="en" l={LOAN} repayments={REPAYMENTS} failure={null} notFound={false} computedAt="2026-10-28T06:30:00.000Z" {...over} />);

describe('PC-56 PARTNER-4a · W215 one loan (render)', () => {
  it('the loan\'s facts are printed, the rate as an INTEGER in basis points, and no identity field or percentage reaches the markup', () => {
    const html = r(); const w = text(html);
    expect(html).toContain('data-kv-lender="loan"');
    expect(w).toContain('0192d2c4…');
    for (const id of ['application', 'product', 'kind', 'fpo', 'principal', 'apr', 'outstanding', 'disbursed', 'maturity', 'nextDue']) {
      expect([id, html.includes(`data-kv-fact="${id}"`)]).toEqual([id, true]);
    }
    expect(w).toContain('1050 bps APR');                   // the stamped rate, as the integer it is
    expect(w).not.toMatch(/10\.5|10,5/);                   // never the float the canon printed
    expect(percents(w)).toBe(0);
    expect(html).not.toMatch(IDENTITY_4A);
    expect(w).toContain('Fixture Dairy Collective');       // the cooperative's PUBLIC name
    expect(w).toContain('₹1,38,410.00');
  });
  it('"no maturity date recorded · no next due date recorded" — the truth, not a dash and not a term computed from a product\'s range', () => {
    const w = text(r());
    expect(w).toContain(en['partner4.loan.noMaturity']);
    expect(w).toContain(en['partner4.loan.noNextDue']);
    expect(w).not.toMatch(/36 months|Feb 2029/);
    // a loan that DID carry the dates would print them — the sentence is conditional, not hard-coded
    const withDates = text(r({ l: { ...LOAN, maturityDate: '2029-02-09', nextDueDate: '2026-07-17' } }));
    expect(withDates).toContain('2029-02-09'); expect(withDates).toContain('2026-07-17');
    expect(withDates).not.toContain(en['partner4.loan.noMaturity']);
  });
  it('"no charge is made for closing this loan early" is printed as the TRUE sentence it is', () => {
    const html = r();
    expect(html).toContain('data-kv-statement="partner4.loan.noForeclosureFee"');
    expect(text(html)).toContain(en['partner4.loan.noForeclosureFee']);
  });
  it('the servicing-consent block is kept, and 0231\'s narrowing is what makes its second half true', () => {
    const html = r(); const w = text(html);
    expect(html).toContain('data-kv-consent="servicing"');
    expect(html).toContain('data-kv-statement="partner4.loan.servicingConsent"');
    expect(w).toContain(en['partner4.loan.servicingConsent']);
    expect(w).toContain(en['partner4.loan.servicingSeen']);
    expect(w).toContain(en['partner4.loan.servicingUnseen']);
  });
  it('the repayment history is RECORDED rows only, newest first, with no "punctual" column and no channel', () => {
    const html = r(); const w = text(html);
    expect(html).toContain('data-kv-repayments="true"');
    for (const rr of REPAYMENTS) expect(html).toContain(`data-kv-repayment="${rr.id}"`);
    expect(html.indexOf(REPAYMENTS[0].id)).toBeLessThan(html.indexOf(REPAYMENTS[1].id));   // newest due date first
    expect(w).toContain(en['partner4.loan.historyNote']);
    const headers = (html.match(/<th scope="col">/g) ?? []).length;
    expect(headers).toBe(4);                              // recorded due · amount due · amount paid · paid — and nothing else
    // the word appears ONLY inside the refusals (one of them says "no calling channel") — the page itself has no such column
    const bare = text(withoutRefusals(html));
    expect(bare).not.toMatch(/channel|milk_bill_deduction|harvest_settlement|cash_partner/i);
    expect(bare).not.toMatch(/\bon[- ]?time\b|punctual/i);
  });
  it('the empty history says repayments appear as they are received, and that the record is append-only', () => {
    const w = text(r({ repayments: [] }));
    expect(w).toContain(en['partner4.loan.noRepayments.title']);
    expect(w).toContain(en['partner4.loan.noRepayments.body']);
  });
  it('the statement button is DECOR into the loan EXPORT chain — on THIS loan, not on the queue the canon\'s crumb names', () => {
    const html = r();
    expect(html).toContain('data-kv-decor="statement"');
    expect(html).toContain(`href="/lender/portfolio/${LOAN.id}?export=queued"`);
    expect(html).toContain('data-kv-real="portfolio"');
    expect(html).toContain('data-kv-real="application"');     // the loan links back to its own application
    expect(html).toContain(`href="/lender/queue/${LOAN.applicationId}"`);
    expect(html).not.toContain('<form');
  });
  it('every refusal of the surface is printed BY NAME in all three languages, and nothing the canon claimed survives outside the list', () => {
    for (const cat of [en, hi, gu]) {
      const html = renderToStaticMarkup(
        <LenderLoanView t={tr(cat)} lang="en" l={LOAN} repayments={REPAYMENTS} failure={null} notFound={false} computedAt={null} />);
      const w = text(html);
      for (const k of partner4RefusalKeys('loan')) expect([k, w.includes(cat[k])]).toEqual([k, true]);
      if (cat === en) expect(text(withoutRefusals(html))).not.toMatch(FALSE_4A);
    }
  });
  it('the states: not found (which never says whose it is), error (servicing continues), the console switched off — and no 7-year promise', () => {
    const nf = r({ l: null, notFound: true });
    expect(nf).toContain('data-kv-state="not_found"');
    expect(text(nf)).toContain(en['partner4.loan.notFound.body']);
    expect(text(nf)).not.toMatch(/not yours|another lender|7 years|seven years/i);
    const err = r({ l: null, failure: 'error' });
    expect(err).toContain('role="alert"');
    expect(text(err)).toContain(en['partner4.loan.error.body']);
    const off = r({ l: null, failure: 'off' });
    expect(off).toContain('data-kv-state="off"');
    expect(text(off)).not.toMatch(/unavailable/i);
  });
});
