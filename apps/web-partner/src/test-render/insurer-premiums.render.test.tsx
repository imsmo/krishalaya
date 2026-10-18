// apps/web-partner/src/test-render/insurer-premiums.render.test.tsx · PC-56 PARTNER-2b · W251 premiums — AN HONEST PAGE (founder Q1): the approved
// statement verbatim from the catalogue; two COUNTS (in force, proposed) labelled as counts; NO rupee figure anywhere on the page (no ₹, no
// digit-grouped amount, no paise) in any state or language; "Export (signed)" DECOR (W2896–W2897 `?export=`), Reload = W2898–W2900 (`?act=`);
// the collected sum, next-day settlement, subsidy owed, refunds, batches and policy-number matching refused by name. M1 kills here.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerPremiumsView } from '../components/partner2/InsurerPremiumsView';
import { honestState, insurerFailureOf, premiumsCounts } from '../features/partner2/figures';
import { partner2RefusalKeys } from '../features/partner2/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { DASH, FALSE_2A } from './partner2a-fixtures';
import { FALSE_2B, MONEY, PREMIUMS, withoutRefusals } from './partner2b-fixtures';

const render = (state: Parameters<typeof InsurerPremiumsView>[0]['state'], cat: Record<string, string> = en, counts = PREMIUMS) =>
  renderToStaticMarkup(<InsurerPremiumsView t={tr(cat)} lang="en" state={state} counts={counts} />);
/** The page's text with the founder's statement removed (it says "collected by the platform" — the only place the word may appear). */
const outsideStatement = (w: string, cat: Record<string, string>) => w.replace(cat['partner2.premiums.statement'], '');

describe('PC-56 PARTNER-2b · W251 premiums — an honest page (render)', () => {
  const html = render('ok'); const w = text(html);
  it('ONE approved statement, verbatim from the catalogue', () => {
    expect(w).toContain(en['partner2.premiums.statement']);
    expect(en['partner2.premiums.statement']).toMatch(/^Premiums paid by farmers for policies on your products are collected by the platform and held in the platform's escrow account\. Nothing is settled to your organisation yet/);
    expect((html.match(/data-kv-statement=/g) ?? []).length).toBe(1);
  });
  it('NO rupee figure anywhere — no ₹, no digit-grouped amount, no paise — in every state and language (M1)', () => {
    for (const [cat, st] of [[en, 'ok'], [hi, 'ok'], [gu, 'ok'], [en, 'error'], [en, 'off'], [en, 'insurance_off']] as const) {
      const h = render(st as never, cat as Record<string, string>);
      expect([st, MONEY.test(text(h))]).toEqual([st, false]);
      expect(h).not.toMatch(/₹|INR|&#x20b9;/i);
    }
    // outside the founder's statement and the refusal list (which names the claims to say no), no line speaks of money collected, settled or owed
    expect(outsideStatement(text(withoutRefusals(html)), en)).not.toMatch(/collected|settled|receivable|refund|subsidy|owed|escrow/i);
  });
  it('the two COUNTS, labelled as counts, with one as-of — the same figures the dashboard read answers (no new money read)', () => {
    expect(html).toContain('data-kv-count="active"'); expect(html).toContain('data-kv-count="proposed"');
    expect(w).toContain('Policies in force (count)'); expect(w).toContain('Proposals awaiting payment (count)');
    expect(w).toContain('1234'); expect(w).toContain(en['partner2.premiums.activeHint']);
    expect((html.match(/data-kv-asof=/g) ?? []).length).toBe(1);
    expect(premiumsCounts(DASH)).toEqual({ active: 1, proposed: 1, computedAt: DASH.computedAt });
    expect(text(render('ok', en, premiumsCounts(DASH)!))).not.toMatch(MONEY);
  });
  it('Export (signed) is DECOR (the W2896 chain, no form); Reload is the W2898 re-read; every refusal by name; no canon claim', () => {
    expect(html).toContain('href="/insurer/premiums?export=queued"'); expect(html).not.toContain('<form');
    for (const k of partner2RefusalKeys('ins_premiums')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const k of ['collectedSum', 'settlesNextDay', 'subsidyOwed', 'refundsLine', 'remitBatches', 'rupeePolicyNo', 'premiumsFile']) expect(w).toContain(en[`partner2.refusal.${k}`]);
    expect(outsideStatement(w, en)).not.toMatch(FALSE_2A); expect(outsideStatement(w, en)).not.toMatch(FALSE_2B);
    const x = render(honestState(null, insurerFailureOf(500, 'X', 'on')), en, null as never);
    expect(x).toContain('data-kv-state="error"'); expect(x).toContain('href="/insurer/premiums?act=confirm"'); expect(text(x)).toContain('Nothing is broken on the platform\'s side');
    expect(withoutRefusals(x)).not.toMatch(/rails|unaffected|unavailable/i);
  });
  it('switched off (console, insurance) — "nothing is broken" (en, hi, gu)', () => {
    expect(render(honestState(null, insurerFailureOf(404, 'NOT_FOUND', 'off')))).toContain('data-kv-state="off"');
    const ins = render(honestState(null, insurerFailureOf(404, 'PARTNER_INSURANCE_SWITCHED_OFF', 'unknown')));
    expect(ins).toContain('data-kv-state="insurance_off"'); expect(text(ins)).toContain('Nothing is broken');
    expect(text(render('insurance_off', hi))).toContain(hi['partner2.insuranceOff.body']); expect(text(render('insurance_off', gu))).toContain(gu['partner2.insuranceOff.body']);
    expect(text(render('ok', hi))).toContain(hi['partner2.premiums.statement']); expect(text(render('ok', gu))).toContain(gu['partner2.premiums.statement']);
  });
});
