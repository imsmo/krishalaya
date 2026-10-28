// apps/web-partner/src/test-render/lender-kcc.render.test.tsx · PC-56 PARTNER-4c · W216 (canon `lender/kcc/[id]`) — AN HONEST PAGE: there is
// no KCC account on this platform (founder 4c-2 / 4c-3). The load-bearing assertions are the statement itself, in all three languages and in
// every state; the loan's own facts beside it (the 4c-2 read, through PARTNER-4a's audited `partner_loan`); the ABSENCE of a ceiling, an
// unused remainder, a yearly re-opening, a share of a ceiling, an interest engine and a subsidy; "Record a yearly review" as DECOR into the
// form chain; the real link to the drawl ledger; and the not-found shape that never says "not yours".
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderKccView } from '../components/partner4/LenderKccView';
import { partner4RefusalKeys } from '../features/partner4/refusals';
import { kccDrawlsHref, kccHref, loanHref } from '../features/partner4/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { IDENTITY_4A, percents, withoutRefusals } from './partner4a-fixtures';
import { FALSE_4C, KCC_LOAN, KCC_LOAN_BARE, LEDGER_FIELDS } from './partner4c-fixtures';

const ID = KCC_LOAN.id;
const r = (over: Partial<Parameters<typeof LenderKccView>[0]> = {}, cat: Record<string, string> = en) =>
  renderToStaticMarkup(<LenderKccView t={tr(cat)} lang="en" loanId={ID} l={KCC_LOAN} failure={null} notFound={false} computedAt={KCC_LOAN.computedAt} {...over} />);

describe('PC-56 PARTNER-4c · W216 the KCC page (render)', () => {
  it('THE STATEMENT — there is no KCC account on this platform — in all three languages, and in EVERY state the page has', () => {
    for (const cat of [en, hi, gu]) {
      for (const over of [{}, { l: null, failure: 'error' as const, computedAt: null }, { l: null, notFound: true, computedAt: null }]) {
        const html = r(over, cat);
        expect(html).toContain('data-kv-statement="noAccount"');
        expect(html).toContain('data-kv-statement="partner4.kcc.statement"');
        expect(text(html)).toContain(cat['partner4.kcc.statement']);
        expect(text(html)).toContain(cat['partner4.kcc.notSetHere']);
        // the canon's ONE true sentence, kept on both KCC pages
        expect(text(html)).toContain(cat['partner4.kcc.zeroTruth']);
      }
    }
    expect(en['partner4.kcc.statement']).toMatch(/^There is no KCC account on this platform\./);
    expect(en['partner4.kcc.zeroTruth']).toMatch(/no drawl, no interest, no cost/);
  });
  it('THE LOAN\'S OWN FACTS, from 4a\'s audited read (founder 4c-2) — and not one figure of an account that does not exist', () => {
    const html = r(); const w = text(html);
    expect(html).toContain('data-kv-kcc-facts="true"');
    for (const f of ['loan', 'product', 'kind', 'fpo', 'principal', 'apr', 'outstanding', 'disbursed']) {
      expect([f, html.includes(`data-kv-fact="${f}"`)]).toEqual([f, true]);
    }
    expect(w).toContain('Fixture seasonal credit line');
    expect(w).toContain('700 bps');                       // the rate as the lender's own INTEGER basis points, never a percentage
    expect(percents(w)).toBe(0);
    expect(w).toContain(en['partner4.kcc.factsNote']);
    expect(w).toContain(en['partner4.kcc.kindNote']);
    expect(html).toContain(`data-kv-asof="${KCC_LOAN.computedAt}"`);
    // an unresolvable product and kind print the truth rather than a guess
    const bare = text(r({ l: KCC_LOAN_BARE, computedAt: KCC_LOAN_BARE.computedAt }));
    expect(bare).toContain(en['partner4.kind.notRecorded']);
    // NOT ONE field of the drawl ledger is named in the markup
    expect(LEDGER_FIELDS.test(html)).toBe(false);
    expect(IDENTITY_4A.test(html)).toBe(false);
    for (const cat of [en, hi, gu]) expect(FALSE_4C.test(text(withoutRefusals(r({}, cat))))).toBe(false);
  });
  it('the account, the ceiling, the unused remainder, the yearly re-opening, the crop-finance sheet, the yearly review and the engines are refused BY NAME (sixteen of them)', () => {
    const html = r(); const w = text(html);
    const keys = partner4RefusalKeys('kcc');
    expect(keys.length).toBeGreaterThanOrEqual(16);
    for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const id of ['kcc_account_entity', 'credit_limit', 'available_headroom', 'renewal_concept', 'scale_of_finance', 'seasonal_drawls',
      'interest_engine', 'subvention_credited', 'utilisation_ratio', 'limit_review_block', 'limit_change_notice', 'limit_review_act',
      'kcc_accounts_opened', 'drawn_balance', 'borrower_ledger_mirror', 'no_limit_reviews_state', 'borrower_identity', 'platform_roles']) {
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    }
  });
  it('"Record a yearly review" is DECOR into the FORM chain; the drawl ledger is a REAL link; the loan is a real link; and the sub-navigation\'s KCC row is drawn against THIS loan', () => {
    const html = r();
    expect(html).toContain('data-kv-decor="limitReview"');
    expect(html).toContain(`href="${kccHref(ID)}?form=review"`);
    expect(html).toContain('data-kv-real="drawls"');
    expect(html).toContain(`href="${kccDrawlsHref(ID)}"`);
    expect(html).toContain(`data-kv-back="${loanHref(ID)}"`);
    expect(html).toContain('data-kv-subnav="lending"');
    expect(html).toMatch(/aria-current="page"[^>]*data-kv-subnav-item="\/lender\/kcc\/\[id\]"/);
    expect(html).toContain(`href="${kccHref(ID)}"`);
    expect(html).not.toContain('href="/lender/kcc/[id]"');     // the row is resolved against the loan, never left a pattern
    // no form, and no control that writes anything
    expect(html).not.toMatch(/<input|<select|<label|<form|<button/);
  });
  it('an unknown id and another lender\'s loan answer the SAME not-found shape — never a refusal to see, never "not yours"', () => {
    const nf = r({ l: null, notFound: true, computedAt: null });
    expect(nf).toContain('data-kv-state="not_found"');
    expect(text(nf)).toContain(en['partner4.kcc.notFound.title']);
    expect(text(nf)).toContain(en['partner4.kcc.notFound.body']);
    expect(text(nf)).not.toMatch(/not yours|forbidden|403/i);
    expect(nf).not.toContain('data-kv-kcc-facts');
  });
  it('a failed read keeps the statement, and ITS RETRY IS THIS PAGE — never the mutate chain (the DELTA kcc_mutate_no_trigger)', () => {
    const err = r({ l: null, failure: 'error', computedAt: null });
    expect(err).toContain('data-kv-state="error"');
    expect(err).toContain('role="alert"');
    expect(text(err)).toContain(en['partner4.kcc.error.body']);
    expect(err).toContain(`data-kv-retry="${kccHref(ID)}"`);
    expect(err).not.toContain('?act=');
    expect(text(err)).toContain(en['partner4.kcc.statement']);
  });
  it('OFF reads as OFF, with no outage wording and no claim that lending is switched off', () => {
    const off = r({ failure: 'off' });
    expect(off).toContain('data-kv-state="off"');
    expect(text(off)).toContain(en['partner.off.body']);
    expect(text(off)).not.toMatch(/unavailable|lending is (switched )?off/i);
  });
});
