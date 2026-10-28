// apps/web-partner/src/test-render/partner4a-chains.render.test.tsx · PC-56 PARTNER-4a — every DECOR / PARITY-DECOR chain state of this wave
// renders its own true sentence, its refusals, and links back to the page it was opened FROM — never the canon's "Back → W206" from W207 and
// W215, and never the loan export chain's crumb, which names W206 although W215's button is its only trigger (F-22):
//   • W2878–W2880 (`?act=` on the queue, the application and the loan — PARITY-DECOR: a re-read; "Take next" is DECOR);
//   • W2876–W2877 (`/lender/portfolio/[id]?export=` — the mailbox line and the mailbox FACT);
//   • W2891–W2892 (`/lender/portfolio?export=` — likewise);
//   • W2893–W2895 (`/lender/portfolio?act=` — PARITY-DECOR: a re-read of the counts).
// No form, no act, nothing written; no rupee figure and no percentage anywhere.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderChain } from '../components/partner4/LenderChain';
import { PARTNER4_CHAINS, partner4RefusalKeys } from '../features/partner4/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { FALSE_4A, percents, withoutRefusals } from './partner4a-fixtures';

const MAILBOX = { kind: 'published', address: 'partners@example.org' } as const;
const APPLICATION_PAGE = '/lender/queue/0192d2c4-a001-7000-8000-000000000001';
const LOAN_PAGE = '/lender/portfolio/0192d2c4-c001-7000-8000-000000000001';
const BACK: Readonly<Record<string, string | undefined>> = {
  application_act: APPLICATION_PAGE, loan_act: LOAN_PAGE, loan_export: LOAN_PAGE,
};

describe('PC-56 PARTNER-4a · the lending chains (render)', () => {
  it('SIX chain entries over FOUR canon chains, ten canon pages — each file recorded once, on the page the chain is triggered from', () => {
    expect(PARTNER4_CHAINS.map((c) => c.id)).toEqual(['queue_act', 'application_act', 'loan_act', 'loan_export', 'portfolio_export', 'portfolio_act']);
    expect(PARTNER4_CHAINS.flatMap((c) => c.files)).toEqual(['W2878', 'W2879', 'W2880', 'W2876', 'W2877', 'W2891', 'W2892', 'W2893', 'W2894', 'W2895']);
  });
  for (const c of PARTNER4_CHAINS) {
    it.each(c.states.map((s) => [s]))(`${c.id} · %s: its sentence, its refusals, the way back to its OWN page — nothing written`, (state) => {
      const back = BACK[c.id];
      const html = renderToStaticMarkup(<LenderChain t={tr(en)} chain={c.id} state={state} back={back} mailbox={MAILBOX} />);
      const w = text(html);
      expect(html).toContain(`data-kv-chain="${c.id}"`);
      expect(html).toContain(`data-kv-chain-state="${state}"`);
      expect(w).toContain(en[`${c.key(state)}.title`]);
      expect(w).toContain(en[`${c.key(state)}.body`]);
      for (const k of partner4RefusalKeys(c.surface)) expect([k, w.includes(en[k])]).toEqual([k, true]);
      // the way back is the page it was opened FROM, never a route pattern and never the canon's W206
      expect(html).toContain(`href="${back ?? c.page}"`);
      expect(html).toContain(`data-kv-back="${back ?? c.page}"`);
      expect(html).not.toContain('[id]');
      expect(html).not.toMatch(/W206|W207|W212|W215|back to confirm/i);
      expect(html).not.toContain('<form');
      expect(text(withoutRefusals(html))).not.toMatch(FALSE_4A);
      expect(w).not.toMatch(MONEY);
      expect(percents(w)).toBe(0);
      if (c.mailbox) {
        expect(w).toContain(en['partner4.export.notAvailable']);
        expect(html).toContain('data-kv-export-note="true"');
        expect(html).toContain('href="mailto:partners@example.org"');
      } else {
        expect(html).not.toContain('data-kv-export-note');
      }
      for (const cat of [hi, gu]) {
        expect(text(renderToStaticMarkup(<LenderChain t={tr(cat)} chain={c.id} state={state} back={back} />))).toContain(cat[`${c.key(state)}.title`]);
      }
    });
  }
  it('a record\'s own chain WITHOUT a back link falls back to the list page, never to a route pattern', () => {
    for (const id of ['application_act', 'loan_act', 'loan_export'] as const) {
      const html = renderToStaticMarkup(<LenderChain t={tr(en)} chain={id} state={id === 'loan_export' ? 'queued' : 'success'} />);
      const expected = id === 'application_act' ? '/lender/queue' : '/lender/portfolio';
      expect([id, html.includes(`href="${expected}"`)]).toEqual([id, true]);
      expect([id, html.includes('[id]')]).toEqual([id, false]);
    }
  });
  it('"Take next" lands on the queue\'s re-read with its refusal: nothing is taken; an export chain with no published mailbox says so', () => {
    expect(text(renderToStaticMarkup(<LenderChain t={tr(en)} chain="queue_act" state="confirm" />))).toContain(en['partner4.refusal.takeNext']);
    expect(text(renderToStaticMarkup(<LenderChain t={tr(en)} chain="portfolio_export" state="queued" mailbox={{ kind: 'none' }} />))).toContain(en['partner1.ops.mailboxNone']);
    expect(text(renderToStaticMarkup(<LenderChain t={tr(en)} chain="loan_export" state="ready" mailbox={{ kind: 'error' }} />))).toContain(en['partner1.ops.mailboxError']);
  });
  it('the switched-off state of a lending page says switched off — never "unavailable", and never "lending is off" (there is no lending flag on this axis)', () => {
    const { LenderSwitchedOff } = require('../components/partner4/LenderChain') as typeof import('../components/partner4/LenderChain');
    const html = renderToStaticMarkup(<LenderSwitchedOff t={tr(en)} page="portfolio" />);
    expect(html).toContain('data-kv-state="off"');
    expect(text(html)).toContain(en['partner.off.title']);
    expect(text(html)).toContain(en['partner.off.body']);
    expect(text(html)).not.toMatch(/unavailable|lending is (switched )?off/i);
  });
});
