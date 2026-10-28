// apps/web-partner/src/test-render/partner4c-chains.render.test.tsx · PC-56 PARTNER-4c — the three chains of the KCC pair, in every state
// (NINE canon pages):
//   • W2951–W2952 (`/lender/kcc/[id]/drawls?export=`) DECOR — no partner export plane: the mailbox line and the mailbox FACT. Its only
//     trigger is the drawls page's button, though the canon's donor, crumb and Back all name W216;
//   • W2953–W2956 (`/lender/kcc/[id]?form=`)          DECOR — THE PARTNER PANEL'S FIRST FOUR-STATE FORM CHAIN, with its own mailbox line.
//     NO state claims a confirm page (W2956's "Retry — back to confirm" is the mutate chain's wording — a canon defect), none offers an
//     earlier step (W2954's "Back to edit" skips its own error page), and none carries the mutate chain's body (W2955's — refused);
//   • W2957–W2959 (`/lender/kcc/[id]?act=`)           DECOR, NOT PARITY-DECOR — W217 reads nothing and W216's error state asks for its own
//     page again, so there is nothing to re-read and no control leads here at all.
// Every state prints the honest page's own statement first (the 2b precedent), then its refusals, and links BACK to the page it was opened
// from — never the canon's "Back → W216" from the drawls page.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderChain } from '../components/partner4/LenderChain';
import { PARTNER4_CHAINS, partner4RefusalKeys } from '../features/partner4/refusals';
import { kccDrawlsHref, kccHref } from '../features/partner4/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { percents, withoutRefusals } from './partner4a-fixtures';
import { FALSE_4C, KCC_LOAN, LEDGER_FIELDS, figuresBesideLedgerWords } from './partner4c-fixtures';

const MAILBOX = { kind: 'published', address: 'partners@example.org' } as const;
const ID = KCC_LOAN.id;
const CHAINS_4C = PARTNER4_CHAINS.filter((c) => c.wave === '4c');
/** Each chain is opened from a real address — the export chain from the drawls page, the other two from the KCC page. */
const BACK: Readonly<Record<string, string>> = { kcc_export: kccDrawlsHref(ID), kcc_form: kccHref(ID), kcc_act: kccHref(ID) };

