// apps/web-storefront/src/test/store4c-notifications.spec.ts · PC-56 STORE-4c · C6 — the pure half of the inbox and the preferences page
// (features/store4c/{inbox,preferences,refusals}.ts), the language route's decision (C4), and the source guards (Rule Zero: no zone or currency
// literal on these pages; one language; no "Flagged off" state).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  channelKey, deepLink, inboxHref, isUnread, itemWords, ladderRows, outcomeKey, readActKey, readAt, readInboxQuery, suppressKey, tierKey, READ_KEY_RE, READ_ALL_KEY_RE,
} from '../features/store4c/inbox';
import {
  actKey, cellName, decodePrefsDraft, draftIsEmpty, encodePrefsDraft, formChanges, isBlocking, langRouteDecision, languageOptions, matrixView, prefsFailureOf,
  readPrefsKey, refusalKey, windowChange, windowView, zoneOptions, type MatrixLike,
} from '../features/store4c/preferences';
import { STORE4C_CHAIN_PAGES, STORE4C_DELTAS, STORE4C_REFUSALS, store4cRefusalKeys } from '../features/store4c/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const c = (channel: string, sentOn: boolean, enabled: boolean | null) => ({ channel, sentOn, enabled });
const M = (o: Partial<MatrixLike> = {}): MatrixLike => ({
  tiers: [
    { tier: 'critical', events: [{ code: 'payment.success', defaultName: 'Payment', priority: 'critical', locked: true, cells: [c('push', true, true), c('sms', true, true), c('inapp', true, true), c('email', false, null)] }] },
    { tier: 'important', events: [{ code: 'order.created', defaultName: 'Order placed', priority: 'important', locked: false, cells: [c('push', true, true), c('sms', true, false), c('inapp', true, true)] }] },
    { tier: 'promotional', events: [{ code: 'tenant.broadcast', defaultName: 'Announcement', priority: 'promotional', locked: false, cells: [c('push', true, false), c('inapp', true, false)], consent: { purpose: 'marketing', granted: false } }] },
  ],
  routineRule: { decided: true, on: false },
  quietHours: { effective: { starts: '21:00:00', ends: '06:00:00', timezone: 'Africa/Nairobi', source: 'tenant_default' }, own: null, tenantDefault: { starts: '21:00', ends: '06:00' }, tenantZone: 'Africa/Nairobi', held: ['push', 'sms'], neverHeld: ['inapp'] },
  language: { current: 'gu', active: [{ code: 'en', nameEnglish: 'English', nameNative: 'English' }, { code: 'gu', nameEnglish: 'Gujarati', nameNative: 'ગુજરાતી' }, { code: 'mr', nameEnglish: 'Marathi', nameNative: 'मराठी' }] },
  ...o,
});

