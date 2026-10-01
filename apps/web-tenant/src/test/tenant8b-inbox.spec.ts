// apps/web-tenant/src/test/tenant8b-inbox.spec.ts · PC-56 TENANT-8b · THE INBOX — the console's helpers, the pages' own
// promises (read from their source), and the catalogue promise that every key a page can ask for exists ×3 — every state,
// outcome, ladder step, tier, module the catalogue holds, suppression and failure reason (read from the API's own lists —
// a second copy would agree exactly once), every refusal the API's three reviews can emit, every refused-by-name entry.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NotificationMatrix } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  ACTS, ACT_HREF, BADGE_CAP, CENTER_HREF, FORMS, INBOX_HREF, MAX_CHANGES, MAX_PICKS, PREFS_EDIT_HREF, READ_ALL_HREF, REFUSED_BY_NAME, STATE_VALUES, actDoneKey, actHref, actLabelKey,
  alsoOnLine, alsoReachedBySms, bellBadge, canConfirmAct, cellState, cellStateKey, centerHref, channelKey, dayLabel, decodeChanges, durationParts, encodeChanges, failureKey, groupByDay,
  hasFilters, inappStatusKey, inboxTransportState, isAct, isForm, isUnread, itemBody, itemKey, itemTitle, ladderHref, matrixChanges, moduleKey, outcomeKey, pageStateKey, pairIdsAt,
  parsePicks, pickValue, prefsEditHref, refusedKey, routineRuleKey, sameOriginPath, stepKey, suppressedKey, tierKey, windowSourceKey,
} from '../features/notifications/inbox';

const three = (k: string) => { for (const [n, cat] of [['en', en], ['hi', hi], ['gu', gu]] as const) expect(cat[k as keyof typeof cat] ? `${n}` : `${n} MISSING ${k}`).toBe(n); };
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules/communication', rel), 'utf8');
function apiList(rel: string, constName: string): string[] {
  const src = api(rel);
  const i = src.indexOf(`${constName} = [`);
  if (i < 0) throw new Error(`${constName} not in ${rel}`);
  return [...src.slice(i, src.indexOf('] as const', i)).matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]);
}
const page = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('routes and links', () => {
  it('the center keeps its filters in the URL and drops a stale cursor when they change', () => {
    expect(centerHref()).toBe(CENTER_HREF);
    expect(centerHref({ state: 'unread', tier: 'critical', module: 'dispute', channel: 'sms' }, 'c1')).toBe('/notifications/center?state=unread&tier=critical&module=dispute&channel=sms&cursor=c1');
    expect(centerHref({ state: 'bogus' })).toBe(CENTER_HREF);
    expect(centerHref({ state: 'read' }, null, INBOX_HREF)).toBe('/notifications?state=read');
    expect(hasFilters({})).toBe(false); expect(hasFilters({ tier: 'critical' })).toBe(true); expect(hasFilters({ state: 'unread' })).toBe(true);
  });
  it('the ladder link carries the EXACT instant; without one there is no link', () => {
    expect(ladderHref({ id: 'n 1', at: '2026-10-01T02:10:00.123456Z' })).toBe('/notifications/n%201?at=2026-10-01T02%3A10%3A00.123456Z');
    expect(ladderHref({ id: 'n1', at: undefined })).toBeNull();
  });
  it('the mutate chains: one item, several, all; the picks round-trip id|at; duplicates once', () => {
    expect(actHref('readAll')).toBe(`${ACT_HREF}?step=confirm&act=readAll`);
    expect(actHref('read', [{ id: 'a', at: 't1' }, { id: 'b', at: undefined }])).toBe(`${ACT_HREF}?step=confirm&act=read&id=a&at=t1&id=b`);
    expect(pickValue({ id: 'a', at: 't1' })).toBe('a|t1'); expect(pickValue({ id: 'a', at: undefined })).toBe('a');
    expect(parsePicks(['a|t1', 'b', 'a|t9', ' ', '|x'])).toEqual([{ id: 'a', at: 't1' }, { id: 'b', at: undefined }]);
    expect(pairIdsAt(['a', ' ', 'b'], ['t1'])).toEqual([{ id: 'a', at: 't1' }, { id: 'b', at: undefined }]);
    expect(itemKey('k', 'a')).toBe('k:a');
    expect(MAX_PICKS).toBe(50);
    expect(prefsEditHref('window', { starts: '22:00', ends: null })).toBe(`${PREFS_EDIT_HREF}?form=window&starts=22%3A00`);
    expect(isForm('window')).toBe(true); expect(isForm('digest')).toBe(false); expect(isForm(null)).toBe(false);
    expect(isAct('readAll')).toBe(true); expect(isAct('archive')).toBe(false);
    expect(READ_ALL_HREF).toBe('/notifications/read-all');
    expect(canConfirmAct(0)).toBe(false); expect(canConfirmAct(2)).toBe(true); expect(canConfirmAct(Number.NaN)).toBe(false);
  });
});

