// apps/web-partner/src/test-render/partner6a-chains.render.test.tsx · PC-56 PARTNER-6a — the settlement chain (W2901–W2903), DECOR on both pages
// it opens from (brief E3):
//   • `settlement_act`         (`/insurer/settlements?act=`, files W2901–W2903)  "Release today's run" refused — nothing to release;
//   • `settlement_detail_act`  (`/insurer/settlements/[id]?act=`, `files: []`)   the same chain on a claim's settlement page.
// Each state prints its page's pinned statement, its own sentence and its refusals — W2902's zero-sum sentence refused BY NAME and NEVER
// printed — and links BACK to the TRIGGERING page: W261 → W261, never the canon's W260 (M4 kills here). No form, no act, no money, no mailbox.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerChain6 } from '../components/partner6/InsurerChain6';
import { PARTNER6_CHAINS, partner6RefusalKeys, type Chain6Id } from '../features/partner6/refusals';
import { settlementHref } from '../features/partner6/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { percents, withoutRefusals } from './partner4a-fixtures';
import { FALSE_6A, FORM_CONTROL_6A, IDS_6A } from './partner6a-fixtures';

/** The page each chain is opened FROM, exactly as the page passes it (W260 passes none and falls back to itself). */
const BACK: Partial<Record<Chain6Id, string>> = { settlement_act: '/insurer/settlements', settlement_detail_act: settlementHref(IDS_6A.claim) };
// PC-56 PARTNER-6b · NAMED UPDATE: PARTNER6_CHAINS now also holds 6b's four lender chains (their own spec: partner6b-chains.render). This
// file is 6a's settlement chain only — the 5a/5b precedent (`PARTNER5_CHAINS.filter((c) => c.wave === '5a')`).
const CHAINS_6A = PARTNER6_CHAINS.filter((c) => c.wave === '6a');
const render = (chain: Chain6Id, state: string, cat: Record<string, string> = en) =>
  renderToStaticMarkup(<InsurerChain6 t={tr(cat)} chain={chain} state={state} back={chain === 'settlement_act' ? undefined : BACK[chain]} />);
const ZERO_SUM = /zero-sum|reconcil|before this page ever shows|money-adjacent/i;

describe('PC-56 PARTNER-6a · the settlement chain (render)', () => {
  for (const c of CHAINS_6A) {
    it.each(c.states.map((s) => [s]))(`${c.id} · %s: the statement, its own sentence, its refusals, Back to the TRIGGERING page, no money, no zero-sum`, (state) => {
      const html = render(c.id, state);
      const w = text(html);
      expect(html).toContain(`data-kv-chain="${c.id}"`);
      expect(html).toContain(`data-kv-chain-state="${state}"`);
      expect(w).toContain(en[c.statement]);
      expect(html).toContain(`data-kv-statement="${c.statement}"`);
      expect(w).toContain(en[`${c.key(state)}.title`]);
      expect(w).toContain(en[`${c.key(state)}.body`]);
      const keys = partner6RefusalKeys(c.surface);
      expect(keys.length).toBeGreaterThanOrEqual(5);
      for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
      expect(html).toContain('data-kv-refusal="zero_sum"');
      expect(html).toContain(`data-kv-back="${BACK[c.id]}"`);
      expect([...html.matchAll(/href="([^"]*)"/g)].map(([, h]) => h)).toEqual([BACK[c.id]]);   // ONE link, and it is the way back
      expect(html).not.toContain('[id]');
      expect(FORM_CONTROL_6A.test(html)).toBe(false);
      expect(percents(w)).toBe(0);
      expect([MONEY.test(w), w.includes('₹')]).toEqual([false, false]);
      expect(FALSE_6A.test(text(withoutRefusals(html)))).toBe(false);
      // W2902's sentence is refused by name and never printed — not in the visible text, not in the refusal list
      expect(ZERO_SUM.test(w)).toBe(false);
      expect(html).not.toMatch(/mailbox|data-kv-export-note/i);
    });
  }
  it('W261\'s chain returns to W261 — never to W260 (the canon\'s defect, DELTA chain_back_w260) — in every state and language', () => {
    for (const cat of [en, hi, gu]) for (const s of ['confirm', 'success', 'failure']) {
      const html = render('settlement_detail_act', s, cat);
      expect([s, html.includes(`href="${settlementHref(IDS_6A.claim)}"`), html.includes('href="/insurer/settlements"')]).toEqual([s, true, false]);
    }
    // a bare pattern page falls back to its list page, never to a route pattern
    expect(renderToStaticMarkup(<InsurerChain6 t={tr(en)} chain="settlement_detail_act" state="confirm" />)).toContain('data-kv-back="/insurer/settlements"');
  });
  it('THE PAGES WIRE IT: W261 opens its chain with Back = ITSELF; W260 opens its own with no back (it is its own page); neither passes a mailbox', () => {
    const page = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'app', 'insurer', 'settlements', ...p, 'page.tsx'), 'utf8')
      .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(page('[id]')).toMatch(/<InsurerChain6 t=\{t\} chain="settlement_detail_act" state=\{act\} back=\{settlementHref\(params\.id\)\} \/>/);
    expect(page()).toMatch(/<InsurerChain6 t=\{t\} chain="settlement_act" state=\{act\} \/>/);
    for (const src of [page(), page('[id]')]) expect(/mailbox|back="\/insurer\/settlements"/i.test(src)).toBe(false);
  });
  it('no 6a chain value says the canon\'s zero-sum, on-call or audit-trail sentences in any language; every state exists in hi and gu with the same skeleton', () => {
    for (const c of CHAINS_6A) for (const state of c.states) {
      const shapes = [en, hi, gu].map((cat) => {
        const html = render(c.id, state, cat);
        expect(text(html)).toContain(cat[`${c.key(state)}.body`]);
        expect(text(html)).toContain(cat[c.statement]);
        return (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
      });
      expect([c.id, state, new Set(shapes).size]).toEqual([c.id, state, 1]);
      for (const sfx of ['title', 'body']) expect([c.id, state, /zero-sum|reconcil|on-call|audit trail|actor/i.test(en[`${c.key(state)}.${sfx}`])]).toEqual([c.id, state, false]);
    }
  });
});
