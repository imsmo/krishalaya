// apps/web-partner/src/test-render/lender-regulatory.render.test.tsx · PC-56 PARTNER-6b · W224 (canon `lender/reports/regulatory`) — AN HONEST
// PAGE THAT READS NOTHING (founder 6b-3, door Q6-A). The load-bearing assertions: the statement VERBATIM ×3; the real links to Portfolio, DPD
// aging and back to "SLA & reports"; the partners mailbox line (the platform's published fact, or "not published"); NO "%", NO regulatory
// classification, gender or land figure, NO figure at all; NO input (M6 kills here) and NO error state; OFF as OFF; "Generate a pack" DECOR →
// the W2987–W2990 form chain; every W224 refusal BY NAME.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderRegulatoryView } from '../components/partner6/LenderRegulatoryView';
import { partner6RefusalKeys } from '../features/partner6/refusals';
import type { LenderHonestState } from '../features/partner4/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { percents, withoutRefusals } from './partner4a-fixtures';
import { FALSE_6B_REGULATORY, FORM_CONTROL_6B, MAILBOX_6B } from './partner6b-fixtures';

type Mb = Parameters<typeof LenderRegulatoryView>[0]['mailbox'];
const r = (state: LenderHonestState = 'ok', cat: Record<string, string> = en, mailbox: Mb = MAILBOX_6B) =>
  renderToStaticMarkup(<LenderRegulatoryView t={tr(cat)} state={state} mailbox={mailbox} />);
const STATEMENT = "The platform produces no regulatory extract and classifies nothing for a regulator. It never gives your organisation a borrower's gender or landholding. Your book's own figures are on Portfolio and DPD aging; your organisation files its own returns — the platform never files for you.";

