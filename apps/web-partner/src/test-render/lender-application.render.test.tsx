// apps/web-partner/src/test-render/lender-application.render.test.tsx · PC-56 PARTNER-4a · W207 ONE APPLICATION (canon `lender/queue/[id]`) —
// the facts, the terms as the PRODUCT'S TODAY in integer basis points, the consent block kept almost verbatim with the "no consent recorded
// yet" state, and the two REAL acts for a checker. The whole credit-score half of the canon screen is ONE refusal; every document row, the
// voice consent, the delivered reason and the "mandatory" note are refused by name. There is no disbursal control, and the approved state
// prints the sentence that says why.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderApplicationView } from '../components/partner4/LenderApplicationView';
import { partner4RefusalKeys } from '../features/partner4/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { APPLICATION, APPLICATION_APPROVED, FALSE_4A, IDENTITY_4A, percents, withoutRefusals } from './partner4a-fixtures';

const NOOP = async () => undefined;
const ACTIONS = { review: NOOP, approve: NOOP, reject: NOOP };
const CHECKER = ['partner.applications.read', 'partner.applications.decide'];
const MAKER = ['partner.applications.read', 'partner.applications.review'];
const VIEWER = ['partner.applications.read'];
type Props = Parameters<typeof LenderApplicationView>[0];
const r = (over: Partial<Props> = {}) => renderToStaticMarkup(
  <LenderApplicationView t={tr(en)} lang="en" a={APPLICATION} failure={null} notFound={false} perms={CHECKER} idemKey="k-1" actions={ACTIONS} {...over} />);