describe('STORE-4c · the inbox view', () => {
  it('tiers ×4, channels, outcomes and the suppress reasons by name — an unknown code is never printed raw', () => {
    expect(['critical', 'important', 'informational', 'promotional', 'x', null].map(tierKey)).toEqual(['store4c.tier.critical', 'store4c.tier.important', 'store4c.tier.informational', 'store4c.tier.promotional', 'store4c.tier.unknown', 'store4c.tier.unknown']);
    expect(channelKey('sms')).toBe('store4c.channel.sms'); expect(channelKey('pigeon')).toBe('store4c.channel.other');
    expect(outcomeKey('held')).toBe('store4c.outcome.held'); expect(outcomeKey('bogus')).toBe('store4c.outcome.unknown');
    expect(['opted_out', 'quiet_hours', 'no_consent', 'routine_collapsed', 'channel_off', 'nope'].map(suppressKey)).toEqual([
      'store4c.suppressed.opted_out', 'store4c.suppressed.quiet_hours', 'store4c.suppressed.no_consent', 'store4c.suppressed.routine_collapsed', 'store4c.suppressed.channel_off', 'store4c.suppressed.unknown']);
  });
  it('the ladder: the OTHER channels, each with its reason only when it was held or not sent; in-app never repeats itself', () => {
    expect(ladderRows([{ channel: 'inapp', outcome: 'sent' }, { channel: 'push', outcome: 'held', suppressedReason: 'quiet_hours' }, { channel: 'sms', outcome: 'failed' }, { channel: 'whatsapp', outcome: 'suppressed', suppressedReason: 'no_consent' }])).toEqual([
      { channel: 'push', channelKey: 'store4c.channel.push', outcomeKey: 'store4c.outcome.held', reasonKey: 'store4c.suppressed.quiet_hours', failed: false },
      { channel: 'sms', channelKey: 'store4c.channel.sms', outcomeKey: 'store4c.outcome.failed', reasonKey: null, failed: true },
      { channel: 'whatsapp', channelKey: 'store4c.channel.whatsapp', outcomeKey: 'store4c.outcome.suppressed', reasonKey: 'store4c.suppressed.no_consent', failed: false },
    ]);
    expect(ladderRows(undefined)).toEqual([]);
  });
  it('the words: rendered → the payload\'s own → none; the deep link same-origin only; unread is the row\'s', () => {
    expect(itemWords({ rendered: { title: 'Payment received', body: 'We received your payment.' }, payload: { title: 'x' } })).toEqual({ title: 'Payment received', body: 'We received your payment.', source: 'rendered' });
    expect(itemWords({ rendered: null, payload: { title: 'Mandi closed', body: '' } })).toEqual({ title: 'Mandi closed', body: null, source: 'payload' });
    expect(itemWords({ rendered: { title: null, body: ' ' }, payload: {} })).toEqual({ title: null, body: null, source: 'event' });
    expect(deepLink({ deepLink: '/anand-fpo/orders/1' })).toBe('/anand-fpo/orders/1');
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil', 'javascript:alert(1)', 42, null]) expect(deepLink({ deepLink: bad as never })).toBeNull();
    expect(isUnread({ status: 'sent', readAt: null })).toBe(true); expect(isUnread({ status: 'read', readAt: null })).toBe(false); expect(isUnread({ status: 'sent', readAt: '2026-10-16T05:00:00Z' })).toBe(false);
  });
  it('the query: All / Unread (strict), a cursor of the API\'s shape only; the hrefs; the act keys and the row instant re-validated', () => {
    expect(readInboxQuery({})).toEqual({ unreadOnly: false, cursor: undefined });
    expect(readInboxQuery({ unread: '1', cursor: 'MjAyNi0xMC0xNnxu' })).toEqual({ unreadOnly: true, cursor: 'MjAyNi0xMC0xNnxu' });
    expect(readInboxQuery({ unread: 'true', cursor: '<script>' })).toEqual({ unreadOnly: false, cursor: undefined });
    expect(inboxHref('anand-fpo', { unread: true, cursor: 'abc' })).toBe('/anand-fpo/notifications?unread=1&cursor=abc');
    expect(inboxHref('Bad Slug')).toBe('/notifications');
    expect(readActKey('read:0215cafe-0000-4000-8000-000000000001', READ_KEY_RE)).toBe('read:0215cafe-0000-4000-8000-000000000001');
    expect(readActKey('readall:0215cafe-0000-4000-8000-000000000001', READ_KEY_RE)).toBeNull();
    expect(readActKey('readall:0215cafe-0000-4000-8000-000000000001', READ_ALL_KEY_RE)).toBe('readall:0215cafe-0000-4000-8000-000000000001');
    expect(readAt('2026-10-16T05:00:00.123456Z')).toBe('2026-10-16T05:00:00.123456Z'); expect(readAt('yesterday')).toBeUndefined();
  });
});

