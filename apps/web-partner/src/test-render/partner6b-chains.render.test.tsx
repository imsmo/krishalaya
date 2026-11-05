// apps/web-partner/src/test-render/partner6b-chains.render.test.tsx · PC-56 PARTNER-6b — the four DECOR chains of the lender's two honest pages
// (founder 6b-5):
//   • `consents_export`  (`/lender/consents?export=queued|ready`, W2921–W2922)                  DECOR + the partners mailbox line;
//   • `consents_act`     (`/lender/consents?act=confirm|success|failure`, W2923–W2925)          DECOR — nothing to re-read;
//   • `regulatory_form`  (`/lender/reports/regulatory?form=error|review|success|failure`, W2987–W2990)  DECOR + the mailbox line, no input, NO
//                         confirm page claimed (the canon's "Retry — back to confirm" and "Back to edit" are DELTAs);
//   • `regulatory_act`   (`/lender/reports/regulatory?act=confirm|success|failure`, W2991–W2993) DECOR.
// Each state prints its page's pinned statement, its own sentence and its refusals, and ONE link: Back to the TRIGGERING page. M5 (the mailbox
// removed from `regulatory_form`) kills here.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderChain6 } from '../components/partner6/LenderChain6';
import { PARTNER6_CHAINS, partner6RefusalKeys, type Chain6Id } from '../features/partner6/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { percents } from './partner4a-fixtures';
import { FORM_CONTROL_6B, MAILBOX_6B } from './partner6b-fixtures';

const CHAINS_6B = PARTNER6_CHAINS.filter((c) => c.wave === '6b');
const BACK: Partial<Record<Chain6Id, string>> = {
  consents_export: '/lender/consents', consents_act: '/lender/consents', regulatory_form: '/lender/reports/regulatory', regulatory_act: '/lender/reports/regulatory',
};
const MAILBOX_CHAINS: Chain6Id[] = ['consents_export', 'regulatory_form'];
const render = (chain: Chain6Id, state: string, cat: Record<string, string> = en) =>
  renderToStaticMarkup(<LenderChain6 t={tr(cat)} chain={chain} state={state} mailbox={MAILBOX_CHAINS.includes(chain) ? MAILBOX_6B : undefined} />);
const CANON_CHAIN = /audit-stamped|checksummed|signed URL|sha256|row count|zero-sum|reconcil|on-call|audit trail|actor|maker-checker|diff against|values you entered|back to confirm|back to edit|position and ETA/i;

