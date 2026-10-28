// apps/web-partner/src/test-render/lender-kcc-drawls.render.test.tsx · PC-56 PARTNER-4c · W217 (canon `lender/kcc/[id]/drawls`) — AN HONEST
// PAGE WITH NOTHING OF THE LEDGER ON IT (founder 4c-1). The load-bearing assertions are the founder's own sentence; the absence of EVERY
// figure of the ledger — asserted as NO DIGIT BESIDE A DRAWL, BALANCE OR INTEREST WORD, in all three languages, and no field of the table
// named in the markup; the canon's one true sentence kept; "Export (signed)" as DECOR into the export chain; the crumb back to W216 (the
// canon's own edge that FLOWMAP omits); the stale backend banner never printed; and NO ERROR STATE, because the page makes no read.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderKccDrawlsView } from '../components/partner4/LenderKccDrawlsView';
import { partner4RefusalKeys } from '../features/partner4/refusals';
import { kccDrawlsHref, kccHref } from '../features/partner4/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { IDENTITY_4A, percents, withoutRefusals } from './partner4a-fixtures';
import { FALSE_4C, KCC_LOAN, LEDGER_FIELDS, figuresBesideLedgerWords } from './partner4c-fixtures';

const ID = KCC_LOAN.id;
const r = (state: 'ok' | 'off' | 'error' = 'ok', cat: Record<string, string> = en) =>
  renderToStaticMarkup(<LenderKccDrawlsView t={tr(cat)} state={state} loanId={ID} />);

describe('PC-56 PARTNER-4c · W217 the drawl-ledger page (render)', () => {
  it('THE FOUNDER\'S SENTENCE (4c-1) — the ledger is the organisation\'s own record, it is not a money movement, and it is not shown here — in all three languages', () => {
    for (const cat of [en, hi, gu]) {
      const html = r('ok', cat);
      expect(html).toContain('data-kv-statement="notShown"');
      expect(html).toContain('data-kv-statement="partner4.drawls.statement"');
      expect(text(html)).toContain(cat['partner4.drawls.statement']);
      expect(text(html)).toContain(cat['partner4.drawls.notMoney']);
      expect(text(html)).toContain(cat['partner4.drawls.whenShown']);
      expect(html).toContain('data-kv-statement="ownRecord"');
      expect(text(html)).toContain(cat['partner4.drawls.ownRecord']);
      expect(text(html)).toContain(cat['partner4.drawls.integrityOwed']);
      // the canon's ONE true sentence, kept
      expect(text(html)).toContain(cat['partner4.drawls.zeroTruth']);
    }
    expect(en['partner4.drawls.statement']).toMatch(/It is not a money movement on this platform, and it is not shown here\.$/);
  });
  it('NOT ONE FIGURE OF THE LEDGER: no digit beside a drawl, balance or interest word, in any language and in any state; no money, no percentage, no table', () => {
    for (const cat of [en, hi, gu]) {
      for (const state of ['ok', 'error'] as const) {
        const w = text(r(state, cat));
        expect([state, figuresBesideLedgerWords(w)]).toEqual([state, []]);
        expect([state, MONEY.test(w)]).toEqual([state, false]);
        expect([state, percents(w)]).toEqual([state, 0]);
      }
    }
    const html = r();
    expect(html).not.toContain('<table');
    expect(html).not.toContain('data-kv-count');
    expect(html).not.toContain('data-kv-asof');
    // and no FIELD of the table is named in the markup — not the entry kind, the amount, the running balance, the note, the destination,
    // the purpose check, the channel, the accrual basis or the money-record anchor
    // the refusal list NAMES what it refuses (its markers carry words like `drawl_narrative`), so the field scan runs over the page without it
    expect(LEDGER_FIELDS.test(withoutRefusals(html))).toBe(false);
    expect(IDENTITY_4A.test(withoutRefusals(html))).toBe(false);
    for (const cat of [en, hi, gu]) expect(FALSE_4C.test(text(withoutRefusals(r('ok', cat))))).toBe(false);
  });
  it('the canon\'s own stale backend banner is NEVER printed (founder 4c-4), and "append-only and safe" is refused rather than said (4c-5)', () => {
    for (const cat of [en, hi, gu]) {
      const w = text(r('ok', cat));
      expect(/DELTA-032|Backend pending|Design leads/i.test(w)).toBe(false);
      expect(/append-?only/i.test(w)).toBe(false);
    }
    expect(r()).toContain('data-kv-refusal="append_only_safe"');
    expect(text(r())).toContain(en['partner4.refusal.appendOnlySafe']);
  });
  it('the ledger rows, the notes, the arithmetic, the purpose check, the count of entries and the borrower\'s own sight of it are refused BY NAME (eight of them)', () => {
    const html = r(); const w = text(html);
    const keys = partner4RefusalKeys('kcc_drawls');
    expect(keys.length).toBeGreaterThanOrEqual(8);
    for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const id of ['drawl_ledger_rows', 'drawl_narrative', 'accrual_arithmetic', 'interest_on_drawn_only', 'drawl_purpose_check',
      'append_only_safe', 'borrower_sees_always', 'entries_since_opening', 'borrower_identity', 'platform_roles', 'plan_settings']) {
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    }
    // the purpose-check sentence is refused for its REASONING as well as for the fact (the W263 lesson)
    expect(en['partner4.refusal.drawlPurposeCheck']).toMatch(/does not tell a lender what a farmer might do with her own loan/);
  });
  it('"Export (signed)" is DECOR into the export chain; the crumb goes back to the KCC page (the canon\'s own edge, omitted by FLOWMAP); no form, no act', () => {
    const html = r();
    expect(html).toContain('data-kv-decor="export"');
    expect(html).toContain(`href="${kccDrawlsHref(ID)}?export=queued"`);
    expect(html).toContain(`data-kv-back="${kccHref(ID)}"`);
    expect(html).toContain('data-kv-real="kcc"');
    expect(html).toContain('data-kv-subnav="lending"');
    expect(html).not.toContain('aria-current="page"');      // the drawls page is not a sub-navigation row of its own
    expect(html).not.toMatch(/<input|<select|<label|<form|<button/);
    // no LINK target is left a route pattern (the sub-navigation row keeps the pattern as its own marker, and resolves the href)
    expect([...html.matchAll(/href="([^"]*)"/g)].filter(([, h]) => h.includes('['))).toEqual([]);
  });
  it('NO ERROR STATE of its own — the page makes no read, so an unreadable flag map still prints the honest page; and OFF reads as OFF', () => {
    const err = r('error');
    expect(err).toContain('data-kv-state="error"');
    expect(err).not.toContain('role="alert"');
    expect(text(err)).toContain(en['partner4.drawls.statement']);
    expect(text(err)).not.toMatch(/could not be read|try again/i);
    const off = r('off');
    expect(off).toContain('data-kv-state="off"');
    expect(text(off)).toContain(en['partner.off.body']);
    expect(text(off)).not.toMatch(/unavailable|lending is (switched )?off/i);
  });
});