describe('STORE-4c · the preferences view', () => {
  it('the matrix: tiers of the events sent on ≥ 1 channel; a LOCKED cell is ON whatever; the promotional group is ONE switch with its consent', () => {
    const v = matrixView(M());
    expect(v.tiers.map((t) => t.tier)).toEqual(['critical', 'important']);
    expect(v.tiers[0].events[0].cells).toEqual([
      { name: 'payment.success::push', channel: 'push', enabled: true, locked: true }, { name: 'payment.success::sms', channel: 'sms', enabled: true, locked: true },
      { name: 'payment.success::inapp', channel: 'inapp', enabled: true, locked: true },
    ]);
    expect(v.lockedCount).toBe(1);
    expect(v.promotional).toMatchObject({ events: ['tenant.broadcast'], on: false, consentGranted: false, purpose: 'marketing' });
    // the switch reads ON only when BOTH halves hold — the opt-in rows AND the consent
    const optedIn = M(); optedIn.tiers[2].events[0].cells = [c('push', true, true), c('inapp', true, true)];
    expect(matrixView(optedIn).promotional!.on).toBe(false);
    optedIn.tiers[2].events[0].consent = { purpose: 'marketing', granted: true };
    expect(matrixView(optedIn).promotional!.on).toBe(true);
  });
  it('the changes: only what differs; a LOCKED cell is never a change (a forged untick is dropped); the switch sets every promotional cell + the consent', () => {
    const v = matrixView(M());
    const today = new Set(['order.created::push', 'order.created::inapp']);
    expect(formChanges(v, today, false)).toEqual({ changes: [], consent: null });
    expect(formChanges(v, new Set(['order.created::push']), false).changes).toEqual([{ eventCode: 'order.created', channel: 'inapp', isEnabled: false }]);
    expect(formChanges(v, new Set([...today, 'order.created::sms']), false).changes).toEqual([{ eventCode: 'order.created', channel: 'sms', isEnabled: true }]);
    const on = formChanges(v, today, true);
    expect(on).toEqual({ changes: [{ eventCode: 'tenant.broadcast', channel: 'push', isEnabled: true }, { eventCode: 'tenant.broadcast', channel: 'inapp', isEnabled: true }], consent: true });
  });
  it('quiet hours: the window and the zone FROM THE MATRIX; the zone choices are the organisation\'s (blank) and the person\'s own; unchanged → no write', () => {
    const m = M();
    expect(windowView(m)).toMatchObject({ starts: '21:00', ends: '06:00', zone: 'Africa/Nairobi', source: 'tenant_default', tenantZone: 'Africa/Nairobi' });
    expect(zoneOptions(m)).toEqual([{ value: '', zone: 'Africa/Nairobi', kind: 'organisation' }]);
    expect(windowChange(m, { starts: '21:00', ends: '06:00', zone: '' })).toBeNull();
    expect(windowChange(m, { starts: '22:00', ends: '06:00', zone: '' })).toEqual({ starts: '22:00', ends: '06:00' });
    expect(windowChange(m, { starts: '22:00', ends: '06:00', zone: 'Asia/Kolkata' })).toEqual({ starts: '22:00', ends: '06:00' });   // a zone not offered is never posted
    const own = M({ quietHours: { ...m.quietHours, own: { starts: '23:00', ends: '05:00', timezone: 'Europe/Paris' }, effective: { starts: '23:00', ends: '05:00', timezone: 'Europe/Paris', source: 'own' } } });
    expect(zoneOptions(own).map((z) => z.value)).toEqual(['', 'Europe/Paris']);
    expect(windowChange(own, { starts: '23:00', ends: '05:00', zone: 'Europe/Paris' })).toBeNull();
    expect(windowChange(own, { starts: '23:00', ends: '05:00', zone: '' })).toEqual({ starts: '23:00', ends: '05:00' });
  });
  it('ONE language: the active registry this site can speak; the language route PATCHes the account only for a signed-in person (the cookie always)', () => {
    expect(languageOptions(M(), (code) => ['en', 'hi', 'gu'].includes(code)).map((l) => l.code)).toEqual(['en', 'gu']);
    expect(langRouteDecision({ lang: 'gu', signedIn: true })).toEqual({ cookie: 'gu', patchAccount: true });
    expect(langRouteDecision({ lang: 'hi', signedIn: false })).toEqual({ cookie: 'hi', patchAccount: false });
  });
  it('the chain codec: the draft round-trips under its key only; anything malformed is dropped; the act keys derive from the one key', () => {
    const key = 'prefs:0215cafe-0000-4000-8000-000000000003';
    const d = { v: 1 as const, key, changes: [{ eventCode: 'order.created', channel: 'sms', isEnabled: false }], consent: true, quiet: { starts: '22:00', ends: '06:30', timezone: 'Europe/London' }, language: 'gu' };
    expect(decodePrefsDraft(encodePrefsDraft(d), key)).toEqual(d);
    expect(decodePrefsDraft(encodePrefsDraft(d), 'prefs:0215cafe-0000-4000-8000-000000000004')).toBeNull();
    const bad = { ...d, changes: [{ eventCode: 'DROP TABLE', channel: 'fax', isEnabled: 'yes' }], quiet: { starts: '25:00', ends: 'x' }, language: '<b>' };
    expect(decodePrefsDraft(encodePrefsDraft(bad as never), key)).toEqual({ v: 1, key, changes: [], consent: true, quiet: null, language: null });
    expect(decodePrefsDraft('not-base64-json', key)).toBeNull();
    expect(draftIsEmpty({ changes: [], consent: null, quiet: null, language: null })).toBe(true);
    expect(readPrefsKey(key)).toBe(key); expect(readPrefsKey('prefs:nope')).toBeNull();
    expect([actKey(key, 'c'), actKey(key, 'p'), actKey(key, 'q')]).toEqual([`${key}:c`, `${key}:p`, `${key}:q`]);
    expect(actKey(key, 'c').length).toBeLessThanOrEqual(120);   // the idempotency column is varchar(120)
    expect(cellName('order.created', 'sms')).toBe('order.created::sms');
  });
  it('W3136 names each failure; the review\'s non-blocking codes; an unknown refusal code is never printed raw', () => {
    expect(prefsFailureOf('NOTIFICATION_CANNOT_OPT_OUT', 409, 'preferences')).toBe('cannot_opt_out');
    expect(prefsFailureOf('INBOX_FORM_REFUSED', 422, 'quiet')).toBe('zone');
    expect(prefsFailureOf('VALIDATION_FAILED', 422, 'quiet')).toBe('window');
    expect(prefsFailureOf('VALIDATION_FAILED', 422, 'language')).toBe('language');
    expect(prefsFailureOf('VALIDATION_FAILED', 422, 'preferences')).toBe('validation');
    expect(prefsFailureOf('NOTIFICATION_UPDATE_LOST', 409, 'preferences')).toBe('concurrency');
    expect(prefsFailureOf(null, 500, 'consent')).toBe('consent');
    expect(prefsFailureOf(null, 500, 'preferences')).toBe('server');
    expect(['NOTHING_CHANGED', 'WINDOW_UNCHANGED', 'LANGUAGE_UNCHANGED'].map(isBlocking)).toEqual([false, false, false]);
    expect(isBlocking('CANNOT_OPT_OUT')).toBe(true);
    expect(refusalKey('CANNOT_OPT_OUT')).toBe('store4c.review.refusal.CANNOT_OPT_OUT'); expect(refusalKey('SOMETHING_NEW')).toBe('store4c.review.refusal.other');
  });
});

