// apps/web-partner/src/test-render/insurer-claim.render.test.tsx · PC-56 PARTNER-3a · W253 ONE CLAIM (founder Q3 + Q4): the facts (reference, policy
// number or "no policy number yet", product, organisation, subject TYPE, event, event date, reported within 72 hours as recorded, sum insured,
// the approved amount AS RECORDED, the damage percentage when the survey recorded one — the ONLY "%" on any 3a page — filed / last changed /
// closed); "Decide" DECOR with the founder's sentence verbatim; NO survey, evidence, claimant, message or timeline block; "7 years" absent;
// not found / error / OFF states.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerClaimView } from '../components/partner3/InsurerClaimView';
import { partner3RefusalKeys } from '../features/partner3/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { CLAIM, CLAIMS, FALSE_3A, percents, withoutRefusals } from './partner3a-fixtures';

const render = (c: Parameters<typeof InsurerClaimView>[0]['c'] = CLAIM, cat: Record<string, string> = en, failure: Parameters<typeof InsurerClaimView>[0]['failure'] = null, notFound = false) =>
  renderToStaticMarkup(<InsurerClaimView t={tr(cat)} lang="en" c={c} failure={failure} notFound={notFound} />);

describe('PC-56 PARTNER-3a · W253 one claim (render)', () => {
  const html = render(); const w = text(html);
  it('the facts, each as recorded; the policy links to the insurer\'s own policy page', () => {
    expect(html).toContain('data-kv-state="ok"'); expect(html).toContain(`data-kv-claim="${CLAIM.id}"`);
    for (const f of ['reference', 'policy', 'product', 'fpo', 'subject', 'event', 'event_date', 'reported', 'sum_insured', 'approved', 'damage', 'filed', 'changed', 'closed']) expect([f, html.includes(`data-kv-fact="${f}"`)]).toEqual([f, true]);
    expect(w).toContain(CLAIM.id); expect(w).toContain('Claim reference');
    expect(w).toContain('INS-0001'); expect(html).toContain(`href="/insurer/policies/${CLAIM.policyId}"`);
    expect(w).toContain('Claim — Not recorded'); expect(w).toContain('A crop season'); expect(w).toContain('Partially approved');
    expect(w).toContain('₹28,500.00, as recorded by the organisation\'s decision'); expect(w).toContain('₹9,00,71,99,25,47,409.93');
    expect(w).toContain('Not closed');
  });
  it('"no policy number yet" when the policy has none; no damage row and no "%" when the survey recorded none', () => {
    const one = render({ ...CLAIMS[0], computedAt: CLAIM.computedAt }); const t1 = text(one);
    expect(t1).toContain('no policy number yet'); expect(one).not.toContain('data-kv-fact="damage"'); expect(percents(t1)).toBe(0);
    expect(t1).toContain('None recorded'); expect(t1).toContain('A late report is recorded; nothing rejects a claim for it.');
  });
  it('the damage percentage is the ONLY "%" on the page — inside its own fact, as the survey recorded it', () => {
    expect(percents(w)).toBe(1);
    expect(html).toMatch(/data-kv-fact="damage"><dt>Damage \(survey\)<\/dt><dd>62%, as the survey recorded it<\/dd>/);
    expect(percents(text(html.replace(/<div class="kv-facts__row" data-kv-fact="damage">[\s\S]*?<\/div>/, '')))).toBe(0);
  });
  it('"Decide" is DECOR — a disabled control, no link, no form — beside the founder\'s sentence verbatim (en, hi, gu)', () => {
    expect(html).toContain('data-kv-decor="decide"'); expect(html).toContain('aria-disabled="true"'); expect(html).not.toContain('<form');
    expect(html).not.toMatch(/<a [^>]*data-kv-decor="decide"/);
    expect(w).toContain('Claim decisions are not made from the partner console yet: the organisation that serves the farmer records the decision today, and the insurer\'s own decision will arrive together with its funding leg.');
    expect(html).toContain('data-kv-statement="partner3.claim.decideStatement"');
    expect(text(render(CLAIM, hi))).toContain(hi['partner3.claim.decideStatement']); expect(text(render(CLAIM, gu))).toContain(gu['partner3.claim.decideStatement']);
    expect(html).toContain(`href="/insurer/claims/${CLAIM.id}?act=confirm"`);
  });
  it('NO survey, evidence, claimant, message or timeline block; no canon word; "7 years" absent; the refusals printed by name', () => {
    expect(html).not.toMatch(/data-kv-(survey|evidence|claimant|message|timeline|media)=/);
    expect(text(withoutRefusals(html))).not.toMatch(FALSE_3A); expect(w).not.toMatch(/7 years|seven years/i);
    expect(text(withoutRefusals(html))).not.toMatch(/surveyor:|notes:|photo \d|video \d/i);
    for (const k of partner3RefusalKeys('claim')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(w).toContain(en['partner3.claim.factsOnly']);
    expect(html).toContain('href="/insurer/claims"');
  });
  it('not found (never "not yours"), error, switched off', () => {
    const nf = text(render(null, en, null, true));
    expect(nf).toContain('Claim not found'); expect(nf).not.toMatch(/not yours|another (insurer|partner)/i);
    expect(render(null, en, 'error')).toContain('data-kv-state="error"');
    expect(render(null, en, 'insurance_off')).toContain('data-kv-state="insurance_off"');
    expect(render(null, en, 'off')).toContain('data-kv-state="off"');
  });
});
