// apps/web-partner/src/test-render/account-notifications.render.test.tsx · PC-56 PARTNER-6c · W270 (canon `account/notifications`) — AN HONEST
// PAGE THAT READS NOTHING (founder 6c-1, door Q5-A), every partner person. The load-bearing assertions: the founder's statement VERBATIM in
// all three languages; the REAL link to the webhook delivery log; NO input, NO select, NO form, NO list of anything, NO error state (an
// unreadable flag map still prints the honest page); NO person, place, event code or counter; OFF as OFF; "Mark all read" DECOR → the
// W2967–W2969 chain; every W270 refusal printed BY NAME.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountNotificationsView } from '../components/partner6/AccountNotificationsView';
import { partner6RefusalKeys } from '../features/partner6/refusals';
import type { AccountState } from '../features/partner6/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { percents, withoutRefusals } from './partner4a-fixtures';
import { FALSE_6C, forms, inputs, selects, submits } from './partner6c-fixtures';

const r = (state: AccountState = 'on', cat: Record<string, string> = en) => renderToStaticMarkup(<AccountNotificationsView t={tr(cat)} state={state} />);
const STATEMENT = "The platform sends the people of your organisation two kinds of message, by SMS: a sign-in code when you sign in, and an invitation when a colleague adds you to the team. Nothing else is sent to you in this console. Your organisation's machine notifications are its webhooks, set up by the platform, and their delivery log is on the Webhooks page.";

describe('PC-56 PARTNER-6c · W270 the notifications page (render)', () => {
  it('THE FOUNDER\'S STATEMENT (6c-1) VERBATIM, in all three languages', () => {
    expect(en['partner6.notifications.statement']).toBe(STATEMENT);
    for (const cat of [en, hi, gu]) {
      const html = r('on', cat);
      expect(html).toContain('data-kv-statement="partner6.notifications.statement"');
      expect(text(html)).toContain(cat['partner6.notifications.statement']);
    }
    expect(new Set([en, hi, gu].map((c) => c['partner6.notifications.statement'])).size).toBe(3);
  });
  it('the REAL link to the webhook delivery log; a real link to Preferences; "Mark all read" is DECOR → ?act=confirm; nothing else links out', () => {
    const html = r();
    expect(html).toContain('href="/account/webhooks"'); expect(html).toContain('data-kv-real="webhooks"');
    expect(html).toContain('href="/account/notifications/preferences"'); expect(html).toContain('data-kv-real="preferences"');
    expect(html).toContain('href="/account/notifications?act=confirm"'); expect(html).toContain('data-kv-decor="mark-all-read"');
    expect([...html.matchAll(/href="([^"]*)"/g)].map(([, h]) => h).sort()).toEqual(['/account/notifications/preferences', '/account/notifications?act=confirm', '/account/webhooks']);
  });
  it('NO INPUT, NO SELECT, NO FORM, NO LIST, NO ERROR STATE — in every state and language; an unreadable flag map prints the honest page', () => {
    for (const cat of [en, hi, gu]) for (const state of ['on', 'unknown', 'off'] as const) {
      const html = r(state, cat);
      expect([state, inputs(html), selects(html), forms(html), submits(html), /<button|<label|placeholder=|name="/.test(html), html.includes('role="alert"')]).toEqual([state, [], 0, 0, 0, false, false]);
      // no inbox, no item, no table: the only list on the page is the refusal list itself
      expect([state, /<table|<tr|<td|<ol|data-kv-(item|row|count|inbox|event|person)/.test(withoutRefusals(html)), /<ul|<li/.test(withoutRefusals(html))]).toEqual([state, false, false]);
    }
    expect(r('unknown')).toEqual(r('on').replace('data-kv-state="on"', 'data-kv-state="unknown"'));
    expect(text(withoutRefusals(r('unknown')))).not.toMatch(/could not be read|try again|retry|couldn/i);
    const off = r('off');
    expect(off).toContain('data-kv-state="off"'); expect(text(off)).toContain(en['partner.off.body']);
    expect(text(off)).not.toContain(STATEMENT); expect(text(off)).not.toMatch(/see plan settings/i);
  });
  it('NO PERSON, PLACE, EVENT CODE, COUNTER, DIGIT, PERCENT OR RUPEE in visible text (outside the refusal list) — in any language', () => {
    for (const cat of [en, hi, gu]) {
      const w = text(withoutRefusals(r('on', cat)));
      expect([/[\d०-९૦-૯]/.test(w), percents(w), w.includes('₹')]).toEqual([false, 0, false]);
    }
    expect(FALSE_6C.test(text(withoutRefusals(r())))).toBe(false);
  });
  it('every W270 refusal is printed BY NAME, with the reused plan-settings refusal BY KEY', () => {
    const html = r(); const w = text(html);
    const keys = partner6RefusalKeys('notifications');
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const id of ['same_engine', 'inbox_counters', 'inbox_items', 'other_channels', 'mark_all_read', 'expand_grouped', 'page_list', 'phone_alerts', 'delivery_log_here',
      'notifications_no_error', 'no_org_inbox', 'plan_settings']) expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    expect(w).toContain(en['partner4.refusal.planSettings']);
  });
  it('hi and gu render the same skeleton with their own words', () => {
    const skel = (h: string) => (h.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
    for (const cat of [hi, gu]) expect(skel(r('on', cat))).toBe(skel(r()));
  });
  it('the page: session gate, the chain state FIRST, then the view with the public flag map — no read, no kind gate, force-dynamic, noindex', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'account', 'notifications', 'page.tsx'), 'utf8');
    const body = src.slice(src.indexOf('export default async function'));
    const at = (s: string) => body.indexOf(s);
    expect(at('await requirePartner()')).toBeGreaterThan(0);
    expect(at("chain6State('notifications_act'")).toBeGreaterThan(at('await requirePartner()'));
    expect(at('await partnerConsoleSwitch()')).toBeGreaterThan(at("chain6State('notifications_act'"));
    expect(body).toMatch(/<AccountChain6 t=\{t\} chain="notifications_act" state=\{act\} \/>/);
    expect(src).toContain("export const dynamic = 'force-dynamic'");
    expect(src).toContain('robots: { index: false, follow: false }');
    expect(/api-client|sdk-js|lenderGate|insurerGate|notFound/.test(src)).toBe(false);
  });
});
