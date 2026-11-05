// apps/web-partner/src/test-render/insurer-settlement.render.test.tsx · PC-56 PARTNER-6a · W261 (canon `insurer/settlements/[id]`) — AN HONEST
// PAGE THAT READS NOTHING (founder 6a-2). The load-bearing assertions: the statement VERBATIM in all three languages; the ONE link to the
// claim's own page (the id encoded, never printed); every id — a claim, a foreign one, an unknown one, a malformed one, a hostile one — prints
// the SAME markup; NO error state, NO input, NO form; never a claimant, a decider, an amount, an account tail, a surveyor, a tag, a diagnosis,
// a message, an offer, a reinsurance note, a hash or a retention promise (M3 kills here); every W261 refusal printed BY NAME.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerSettlementView } from '../components/partner6/InsurerSettlementView';
import { partner6RefusalKeys } from '../features/partner6/refusals';
import { claimHref } from '../features/partner6/figures';
import type { HonestState } from '../features/partner2/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { percents, withoutRefusals } from './partner4a-fixtures';
import { FALSE_6A, FORM_CONTROL_6A, IDS_6A } from './partner6a-fixtures';

const r = (state: HonestState = 'ok', cat: Record<string, string> = en, id: string = IDS_6A.claim) =>
  renderToStaticMarkup(<InsurerSettlementView t={tr(cat)} state={state} claimId={id} />);
/** The page with every id-bearing attribute normalised — what must be IDENTICAL for every id. */
const shape = (html: string, id: string) => html.split(encodeURIComponent(id)).join('<ID>');
const STATEMENT = "No settlement exists for any claim on this platform. This claim's own facts are on its claim page.";

