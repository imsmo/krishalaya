// apps/web-partner/src/test-render/lender-restructure.render.test.tsx · PC-56 PARTNER-5b · W221 (canon `lender/collections/[id]/restructure`)
// — AN HONEST PAGE THAT READS NOTHING (founder 5b-1 / 5b-4, door Q4). The load-bearing assertions: the statement VERBATIM; NOTHING of any
// proposal (no term, no figure, no proposal field named in the markup); the stale backend banner never printed; "restructure ≠ default" kept;
// "Take to mediation" DECOR into W2999–W3001 and never the canon's acceptance order; the loan page and the case page as real links; every
// id the same page; no form control; no error state.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderRestructureView } from '../components/partner5/LenderRestructureView';
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
  renderToStaticMarkup(<LenderRestructureView t={tr(cat)} state={state} loanId={id} />);
const PROPOSAL_FIELDS = /instalment|tenor|rate_?apr|holiday|interest_delta|interestDelta|case_?ref|proposed_?by|checker_?id|accepted_?at|mediation_?at|evidence|otp|cooling|comparison_pdf|reasonCode|reason_code/i;

describe('PC-56 PARTNER-5b · W221 the restructure page (render)', () => {
  it('THE FOUNDER\'S STATEMENT (5b-4) VERBATIM — a restructure is the organisation\'s, not this console\'s — in all three languages; the doctrine kept', () => {
    expect(en['partner5.restructure.statement']).toBe("A restructure is proposed and decided by the organisation that serves the farmer, not from this console. The lender is not a party to it on this platform, and nothing of any proposal is shown here. A restructure cannot yet be accepted or activated on the platform. The loan's status appears on its own page.");
    for (const cat of [en, hi, gu]) {
      const html = r('ok', cat);
      expect(html).toContain('data-kv-statement="partner5.restructure.statement"');
      expect(text(html)).toContain(cat['partner5.restructure.statement']);
      expect(text(html)).toContain(cat['partner5.restructure.doctrine']);
    }
    expect(en['partner5.restructure.doctrine']).toBe('A restructure is not a default.');
  });
  it('NOTHING OF ANY PROPOSAL: no term, no figure, no money, no percentage, no proposal field named in the markup; the stale banner never printed', () => {
    for (const cat of [en, hi, gu]) for (const state of ['ok', 'error'] as const) {
      const html = r(state, cat); const w = text(html);
      expect([state, /[\d०-९૦-૯]/.test(text(withoutRefusals(html)))]).toEqual([state, false]);
      expect([state, figuresBesideArrearsWords(w)]).toEqual([state, []]);
      expect([state, MONEY.test(w)]).toEqual([state, false]);
      expect([state, percents(w)]).toEqual([state, 0]);
      expect([state, /DELTA-033|Backend pending|Design leads/i.test(w)]).toEqual([state, false]);
    }
    const html = r();
    expect(PROPOSAL_FIELDS.test(withoutRefusals(html).replace(/data-kv-refusal="[^"]*"/g, ''))).toBe(false);
    expect(IDENTITY_4A.test(html)).toBe(false);
    expect(html).not.toContain('<table');
    expect(FORM_CONTROL.test(html)).toBe(false);
    for (const cat of [en, hi, gu]) expect(FALSE_5B.test(text(withoutRefusals(r('ok', cat))))).toBe(false);
  });
  it('"Take to mediation" is DECOR into W2999–W3001; the loan page and the case page are REAL links; every id prints the same page', () => {
    const html = r();
    expect(html).toContain('data-kv-decor="mediation"');
    expect(html).toContain(`href="${restructureHref(IDS.loan)}?act=confirm"`);
    expect(html).toContain(`href="${loanHref(IDS.loan)}"`); expect(html).toContain('data-kv-real="loan"');
    expect(html).toContain(`href="${collectionsCaseHref(IDS.loan)}"`); expect(html).toContain('data-kv-real="case"');
    expect(html).toContain(`data-kv-back="${collectionsCaseHref(IDS.loan)}"`);
    expect(/after (the )?borrower accepts?/i.test(text(html))).toBe(false);
    const base = r('ok', en, IDS.loan).split(encodeURIComponent(IDS.loan)).join('<ID>');
    for (const id of Object.values(IDS)) {
      const h = r('ok', en, id);
      expect([id, h.split(encodeURIComponent(id)).join('<ID>')]).toEqual([id, base]);
      expect([id, text(h).includes(id)]).toEqual([id, false]);
    }
    expect([...html.matchAll(/href="([^"]*)"/g)].filter(([, h]) => h.includes('['))).toEqual([]);
  });
  it('every W221 refusal is printed BY NAME', () => {
    const html = r(); const w = text(html);
    const keys = partner5RefusalKeys('restructure');
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const id of ['stale_banner', 'terms_comparison', 'weather_clause', 'npa_discipline', 'acceptance_flow', 'comparison_forever', 'versioned_draft',
      'restructure_people', 'take_to_mediation', 'no_acceptance_state', 'starts_from_case', 'collections_roles', 'mediation_first', 'plan_settings']) {
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    }
  });
  it('NO ERROR STATE — an unreadable flag map still prints the honest page; OFF reads as OFF', () => {
    const err = r('error');
    expect(err).toContain('data-kv-state="error"');
    expect(err).not.toContain('role="alert"');
    expect(text(err)).toContain(en['partner5.restructure.statement']);
    expect(text(err)).not.toMatch(/could not be read|try again|retry/i);
    const off = r('off');
    expect(off).toContain('data-kv-state="off"');
    expect(text(off)).toContain(en['partner.off.body']);
    expect(text(off)).not.toMatch(/unavailable|lending is (switched )?off/i);
  });
  it('the page checks its chain state FIRST, returning HERE, after the session and kind gates; it never imports a client', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'lender', 'collections', '[id]', 'restructure', 'page.tsx'), 'utf8');
    const body = src.slice(src.indexOf('export default async function'));
    const at = (s: string) => body.indexOf(s);
    expect(at('await lenderGate()')).toBeGreaterThan(at('await requirePartner()'));
    expect(at("chain5State('restructure_act'")).toBeGreaterThan(at('await lenderGate()'));
    expect(at('await lenderSwitches()')).toBeGreaterThan(at("chain5State('restructure_act'"));
    expect(body).toContain('back={restructureHref(params.id)}');
    expect(/api-client|sdk-js|partnersMailbox/.test(src)).toBe(false);
  });
});
