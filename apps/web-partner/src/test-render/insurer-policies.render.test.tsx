// apps/web-partner/src/test-render/insurer-policies.render.test.tsx · PC-56 PARTNER-2a · W248 the policies on the insurer's products — POLICY
// FACTS ONLY (founder Q6): no name, no phone, no animal tag, no health line, no holder; "no policy number yet" when the number is NULL (Q5 —
// never an invented number); the FPO by its public name ("an organisation" when not live); the status filter and the keyset link are the only
// things in a URL; "Export book" is DECOR (W2881–W2882). M8-class leaks (a holder column) would show here.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerPoliciesView } from '../components/partner2/InsurerPoliciesView';
import { listState } from '../features/partner2/figures';
import { partner2RefusalKeys } from '../features/partner2/refusals';
import { en } from '../i18n/en';
import { text, tr } from './partner1a-fixtures';
import { FALSE_2A, POLICIES } from './partner2a-fixtures';

describe('PC-56 PARTNER-2a · W248 the policies (render)', () => {
  const html = renderToStaticMarkup(<InsurerPoliciesView t={tr(en)} lang="en" state={listState(POLICIES, null)} items={POLICIES} status="active" nextCursor="Y3Vyc29y" computedAt="2026-10-18T06:30:00.000Z" />);
  const w = text(html);
  it('the columns are policy facts: number or "no policy number yet", product, organisation, subject TYPE, sum insured, farmer premium, status, dates', () => {
    expect(w).toContain('no policy number yet'); expect(w).toContain('INS-FIXTURE-0002');
    expect(w).toContain('Fixture Growers Collective'); expect(w).toContain('an organisation');
    expect(w).toContain('An animal'); expect(w).toContain('A crop season');
    expect(w).toContain('₹1,60,000.00'); expect(w).toContain('₹5,120.00');
    expect(w).toContain('In force'); expect(w).toContain('Proposed');
    expect(html).toContain(`href="/insurer/policies/${POLICIES[0].id}"`);
    for (const h of ['Policy', 'Product', 'Organisation', 'Covers', 'Sum insured', 'Farmer\'s premium', 'Status', 'Valid']) expect(w).toContain(h);
  });
  it('NO identity column, value or word; the identity refusal printed by name', () => {
    expect(w).not.toMatch(/holder name|phone number|ear|vaccin|health|Aadhaar/i);
    expect(html).not.toMatch(/holderUserId|subjectId|tenantId|premiumPaymentId/);
    for (const k of partner2RefusalKeys('ins_policies')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(w).toContain(en['partner2.refusal.holderIdentity']);
    expect(w).not.toMatch(FALSE_2A);
  });
  it('the keyset link keeps the filter; the filter chips are the state machine\'s six; Export is DECOR (no form)', () => {
    expect(html).toContain('href="/insurer/policies?status=active&amp;cursor=Y3Vyc29y"');
    for (const s of ['proposed', 'active', 'lapsed', 'cancelled', 'expired', 'claimed']) expect(html).toContain(`data-kv-status-filter="${s}"`);
    expect(html).toContain('href="/insurer/policies?export=queued"'); expect(html).not.toContain('<form');
  });
  it('empty / error states', () => {
    expect(text(renderToStaticMarkup(<InsurerPoliciesView t={tr(en)} lang="en" state="empty" items={[]} nextCursor={null} computedAt={null} />))).toContain(en['partner2.policies.empty.title']);
    const x = renderToStaticMarkup(<InsurerPoliciesView t={tr(en)} lang="en" state="error" items={[]} nextCursor={null} computedAt={null} />);
    expect(x).toContain('href="/insurer/policies?retry=confirm"'); expect(x).not.toMatch(/unavailable/i);
  });
});
