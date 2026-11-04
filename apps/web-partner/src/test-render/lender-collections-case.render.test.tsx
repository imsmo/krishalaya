// apps/web-partner/src/test-render/lender-collections-case.render.test.tsx · PC-56 PARTNER-5b · W220 (canon `lender/collections/[id]`) — AN
// HONEST PAGE THAT READS NOTHING (founder 5b-1 / 5b-3, door Q5). The load-bearing assertions: the statement VERBATIM; NO input, select,
// textarea, label-for or form in the DOM (the canon's two real inputs are never rendered — M2 kills here); every id — a loan, a foreign one,
// an unknown one, a malformed one, a hostile one — prints the SAME page (no not-found, no existence oracle) and the id is never printed as
// text; "Log contact" / "Record promise" DECOR into the form chain; "Propose restructure" a real link; the code-of-conduct refusals and the
// absence line present; no digit beside an arrears, case, contact or promise word; no error state.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderCollectionsCaseView } from '../components/partner5/LenderCollectionsCaseView';
import { partner5RefusalKeys } from '../features/partner5/refusals';
import { collectionsCaseHref, restructureHref } from '../features/partner5/figures';
import { loanHref } from '../features/partner4/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { IDENTITY_4A, percents, withoutRefusals } from './partner4a-fixtures';
import { FALSE_5B, FORM_CONTROL, IDS, figuresBesideArrearsWords } from './partner5b-fixtures';

const r = (state: 'ok' | 'off' | 'error' = 'ok', cat: Record<string, string> = en, id: string = IDS.loan) =>
  renderToStaticMarkup(<LenderCollectionsCaseView t={tr(cat)} state={state} loanId={id} />);
/** The page with every id-bearing attribute normalised — what must be IDENTICAL for every id. */
const shape = (html: string, id: string) => html.split(encodeURIComponent(id)).join('<ID>');