describe('PC-56 PARTNER-6b · the four lender chains (render)', () => {
  it('the four chains are 6b\'s, on the two honest pages; twelve files', () => {
    expect(CHAINS_6B.map((c) => c.id)).toEqual(['consents_export', 'consents_act', 'regulatory_form', 'regulatory_act']);
    expect(CHAINS_6B.flatMap((c) => c.files).length).toBe(12);
  });
  for (const c of CHAINS_6B) {
    it.each(c.states.map((s) => [s]))(`${c.id} · %s: the statement, its own sentence, its refusals, ONE link Back to the triggering page, no figure, no input`, (state) => {
      const html = render(c.id, state); const w = text(html);
      expect(html).toContain(`data-kv-chain="${c.id}"`); expect(html).toContain(`data-kv-chain-state="${state}"`);
      expect(w).toContain(en[c.statement]); expect(html).toContain(`data-kv-statement="${c.statement}"`);
      expect(w).toContain(en[`${c.key(state)}.title`]); expect(w).toContain(en[`${c.key(state)}.body`]);
      const keys = partner6RefusalKeys(c.surface);
      expect(keys.length).toBeGreaterThanOrEqual(2);
      for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
      expect(html).toContain(`data-kv-back="${BACK[c.id]}"`);
      const links = [...html.matchAll(/href="([^"]*)"/g)].map(([, h]) => h).filter((h) => !h.startsWith('mailto:'));
      expect(links).toEqual([BACK[c.id]]);
      expect(FORM_CONTROL_6B.test(html)).toBe(false);
      expect([percents(w), MONEY.test(w), w.includes('₹'), /[\d०-९૦-૯]/.test(w)]).toEqual([0, false, false, false]);
      expect(CANON_CHAIN.test(w)).toBe(false);
      // the mailbox line exactly on the two chains that carry it
      expect([c.id, html.includes('data-kv-export-note="true"'), html.includes('data-kv-ops-mailbox="published"')]).toEqual([c.id, !!c.mailbox, !!c.mailbox]);
    });
  }
  it('consents_export and regulatory_form PRINT THE MAILBOX LINE (M5 kills here): the export sentence / the filing sentence, then the published fact', () => {
    for (const s of ['queued', 'ready']) {
      const w = text(render('consents_export', s));
      expect(w).toContain(en['partner4.export.notAvailable']); expect(w).toContain('partners@example.org');
    }
    for (const s of ['error', 'review', 'success', 'failure']) {
      const html = render('regulatory_form', s); const w = text(html);
      expect([s, w.includes(en['partner6.regulatory.mailboxAsk']), html.includes('partners@example.org')]).toEqual([s, true, true]);
    }
    for (const s of ['confirm', 'success', 'failure']) for (const id of ['consents_act', 'regulatory_act'] as const) expect(render(id, s)).not.toMatch(/mailbox|data-kv-export-note/i);
  });
  it('THE FORM CHAIN CLAIMS NO CONFIRM PAGE AND NO EDIT STEP: no state is "confirm", no sentence says "back to confirm" or "back to edit"; its refusals name the missing form', () => {
    const c = CHAINS_6B.find((x) => x.id === 'regulatory_form')!;
    expect(c.states).toEqual(['error', 'review', 'success', 'failure']);
    for (const cat of [en, hi, gu]) for (const s of c.states) expect([s, /back to confirm|back to edit|confirm page/i.test(text(render('regulatory_form', s, cat)).replace(cat['partner6.refusal.noConfirmPage'], ''))]).toEqual([s, false]);
    const fail = render('regulatory_form', 'failure');
    for (const id of ['no_confirm_page', 'form_without_form', 'generate_pack', 'form_review_checker_6b']) expect([id, fail.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
  });
  it('THE PAGES WIRE THEM: the export and form chains get the mailbox fact, the act chains none; no Back is passed (each chain returns to its own page)', () => {
    const page = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'app', 'lender', ...p, 'page.tsx'), 'utf8')
      .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(page('consents')).toMatch(/<LenderChain6 t=\{t\} chain="consents_export" state=\{exp\} mailbox=\{await partnersMailbox\(\)\} \/>/);
    expect(page('consents')).toMatch(/<LenderChain6 t=\{t\} chain="consents_act" state=\{act\} \/>/);
    expect(page('reports', 'regulatory')).toMatch(/<LenderChain6 t=\{t\} chain="regulatory_form" state=\{form\} mailbox=\{await partnersMailbox\(\)\} \/>/);
    expect(page('reports', 'regulatory')).toMatch(/<LenderChain6 t=\{t\} chain="regulatory_act" state=\{act\} \/>/);
    for (const src of [page('consents'), page('reports', 'regulatory')]) expect(/back=/.test(src)).toBe(false);
  });
  it('every 6b chain state exists in hi and gu with the same skeleton; no 6b chain value carries the canon\'s chain sentences in any language', () => {
    for (const c of CHAINS_6B) for (const state of c.states) {
      const shapes = [en, hi, gu].map((cat) => {
        const html = render(c.id, state, cat);
        expect(text(html)).toContain(cat[`${c.key(state)}.body`]); expect(text(html)).toContain(cat[c.statement]);
        return (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
      });
      expect([c.id, state, new Set(shapes).size]).toEqual([c.id, state, 1]);
      for (const sfx of ['title', 'body']) expect([c.id, state, CANON_CHAIN.test(en[`${c.key(state)}.${sfx}`])]).toEqual([c.id, state, false]);
    }
  });
});