describe('PC-56 PARTNER-6b · W224 the regulatory page (render)', () => {
  it('THE FOUNDER\'S STATEMENT (6b-3) VERBATIM, in all three languages', () => {
    expect(en['partner6.regulatory.statement']).toBe(STATEMENT);
    for (const cat of [en, hi, gu]) {
      const html = r('ok', cat);
      expect(html).toContain('data-kv-statement="partner6.regulatory.statement"');
      expect(text(html)).toContain(cat['partner6.regulatory.statement']);
    }
    expect(new Set([en, hi, gu].map((c) => c['partner6.regulatory.statement'])).size).toBe(3);
  });
  it('the real links: Portfolio, DPD aging and back to SLA & reports; "Generate a pack" DECOR → ?form=review; nothing else', () => {
    const html = r();
    for (const [h, id] of [['/lender/portfolio', 'portfolio'], ['/lender/portfolio/aging', 'aging'], ['/lender/reports', 'reports']]) {
      expect([h, html.includes(`href="${h}"`), html.includes(`data-kv-real="${id}"`)]).toEqual([h, true, true]);
    }
    expect(html).toContain('href="/lender/reports/regulatory?form=review"'); expect(html).toContain('data-kv-decor="pack"');
    expect([...withoutRefusals(html).matchAll(/href="([^"]*)"/g)].map(([, h]) => h).filter((h) => !h.startsWith('mailto:')).sort())
      .toEqual(['/lender/portfolio', '/lender/portfolio/aging', '/lender/reports', '/lender/reports/regulatory?form=review']);
    expect(html).not.toContain('?act=');
  });
  it('the partners mailbox line for a lender that needs data for its own filing — the published fact, or "not published", never a literal', () => {
    const html = r(); const w = text(html);
    expect(w).toContain(en['partner6.regulatory.mailboxAsk']);
    expect(html).toContain('data-kv-ops-mailbox="published"'); expect(html).toContain('partners@example.org');
    expect(text(r('ok', en, { kind: 'none' }))).toContain(en['partner1.ops.mailboxNone']);
    expect(text(r('ok', en, { kind: 'error' }))).toContain(en['partner1.ops.mailboxError']);
  });
  it('NO "%", NO regulatory classification, gender or land figure, NO figure at all — in any state or language', () => {
    for (const cat of [en, hi, gu]) for (const state of ['ok', 'error'] as const) {
      const html = r(state, cat); const w = text(html);
      expect([state, html.includes('%'), percents(w), MONEY.test(w), w.includes('₹')]).toEqual([state, false, 0, false, false]);
      expect([state, /[\d०-९૦-૯]/.test(w)]).toEqual([state, false]);
      expect([state, /<table|<tr|<td|data-kv-(count|kpi|figure|extract|hash)/.test(withoutRefusals(html))]).toEqual([state, false]);
    }
    expect(FALSE_6B_REGULATORY.test(text(withoutRefusals(r())))).toBe(false);
    // and the refusal list itself names no regulator's target by its acronym or phrase
    expect(/\bPSL\b|priority[- ]sector|weaker[- ]section|small (&|and) marginal|women|\bRBI\b|sha256|watermark/i.test(text(r()))).toBe(false);
  });
  it('NO INPUT AND NO ERROR STATE (M6 kills here) — an unreadable flag map still prints the honest page; OFF reads as OFF', () => {
    for (const cat of [en, hi, gu]) for (const state of ['ok', 'error', 'off'] as const) {
      const html = r(state, cat);
      expect([state, FORM_CONTROL_6B.test(html), /placeholder=|type="|name="/.test(html), html.includes('role="alert"')]).toEqual([state, false, false, false]);
    }
    expect(r('error')).toEqual(r('ok').replace('data-kv-state="ok"', 'data-kv-state="error"'));
    expect(text(r('error'))).not.toMatch(/could not|try again|retry|couldn/i);
    const off = r('off');
    expect(off).toContain('data-kv-state="off"'); expect(text(off)).toContain(en['partner.off.body']);
    expect(text(off)).not.toContain(STATEMENT); expect(text(off)).not.toMatch(/see plan settings/i);
  });
  it('every W224 refusal is printed BY NAME, with the reused report-pack, partner-roles and plan-settings refusals BY KEY', () => {
    const html = r(); const w = text(html);
    const keys = partner6RefusalKeys('regulatory');
    expect(keys.length).toBeGreaterThanOrEqual(13);
    for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const id of ['prepared_filings', 'generate_pack', 'target_classification', 'land_kpi', 'gender_kpi', 'extracts_table', 'trace_to_evidence', 'packs_appear',
      'quarter_building', 'prior_packs', 'extract_marks', 'form_without_form', 'partner_roles_consents', 'plan_settings']) expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    for (const k of ['partner2.refusal.reportPack', 'partner2.refusal.partnerRoles', 'partner4.refusal.planSettings']) expect([k, w.includes(en[k])]).toEqual([k, true]);
  });
  it('hi and gu render the same skeleton with their own words', () => {
    const skel = (h: string) => (h.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
    for (const cat of [hi, gu]) expect(skel(r('ok', cat))).toBe(skel(r()));
  });
  it('the page: session gate, kind gate, the two chain states FIRST, then the view with the public flag map and the mailbox fact — no read', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'lender', 'reports', 'regulatory', 'page.tsx'), 'utf8');
    const body = src.slice(src.indexOf('export default async function'));
    const at = (s: string) => body.indexOf(s);
    expect(at('await lenderGate()')).toBeGreaterThan(at('await requirePartner()'));
    expect(at("chain6State('regulatory_form'")).toBeGreaterThan(at('await lenderGate()'));
    expect(at("chain6State('regulatory_act'")).toBeGreaterThan(at("chain6State('regulatory_form'"));
    expect(at('await lenderSwitches()')).toBeGreaterThan(at("chain6State('regulatory_act'"));
    expect(body).toMatch(/<LenderChain6 t=\{t\} chain="regulatory_form" state=\{form\} mailbox=\{await partnersMailbox\(\)\} \/>/);
    expect(body).toMatch(/<LenderChain6 t=\{t\} chain="regulatory_act" state=\{act\} \/>/);
    expect(/api-client|sdk-js|lenderFailure|notFound/.test(src)).toBe(false);
  });
});
