// apps/web-partner/src/test-render/insurer-evidence-board.render.test.tsx · PC-56 PARTNER-3b · W256 EVIDENCE BOARD — AN HONEST PAGE: the claim's
// FACTS from the shared `ClaimFacts` wall (the same component W253 and W259 use) and the evidence statement where the canon draws a media board.
// No claimant, phone, place, tag, health record, surveyor, note, media item, file or URL exists to print. The three DECOR acts land on the
// W2866 chain; "Open the claim" and "Open the survey report" are real; the not-found state is "not found", never "not yours".
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerEvidenceBoardView } from '../components/partner3/InsurerEvidenceBoardView';
import { insurerFailureOf } from '../features/partner2/figures';
import { partner3RefusalKeys } from '../features/partner3/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { FALSE_3A, percents, withoutRefusals } from './partner3a-fixtures';
import { CLAIM_SURVEYED, FALSE_3B, IDENTITY_FIELDS, MEDIA_FILES, mediaCount } from './partner3b-fixtures';

const render = (c: Parameters<typeof InsurerEvidenceBoardView>[0]['c'], failure: Parameters<typeof InsurerEvidenceBoardView>[0]['failure'] = null, notFound = false, cat = en) =>
  renderToStaticMarkup(<InsurerEvidenceBoardView t={tr(cat)} lang="en" c={c} failure={failure} notFound={notFound} />);

describe('PC-56 PARTNER-3b · W256 the evidence board (render)', () => {
  const html = render(CLAIM_SURVEYED); const w = text(html);
  it('the claim\'s facts from the shared wall — the same fact rows W253 prints, and nothing of the evidence itself', () => {
    expect(html).toContain('data-kv-insurer="evidence_board"'); expect(html).toContain('data-kv-state="ok"');
    expect(html).toContain(`data-kv-facts="${CLAIM_SURVEYED.id}"`);
    for (const f of ['reference', 'policy', 'product', 'fpo', 'subject', 'event', 'event_date', 'reported', 'sum_insured', 'approved', 'damage', 'filed', 'changed', 'closed']) {
      expect([f, html.includes(`data-kv-fact="${f}"`)]).toEqual([f, true]);
    }
    expect(w).toContain('A crop season'); expect(w).toContain('INS-0001'); expect(w).toContain('62%');
    expect(percents(w)).toBe(1);   // the recorded damage percentage is the only "%" on the page
  });
  it('the founder\'s evidence statement, verbatim and pinned to its key; the facts-only line', () => {
    expect(html).toContain('data-kv-statement="partner3.evidence.statement"');
    expect(w).toContain(en['partner3.evidence.statement']);
    expect(w).toContain(en['partner3.claim.factsOnly']);
  });
  it('NO name, phone, place, tag, health record, surveyor, note, media item, file or URL; the refusals printed by name', () => {
    expect(text(withoutRefusals(html))).not.toMatch(FALSE_3A); expect(text(withoutRefusals(html))).not.toMatch(FALSE_3B);
    expect(html).not.toMatch(IDENTITY_FIELDS);
    expect(html).not.toMatch(MEDIA_FILES); expect(mediaCount(text(withoutRefusals(html)))).toEqual([]);
    for (const k of partner3RefusalKeys('evidence_board')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(w).toContain(en['partner3.refusal.boardIdentity']);
  });
  it('the three DECOR acts land on the W2866 chain (no <form>, no <button>); "Open the claim" and the report are real; "Back to claim evidence"', () => {
    expect([...html.matchAll(new RegExp(`href="/insurer/claims/evidence/${CLAIM_SURVEYED.id}\\?act=confirm"`, 'g'))].length).toBe(3);
    for (const d of ['reshoot', 'verify', 'retry']) expect([d, html.includes(`data-kv-decor="${d}"`)]).toEqual([d, true]);
    expect(w).toContain('Ask for new photos'); expect(w).toContain('Verify and schedule a survey');
    expect(html).toContain(`href="/insurer/claims/${CLAIM_SURVEYED.id}"`); expect(html).toContain('data-kv-real="claim"');
    expect(html).toContain(`href="/insurer/surveys/${CLAIM_SURVEYED.id}/report"`);
    expect(html).toContain('data-kv-back="/insurer/claims/evidence"');
    expect(html).not.toContain('<form'); expect(html).not.toContain('<button');
  });
  it('not found: "no claim with this reference is on your products" — never "not yours", never a 403; the error state re-reads', () => {
    const nf = render(null, null, true);
    expect(nf).toContain('data-kv-state="not_found"'); expect(text(nf)).toContain('Claim not found');
    expect(text(nf)).toContain('No claim with this reference is on your products.');
    expect(text(nf)).not.toMatch(/not yours|another insurer|forbidden|403/i);
    const x = render(null, insurerFailureOf(500, 'INTERNAL', 'on'));
    expect(x).toContain('data-kv-state="error"'); expect(text(x)).toContain('Nothing is broken on the platform\'s side');
    expect(x).toContain('href="/insurer/claims/evidence?act=confirm"');
  });
  it('switched off (both switches); hi and gu print their own statement', () => {
    expect(render(null, insurerFailureOf(404, 'NOT_FOUND', 'off'))).toContain('data-kv-state="off"');
    expect(render(null, insurerFailureOf(404, 'PARTNER_INSURANCE_SWITCHED_OFF', 'unknown'))).toContain('data-kv-state="insurance_off"');
    for (const cat of [hi, gu]) expect(text(render(CLAIM_SURVEYED, null, false, cat))).toContain(cat['partner3.evidence.statement']);
  });
});
