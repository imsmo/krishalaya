// apps/web-partner/src/test-render/partner4b-chains.render.test.tsx · PC-56 PARTNER-4b — the four chains of this wave, in every state:
//   • W2863–W2865 (`/lender/disbursements?act=`)      DECOR — the canon's primary money act, refused by name (FLOWMAP classed it `filter`);
//   • W2860–W2862 (`/lender/disbursements/[id]?act=`) DECOR — "Co-approve — disburse now", refused by name (FLOWMAP classed it `nav-detail`);
//   • W2994–W2995 (`/lender/repayments?export=`)      DECOR — no partner export plane: the mailbox line and the mailbox FACT;
//   • W2996–W2998 (`/lender/repayments?act=`)         PARITY-DECOR — Retry is a re-read of the counts.
// Each state prints its own true sentence and its refusals, and links BACK to the page it was opened from — never a route pattern, never the
// canon's own return defect. The two pay chains say the act does not exist here; they never say "we read it again".
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderChain } from '../components/partner4/LenderChain';
import { PARTNER4_CHAINS, partner4RefusalKeys } from '../features/partner4/refusals';
import { batchHref } from '../features/partner4/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { percents, withoutRefusals } from './partner4a-fixtures';
import { FALSE_4B } from './partner4b-fixtures';

const MAILBOX = { kind: 'published', address: 'partners@example.org' } as const;
const BATCH_PAGE = batchHref('0192d2c4-c001-7000-8000-000000000001');
const CHAINS_4B = PARTNER4_CHAINS.filter((c) => c.wave === '4b');
/** The singular chain belongs to ONE batch page, so the page passes its own address; the other three return to their list page. */
const BACK: Readonly<Record<string, string | undefined>> = { disbursement_act: BATCH_PAGE };

describe('PC-56 PARTNER-4b · the pay-out and repayment chains (render)', () => {
  it('FOUR chain entries over FOUR canon chains, ELEVEN canon pages — each file recorded once, on the page the canon returns to', () => {
    expect(CHAINS_4B.map((c) => c.id)).toEqual(['disbursements_act', 'disbursement_act', 'repayments_export', 'repayments_act']);
    expect(CHAINS_4B.flatMap((c) => c.files)).toEqual(['W2863', 'W2864', 'W2865', 'W2860', 'W2861', 'W2862', 'W2994', 'W2995', 'W2996', 'W2997', 'W2998']);
    expect(CHAINS_4B.filter((c) => c.mailbox).map((c) => c.id)).toEqual(['repayments_export']);
  });
  for (const c of CHAINS_4B) {
    it.each(c.states.map((s) => [s]))(`${c.id} · %s: its own sentence, its refusals, the way back to the page it was opened from`, (state) => {
      const back = BACK[c.id];
      const html = renderToStaticMarkup(<LenderChain t={tr(en)} chain={c.id} state={state} back={back} mailbox={MAILBOX} />);
      const w = text(html);
      expect(html).toContain(`data-kv-chain="${c.id}"`);
      expect(html).toContain(`data-kv-chain-state="${state}"`);
      expect(w).toContain(en[`${c.key(state)}.title`]);
      expect(w).toContain(en[`${c.key(state)}.body`]);
      for (const k of partner4RefusalKeys(c.surface)) expect([k, w.includes(en[k])]).toEqual([k, true]);
      expect(html).toContain(`href="${back ?? c.page}"`);
      expect(html).toContain(`data-kv-back="${back ?? c.page}"`);
      expect(html).not.toContain('[id]');
      // no form, no act, no money figure and no percentage on any chain state
      expect(html).not.toMatch(/<input|<select|<label|<form|<button/);
      expect(percents(w)).toBe(0);
      expect(MONEY.test(w)).toBe(false);
      expect(FALSE_4B.test(text(withoutRefusals(html)))).toBe(false);
    });
  }
  it('the two PAY chains refuse the act; only the repayments mutate chain is the PARITY-DECOR re-read', () => {
    for (const id of ['disbursements_act', 'disbursement_act'] as const) {
      const w = text(renderToStaticMarkup(<LenderChain t={tr(en)} chain={id} state="confirm" back={BACK[id]} />));
      expect(w).toContain(en['partner4.chain.pay.confirm.body']);
      expect(w).not.toContain(en['partner4.chain.act.confirm.body']);
    }
    const retry = text(renderToStaticMarkup(<LenderChain t={tr(en)} chain="repayments_act" state="confirm" />));
    expect(retry).toContain(en['partner4.chain.act.confirm.body']);
    expect(en['partner4.chain.pay.confirm.body']).toMatch(/no control here is wired to anything that could move any/);
    expect(en['partner4.chain.pay.failure.body']).toMatch(/Your approvals are the part that is yours/);
  });
  it('the export chain prints the mailbox line and the mailbox FACT, and never a receipt it cannot produce', () => {
    const html = renderToStaticMarkup(<LenderChain t={tr(en)} chain="repayments_export" state="queued" mailbox={MAILBOX} />);
    expect(html).toContain('data-kv-export-note="true"');
    expect(text(html)).toContain(en['partner4.export.notAvailable']);
    expect(html).toContain('partners@example.org');
    expect(text(html)).not.toMatch(/sha256|checksum|signed URL|row count/i);
    // the two act chains carry no mailbox note at all
    for (const id of ['disbursements_act', 'repayments_act'] as const) {
      expect(renderToStaticMarkup(<LenderChain t={tr(en)} chain={id} state="confirm" mailbox={MAILBOX} />)).not.toContain('data-kv-export-note');
    }
  });
  it('every state of every 4b chain exists in hi and gu too, with the same markup skeleton', () => {
    for (const c of CHAINS_4B) {
      for (const state of c.states) {
        const shapes = [en, hi, gu].map((cat) => {
          const html = renderToStaticMarkup(<LenderChain t={tr(cat)} chain={c.id} state={state} back={BACK[c.id]} mailbox={MAILBOX} />);
          expect(text(html)).toContain(cat[`${c.key(state)}.body`]);
          return (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
        });
        expect([c.id, state, new Set(shapes).size]).toEqual([c.id, state, 1]);
      }
    }
  });
});
