// apps/web-partner/src/test-render/lender-collections.render.test.tsx · PC-56 PARTNER-5b · W219 (canon `lender/collections`) — AN HONEST
// PAGE THAT READS NOTHING (founder 5b-1 / 5b-2, door Q5). The load-bearing assertions: the founder's statement VERBATIM in en (present in
// hi and gu); where arrears are counted as two REAL links with 5a's zero sentence reused by key and NO figure on the page; PARTNER-4b's
// code-of-conduct refusals present BY KEY; the absence line; no form control and no digit beside an arrears word in any language; "Take
// next case" as DECOR into its chain; and NO ERROR STATE (an unreadable flag map still prints the honest page; OFF prints OFF).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderCollectionsView } from '../components/partner5/LenderCollectionsView';
import { partner5RefusalKeys, PARTNER5_REFUSALS } from '../features/partner5/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { IDENTITY_4A, percents, withoutRefusals } from './partner4a-fixtures';
import { FALSE_5B, FORM_CONTROL, figuresBesideArrearsWords } from './partner5b-fixtures';

const r = (state: 'ok' | 'off' | 'error' = 'ok', cat: Record<string, string> = en) => renderToStaticMarkup(<LenderCollectionsView t={tr(cat)} state={state} />);

describe('PC-56 PARTNER-5b · W219 the collections page (render)', () => {
  it('THE FOUNDER\'S STATEMENT (5b-2) VERBATIM — a lender does not collect on this platform — in all three languages, with the page\'s own voice', () => {
    expect(en['partner5.collections.statement']).toBe('A lender does not collect on this platform. The organisation that serves the farmer is the lender of record and services its own book. No borrower in arrears is named, contacted or ranked here.');
    for (const cat of [en, hi, gu]) {
      const html = r('ok', cat);
      expect(html).toContain('data-kv-statement="partner5.collections.statement"');
      expect(text(html)).toContain(cat['partner5.collections.statement']);
      expect(text(html)).toContain(cat['partner5.collections.voice']);
    }
    expect(en['partner5.collections.voice']).toBe('Distress is a season, not a character.');
  });
  it('WHERE ARREARS ARE COUNTED: two REAL links, 5a\'s zero sentence reused BY KEY, and NO figure printed on this page', () => {
    const html = r();
    expect(html).toContain('href="/lender/repayments"'); expect(html).toContain('data-kv-real="repayments"');
    expect(html).toContain('href="/lender/portfolio/aging"'); expect(html).toContain('data-kv-real="aging"');
    expect(html).toContain('data-kv-statement="partner5.aging.statement"');
    expect(text(html)).toContain(en['partner5.aging.statement']);
    for (const cat of [en, hi, gu]) {
      for (const state of ['ok', 'error'] as const) {
        const w = text(r(state, cat));
        expect([state, figuresBesideArrearsWords(w)]).toEqual([state, []]);
        expect([state, /[\d०-९૦-૯]/.test(text(withoutRefusals(r(state, cat))))]).toEqual([state, false]);   // not one digit outside the refusals
        expect([state, MONEY.test(w)]).toEqual([state, false]);
        expect([state, percents(w)]).toEqual([state, 0]);
      }
    }
    expect(html).not.toContain('<table');
    expect(html).not.toContain('data-kv-count');
  });
  it('PARTNER-4b\'s code-of-conduct refusals are printed BY KEY, and every W219 refusal is on the page', () => {
    const html = r(); const w = text(html);
    for (const id of ['code_of_conduct', 'contact_hours', 'contact_log', 'mediation_first', 'third_party_agents', 'partner_suspension', 'collections_roles']) {
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
      const key = PARTNER5_REFUSALS.find((x) => x.id === id)?.key as string;
      expect([id, key.startsWith('partner4.refusal.'), w.includes(en[key])]).toEqual([id, true, true]);
    }
    const keys = partner5RefusalKeys('collections');
    expect(keys.length).toBeGreaterThanOrEqual(15);
    for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const id of ['take_next_case', 'named_cases', 'arrears_kpis', 'recovery_measure', 'dairy_inference', 'auto_threshold', 'all_loans_up_to_date', 'logs_server_side', 'plan_settings']) {
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    }
  });
  it('the one true line, as an ABSENCE: nothing on this platform restricts a borrower\'s selling because of a loan', () => {
    for (const cat of [en, hi, gu]) expect(text(r('ok', cat))).toContain(cat['partner5.collections.noSellingBlock']);
    expect(r()).toContain('data-kv-statement="partner5.collections.noSellingBlock"');
  });
  it('no borrower, no form control, no canon claim outside the refusals; "Take next case" is DECOR into W2918–W2920; the sub-navigation marks this page', () => {
    const html = r();
    expect(FORM_CONTROL.test(html)).toBe(false);
    expect(IDENTITY_4A.test(html)).toBe(false);
    for (const cat of [en, hi, gu]) expect(FALSE_5B.test(text(withoutRefusals(r('ok', cat))))).toBe(false);
    expect(html).toContain('data-kv-decor="nextCase"');
    expect(html).toContain('href="/lender/collections?act=confirm"');
    expect(html).toMatch(/aria-current="page"[^>]*data-kv-subnav-item="\/lender\/collections"/);
    // no link down to a case: a list of cases would name borrowers
    expect([...html.matchAll(/href="([^"]*)"/g)].map(([, h]) => h).filter((h) => /^\/lender\/collections\/./.test(h))).toEqual([]);
    expect([...html.matchAll(/href="([^"]*)"/g)].filter(([, h]) => h.includes('['))).toEqual([]);
  });
  it('NO ERROR STATE — the page reads nothing, so an unreadable flag map still prints the honest page; OFF reads as OFF', () => {
    const err = r('error');
    expect(err).toContain('data-kv-state="error"');
    expect(err).not.toContain('role="alert"');
    expect(text(err)).toContain(en['partner5.collections.statement']);
    expect(text(err)).not.toMatch(/could not be read|try again|retry/i);
    const off = r('off');
    expect(off).toContain('data-kv-state="off"');
    expect(text(off)).toContain(en['partner.off.body']);
    expect(text(off)).not.toMatch(/unavailable|lending is (switched )?off/i);
    expect(text(off)).not.toContain(en['partner5.collections.statement']);
  });
  it('the page gates the session and the KIND before anything else (an insurer is sent home by lenderGate — the harness cannot mount a server page, so the order is asserted on the source)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'lender', 'collections', 'page.tsx'), 'utf8');
    const body = src.slice(src.indexOf('export default async function'));
    expect(body.indexOf('await requirePartner()')).toBeGreaterThan(0);
    expect(body.indexOf('await lenderGate()')).toBeGreaterThan(body.indexOf('await requirePartner()'));
    expect(body.indexOf("chain5State('collections_act'")).toBeGreaterThan(body.indexOf('await lenderGate()'));
    expect(body.indexOf('await lenderSwitches()')).toBeGreaterThan(body.indexOf("chain5State('collections_act'"));
    expect(src).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(src).toMatch(/export const dynamic = 'force-dynamic';/);
    const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'lender.ts'), 'utf8');
    expect(lib).toMatch(/if \(wrongConsole\(me\?\.organisation\?\.kind, 'lender'\)\) redirect\('\/insurer\/dashboard'\);/);
  });
});
