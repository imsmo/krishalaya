// apps/web-storefront/src/test-render/store4c-fixtures.ts · PC-56 STORE-4c — the shared world of the inbox / preferences / header render tests (not a
// test file: jest.render.config.js matches *.render.test.tsx only). Each test's jest.mock factories `require` THIS module, so the page under test
// and the test read the same mutable state `C`: the buyer's inbox (as the API answers it — tier, `rendered`, `alsoOn`), the BUYER matrix (a
// locked payment notice, an opt-in promotional row with its consent half, quiet hours in the ORGANISATION's zone — Europe/London here, so a
// literal could never pass), the three server reviews, the store's public flags, the cookies, and every SDK call made. A name in `C.fail`
// makes that call throw the given SdkError.
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures stand in for SDK shapes */
import { SdkError } from '@krishalaya/sdk-js';

export const N = Object.freeze({
  pay: '0215a000-0000-7000-8000-000000000001', outbid: '0215a000-0000-7000-8000-000000000002', promo: '0215a000-0000-7000-8000-000000000003',
  placed: '0215a000-0000-7000-8000-000000000004', evil: '0215a000-0000-7000-8000-000000000005',
});
export const ORG_ZONE = 'Europe/London';

export const C: {
  lang: string; inbox: any[]; nextCursor: string | null; matrix: any; flags: Record<string, boolean>; sessionFlags: Record<string, boolean>;
  prefsReview: any; quietReview: any; langReview: any; calls: any[]; cookies: Map<string, string>; fail: Record<string, SdkError | undefined>;
} = {} as any;

const cell = (channel: string, sentOn: boolean, enabled: boolean | null) => ({ channel, sentOn, enabled, explicit: false });
const CH = ['push', 'sms', 'whatsapp', 'email', 'inapp', 'ivr'];
const cells = (sent: string[], enabled: boolean) => CH.map((c) => cell(c, sent.includes(c), sent.includes(c) ? enabled : null));

export function reset(): void {
  Object.assign(C, {
    lang: 'en', nextCursor: null,
    inbox: [
      // the payment notice (critical, in-app since 0215) — its words are the API's rendering of its template version
      { id: N.pay, eventCode: 'payment.success', channel: 'inapp', status: 'sent', readAt: null, languageCode: 'en', payload: { paymentId: 'p1', referenceType: 'order' },
        createdAt: '2026-10-16T05:00:00.000Z', at: '2026-10-16T05:00:00.123456Z', tier: 'critical', module: 'payment',
        rendered: { title: 'Payment received', body: 'We received your payment.' },
        alsoOn: [{ channel: 'push', status: 'sent', outcome: 'sent', suppressedReason: null, failureReason: null }, { channel: 'sms', status: 'failed', outcome: 'failed', suppressedReason: null, failureReason: 'no_address' }] },
      // outbid — already READ (the All tab lists it); its push was held for quiet hours
      { id: N.outbid, eventCode: 'bid.outbid', channel: 'inapp', status: 'read', readAt: '2026-10-16T05:20:00.000Z', languageCode: 'en', payload: { lot_name: 'Cotton lot' },
        createdAt: '2026-10-16T05:10:00.000Z', at: '2026-10-16T05:10:00.000001Z', tier: 'important', module: 'bid',
        rendered: { title: 'You were outbid', body: 'A higher bid was placed on Cotton lot.' },
        alsoOn: [{ channel: 'push', status: 'suppressed', outcome: 'held', suppressedReason: 'quiet_hours', failureReason: null }] },
      // an announcement (promotional) — its words ride the payload; a same-origin deep link
      { id: N.promo, eventCode: 'tenant.broadcast', channel: 'inapp', status: 'sent', readAt: null, languageCode: 'en', payload: { title: 'Mandi closed Friday', body: 'The yard is shut this Friday.', deepLink: '/anand-fpo/orders' },
        createdAt: '2026-10-16T04:00:00.000Z', at: '2026-10-16T04:00:00.000000Z', tier: 'promotional', module: 'tenant', rendered: null,
        alsoOn: [{ channel: 'push', status: 'suppressed', outcome: 'suppressed', suppressedReason: 'opted_out', failureReason: null }] },
      // order placed — no words served at all → the event's name
      { id: N.placed, eventCode: 'order.created', channel: 'inapp', status: 'sent', readAt: null, languageCode: 'en', payload: { orderId: 'o1' },
        createdAt: '2026-10-16T03:00:00.000Z', at: '2026-10-16T03:00:00.000000Z', tier: 'important', module: 'order', rendered: null, alsoOn: [] },
      // an off-site deep link is never honoured
      { id: N.evil, eventCode: 'order.delivered', channel: 'inapp', status: 'sent', readAt: null, languageCode: 'en', payload: { deepLink: 'https://evil.example/x' },
        createdAt: '2026-10-16T02:00:00.000Z', at: '2026-10-16T02:00:00.000000Z', tier: 'important', module: 'order', rendered: { title: 'Delivered', body: 'Your order was marked delivered.' }, alsoOn: [] },
    ],
    matrix: {
      channels: CH,
      tiers: [
        { tier: 'critical', events: [{ code: 'payment.success', defaultName: 'Payment successful', priority: 'critical', locked: true, cells: cells(['push', 'sms', 'inapp'], true) }] },
        { tier: 'important', events: [
          { code: 'order.created', defaultName: 'Order placed', priority: 'important', locked: false, cells: cells(['push', 'sms', 'inapp'], true) },
          { code: 'bid.outbid', defaultName: 'You were outbid', priority: 'important', locked: false, cells: cells(['push', 'inapp'], true) },
        ] },
        { tier: 'informational', events: [{ code: 'chat.message_posted', defaultName: 'New message', priority: 'informational', locked: false, cells: cells(['push', 'inapp'], true) }] },
        { tier: 'promotional', events: [{ code: 'tenant.broadcast', defaultName: 'Announcement', priority: 'promotional', locked: false, cells: cells(['push', 'inapp'], false), consent: { purpose: 'marketing', granted: false } }] },
      ],
      counts: { events: 5, locked: 1, critical: 1, explicit: 0 },
      routineRule: { decided: true, on: false, flag: 'notification_routine_single_channel' },
      quietHours: {
        effective: { starts: '21:00:00', ends: '06:00:00', timezone: ORG_ZONE, source: 'tenant_default', sanitised: false, requestedZone: null },
        own: null, tenantDefault: { starts: '21:00', ends: '06:00' }, tenantZone: ORG_ZONE, held: ['push', 'sms', 'whatsapp', 'ivr'], neverHeld: ['inapp', 'email'],
      },
      language: {
        current: 'gu',
        active: [{ code: 'en', nameEnglish: 'English', nameNative: 'English' }, { code: 'hi', nameEnglish: 'Hindi', nameNative: 'हिन्दी' }, { code: 'gu', nameEnglish: 'Gujarati', nameNative: 'ગુજરાતી' }, { code: 'mr', nameEnglish: 'Marathi', nameNative: 'मराठी' }],
        tenantLanguages: [],
      },
    },
    flags: { communication: false, offers: false, auctions: false, group_lots: false },
    sessionFlags: { communication: false },
    prefsReview: null, quietReview: null, langReview: null,
    calls: [], cookies: new Map(), fail: {},
  });
}
reset();