describe('states', () => {
  it('a switched-off module is "flagged off", not "couldn\'t load" (6e-1); not-found and restricted are their own sentences', () => {
    expect(inboxTransportState('NOT_FOUND', 404)).toBe('notEnabled');
    expect(inboxTransportState(null, 404)).toBe('notEnabled');
    expect(inboxTransportState('NOTIFICATION_NOT_FOUND', 404)).toBe('notFound');
    expect(inboxTransportState('COMM_FORBIDDEN', 403)).toBe('restricted');
    expect(inboxTransportState(null, 403)).toBe('restricted');
    expect(inboxTransportState('BOOM', 500)).toBe('error');
    expect(inboxTransportState(undefined)).toBe('error');
  });
});

describe('what an item says', () => {
  const item = (o: Record<string, unknown> = {}) => ({ id: 'n', eventCode: 'order.confirmed', channel: 'inapp', status: 'sent', payload: { title: 'T', body: 'B', deepLink: '/orders/1' }, readAt: null, ...o }) as any;
  it('an in-app item is unread or read — never "delivered"', () => {
    expect(inappStatusKey(item())).toBe('notif.inapp.unread');
    expect(inappStatusKey(item({ status: 'read' }))).toBe('notif.inapp.read');
    expect(inappStatusKey(item({ readAt: '2026-10-01T00:00:00Z' }))).toBe('notif.inapp.read');
    expect(isUnread(item())).toBe(true);
    expect(itemTitle(item())).toBe('T'); expect(itemBody(item({ payload: {} }))).toBeNull(); expect(itemTitle(item({ payload: { title: '  ' } }))).toBeNull();
  });
  it('deep links are same-origin only', () => {
    expect(sameOriginPath('/orders/1')).toBe('/orders/1');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', '', 7, null]) expect(sameOriginPath(bad)).toBeNull();
  });
  it('"also by" is what the delivery instance holds; "the bell is never the only wire" only where an SMS row exists', () => {
    const also = [{ channel: 'push', status: 'sent', outcome: 'sent', suppressedReason: null, failureReason: null }, { channel: 'sms', status: 'suppressed', outcome: 'held', suppressedReason: 'quiet_hours', failureReason: null }] as any;
    expect(alsoOnLine(also)).toEqual([{ channel: 'push', outcome: 'sent' }, { channel: 'sms', outcome: 'held' }]);
    expect(alsoReachedBySms(also)).toBe(true);
    expect(alsoReachedBySms([also[0]])).toBe(false);
  });
});

describe('the center\'s days are the cooperative\'s', () => {
  it('labels today / yesterday / a date, and groups consecutive items by day', () => {
    expect(dayLabel('2026-10-01', '2026-10-01')).toEqual({ kind: 'today' });
    expect(dayLabel('2026-09-30', '2026-10-01')).toEqual({ kind: 'yesterday' });
    expect(dayLabel('2026-02-28', '2026-03-01')).toEqual({ kind: 'yesterday' });
    expect(dayLabel('2026-09-29', '2026-10-01')).toEqual({ kind: 'date', date: '2026-09-29' });
    expect(dayLabel('2026-09-29', null)).toEqual({ kind: 'date', date: '2026-09-29' });
    expect(dayLabel(null, '2026-10-01')).toEqual({ kind: 'unknown' });
    const g = groupByDay([{ localDay: 'b' }, { localDay: 'b' }, { localDay: 'a' }, { localDay: null }] as any[]);
    expect(g.map((x) => [x.day, x.items.length])).toEqual([['b', 2], ['a', 1], [null, 1]]);
  });
});

