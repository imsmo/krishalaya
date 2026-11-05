// apps/web-partner/src/test-render/account-notification-prefs.render.test.tsx · PC-56 PARTNER-6c · W271 (canon `account/notifications/preferences`)
// — AN HONEST PAGE WITH NO CHECKBOX (founder 6c-2, door Q5-A) carrying THE ONE REAL ACT OF PARTNER-6 (founder 6c-3, door Q7-A). The load-bearing
// assertions: the statement VERBATIM ×3; EXACTLY ONE radio group with EXACTLY the package's languages (each in its own script, `lang`-marked,
// the current one checked) and EXACTLY ONE submit — NO checkbox, NO select, NO other input (the canon's 24); the English-fallback note; the
// webhooks link; the refusals BY NAME; no error state; OFF as OFF. M1 (one `<input type="checkbox">` rendered on the page) kills here.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveLanguage } from '@krishalaya/i18n';
import { AccountNotificationPrefsView } from '../components/partner6/AccountNotificationPrefsView';
import { partner6RefusalKeys } from '../features/partner6/refusals';
import type { AccountState } from '../features/partner6/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { percents, withoutRefusals } from './partner4a-fixtures';
import { CHOICES, CURRENT, FALSE_6C, forms, inputs, selects, submits } from './partner6c-fixtures';

const r = (state: AccountState = 'on', cat: Record<string, string> = en, current = CURRENT) =>
  renderToStaticMarkup(<AccountNotificationPrefsView t={tr(cat)} state={state} current={current} choices={CHOICES} />);
/** Each radio as `name=value` (+ `*` when checked) — attribute order independent. */
const radios = (html: string) => [...html.matchAll(/<input\b[^>]*>/g)].map(([m]) => m).filter((m) => /type="radio"/.test(m))
  .map((m) => `${(m.match(/name="([^"]+)"/) ?? [])[1]}=${(m.match(/value="([^"]+)"/) ?? [])[1]}${/\bchecked=""/.test(m) ? '*' : ''}`);
const STATEMENT = 'The sign-in code and the team invitation cannot be switched off: you need them to use the console. No other message is sent to you here, so there is nothing else to set.';

