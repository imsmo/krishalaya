// apps/web-partner/src/test-render/lender-consents.render.test.tsx · PC-56 PARTNER-6b · W213 (canon `lender/consents`) — AN HONEST PAGE THAT
// READS NOTHING AND SHOWS NO ONE (founder 6b-1, door Q3-A; 6b-2 / Q4-A for its words). The load-bearing assertions: the statement and the
// truth today VERBATIM in all three languages; NO person, phone, application reference, count or DIGIT; never "revocable" (or any of Q4-A's
// words); the real link to the loan queue; NO input and NO error state (an unreadable flag map still prints the honest page); OFF as OFF;
// Export is DECOR → the W2921–W2922 chain; every W213 refusal printed BY NAME.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderConsentsView } from '../components/partner6/LenderConsentsView';
import { partner6RefusalKeys } from '../features/partner6/refusals';
import type { LenderHonestState } from '../features/partner4/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { percents, withoutRefusals } from './partner4a-fixtures';
import { FALSE_6B_CONSENTS, FORM_CONTROL_6B } from './partner6b-fixtures';

const r = (state: LenderHonestState = 'ok', cat: Record<string, string> = en) => renderToStaticMarkup(<LenderConsentsView t={tr(cat)} state={state} />);
const STATEMENT = "A farmer's consent to show you a loan application is given for that one application. The platform checks it every time your organisation reads the application, and your access ends when the consent expires. You never see who consented, when, how or what the consent covers.";
const NONE_YET = 'No consent is recorded on the platform yet: the step that asks the farmer for it does not exist.';

describe('PC-56 PARTNER-6b · W213 the consents page (render)', () => {
  it('THE FOUNDER\'S STATEMENT AND THE TRUTH TODAY (6b-1) VERBATIM, in all three languages', () => {
    expect(en['partner6.consents.statement']).toBe(STATEMENT);
    expect(en['partner6.consents.noneYet']).toBe(NONE_YET);
    for (const cat of [en, hi, gu]) {
      const html = r('ok', cat); const w = text(html);
      expect(html).toContain('data-kv-statement="partner6.consents.statement"');
      expect(html).toContain('data-kv-statement="partner6.consents.noneYet"');
      expect(w).toContain(cat['partner6.consents.statement']);
      expect(w).toContain(cat['partner6.consents.noneYet']);
    }
    for (const k of ['partner6.consents.statement', 'partner6.consents.noneYet']) expect(new Set([en[k], hi[k], gu[k]]).size).toBe(3);
  });
  it('NO PERSON, PHONE, REFERENCE, COUNT OR DIGIT — no registry, no table, no list of anyone — in any state or language', () => {
    for (const cat of [en, hi, gu]) for (const state of ['ok', 'error'] as const) {
      const html = r(state, cat); const w = text(html);
      expect([state, /[\d०-९૦-૯]/.test(w)]).toEqual([state, false]);
      expect([state, percents(w), w.includes('₹')]).toEqual([state, 0, false]);
      expect([state, /<table|<tr|<td|<ol|data-kv-(row|count|borrower|phone|person|ref)/.test(withoutRefusals(html))]).toEqual([state, false]);
    }
    const visible = text(withoutRefusals(r()));
    expect(FALSE_6B_CONSENTS.test(visible)).toBe(false);
  });
  it('NEVER "revocable" (founder 6b-2 / Q4-A) — nor "time-boxed", "within 60 seconds", "logged on both sides" or "standing access" — anywhere, the refusals included', () => {
    for (const cat of [en, hi, gu]) expect(/revocab|time-?boxed|within \d+ seconds|both sides|standing access/i.test(text(r('ok', cat)))).toBe(false);
    // the strongest thing the page says about an end is that access ends when the consent expires
    expect(text(r())).toContain('your access ends when the consent expires');
  });
  it('the real link to the loan queue; Export is DECOR → ?export=queued; nothing else links out', () => {
    const html = r();
    expect(html).toContain('href="/lender/queue"'); expect(html).toContain('data-kv-real="queue"');
    expect(html).toContain('href="/lender/consents?export=queued"'); expect(html).toContain('data-kv-decor="export"');
    expect([...html.matchAll(/href="([^"]*)"/g)].map(([, h]) => h).sort()).toEqual(['/lender/consents?export=queued', '/lender/queue']);
    // no control leads to the mutate chain: the readless page has no error state and so no Retry
    expect(html).not.toContain('?act=');
  });
  it('NO INPUT AND NO ERROR STATE — an unreadable flag map still prints the honest page; OFF reads as OFF', () => {
    for (const cat of [en, hi, gu]) for (const state of ['ok', 'error', 'off'] as const) {
      const html = r(state, cat);
      expect([state, FORM_CONTROL_6B.test(html), /placeholder=|type="|name="/.test(html), html.includes('role="alert"')]).toEqual([state, false, false, false]);
    }
    expect(r('error')).toEqual(r('ok').replace('data-kv-state="ok"', 'data-kv-state="error"'));
    expect(text(r('error'))).not.toMatch(/could not be read|try again|retry|couldn/i);
    const off = r('off');
    expect(off).toContain('data-kv-state="off"');
    expect(text(off)).toContain(en['partner.off.body']);
    expect(text(off)).not.toContain(STATEMENT);
    expect(text(off)).not.toMatch(/see plan settings/i);
  });
  it('every W213 refusal is printed BY NAME, with the reused partner-roles, score and plan-settings refusals BY KEY', () => {
    const html = r(); const w = text(html);
    const keys = partner6RefusalKeys('consents');
    expect(keys.length).toBeGreaterThanOrEqual(15);
    for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const id of ['consent_adjectives', 'bank_holds', 'provably', 'consent_registry_rows', 'status_chips', 'standard_term', 'covers_score', 'revocation_seconds',
      'decision_record', 'compliance_file', 'will_appear', 'arrive_with_applications', 'consents_no_error', 'partner_roles_consents', 'audit_mirror', 'export_registry', 'plan_settings']) {
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    }
    for (const k of ['partner2.refusal.partnerRoles', 'partner4.refusal.creditScore', 'partner4.refusal.planSettings']) expect([k, w.includes(en[k])]).toEqual([k, true]);
  });
  it('hi and gu render the same skeleton with their own words', () => {
    const skel = (h: string) => (h.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
    for (const cat of [hi, gu]) expect(skel(r('ok', cat))).toBe(skel(r()));
  });
  it('the page: session gate, kind gate, the two chain states FIRST, then the view with the public flag map — no read, no error state', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'lender', 'consents', 'page.tsx'), 'utf8');
    const body = src.slice(src.indexOf('export default async function'));
    const at = (s: string) => body.indexOf(s);
    expect(at('await requirePartner()')).toBeGreaterThan(0);
    expect(at('await lenderGate()')).toBeGreaterThan(at('await requirePartner()'));
    expect(at("chain6State('consents_export'")).toBeGreaterThan(at('await lenderGate()'));
    expect(at("chain6State('consents_act'")).toBeGreaterThan(at("chain6State('consents_export'"));
    expect(at('await lenderSwitches()')).toBeGreaterThan(at("chain6State('consents_act'"));
    expect(body).toMatch(/<LenderChain6 t=\{t\} chain="consents_export" state=\{exp\} mailbox=\{await partnersMailbox\(\)\} \/>/);
    expect(body).toMatch(/<LenderChain6 t=\{t\} chain="consents_act" state=\{act\} \/>/);
    expect(/api-client|sdk-js|lenderFailure|notFound/.test(src)).toBe(false);
  });
});