const maybe = async <T>(name: string, v: () => T): Promise<T> => { const f = C.fail[name]; if (f) throw f; return v(); };
const okReview = (extra: Record<string, unknown> = {}) => ({ ready: true, fields: [], refusals: [], diff: null, entityType: 'x', ...extra });

export function serverClient(slug?: string): any {
  return {
    _slug: slug ?? null,
    users: { updateMe: async (p: any) => { C.calls.push(['users.updateMe', p]); return maybe('updateMe', () => ({ id: 'me' })); } },
    privacy: { setConsent: async (purpose: string, granted: boolean, key: string, channel?: string) => { C.calls.push(['privacy.setConsent', purpose, granted, key, channel]); return maybe('setConsent', () => ({ ok: true, version: 'v1' })); } },
    notifications: {
      inbox: async (q: any) => { C.calls.push(['notifications.inbox', q]); return maybe('inbox', () => ({ items: q.unreadOnly === true ? C.inbox.filter((n) => !n.readAt) : C.inbox, nextCursor: C.nextCursor })); },
      markRead: async (id: string, o: any) => { C.calls.push(['notifications.markRead', id, o]); return maybe('markRead', () => ({ id })); },
      markAllRead: async (key: string) => { C.calls.push(['notifications.markAllRead', key]); return maybe('markAllRead', () => ({ marked: 2 })); },
      matrix: async (o: any) => { C.calls.push(['notifications.matrix', o]); return maybe('matrix', () => C.matrix); },
      previewPreferences: async (changes: any[]) => {
        C.calls.push(['notifications.previewPreferences', changes]);
        return maybe('previewPreferences', () => C.prefsReview ?? okReview({ diff: changes.map((c) => ({ field: `${c.eventCode}::${c.channel}`, before: c.isEnabled ? 'off' : 'on', after: c.isEnabled ? 'on' : 'off' })), changes }));
      },
      previewQuietHours: async (input: any) => {
        C.calls.push(['notifications.previewQuietHours', input]);
        return maybe('previewQuietHours', () => C.quietReview ?? okReview({
          maths: { lengthMinutes: 570, off: false, crossesMidnight: true, next: { start: '2026-10-16T21:30:00.000Z', end: '2026-10-17T07:00:00.000Z', current: false }, zone: input.timezone ?? ORG_ZONE, zoneFromTenant: !input.timezone },
          stored: { starts: `${input.starts}:00`, ends: `${input.ends}:00`, timezone: input.timezone ?? ORG_ZONE },
        }));
      },
      previewLanguage: async (code: string) => { C.calls.push(['notifications.previewLanguage', code]); return maybe('previewLanguage', () => C.langReview ?? okReview({ tenantSpeaks: false })); },
      setPreferences: async (prefs: any[], key: string) => { C.calls.push(['notifications.setPreferences', prefs, key]); return maybe('setPreferences', () => ({ updated: prefs.length })); },
      setQuietHours: async (input: any, key: string) => { C.calls.push(['notifications.setQuietHours', input, key]); return maybe('setQuietHours', () => input); },
    },
    storefront: { flags: async () => C.flags },
  };
}
export function publicClient(slug?: string): any {
  return { _slug: slug ?? null, storefront: { flags: async () => maybe('flags', () => C.flags) }, lookups: { categories: async () => [] } };
}
export function sessionTenantClient(): any {
  return { storefront: { flags: async () => maybe('sessionFlags', () => C.sessionFlags), tenant: async () => ({ slug: 'anand-fpo', displayName: 'Anand FPO', countryCode: 'GB' }) } };
}
export function cookieJar(): any {
  return {
    get: (k: string) => (C.cookies.has(k) ? { name: k, value: C.cookies.get(k) } : undefined),
    set: (k: string, v: string) => { C.cookies.set(k, v); },
    delete: (k: string) => { C.cookies.delete(k); },
  };
}
/** The SdkError the API answers for a refusal (its code, status and details). */
export const refusal = (code: string, status: number, details?: Record<string, unknown>) => new SdkError(code, status, code, undefined, details);