describe('PC-56 PARTNER-5b · W220 the collections "case" page (render)', () => {
  it('THE FOUNDER\'S STATEMENT (5b-3) VERBATIM — there is no collections case on this platform — in all three languages', () => {
    expect(en['partner5.case.statement']).toBe("There is no collections case on this platform. Nothing about a borrower is shown or looked up here — no name, phone, reason, contact, promise or meeting. This loan's own facts are on its loan page.");
    for (const cat of [en, hi, gu]) {
      const html = r('ok', cat);
      expect(html).toContain('data-kv-statement="partner5.case.statement"');
      expect(text(html)).toContain(cat['partner5.case.statement']);
      expect(text(html)).toContain(cat['partner5.case.noRelay']);
      expect(text(html)).toContain(cat['partner5.collections.noSellingBlock']);
    }
  });
  it('NO FORM CONTROL IN THE DOM — no input, select, textarea, label, label-for, button or form, in any language or state', () => {
    for (const cat of [en, hi, gu]) for (const state of ['ok', 'error', 'off'] as const) {
      const html = r(state, cat);
      expect([state, FORM_CONTROL.test(html)]).toEqual([state, false]);
      expect([state, /placeholder=|type="(text|number|date)"|name="/.test(html)]).toEqual([state, false]);
    }
  });
  it('EVERY ID PRINTS THE SAME PAGE: a loan, a foreign loan, an unknown id, a malformed id and a hostile one — no not-found, and the id is never printed as text', () => {
    const base = shape(r('ok', en, IDS.loan), IDS.loan);
    for (const id of Object.values(IDS)) {
      const html = r('ok', en, id);
      expect([id, shape(html, id)]).toEqual([id, base]);
      expect([id, text(html).includes(id)]).toEqual([id, false]);
      expect([id, /not found|does not exist|not yours|no such loan/i.test(text(html))]).toEqual([id, false]);
      expect(html).not.toContain('<script>');
    }
    // the id is used ONLY, encoded, in links: the loan's page, the restructure page, and this page's own chain states
    const hrefs = [...r().matchAll(/href="([^"]*)"/g)].map(([, h]) => h);
    expect(hrefs).toEqual(expect.arrayContaining([loanHref(IDS.loan), restructureHref(IDS.loan), `${collectionsCaseHref(IDS.loan)}?form=review`, '/lender/collections']));
    expect(hrefs.filter((h) => h.includes('['))).toEqual([]);
  });
  it('NOT ONE FIGURE: no digit beside an arrears, case, contact or promise word, no money, no percentage, in any language', () => {
    for (const cat of [en, hi, gu]) for (const state of ['ok', 'error'] as const) {
      const w = text(r(state, cat));
      expect([state, figuresBesideArrearsWords(w)]).toEqual([state, []]);
      expect([state, /[\d०-९૦-૯]/.test(text(withoutRefusals(r(state, cat))))]).toEqual([state, false]);
      expect([state, MONEY.test(w)]).toEqual([state, false]);
      expect([state, percents(w)]).toEqual([state, 0]);
    }
    expect(r()).not.toContain('<table');
    // the refusal list NAMES what it refuses (its markers carry words like `case_narrative`), so the identity scan runs over the page without it
    expect(IDENTITY_4A.test(withoutRefusals(r()))).toBe(false);
    for (const cat of [en, hi, gu]) expect(FALSE_5B.test(text(withoutRefusals(r('ok', cat))))).toBe(false);
  });
  it('"Log contact" and "Record promise" are DECOR into the form chain with NO mailbox; "Propose restructure" and "View this loan" are REAL links', () => {
    const html = r();
    expect(html).toContain('data-kv-decor="logContact"');
    expect(html).toContain('data-kv-decor="recordPromise"');
    expect([...html.matchAll(/href="([^"]*\?form=review)"/g)].length).toBe(2);
    expect(html).toContain(`data-kv-real="restructure"`); expect(html).toContain(`href="${restructureHref(IDS.loan)}"`);
    expect(html).toContain(`data-kv-real="loan"`); expect(html).toContain(`href="${loanHref(IDS.loan)}"`);
    expect(html).toContain('data-kv-back="/lender/collections"');
    expect(html).not.toMatch(/mailbox|partners@/i);
    expect(html).not.toContain('data-kv-export-note');
    expect(html).not.toContain('aria-current="page"');      // the case page is not a sub-navigation row
  });
  it('every W220 refusal is printed BY NAME, with PARTNER-4b\'s code of conduct BY KEY', () => {
    const html = r(); const w = text(html);
    const keys = partner5RefusalKeys('collections_case');
    expect(keys.length).toBeGreaterThanOrEqual(15);
    for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const id of ['case_identity', 'case_entity', 'case_narrative', 'reconsent_recording', 'contact_entries', 'mediation_meeting', 'promise_form',
      'log_contact', 'promise_ladder', 'off_the_table', 'case_archive', 'contact_log_safe', 'every_open_logged', 'code_of_conduct', 'contact_hours',
      'contact_log', 'mediation_first', 'collections_roles', 'plan_settings']) {
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    }
    expect(w).toContain(en['partner4.refusal.codeOfConduct']);
  });
  it('NO ERROR STATE — an unreadable flag map still prints the honest page; OFF reads as OFF', () => {
    const err = r('error');
    expect(err).toContain('data-kv-state="error"');
    expect(err).not.toContain('role="alert"');
    expect(text(err)).toContain(en['partner5.case.statement']);
    expect(text(err)).not.toMatch(/could not be read|try again|retry/i);
    const off = r('off');
    expect(off).toContain('data-kv-state="off"');
    expect(text(off)).toContain(en['partner.off.body']);
    expect(text(off)).not.toMatch(/unavailable|lending is (switched )?off/i);
  });
  it('the page checks the two chain states FIRST (form, then act), each returning HERE, after the session and kind gates; it never imports a client', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'lender', 'collections', '[id]', 'page.tsx'), 'utf8');
    const body = src.slice(src.indexOf('export default async function'));
    const at = (s: string) => body.indexOf(s);
    expect(at('await requirePartner()')).toBeGreaterThan(0);
    expect(at('await lenderGate()')).toBeGreaterThan(at('await requirePartner()'));
    expect(at("chain5State('collections_form'")).toBeGreaterThan(at('await lenderGate()'));
    expect(at("chain5State('case_act'")).toBeGreaterThan(at("chain5State('collections_form'"));
    expect(at('await lenderSwitches()')).toBeGreaterThan(at("chain5State('case_act'"));
    expect((body.match(/back=\{collectionsCaseHref\(params\.id\)\}/g) ?? []).length).toBe(2);
    expect(/api-client|sdk-js|partnersMailbox/.test(src)).toBe(false);
  });
});
