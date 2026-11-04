// apps/web-partner/src/test-render/partner5a-chains.render.test.tsx · PC-56 PARTNER-5a — the four chains of this wave, in every state:
//   • W2929–W2930 (`/lender/portfolio/aging?export=`)      DECOR — no partner export plane: the mailbox line and the mailbox FACT;
//   • W2931–W2933 (`/lender/portfolio/aging?act=`)         PARITY-DECOR — Retry is a genuine re-read of the dpd read;
//   • W3024–W3025 (`/lender/portfolio/writeoffs?export=`)  DECOR — nothing is prepared for a board; the mailbox line;
//   • W3026–W3028 (`/lender/portfolio/writeoffs?act=`)     PARITY-DECOR — Retry re-reads the counts and the list.
// Each state prints its own sentence and its refusals, and links BACK to the page that triggered it. No form, no act, no money, no "%".
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderChain5 } from '../components/partner5/LenderChain5';
import { PARTNER5_CHAINS, partner5RefusalKeys } from '../features/partner5/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { percents, withoutRefusals } from './partner4a-fixtures';
import { FALSE_5A } from './partner5a-fixtures';

const MAILBOX = { kind: 'published', address: 'partners@example.org' } as const;
// PC-56 PARTNER-5b · NAMED UPDATE: PARTNER5_CHAINS now also holds 5b's four chains (their own spec: partner5b-chains.render). This file is
// about 5a's four, so it reads exactly those — the assertions on them are unchanged.
const CHAINS_5A = PARTNER5_CHAINS.filter((c) => c.wave === '5a');

describe('PC-56 PARTNER-5a · the four arrears chains (render)', () => {
  it('FOUR chain entries over FOUR canon chains, TEN canon pages, each recorded once on its triggering page', () => {
    expect(CHAINS_5A.map((c) => [c.id, c.page])).toEqual([
      ['aging_export', '/lender/portfolio/aging'], ['aging_act', '/lender/portfolio/aging'],
      ['writeoffs_export', '/lender/portfolio/writeoffs'], ['writeoffs_act', '/lender/portfolio/writeoffs']]);
    expect(CHAINS_5A.flatMap((c) => c.files)).toEqual(['W2929', 'W2930', 'W2931', 'W2932', 'W2933', 'W3024', 'W3025', 'W3026', 'W3027', 'W3028']);
  });
  for (const c of CHAINS_5A) {
    it.each(c.states.map((s) => [s]))(`${c.id} · %s: its own sentence, its refusals, Back to the triggering page`, (state) => {
      const html = renderToStaticMarkup(<LenderChain5 t={tr(en)} chain={c.id} state={state} mailbox={MAILBOX} />);
      const w = text(html);
      expect(html).toContain(`data-kv-chain="${c.id}"`);
      expect(html).toContain(`data-kv-chain-state="${state}"`);
      expect(w).toContain(en[`${c.key(state)}.title`]);
      expect(w).toContain(en[`${c.key(state)}.body`]);
      const keys = partner5RefusalKeys(c.surface);
      expect(keys.length).toBeGreaterThanOrEqual(3);
      for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
      expect(html).toContain(`href="${c.page}"`);
      expect(html).toContain(`data-kv-back="${c.page}"`);
      expect(html).not.toContain('[id]');
      expect(html).not.toMatch(/<input|<select|<label|<form|<button|<textarea/);
      expect(percents(w)).toBe(0);
      expect(MONEY.test(w)).toBe(false);
      expect(FALSE_5A.test(text(withoutRefusals(html)))).toBe(false);
      // the export chains print the mailbox line and FACT; the act chains carry none
      if (c.mailbox) {
        expect(html).toContain('data-kv-export-note="true"');
        expect(w).toContain(en['partner4.export.notAvailable']);
        expect(html).toContain('partners@example.org');
        expect(w).not.toMatch(/sha256|checksum|signed URL|row count/i);
      } else {
        expect(html).not.toContain('data-kv-export-note');
      }
    });
  }
  it('the act chains are PARITY-DECOR: Retry is a genuine re-read, with no confirm step and no audit row of its own', () => {
    for (const id of ['aging_act', 'writeoffs_act']) {
      const body = en[`partner5.chain.${id === 'aging_act' ? 'agingAct' : 'writeoffsAct'}.confirm.body`];
      expect(body).toMatch(/genuine re-read/);
      expect(body).toMatch(/no confirm step/);
      expect(body).toMatch(/no audit row of its own/);
    }
    // the export chains name the board's file only to refuse it
    expect(partner5RefusalKeys('writeoffs_export')).toContain('partner5.refusal.boardPack');
    expect(partner5RefusalKeys('aging_export')).not.toContain('partner5.refusal.boardPack');
  });
  it('every state of every chain exists in hi and gu too, with the same markup skeleton', () => {
    for (const c of CHAINS_5A) for (const state of c.states) {
      const shapes = [en, hi, gu].map((cat) => {
        const html = renderToStaticMarkup(<LenderChain5 t={tr(cat)} chain={c.id} state={state} mailbox={MAILBOX} />);
        expect(text(html)).toContain(cat[`${c.key(state)}.body`]);
        expect(percents(text(html))).toBe(0);
        return (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
      });
      expect([c.id, state, new Set(shapes).size]).toEqual([c.id, state, 1]);
    }
  });
});