describe('PC-56 PARTNER-6a · W261 one claim\'s settlement page (render)', () => {
  it('THE FOUNDER\'S STATEMENT (6a-2) VERBATIM — no settlement exists for any claim — in all three languages', () => {
    expect(en['partner6.settlement.statement']).toBe(STATEMENT);
    for (const cat of [en, hi, gu]) {
      const html = r('ok', cat);
      expect(html).toContain('data-kv-statement="partner6.settlement.statement"');
      expect(text(html)).toContain(cat['partner6.settlement.statement']);
    }
    expect(hi['partner6.settlement.statement']).not.toBe(en['partner6.settlement.statement']);
    expect(gu['partner6.settlement.statement']).not.toBe(hi['partner6.settlement.statement']);
  });
  it('the ONE onward link is the claim\'s own page (3a); "Back to settlements" is real; the id is only ever encoded into an href', () => {
    const html = r();
    const hrefs = [...withoutRefusals(html).matchAll(/href="([^"]*)"/g)].map(([, h]) => h);
    expect(hrefs).toEqual(expect.arrayContaining([claimHref(IDS_6A.claim), '/insurer/settlements']));
    expect(html).toMatch(new RegExp(`data-kv-real="claim" href="${claimHref(IDS_6A.claim).replace(/[/.]/g, '\\$&')}"`));
    expect(html).toContain('data-kv-back="/insurer/settlements"');
    // the hostile id is escaped by encoding — never markup
    expect(r('ok', en, IDS_6A.hostile)).toContain(`href="${claimHref(IDS_6A.hostile).replace(/"/g, '&quot;')}"`);
    expect(hrefs.filter((h) => h.includes('['))).toEqual([]);
  });
  it('EVERY ID PRINTS THE SAME PAGE: a claim, a foreign claim, an unknown id, a malformed id, a hostile one — no not-found, the id never printed as text', () => {
    const base = shape(r('ok', en, IDS_6A.claim), IDS_6A.claim);
    for (const id of Object.values(IDS_6A)) {
      const html = r('ok', en, id);
      expect([id, shape(html, id)]).toEqual([id, base]);
      expect([id, text(html).includes(id)]).toEqual([id, false]);
      expect([id, /not found|does not exist|not yours|no such claim/i.test(text(withoutRefusals(html)))]).toEqual([id, false]);
      expect(html).not.toContain('<script>');
    }
  });
  it('NO ERROR STATE AND NO INPUT — an unreadable flag map still prints the honest page; OFF reads as OFF; no form control in any state or language', () => {
    for (const cat of [en, hi, gu]) for (const state of ['ok', 'error', 'off', 'insurance_off'] as const) {
      const html = r(state, cat);
      expect([state, FORM_CONTROL_6A.test(html)]).toEqual([state, false]);
      expect([state, /placeholder=|type="|name="/.test(html)]).toEqual([state, false]);
      expect([state, html.includes('role="alert"')]).toEqual([state, false]);
    }
    const err = r('error');
    expect(err).toContain('data-kv-state="error"');
    expect(text(err)).toContain(STATEMENT);
    expect(text(err)).not.toMatch(/could not be read|try again|retry/i);
    expect(r('error')).toEqual(r('ok').replace('data-kv-state="ok"', 'data-kv-state="error"'));
    expect(text(r('off'))).toContain(en['partner.off.body']);
    expect(text(r('insurance_off'))).toContain(en['partner2.insuranceOff.body']);
  });
  it('NEVER A PERSON OR A RUPEE: no claimant, decider, amount, account tail, surveyor, tag, diagnosis, message, offer, reinsurance note, hash or retention (M3 kills here)', () => {
    for (const cat of [en, hi, gu]) for (const state of ['ok', 'error'] as const) {
      const html = r(state, cat); const visible = text(withoutRefusals(html));
      // the claims sub-navigation's own tab labels ("Surveyors" …) are 3b's, not this page's copy
      const own = text(withoutRefusals(html).replace(/<nav class="kv-subnav"[\s\S]*?<\/nav>/, ''));
      expect([state, FALSE_6A.test(visible)]).toEqual([state, false]);
      expect([state, MONEY.test(visible), html.includes('₹'), percents(text(html))]).toEqual([state, false, false, 0]);
      expect([state, /[\d०-९૦-૯]/.test(visible)]).toEqual([state, false]);
      expect([state, /claimant|approver|decider|surveyor|diagnos|ear-?tag|\btag\b|\bSMS\b|offer|account|treaty|receiv/i.test(own)]).toEqual([state, false]);
    }
    expect(r()).not.toContain('<table');
    expect(r()).not.toMatch(/data-kv-(claimant|amount|account|name)/);
  });
  it('every W261 refusal is printed BY NAME, with 3a\'s named-holders and payout-link refusals BY KEY', () => {
    const html = r(); const w = text(html);
    const keys = partner6RefusalKeys('settlement');
    expect(keys.length).toBeGreaterThanOrEqual(15);
    for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const id of ['named_heading', 'decider_names', 'claim_file', 'whole_chain', 'survey_details', 'event_to_money', 'claimant_message', 'credit_offer',
      'recovery_notes', 'recorded_end_to_end', 'retention', 'not_at_risk', 'export_watermark', 'payout_link', 'paying_chip', 'finance_role', 'plan_settings']) {
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    }
    expect(w).toContain(en['partner3.refusal.namedHolders']);
  });
  it('the page: session gate, kind gate, the chain state FIRST (returning HERE), then the view with the public flag map — no read, no not-found', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'insurer', 'settlements', '[id]', 'page.tsx'), 'utf8');
    const body = src.slice(src.indexOf('export default async function'));
    const at = (s: string) => body.indexOf(s);
    expect(at('await requirePartner()')).toBeGreaterThan(0);
    expect(at('await insurerGate()')).toBeGreaterThan(at('await requirePartner()'));
    expect(at("chain6State('settlement_detail_act'")).toBeGreaterThan(at('await insurerGate()'));
    expect(at('await insurerSwitches()')).toBeGreaterThan(at("chain6State('settlement_detail_act'"));
    expect(body).toMatch(/back=\{settlementHref\(params\.id\)\}/);
    expect(/api-client|sdk-js|partnersMailbox|notFound|isNotFound|insurerFailure/.test(src)).toBe(false);
    expect(src).toContain("export const dynamic = 'force-dynamic'");
    expect(src).toContain('robots: { index: false, follow: false }');
  });
});