describe('W432 · the bell', () => {
  it('zero unread draws NO badge; the badge caps at 99+', () => {
    expect(bellBadge(0)).toBeNull(); expect(bellBadge(-1)).toBeNull(); expect(bellBadge(Number.NaN)).toBeNull();
    expect(bellBadge(1)).toBe('1'); expect(bellBadge(99)).toBe('99'); expect(bellBadge(100)).toBe('99+'); expect(bellBadge(214)).toBe('99+');
    expect(BADGE_CAP).toBe(99);
  });
  it('is drawn in the topbar from the bell read — a <details> disclosure, no client JS — and the layout hides it on 404', () => {
    const top = page('components/ConsoleTopbar.tsx');
    expect(top).toContain('<details className="kv-bell">');
    expect(top).not.toMatch(/['"]use client['"]/);
    expect(top).toContain('bellBadge(b.unread)');
    const layout = page('app/layout.tsx');
    expect(layout).toContain('notifications.bell()');
    expect(layout).toMatch(/status === 404[^]*kind: 'hidden'/);
  });
});

describe('W433 · the matrix', () => {
  const m = {
    tiers: [{ tier: 'critical', events: [{ code: 'auth.otp', defaultName: 'OTP', priority: 'critical', locked: true, cells: [{ channel: 'sms', sentOn: true, enabled: true, explicit: false }, { channel: 'push', sentOn: false, enabled: null, explicit: false }] }] },
      { tier: 'important', events: [{ code: 'order.packed', defaultName: 'Packed', priority: 'important', locked: false, cells: [{ channel: 'push', sentOn: true, enabled: true, explicit: false }, { channel: 'sms', sentOn: true, enabled: false, explicit: true }, { channel: 'email', sentOn: false, enabled: null, explicit: false }] }] }],
  } as unknown as NotificationMatrix;
  it('a cell is not-sent, locked, on or off', () => {
    expect(cellState({ sentOn: false, enabled: null }, false)).toBe('notSent');
    expect(cellState({ sentOn: false, enabled: null }, true)).toBe('notSent');
    expect(cellState({ sentOn: true, enabled: true }, true)).toBe('locked');
    expect(cellState({ sentOn: true, enabled: false }, false)).toBe('off');
    expect(cellState({ sentOn: true, enabled: true }, false)).toBe('on');
    expect(cellState({ sentOn: true, enabled: null }, false)).toBe('on');
  });
  it('only CHANGED, editable cells reach the review — a locked or not-sent cell can never be smuggled in', () => {
    const posted = ['order.packed::push', 'order.packed::sms', 'auth.otp::sms', 'order.packed::email', 'nope::push'];
    expect(matrixChanges(m, posted, new Set(['order.packed::sms']))).toEqual([
      { eventCode: 'order.packed', channel: 'push', isEnabled: false }, { eventCode: 'order.packed', channel: 'sms', isEnabled: true }]);
    expect(matrixChanges(m, posted, new Set(['order.packed::push']))).toEqual([]);
    expect(matrixChanges(m, [], new Set())).toEqual([]);
  });
  it('changes travel the link as event::channel::1|0 and come back the same; junk is dropped', () => {
    const c = [{ eventCode: 'order.packed', channel: 'sms', isEnabled: true }, { eventCode: 'a.b', channel: 'push', isEnabled: false }];
    expect(encodeChanges(c)).toEqual(['order.packed::sms::1', 'a.b::push::0']);
    expect(decodeChanges(encodeChanges(c))).toEqual(c);
    expect(decodeChanges(['x::sms', 'x::sms::2', '::sms::1', 'x::::1', 'a::b::c::1'])).toEqual([]);
    expect(MAX_CHANGES).toBe(60);
  });
  it('F-18 · the routine rule is DECIDED either way — never "pending"', () => {
    expect(routineRuleKey(true)).toBe('notif.routine.decidedOn');
    expect(routineRuleKey(false)).toBe('notif.routine.decidedOff');
    for (const lang of [en, hi, gu]) for (const k of ['notif.routine.decidedOn', 'notif.routine.decidedOff']) expect(lang[k as keyof typeof lang]).toMatch(/2026/);
    expect(en['notif.routine.decidedOn' as keyof typeof en]).not.toMatch(/pending/i);
  });
  it('durations for the review', () => {
    expect(durationParts(450)).toEqual({ h: 7, m: 30 }); expect(durationParts(0)).toEqual({ h: 0, m: 0 }); expect(durationParts(-5)).toEqual({ h: 0, m: 0 }); expect(durationParts(59.9)).toEqual({ h: 0, m: 59 });
  });
});

describe('the pages keep the wave\'s promises', () => {
  it('F-22 · no zone literal and no 22:00/07:00 prefill anywhere in the notification pages', () => {
    for (const f of ['app/notifications/preferences/page.tsx', 'app/notifications/preferences/edit/page.tsx', 'app/notifications/preferences/edit/actions.ts', 'app/notifications/page.tsx', 'app/notifications/center/page.tsx']) {
      const s = page(f);
      expect(s).not.toContain("'Asia/Kolkata'");
      expect(s).not.toMatch(/'22:00'|'07:00'/);
    }
  });
  it('F-17 · every write carries the key the review / confirm page minted', () => {
    for (const f of ['app/notifications/preferences/edit/page.tsx', 'app/notifications/act/page.tsx', 'app/notifications/read-all/page.tsx']) expect(page(f)).toContain('name="idempotencyKey" value={randomUUID()}');
    expect(page('app/notifications/preferences/edit/actions.ts')).toMatch(/setQuietHours\([^]*key\)/);
    expect(page('app/notifications/act/actions.ts')).toContain('markAllRead(key)');
  });
  it('the old straight-from-the-form writers are gone (no review, no key, no audit)', () => {
    const s = page('app/notifications/preferences/actions.ts');
    expect(s).not.toMatch(/export async function (savePreferencesAction|saveQuietHoursAction)/);
    expect(s).not.toMatch(/\.(setPreferences|setQuietHours)\(/);
    expect(fs.existsSync(path.join(__dirname, '..', 'app/notifications/actions.ts'))).toBe(false);
  });
  it('the center never prints an in-app item as delivered', () => {
    const s = page('app/notifications/center/page.tsx');
    expect(s).toContain('inappStatusKey(it)');
    expect(s).not.toContain("'notif.outcome.delivered'");
  });
});

describe('the catalogue covers every key a page can ask for, ×3', () => {
  it('states, outcomes, steps, tiers, cells, window sources, filters, acts, forms, refused-by-name', () => {
    for (const s of ['notEnabled', 'restricted', 'notFound', 'error'] as const) three(pageStateKey(s));
    for (const o of ['queued', 'held', 'released', 'suppressed', 'sent', 'delivered', 'failed', 'read']) { three(outcomeKey(o)); three(stepKey({ kind: o as any })); }
    for (const t of ['critical', 'important', 'informational', 'promotional', null]) three(tierKey(t));
    for (const c of ['push', 'sms', 'whatsapp', 'email', 'inapp', 'ivr']) three(channelKey(c));
    for (const c of ['notSent', 'locked', 'on', 'off'] as const) three(cellStateKey(c));
    for (const s of ['own', 'tenant_default', null] as const) three(windowSourceKey(s));
    for (const s of STATE_VALUES) three(`notif.filter.state.${s}`);
    for (const a of ACTS) { three(actLabelKey(a)); three(actDoneKey(a)); }
    for (const f of FORMS) { three(`form.notif.title.${f}`); three(`form.notif.submit.${f}`); three(`form.notif.done.${f}`); }
    for (const r of REFUSED_BY_NAME) three(refusedKey(r));
    three('notif.inapp.read'); three('notif.inapp.unread');
  });
  it('every suppression and failure reason the API can write (its own lists)', () => {
    for (const r of apiList('domain/delivery-log.ts', 'SUPPRESSED_REASONS')) three(suppressedKey(r));
    three(suppressedKey(null));
    const failures = apiList('domain/delivery-log.ts', 'FAILURE_REASONS');
    expect(failures.length).toBe(15);
    for (const r of failures) three(failureKey(r));
    three(failureKey(null));
  });
  it('every refusal the three reviews can emit (the API\'s own lists)', () => {
    const codes = [...apiList('domain/inbox-review.ts', 'WINDOW_REFUSALS'), ...apiList('domain/inbox-review.ts', 'PREFERENCE_REFUSALS'), ...apiList('domain/inbox-review.ts', 'LANGUAGE_REFUSALS'), 'TOO_LONG', 'VALUE_REJECTED'];
    expect(codes).toContain('TIMEZONE_UNKNOWN'); expect(codes).toContain('CANNOT_OPT_OUT');
    for (const c of codes) three(`form.notif.refusal.${c}`);
    for (const f of ['starts', 'ends', 'timezone', 'languageCode']) three(`form.notif.field.${f}`);
  });
  it('every module namespace the catalogue holds (every event prefix the migrations and seeds insert)', () => {
    const dir = path.join(__dirname, '../../../../db/migrations');
    const prefixes = new Set<string>();
    for (const f of fs.readdirSync(dir)) {
      const s = fs.readFileSync(path.join(dir, f), 'utf8');
      const ins = /INSERT INTO notification_events\s*\(([^)]*)\)\s*VALUES([^;]*);/g;
      let m: RegExpExecArray | null;
      while ((m = ins.exec(s))) for (const c of m[2].matchAll(/\(\s*'([a-z_]+)\.[a-z_.]+'/g)) prefixes.add(c[1]);
    }
    for (const seed of fs.readdirSync(path.join(__dirname, '../../../../db/seeds/core'))) {
      const s = fs.readFileSync(path.join(__dirname, '../../../../db/seeds/core', seed), 'utf8');
      if (!/notification_events/.test(s)) continue;
      for (const c of s.matchAll(/\(\s*'([a-z_]+)\.[a-z_.]+'\s*,\s*'[^']*'\s*,\s*'(?:critical|important|informational|promotional)'/g)) prefixes.add(c[1]);
    }
    expect(prefixes.size).toBeGreaterThan(10);
    for (const p of prefixes) three(moduleKey(p));
  });
});
