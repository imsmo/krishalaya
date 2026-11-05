// apps/web-partner/src/test-render/partner6c-chains.render.test.tsx · PC-56 PARTNER-6c — the three chains of every partner person's two account
// pages (founder 6c-5):
//   • `notification_form` (`/account/notifications/preferences?form=error|review|success|failure`, W2960–W2963) — REAL: the language act.
//     error = nothing set; review = the chosen language NAMED IN ITSELF and ONE button that posts it (the button carries the code — no other
//     field); success = set, the current language named; failure = nothing changed. The canon's three other triggers (Change time, Change
//     window, Save preferences) print their refusals in EVERY state; no state claims a confirm page;
//   • `notification_act` (`?act=` on the preferences page, W2964–W2966) — DECOR;
//   • `notifications_act` (`?act=` on `/account/notifications`, W2967–W2969, "Mark all read") — DECOR, refused by name.
// Each state prints its page's pinned statement, its own sentence, its refusals and ONE link: Back to the TRIGGERING page.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LanguageDef } from '@krishalaya/i18n';
import { AccountChain6 } from '../components/partner6/AccountChain6';
import { PARTNER6_CHAINS, partner6RefusalKeys, type Chain6Id } from '../features/partner6/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { percents } from './partner4a-fixtures';
import { ACT, CHOICES, CURRENT, forms, inputs, selects, submits } from './partner6c-fixtures';

const CHAINS_6C = PARTNER6_CHAINS.filter((c) => c.wave === '6c');
const BACK: Partial<Record<Chain6Id, string>> = {
  notification_form: '/account/notifications/preferences', notification_act: '/account/notifications/preferences', notifications_act: '/account/notifications',
};
const render = (chain: Chain6Id, state: string, cat: Record<string, string> = en, chosen: LanguageDef | null = CHOICES[CHOICES.length - 1], current: LanguageDef = CURRENT) =>
  renderToStaticMarkup(<AccountChain6 t={tr(cat)} chain={chain} state={state} chosen={chosen} current={current} act={ACT} />);
const CANON_CHAIN = /audit-stamped|checksummed|signed URL|sha256|zero-sum|reconcil|on-call|audit trail|actor|maker-checker|diff against|values you entered|back to confirm|back to edit|position and ETA/i;
const REFUSED_TRIGGERS = ['daily_summary', 'quiet_window', 'save_prefs'];