describe('PC-56 PARTNER-4a · W207 one application (render)', () => {
  it('the facts are printed, the purpose waits for approval, and no identity field reaches the markup', () => {
    const html = r(); const w = text(html);
    expect(html).toContain('data-kv-lender="application"');
    expect(w).toContain('0192d2c4…');
    expect(html).toContain('data-kv-fact="product"'); expect(html).toContain('data-kv-fact="requested"');
    expect(w).toContain(en['partner4.application.purposeAfterApproval']);
    expect(html).toContain('data-kv-after-approval="true"');
    expect(html).not.toMatch(IDENTITY_4A);
    expect(html).not.toContain('0192d2c4-7001-7000-8000-000000000001');
    expect(percents(w)).toBe(0);
  });
  it('the terms say they are the PRODUCT\'S TODAY, and the cooling-off note is the one unqualified truth of the screen', () => {
    const html = r(); const w = text(html);
    expect(html).toContain('data-kv-terms-note="true"');
    expect(w).toContain(en['partner4.application.termsToday']);
    expect(html).toContain('data-kv-cooling-note="true"');
    expect(w).toContain(en['partner4.application.coolingNote']);
  });
  it('the consent block is kept — the wall in the designer\'s own words — plus the truth that nothing writes the consent row', () => {
    const html = r(); const w = text(html);
    expect(html).toContain('data-kv-consent="true"');
    expect(html).toContain('data-kv-statement="partner4.application.consentNone"');
    expect(w).toContain(en['partner4.application.consentNone']);
    expect(w).toContain(en['partner4.application.consentBound']);
    expect(w).toContain(en['partner4.application.consentGate']);
    expect(w).toContain(en['partner4.application.consentNotShared']);
  });
  it('the credit-score half of the canon screen is ONE refusal, in its own block — never a placeholder and never an empty panel', () => {
    const html = r();
    expect(html).toContain('data-kv-score="refused"');
    expect(html).toContain('data-kv-statement="partner4.refusal.creditScore"');
    expect(text(html)).toContain(en['partner4.refusal.creditScore']);
    // and no rating FIELD of any kind reaches the markup. The `data-kv-*` hooks carry the refusal's own i18n KEY, which names what is
    // refused — strip those attributes first, then scan what a reader actually gets.
    const bare = html.replace(/data-kv-(statement|refusal)="[^"]*"/g, '');
    expect(bare).not.toMatch(/creditScore|credit_score|scoreBand|score_band|modelVersion|model_version|"factors"|verifiedIncome|\b742\b|300–900/);
  });
  it('a CHECKER gets Approve and Reject as real forms with the page\'s minted key; a MAKER gets only Begin review; a VIEWER gets neither', () => {
    const checker = r({ perms: CHECKER, a: { ...APPLICATION, status: 'under_review' } });
    expect(checker).toContain('data-kv-act="approve"'); expect(checker).toContain('data-kv-act="reject"');
    expect(checker).toContain('value="k-1-approve"'); expect(checker).toContain('value="k-1-reject"');
    expect(checker).not.toContain('data-kv-act="review"');            // under review already
    const maker = r({ perms: MAKER, a: { ...APPLICATION, status: 'submitted' } });
    expect(maker).toContain('data-kv-act="review"'); expect(maker).toContain('value="k-1-review"');
    expect(maker).not.toContain('data-kv-act="approve"');
    const viewer = r({ perms: VIEWER, a: { ...APPLICATION, status: 'under_review' } });
    for (const act of ['review', 'approve', 'reject']) expect([act, viewer.includes(`data-kv-act="${act}"`)]).toEqual([act, false]);
    expect(viewer).not.toContain('<form');
  });
  it('the reject reason is marked OPTIONAL — the canon called it mandatory and the DTO does not (survey E7)', () => {
    const html = r({ a: { ...APPLICATION, status: 'under_review' } });
    expect(html).toContain('data-kv-note-optional="true"');
    expect(text(html)).toContain(en['partner4.application.rejectReasonOptional']);
  });
  it('there is NO disbursal control anywhere, and an approved application prints the sentence that says whose money it is', () => {
    const approved = r({ a: APPLICATION_APPROVED, perms: CHECKER });
    expect(approved).toContain('data-kv-statement="partner4.application.disburseStatement"');
    expect(text(approved)).toContain(en['partner4.application.disburseStatement']);
    for (const html of [r(), approved]) {
      expect(html).not.toMatch(/data-kv-act="disburse"|name="disburse"|>Disburse/);
      expect(text(withoutRefusals(html))).not.toMatch(FALSE_4A);
    }
  });
  it('every refusal of the surface is printed BY NAME, in all three languages', () => {
    for (const cat of [en, hi, gu]) {
      const w = text(renderToStaticMarkup(
        <LenderApplicationView t={tr(cat)} lang="en" a={APPLICATION} failure={null} notFound={false} perms={CHECKER} idemKey="k-1" actions={ACTIONS} />));
      for (const k of partner4RefusalKeys('application')) expect([k, w.includes(cat[k])]).toEqual([k, true]);
    }
  });
  it('the states: not found (which never says whether it exists), error, and the console switched off', () => {
    const nf = r({ a: null, notFound: true });
    expect(nf).toContain('data-kv-state="not_found"');
    expect(text(nf)).toContain(en['partner4.application.notFound.body']);
    expect(text(nf)).toContain(en['partner4.application.consentGate']);
    expect(text(nf)).not.toMatch(/not yours|another lender|does not exist/i);
    const err = r({ a: null, failure: 'error' });
    expect(err).toContain('data-kv-state="error"'); expect(err).toContain('role="alert"');
    const off = r({ a: null, failure: 'off' });
    expect(off).toContain('data-kv-state="off"');
    expect(text(off)).toContain(en['partner.off.body']);
    expect(text(off)).not.toMatch(/unavailable/i);
  });
  it('the ok and error notices come from the whitelist only — an unknown query value prints nothing', () => {
    expect(text(r({ ok: 'approve' }))).toContain(en['partner4.application.ok.approve']);
    expect(text(r({ error: 'badAmount' }))).toContain(en['partner4.application.err.badAmount']);
    const junk = r({ ok: 'disbursed', error: '<script>' });
    expect(junk).not.toContain('role="status"');
    expect(junk).not.toContain('<script>');
  });
});