describe('PC-56 PARTNER-6c · W271 the preferences page (render)', () => {
  it('THE FOUNDER\'S STATEMENT (6c-2) VERBATIM, in all three languages', () => {
    expect(en['partner6.notificationPrefs.statement']).toBe(STATEMENT);
    for (const cat of [en, hi, gu]) {
      const html = r('on', cat);
      expect(html).toContain('data-kv-statement="partner6.notificationPrefs.statement"');
      expect(text(html)).toContain(cat['partner6.notificationPrefs.statement']);
    }
  });
  it('EXACTLY ONE radio group with EXACTLY the package\'s languages and EXACTLY ONE submit — NO checkbox, NO select, NO other input (M1 kills here)', () => {
    for (const cat of [en, hi, gu]) for (const state of ['on', 'unknown'] as const) {
      const html = r(state, cat);
      expect([state, inputs(html)]).toEqual([state, CHOICES.map(() => 'radio')]);
      expect([state, (html.match(/type="checkbox"/g) ?? []).length, selects(html), forms(html), submits(html), (html.match(/<fieldset/g) ?? []).length]).toEqual([state, 0, 0, 1, 1, 1]);
      // the group: one name, the package's codes in the package's order
      expect(radios(html).map((x) => x.replace(/\*$/, ''))).toEqual(CHOICES.map((l) => `lang=${l.code}`));
    }
    expect(CHOICES.length).toBeGreaterThanOrEqual(3);
  });
  it('each language is labelled IN ITS OWN SCRIPT (the package\'s nameNative), marked with its own `lang`; the current one is checked', () => {
    const html = r();
    for (const l of CHOICES) {
      expect(html).toContain(`lang="${l.code}" data-kv-lang-option="${l.code}"`);
      expect(text(html)).toContain(l.nameNative);
    }
    for (const l of CHOICES) {
      const h = r('on', en, l);
      expect([l.code, radios(h).filter((x) => x.endsWith('*'))]).toEqual([l.code, [`lang=${l.code}*`]]);
    }
    // the labels do not change with the console's language: हिन्दी stays हिन्दी on an English page and on a Gujarati one
    const label = (h: string) => [...h.matchAll(/data-kv-lang-option="[^"]+"><input[^>]*\/?><span>([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(label(r('on', gu))).toEqual(label(r('on', en)));
    expect(label(r('on', en))).toEqual(CHOICES.map((l) => l.nameNative));
  });
  it('the submit opens the REVIEW state (a GET to the page with form=review) — nothing is set from this page itself', () => {
    const html = r();
    expect(html).toMatch(/<form method="get" action="\/account\/notifications\/preferences"/);
    expect(html).toMatch(/<button type="submit" name="form" value="review"/);
    expect(html).not.toMatch(/method="post"/i);
  });
  it('says PLAINLY that older text is English-only and falls back to English (never "every template exists"); the choice is this browser only', () => {
    for (const cat of [en, hi, gu]) {
      const w = text(r('on', cat));
      expect(w).toContain(cat['partner6.language.fallbackNote']); expect(w).toContain(cat['partner6.language.browserOnly']);
    }
    expect(en['partner6.language.fallbackNote']).toMatch(/still in English only.*shown in English/);
    expect(/every template|one click/i.test(text(r()))).toBe(false);
  });
  it('the webhooks link and the way back to Notifications are REAL; nothing else links out; no person, no counter, no digit outside the choices', () => {
    const html = r();
    expect([...html.matchAll(/href="([^"]*)"/g)].map(([, h]) => h).sort()).toEqual(['/account/notifications', '/account/webhooks']);
    for (const cat of [en, hi, gu]) {
      const w = text(withoutRefusals(r('on', cat)));
      expect([/[\d०-९૦-૯]/.test(w), percents(w), w.includes('₹')]).toEqual([false, 0, false]);
    }
    expect(FALSE_6C.test(text(withoutRefusals(r())))).toBe(false);
    // the viewer's name is not printed — the page makes no read (DELTA viewer_name_omitted)
    expect(html).not.toMatch(/data-kv-(person|name|me)=/);
  });
  it('NO ERROR STATE (an unreadable flag map prints the honest page); OFF reads as OFF with no control at all', () => {
    expect(r('unknown')).toEqual(r('on').replace('data-kv-state="on"', 'data-kv-state="unknown"'));
    expect(text(withoutRefusals(r('unknown')))).not.toMatch(/could not be read|try again|retry|couldn/i);
    expect(r('on').includes('role="alert"')).toBe(false);
    const off = r('off');
    expect([inputs(off), forms(off), submits(off)]).toEqual([[], 0, 0]);
    expect(text(off)).toContain(en['partner.off.body']); expect(text(off)).not.toContain(STATEMENT);
  });
  it('every W271 refusal is printed BY NAME (the matrix, the lock, the quiet window, the daily summary, Save preferences …)', () => {
    const html = r(); const w = text(html);
    const keys = partner6RefusalKeys('notification_prefs');
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const id of ['prefs_matrix', 'duty_lock', 'security_channels', 'event_count', 'quiet_window', 'daily_summary', 'save_prefs', 'defaults_state', 'prefs_no_error',
      'colleague_reach', 'template_parity', 'plan_settings']) expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
  });
  it('hi and gu render the same skeleton with their own words', () => {
    const skel = (h: string) => (h.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
    for (const cat of [hi, gu]) expect(skel(r('on', cat))).toBe(skel(r()));
    // and the current language marks its own option in any console language
    expect(radios(r('on', gu, resolveLanguage('gu'))).filter((x) => x.endsWith('*'))).toEqual(['lang=gu*']);
  });
  it('the page: session gate, the two chain states FIRST, then the view with the package\'s list and the public flag map — force-dynamic, noindex', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'account', 'notifications', 'preferences', 'page.tsx'), 'utf8');
    const body = src.slice(src.indexOf('export default async function'));
    const at = (s: string) => body.indexOf(s);
    expect(at("chain6State('notification_form'")).toBeGreaterThan(at('await requirePartner()'));
    expect(at("chain6State('notification_act'")).toBeGreaterThan(at("chain6State('notification_form'"));
    expect(at('await partnerConsoleSwitch()')).toBeGreaterThan(at("chain6State('notification_act'"));
    expect(body).toMatch(/choices=\{LANGUAGE_CHOICES\}/);
    expect(body).toMatch(/act=\{chooseLanguageAction\}/);
    expect(src).toContain("export const dynamic = 'force-dynamic'");
    expect(src).toContain('robots: { index: false, follow: false }');
    expect(/api-client|sdk-js|lenderGate|insurerGate|notFound/.test(src)).toBe(false);
  });
});