describe('PC-56 PARTNER-4c · the KCC export, form and mutate chains (render)', () => {
  it('THREE chain entries over THREE canon chains, NINE canon pages — each file recorded once, on the page it is triggered from', () => {
    expect(CHAINS_4C.map((c) => c.id)).toEqual(['kcc_export', 'kcc_form', 'kcc_act']);
    expect(CHAINS_4C.flatMap((c) => c.files)).toEqual(['W2951', 'W2952', 'W2953', 'W2954', 'W2955', 'W2956', 'W2957', 'W2958', 'W2959']);
    expect(CHAINS_4C.flatMap((c) => c.states).length).toBe(9);           // 2 + 4 + 3 — one state per canon page
    expect(CHAINS_4C.filter((c) => c.mailbox).map((c) => c.id)).toEqual(['kcc_export', 'kcc_form']);
  });
  for (const c of CHAINS_4C) {
    it.each(c.states.map((s) => [s]))(`${c.id} · %s: the page's own statement, its sentence, its refusals, and the way back to the page it was opened from`, (state) => {
      const html = renderToStaticMarkup(<LenderChain t={tr(en)} chain={c.id} state={state} back={BACK[c.id]} mailbox={MAILBOX} />);
      const w = text(html);
      expect(html).toContain(`data-kv-chain="${c.id}"`);
      expect(html).toContain(`data-kv-chain-state="${state}"`);
      expect(html).toContain(`data-kv-statement="${c.statement}"`);
      expect(w).toContain(en[c.statement as string]);
      expect(w).toContain(en[`${c.key(state)}.title`]);
      expect(w).toContain(en[`${c.key(state)}.body`]);
      for (const k of partner4RefusalKeys(c.surface)) expect([k, w.includes(en[k])]).toEqual([k, true]);
      expect(html).toContain(`href="${BACK[c.id]}"`);
      expect(html).toContain(`data-kv-back="${BACK[c.id]}"`);
      expect(html).not.toContain('[id]');
      // NO form on a form chain, no act on a mutate chain, no figure of the ledger and no percentage anywhere
      expect(html).not.toMatch(/<input|<select|<label|<form|<button/);
      expect(percents(w)).toBe(0);
      expect(MONEY.test(w)).toBe(false);
      expect(figuresBesideLedgerWords(w)).toEqual([]);
      expect(LEDGER_FIELDS.test(withoutRefusals(html))).toBe(false);
      expect(FALSE_4C.test(text(withoutRefusals(html)))).toBe(false);
    });
  }
  it('THE FORM CHAIN claims NO confirm page and offers NO earlier step — W2956\'s two canon defects, and W2955\'s mutate-chain body, all refused', () => {
    for (const state of ['error', 'review', 'success', 'failure'] as const) {
      const w = text(renderToStaticMarkup(<LenderChain t={tr(en)} chain="kcc_form" state={state} back={BACK.kcc_form} mailbox={MAILBOX} />));
      expect([state, /back to confirm|confirm page|confirm step/i.test(w)]).toEqual([state, false]);
      expect([state, /back to edit|edit the form/i.test(w)]).toEqual([state, false]);
      // the canon's mutate body on a form page, refused twice over
      expect([state, /the audit trail has the entry|reconcile zero-sum/i.test(w)]).toEqual([state, false]);
      expect([state, w.includes(en['partner4.refusal.chainAudit'])]).toEqual([state, true]);
      expect([state, w.includes(en['partner4.refusal.chainZeroSum'])]).toEqual([state, true]);
    }
    expect(en['partner4.chain.kccForm.failure.body']).toMatch(/no page of it asks you to confirm anything/);
    expect(en['partner4.chain.kccForm.error.body']).toMatch(/no table, no route, no permission and no form/);
    expect(en['partner4.chain.kccForm.review.body']).toMatch(/no second person waits to check it/);
  });
  it('THE MUTATE CHAIN says there is nothing to read again — it is not the `act` chains\' PARITY-DECOR re-read (founder 4c-1)', () => {
    const w = text(renderToStaticMarkup(<LenderChain t={tr(en)} chain="kcc_act" state="confirm" back={BACK.kcc_act} />));
    expect(w).toContain(en['partner4.chain.kccAct.confirm.body']);
    expect(w).not.toContain(en['partner4.chain.act.confirm.body']);
    expect(en['partner4.chain.kccAct.confirm.body']).toMatch(/nothing to load again/);
    expect(en['partner4.chain.kccAct.failure.body']).toMatch(/no control on either of these two pages is wired to this step/);
  });
  it('the export chain prints the mailbox line and the mailbox FACT; the FORM chain prints ITS OWN line instead; the mutate chain prints neither', () => {
    const exp = renderToStaticMarkup(<LenderChain t={tr(en)} chain="kcc_export" state="queued" back={BACK.kcc_export} mailbox={MAILBOX} />);
    expect(exp).toContain('data-kv-export-note="true"');
    expect(text(exp)).toContain(en['partner4.export.notAvailable']);
    expect(exp).toContain('partners@example.org');
    expect(text(exp)).not.toMatch(/sha256|checksum|signed URL|row count/i);
    const form = renderToStaticMarkup(<LenderChain t={tr(en)} chain="kcc_form" state="review" back={BACK.kcc_form} mailbox={MAILBOX} />);
    expect(form).toContain('data-kv-export-note="true"');
    expect(text(form)).toContain(en['partner4.kcc.proposeLimitChange']);
    expect(text(form)).not.toContain(en['partner4.export.notAvailable']);
    expect(form).toContain('partners@example.org');
    expect(renderToStaticMarkup(<LenderChain t={tr(en)} chain="kcc_act" state="confirm" mailbox={MAILBOX} />)).not.toContain('data-kv-export-note');
  });
  it('every state of every 4c chain renders in hi and gu too, with the same markup skeleton', () => {
    for (const c of CHAINS_4C) {
      for (const state of c.states) {
        const shapes = [en, hi, gu].map((cat) => {
          const html = renderToStaticMarkup(<LenderChain t={tr(cat)} chain={c.id} state={state} back={BACK[c.id]} mailbox={MAILBOX} />);
          expect(text(html)).toContain(cat[`${c.key(state)}.body`]);
          expect(text(html)).toContain(cat[c.statement as string]);
          return (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
        });
        expect([c.id, state, new Set(shapes).size]).toEqual([c.id, state, 1]);
      }
    }
  });
});
