// apps/web-partner/src/test-render/partner5b-chains.render.test.tsx · PC-56 PARTNER-5b — the four DECOR chains of the three honest
// collections pages, in every state (founder 5b-5):
//   • W2914–W2917 (`/lender/collections/[id]?form=`)             the collections FORM chain — NO mailbox line, no confirm page claimed;
//   • W2918–W2920 (`/lender/collections?act=`)                   the collections mutate chain — "Take next case" refused;
//   • (`/lender/collections/[id]?act=`, files on W219's chain)   the case's mutate chain;
//   • W2999–W3001 (`/lender/collections/[id]/restructure?act=`)  the restructure mutate chain — never the canon's acceptance order.
// Each state prints its page's pinned statement, its own sentence and its refusals, and links BACK to the TRIGGERING page — the case page
// for the form chain and the case act (never the canon's W219). No form, no act, no money, no "%". M4 / M6 kill here.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderChain5 } from '../components/partner5/LenderChain5';
import { PARTNER5_CHAINS, partner5RefusalKeys, type Chain5Id } from '../features/partner5/refusals';
import { collectionsCaseHref, restructureHref } from '../features/partner5/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { percents, withoutRefusals } from './partner4a-fixtures';
import { FALSE_5B, FORM_CONTROL, IDS } from './partner5b-fixtures';

const MAILBOX = { kind: 'published', address: 'partners@example.org' } as const;
const CHAINS_5B = PARTNER5_CHAINS.filter((c) => c.wave === '5b');
/** The page each 5b chain is opened FROM, exactly as the page passes it. */
const BACK: Record<string, string> = {
  collections_form: collectionsCaseHref(IDS.loan), collections_act: '/lender/collections',
  case_act: collectionsCaseHref(IDS.loan), restructure_act: restructureHref(IDS.loan),
};
const render = (chain: Chain5Id, state: string, cat: Record<string, string> = en) =>
  renderToStaticMarkup(<LenderChain5 t={tr(cat)} chain={chain} state={state} back={chain === 'collections_act' ? undefined : BACK[chain]} mailbox={MAILBOX} />);

