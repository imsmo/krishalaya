// apps/web-partner/src/test-render/insurer-issuance.render.test.tsx · PC-56 PARTNER-2b · W249 the issuance desk as a READ (founder Q5): the founder's
// statement verbatim; the `proposed` queue rows (proposal, product, the FPO's public name, subject TYPE, sum insured, the premium the farmer will
// pay, proposed on, the cover window or "no window given") with NO name, phone, holder or policy number; the keyset link; the act DECOR (W2944–
// W2947 `?form=`) and Reload = the W2948–W2950 re-read (`?act=`); empty / error / OFF states; the kind gate is a figures rule (pinned in the unit
// spec) — a lender never renders this view. Every refusal of the surface printed by name.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerIssuanceView } from '../components/partner2/InsurerIssuanceView';
import { insurerFailureOf, listState, wrongConsole } from '../features/partner2/figures';
import { partner2RefusalKeys } from '../features/partner2/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { FALSE_2A } from './partner2a-fixtures';
import { FALSE_2B, QUEUE, withoutRefusals } from './partner2b-fixtures';

const render = (state: Parameters<typeof InsurerIssuanceView>[0]['state'], cat: Record<string, string> = en, items = QUEUE, nextCursor: string | null = 'Y3Vyc29y') =>
  renderToStaticMarkup(<InsurerIssuanceView t={tr(cat)} lang="en" state={state} items={items} nextCursor={nextCursor} computedAt="2026-10-18T06:30:00.000Z" />);

describe('PC-56 PARTNER-2b · W249 the issuance desk (render)', () => {
  const html = render(listState(QUEUE, null)); const w = text(html);
  it('the founder\'s statement, verbatim from the catalogue, at the top', () => {
    expect(w).toContain('Cover starts when the farmer\'s premium payment is confirmed; the insurer does not issue policies on the platform yet');
    expect(w).toContain(en['partner2.issuance.statement']);
    expect(html).toContain('data-kv-statement="partner2.issuance.statement"');
  });
  it('the queue rows: proposal, product, organisation, subject TYPE, sum insured, the farmer\'s premium, proposed on, the window — exact past 2^53', () => {
    expect(html).toContain('data-kv-state="ok"');
    for (const r of QUEUE) expect(html).toContain(`data-kv-proposal="${r.id}"`);
    expect(w).toContain('Fixture Dairy Collective'); expect(w).toContain('an organisation');
    expect(w).toContain('An animal'); expect(w).toContain('A crop season');
    expect(w).toContain('₹80,000.00'); expect(w).toContain('₹2,560.00'); expect(w).toContain('₹9,00,71,99,25,47,409.93');
    expect(w).toContain('once the farmer has paid'); expect(w).toContain(en['partner2.issuance.noWindow']);
    expect(html).toContain(`href="/insurer/policies/${QUEUE[0].id}"`);
    for (const h of ['Proposal', 'Product', 'Organisation', 'Covers', 'Sum insured', 'Premium the farmer will pay', 'Proposed on', 'Cover window']) expect(w).toContain(h);
  });
  it('NO identity column, value or word; no policy number; no status chip; the refusals printed by name', () => {
    expect(w).not.toMatch(/holder name|phone number|ear|vaccin|health|policy number|INS-/i);
    expect(html).not.toMatch(/holderUserId|subjectId|tenantId|premiumPaymentId|data-kv-status-filter/);
    for (const k of partner2RefusalKeys('ins_issuance')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(w).toContain(en['partner2.refusal.issueAct']); expect(w).toContain(en['partner2.refusal.proposalLatency']); expect(w).toContain(en['partner2.refusal.partnerRoles']);
    expect(w).not.toMatch(FALSE_2A); expect(w).not.toMatch(FALSE_2B);
  });
  it('the act is DECOR (the W2944 form chain, no <form>); the keyset link carries the cursor only', () => {
    expect(html).toContain('href="/insurer/issuance?form=review"'); expect(html).toContain('data-kv-decor="issue"'); expect(html).not.toContain('<form');
    expect(html).toContain('href="/insurer/issuance?cursor=Y3Vyc29y"');
    expect(render('ok', en, QUEUE, null)).not.toContain('data-kv-next');
  });
  it('empty: no proposals awaiting a farmer\'s payment; error: nothing is broken + Reload = the W2948 re-read; never "unavailable"', () => {
    const e = render('empty', en, []);
    expect(e).toContain('data-kv-state="empty"'); expect(text(e)).toContain('No proposals awaiting a farmer\'s payment');
    const x = render(listState(null, insurerFailureOf(500, 'INTERNAL', 'on')), en, []);
    expect(x).toContain('data-kv-state="error"'); expect(text(x)).toContain(en['partner2.issuance.error.body']); expect(text(x)).toContain('Nothing is broken on the platform\'s side');
    expect(x).toContain('href="/insurer/issuance?act=confirm"'); expect(withoutRefusals(x)).not.toMatch(/unavailable|SLA|pauses/i); expect(x).not.toContain('data-kv-next');
    expect(text(x)).toContain(en['partner2.issuance.statement']);
  });
  it('switched off: the console and the platform\'s insurance — "nothing is broken" (en, hi, gu); a lender is sent away (the kind rule)', () => {
    const off = render(listState(null, insurerFailureOf(404, 'NOT_FOUND', 'off')));
    expect(off).toContain('data-kv-state="off"'); expect(text(off)).toContain('Nothing is broken');
    const ins = render(listState(null, insurerFailureOf(404, 'PARTNER_INSURANCE_SWITCHED_OFF', 'unknown')));
    expect(ins).toContain('data-kv-state="insurance_off"'); expect(text(ins)).toContain(en['partner2.insuranceOff.title']);
    expect(text(render('insurance_off', hi))).toContain(hi['partner2.insuranceOff.body']);
    expect(text(render('insurance_off', gu))).toContain(gu['partner2.insuranceOff.body']);
    expect([wrongConsole('bank', 'insurer'), wrongConsole('amc', 'insurer'), wrongConsole('insurer', 'insurer')]).toEqual([true, true, false]);
  });
  it('hi and gu print their own statement', () => {
    expect(text(render('ok', hi))).toContain(hi['partner2.issuance.statement']);
    expect(text(render('ok', gu))).toContain(gu['partner2.issuance.statement']);
  });
});