describe('PC-56 PARTNER-6c · the three account chains (render)', () => {
  it('the three chains are 6c\'s, on the two account pages; ten files; only the form chain is REAL', () => {
    expect(CHAINS_6C.map((c) => [c.id, c.real ?? null])).toEqual([['notification_form', 'language'], ['notification_act', null], ['notifications_act', null]]);
    expect(CHAINS_6C.flatMap((c) => c.files).length).toBe(10);
  });
  for (const c of CHAINS_6C) {
    it.each(c.states.map((s) => [s]))(`${c.id} · %s: the statement, its own sentence, its refusals, ONE link Back to the triggering page, no figure, no checkbox`, (state) => {
      const html = render(c.id, state); const w = text(html);
      expect(html).toContain(`data-kv-chain="${c.id}"`); expect(html).toContain(`data-kv-chain-state="${state}"`);
      expect(w).toContain(en[c.statement]); expect(html).toContain(`data-kv-statement="${c.statement}"`);
      expect(w).toContain(en[`${c.key(state)}.title`]); expect(w).toContain(en[`${c.key(state)}.body`]);
      const keys = partner6RefusalKeys(c.surface);
      expect(keys.length).toBeGreaterThanOrEqual(3);
      for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
      expect(html).toContain(`data-kv-back="${BACK[c.id]}"`);
      expect([...html.matchAll(/href="([^"]*)"/g)].map(([, h]) => h)).toEqual([BACK[c.id]]);
      expect([(html.match(/type="checkbox"/g) ?? []).length, selects(html), inputs(html)]).toEqual([0, 0, []]);
      expect([percents(w), MONEY.test(w), w.includes('₹'), /[\d०-९૦-૯]/.test(w)]).toEqual([0, false, false, false]);
      expect(CANON_CHAIN.test(w)).toBe(false);
      // a control exists ONLY in the REAL chain's review state: one form, one button
      const isReview = c.id === 'notification_form' && state === 'review';
      expect([c.id, state, forms(html), submits(html)]).toEqual([c.id, state, isReview ? 1 : 0, isReview ? 1 : 0]);
    });
  }
  it('THE REAL FORM CHAIN · review: the chosen language NAMED IN ITSELF, `lang`-marked, and ONE button that posts exactly its code', () => {
    for (const chosen of CHOICES) for (const cat of [en, hi, gu]) {
      const html = render('notification_form', 'review', cat, chosen);
      expect(html).toContain(`data-kv-language-review="${chosen.code}"`);
      expect(html).toContain(`<strong lang="${chosen.code}" data-kv-language-chosen="${chosen.code}">${chosen.nameNative}</strong>`);
      expect([...html.matchAll(/<button type="submit" name="([^"]+)" value="([^"]+)"/g)].map(([, n, v]) => `${n}=${v}`)).toEqual([`lang=${chosen.code}`]);
      expect(text(html)).toContain(cat['partner6.language.use']);
    }
  });
  it('THE REAL FORM CHAIN · success names the language now in use; error and failure set nothing and say so; no state shows a control but review', () => {
    for (const current of CHOICES) {
      const ok = render('notification_form', 'success', en, null, current);
      expect(ok).toContain(`data-kv-language-current="${current.code}"`);
      expect(ok).toContain(`<strong lang="${current.code}">${current.nameNative}</strong>`);
    }
    expect(text(render('notification_form', 'error'))).toMatch(/nothing was set/i);
    expect(text(render('notification_form', 'failure'))).toMatch(/nothing changed/i);
    for (const s of ['error', 'success', 'failure']) expect([s, /data-kv-language-review|<form/.test(render('notification_form', s))]).toEqual([s, false]);
    // a review with no valid choice draws no control (the page turns it into the error state before it gets here)
    expect(forms(render('notification_form', 'review', en, null))).toBe(0);
  });
  it('THE REAL FORM CHAIN prints the canon\'s THREE OTHER TRIGGERS\' refusals in every state, claims no confirm page and no edit step, writes no trail', () => {
    const c = CHAINS_6C.find((x) => x.id === 'notification_form')!;
    expect(c.states).toEqual(['error', 'review', 'success', 'failure']);
    for (const cat of [en, hi, gu]) for (const s of c.states) {
      const html = render('notification_form', s, cat);
      for (const id of [...REFUSED_TRIGGERS, 'no_confirm_page', 'language_no_audit', 'language_review_checker']) expect([s, id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([s, id, true]);
      expect([s, /back to confirm|back to edit|confirm page/i.test(text(html).replace(cat['partner6.refusal.noConfirmPage'], ''))]).toEqual([s, false]);
      expect(html.includes('data-kv-refusal="chain_audit"')).toBe(false);
    }
  });
  it('the two DECOR chains: "Mark all read" refused by name on notifications_act; Retry re-reads nothing on notification_act', () => {
    for (const s of ['confirm', 'success', 'failure']) {
      expect(render('notifications_act', s)).toContain('data-kv-refusal="mark_all_read"');
      expect(render('notification_act', s)).toContain('data-kv-refusal="prefs_no_error"');
      for (const id of ['notification_act', 'notifications_act'] as const) expect(render(id, s)).not.toMatch(/data-kv-language-|<form/);
    }
  });
  it('THE PAGES WIRE THEM: the form chain gets the chosen language, the current one and the Server Action; the act chains nothing; an unknown review code is the error state', () => {
    const page = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'app', 'account', ...p, 'page.tsx'), 'utf8')
      .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const prefs = page('notifications', 'preferences');
    expect(prefs).toMatch(/<AccountChain6 t=\{t\} chain="notification_form" state=\{state\} chosen=\{chosen\} current=\{getLanguageDef\(\)\} act=\{chooseLanguageAction\} \/>/);
    expect(prefs).toMatch(/const chosen = form === 'review' \? pickLanguage\(/);
    expect(prefs).toMatch(/const state = form === 'review' && !chosen \? 'error' : form;/);
    expect(prefs).toMatch(/<AccountChain6 t=\{t\} chain="notification_act" state=\{act\} \/>/);
    expect(page('notifications')).toMatch(/<AccountChain6 t=\{t\} chain="notifications_act" state=\{act\} \/>/);
    for (const src of [prefs, page('notifications')]) expect(/back=/.test(src)).toBe(false);
  });
  it('every 6c chain state exists in hi and gu with the same skeleton; no 6c chain value carries the canon\'s chain sentences in any language', () => {
    for (const c of CHAINS_6C) for (const state of c.states) {
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