describe('PC-56 PARTNER-5b · the four collections chains (render)', () => {
  it('FOUR 5b chain entries over THREE canon chains; TEN canon pages, each recorded once on its triggering page', () => {
    expect(CHAINS_5B.map((c) => [c.id, c.page, c.param])).toEqual([
      ['collections_form', '/lender/collections/[id]', 'form'], ['collections_act', '/lender/collections', 'act'],
      ['case_act', '/lender/collections/[id]', 'act'], ['restructure_act', '/lender/collections/[id]/restructure', 'act']]);
    expect(CHAINS_5B.flatMap((c) => c.files)).toEqual(['W2914', 'W2915', 'W2916', 'W2917', 'W2918', 'W2919', 'W2920', 'W2999', 'W3000', 'W3001']);
  });
  for (const c of CHAINS_5B) {
    it.each(c.states.map((s) => [s]))(`${c.id} · %s: the statement, its own sentence, its refusals, Back to the TRIGGERING page, no mailbox`, (state) => {
      const html = render(c.id, state);
      const w = text(html);
      expect(html).toContain(`data-kv-chain="${c.id}"`);
      expect(html).toContain(`data-kv-chain-state="${state}"`);
      expect(w).toContain(en[c.statement as string]);
      expect(html).toContain(`data-kv-statement="${c.statement}"`);
      expect(w).toContain(en[`${c.key(state)}.title`]);
      expect(w).toContain(en[`${c.key(state)}.body`]);
      const keys = partner5RefusalKeys(c.surface);
      expect(keys.length).toBeGreaterThanOrEqual(4);
      for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
      expect(html).toContain(`data-kv-back="${BACK[c.id]}"`);
      expect([...html.matchAll(/href="([^"]*)"/g)].map(([, h]) => h)).toEqual([BACK[c.id]]);   // ONE link, and it is the way back
      expect(html).not.toContain('[id]');
      expect(FORM_CONTROL.test(html)).toBe(false);
      expect(percents(w)).toBe(0);
      expect(MONEY.test(w)).toBe(false);
      expect(FALSE_5B.test(text(withoutRefusals(html)))).toBe(false);
      // NO mailbox line on any 5b chain, even when the page is handed one
      expect(html).not.toContain('data-kv-export-note');
      expect(html).not.toContain('partners@example.org');
      expect(w).not.toContain(en['partner4.export.notAvailable']);
    });
  }
  it('the collections FORM chain returns to the CASE page (never W219\'s /lender/collections) and claims no confirm page and no earlier step', () => {
    for (const s of ['error', 'review', 'success', 'failure']) {
      const html = render('collections_form', s);
      expect(html).toContain(`href="${collectionsCaseHref(IDS.loan)}"`);
      expect(html).not.toContain('href="/lender/collections"');
      expect(/back to confirm|confirm page|back to edit|retry/i.test(text(withoutRefusals(html)))).toBe(false);
    }
    expect(en['partner5.chain.collectionsForm.failure.body']).toMatch(/There is no earlier step to return to/);
    // the case act returns to the case page too (the canon's W2918–W2920 Back → W219 is a DELTA)
    expect(render('case_act', 'confirm')).toContain(`data-kv-back="${collectionsCaseHref(IDS.loan)}"`);
  });
  it('THE PAGES WIRE IT: each page opens its own chains with Back = ITSELF (the case page for the form chain and the case act, never /lender/collections) and passes NO mailbox', () => {
    // the page's CODE (comment lines dropped — a header may DISCUSS the mailbox it does not pass)
    const page = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'app', 'lender', 'collections', ...p, 'page.tsx'), 'utf8')
      .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const kase = page('[id]'); const restr = page('[id]', 'restructure'); const list = page();
    expect(kase).toMatch(/<LenderChain5 t=\{t\} chain="collections_form" state=\{form\} back=\{collectionsCaseHref\(params\.id\)\} \/>/);
    expect(kase).toMatch(/<LenderChain5 t=\{t\} chain="case_act" state=\{act\} back=\{collectionsCaseHref\(params\.id\)\} \/>/);
    expect(restr).toMatch(/<LenderChain5 t=\{t\} chain="restructure_act" state=\{act\} back=\{restructureHref\(params\.id\)\} \/>/);
    expect(list).toMatch(/<LenderChain5 t=\{t\} chain="collections_act" state=\{act\} \/>/);
    for (const src of [kase, restr, list]) expect(/mailbox|back="\/lender\/collections"/i.test(src)).toBe(false);
    // and the registry's own fallback for a pattern page is its list page, never a route pattern
    expect(renderToStaticMarkup(<LenderChain5 t={tr(en)} chain="collections_form" state="error" />)).toContain('data-kv-back="/lender/collections"');
  });
  it('the restructure chain never repeats the canon\'s acceptance order, in any state or language', () => {
    for (const cat of [en, hi, gu]) for (const s of ['confirm', 'success', 'failure']) {
      expect(/after (the )?borrower accepts?|checker after/i.test(text(render('restructure_act', s, cat)))).toBe(false);
    }
  });
  it('every state of every 5b chain exists in hi and gu too, with the same markup skeleton', () => {
    for (const c of CHAINS_5B) for (const state of c.states) {
      const shapes = [en, hi, gu].map((cat) => {
        const html = render(c.id, state, cat);
        expect(text(html)).toContain(cat[`${c.key(state)}.body`]);
        expect(text(html)).toContain(cat[c.statement as string]);
        expect(percents(text(html))).toBe(0);
        return (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
      });
      expect([c.id, state, new Set(shapes).size]).toEqual([c.id, state, 1]);
    }
  });
});