describe('STORE-4c · the refusal registry', () => {
  it('every refusal and delta is unique, worded ×3, and prints on a declared surface; the 8 canon files are recorded', () => {
    const ids = STORE4C_REFUSALS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of STORE4C_REFUSALS) for (const cat of [en, hi, gu] as Array<Record<string, string>>) expect([r.key, typeof cat[r.key]]).toEqual([r.key, 'string']);
    expect(store4cRefusalKeys('inbox')).toContain('store4c.refusal.flaggedOff'); expect(store4cRefusalKeys('preferences')).toContain('store4c.refusal.everywhereElse');
    expect(STORE4C_DELTAS.map((d) => d.id)).toEqual(['preferences_route', 'inbox_route', 'mark_all_read', 'keyset', 'retry_reload', 'review_step']);
    expect(STORE4C_CHAIN_PAGES.map((p) => p.file.slice(0, 5))).toEqual(['W299-', 'W302-', 'W3118', 'W3119', 'W3120', 'W3134', 'W3135', 'W3136']);
  });
  it('the event names: every buyer notice the matrix can list is worded ×3', () => {
    const codes = ['order.created', 'order.confirmed', 'order.delivered', 'order.completed', 'offer.accepted', 'shipment.delivered', 'payment.success', 'dispute.opened', 'dispute.resolved',
      'dispute.refunded', 'requirement.matched', 'requirement.reminder', 'bid.outbid', 'bid.won', 'chat.message_posted', 'auction.ended', 'auction.cancelled', 'auction.failed_reserve',
      'auction.defaulted', 'auction.lapsed', 'requirement.group_quoted', 'review.prompt', 'logistics.cold_chain_buyer_offer', 'exports.export_ready', 'impersonation.session_started',
      'impersonation.session_ended', 'tenant.broadcast'];
    for (const code of codes) for (const cat of [en, hi, gu] as Array<Record<string, string>>) expect([code, typeof cat[`store4c.event.${code}`]]).toEqual([code, 'string']);
  });
});

describe('STORE-4c · the source guards (Rule Zero, one language, no kill-switch on a person\'s notices)', () => {
  const SRC = join(__dirname, '..');
  const files = [
    'app/[tenantSlug]/notifications/page.tsx', 'app/[tenantSlug]/notifications/actions.ts', 'app/(platform)/notifications/page.tsx', 'app/(platform)/notifications/preferences/page.tsx',
    'app/(platform)/account/preferences/page.tsx', 'app/(platform)/account/preferences/actions.ts', 'app/[tenantSlug]/account/preferences/page.tsx',
    'components/account/PreferencesScreen.tsx', 'features/store4c/inbox.ts', 'features/store4c/preferences.ts', 'app/api/lang/route.ts',
  ];
  it.each(files)('%s: no zone literal, no currency literal, no free-text zone field', (f) => {
    const src = readFileSync(join(SRC, f), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/Asia\/Kolkata/); expect(src).not.toMatch(/'INR'|"INR"/);
    expect(src).not.toMatch(/name="timezone"/);
  });
  it('one language select on the preferences page; the old free-text zone page is gone (a door)', () => {
    const screen = readFileSync(join(SRC, 'components/account/PreferencesScreen.tsx'), 'utf8');
    expect((screen.match(/name="language"/g) ?? []).length).toBe(1);
    const door = readFileSync(join(SRC, 'app/(platform)/notifications/preferences/page.tsx'), 'utf8');
    expect(door).toMatch(/redirect\(accountHref\(PLATFORM_CHROME, 'preferences'\)\)/); expect(door).not.toMatch(/<form/);
  });
  it('no catalogue value draws a "Flagged off" state for the inbox or preferences (only the refusal says no)', () => {
    for (const cat of [en, hi, gu] as Array<Record<string, string>>) for (const [k, v] of Object.entries(cat)) {
      if (!k.startsWith('store4c.') || k.includes('.refusal.')) continue;
      expect([k, /Flagged off|disabled for this tenant/i.test(v)]).toEqual([k, false]);
    }
  });
});
