// apps/web-storefront/src/test-render/preferences.render.test.tsx · PC-56 STORE-4c · C6 — canon W302 "Preferences" and its REAL save chain (W3134
// confirm → W3135 success / W3136 failure) at /account/preferences under BOTH chromes (components/account/PreferencesScreen.tsx):
//   • the BUYER audience only (the page asks `matrix({ audience: 'buyer' })`); a LOCKED cell (the payment notice) drawn disabled + "Always on";
//   • the promotional row OFF by default, ONE switch, with the consent sentence and the consent state (both halves);
//   • quiet hours in the ORGANISATION's zone from the data — never a literal (no 'Asia/Kolkata' anywhere); the zone a select, never free text;
//   • ONE language select (the active registry this site can speak — not Marathi), the account language printed beside the site's;
//   • senior mode posts the device cookie and says "on this device";
//   • the review renders the server's three previews + the consent half; Save sends each act with its derived key; each failure is NAMED, with
//     the same key on Retry; the success says what applies where; the refusals by name; the old /notifications/preferences is a door.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => jest.requireActual('./store4c-fixtures').cookieJar() }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store4c-fixtures');
  return { LANG_COOKIE: 'kv_lang', getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store4c-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import PlatformPrefs from '../app/(platform)/account/preferences/page';
import TenantPrefs from '../app/[tenantSlug]/account/preferences/page';
import OldDoor from '../app/(platform)/notifications/preferences/page';
import { reviewPreferencesAction, submitPreferencesAction } from '../app/(platform)/account/preferences/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, ORG_ZONE, reset, refusal } from './store4c-fixtures';
import { STORE4C_REFUSALS } from '../features/store4c/refusals';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await PlatformPrefs({ searchParams: sp }));
const tenantPage = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantPrefs({ params: { tenantSlug: 'anand-fpo' }, searchParams: sp }));
const form = (o: Record<string, string | string[]>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x); return f; };
const redirectOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { return String((e as Error).message); } return 'NO REDIRECT'; };
const KEY = 'prefs:0215cafe-0000-4000-8000-000000000001';
const EK = encodeURIComponent(KEY);   // the key as it rides a redirect's query
/** Every unlocked cell the page draws as ticked today (the fixture: every non-promotional channel on). */
const ALL_ON = ['order.created::push', 'order.created::sms', 'order.created::inapp', 'bid.outbid::push', 'bid.outbid::inapp', 'chat.message_posted::push', 'chat.message_posted::inapp'];
const base = (o: Record<string, string | string[]> = {}) => ({ chrome: 'platform', key: KEY, language: 'gu', starts: '21:00', ends: '06:00', zone: '', cell: ALL_ON, ...o });
beforeEach(() => { reset(); });

describe('STORE-4c · W302 the page', () => {
  it('asks the BUYER matrix; the payment notice is LOCKED — drawn disabled and "Always on", its cells never posted', async () => {
    const h = await page();
    expect(C.calls[0]).toEqual(['notifications.matrix', { audience: 'buyer' }]);
    expect(h).toMatch(/data-kv-event="payment.success" data-kv-locked="true"/);
    const payCell = /data-kv-cell="payment.success::push"><input ([^>]*)\/>/.exec(h)![1];
    expect(payCell).toContain('disabled=""'); expect(payCell).toContain('checked=""'); expect(payCell).not.toContain('name=');
    expect(h).not.toMatch(/name="cell" value="payment.success::/);
    expect(text(h)).toContain(en['store4c.prefs.alwaysOn']); expect(text(h)).toContain(en['store4c.prefs.lockedSentence']);
  });
  it('the promotional row: ONE switch, OFF by default, with the consent sentence and "no consent on record"', async () => {
    const h = await page();
    expect(h).toMatch(/data-kv-tier="promotional" data-kv-promo="off" data-kv-consent="none"/);
    const sw = /<input ([^>]*data-kv-promo-switch[^>]*)\/>/.exec(h)![1];
    expect(sw).toContain('name="promo"'); expect(sw).not.toContain('checked');   // OFF by default
    expect(h).not.toMatch(/name="cell" value="tenant.broadcast::/);
    expect(text(h)).toContain(en['store4c.promo.sentence']); expect(text(h)).toContain(en['store4c.promo.consentNone']);
  });
  it('quiet hours in the ORGANISATION\'s zone FROM THE DATA — a select, never free text, never the Asia/Kolkata literal', async () => {
    const h = await page();
    expect(h).toContain(`data-kv-window-source="tenant_default"`);
    expect(text(h)).toContain(en['store4c.quiet.inForceOrg'].replace('{starts}', '21:00').replace('{ends}', '06:00').replace('{zone}', ORG_ZONE));
    expect(h).toMatch(/<select id="qh-zone" name="zone"/); expect(h).not.toMatch(/name="timezone"|type="text"[^>]*zone/);
    expect(h).toContain(`<option value="" data-kv-zone-kind="organisation" selected="">${en['store4c.quiet.orgZone'].replace('{zone}', ORG_ZONE)}</option>`);
    expect(h).not.toContain('Asia/Kolkata');
    expect(h).toContain('data-kv-held="push,sms,whatsapp,ivr"'); expect(h).toContain('data-kv-never-held="inapp,email"');
  });
  it('ONE language select — the registry this site can speak (not Marathi); the account language beside the site\'s, mismatch said', async () => {
    const h = await page();
    expect((h.match(/<select[^>]*name="language"/g) ?? []).length).toBe(1);
    expect(h).toMatch(/<option value="gu" lang="gu" selected="">ગુજરાતી<\/option>/);
    expect(h).not.toContain('value="mr"');
    expect(h).toMatch(/data-kv-account-language="gu" data-kv-site-language="en"/);
    expect(text(h)).toContain(en['store4c.lang.mismatch']); expect(text(h)).toContain(en['store4c.lang.oneAnswer']);
  });
  it('senior mode: the toggle posts the DEVICE cookie (/api/mechanism) and says "on this device"', async () => {
    let h = await page();
    expect(h).toMatch(/<form action="\/api\/mechanism" method="post"[^>]*data-kv-form="senior"><input type="hidden" name="senior" value="on"\/>/);
    // PC-56 STORE-5a · C4: the toggle stays; every device mode lives on the accessibility page (under the same chrome)
    expect(h).toMatch(/data-kv-link="accessibility"[^>]*href="\/account\/accessibility"|href="\/account\/accessibility"[^>]*data-kv-link="accessibility"/);
    expect(text(h)).toContain(en['store4c.senior.off']); expect(text(h)).toContain(en['store4c.senior.deviceOnly']);
    C.cookies.set('kvs_senior', 'on');
    h = await page();
    expect(h).toContain('data-kv-senior="on"'); expect(h).toMatch(/name="senior" value="off"/); expect(text(h)).toContain(en['store4c.senior.on']);
  });
  it('both chromes: the hidden chrome field; a load error is said with a Retry — never a blank form', async () => {
    expect(await tenantPage()).toMatch(/<input type="hidden" name="chrome" value="anand-fpo"/);
    C.fail.matrix = new SdkError('UNAVAILABLE', 503, 'x');
    const h = await page();
    expect(h).toContain('data-kv-state="error"'); expect(h).toContain('data-kv-retry="reload"'); expect(h).not.toContain('data-kv-form="preferences"');
  });
  it('every refused canon claim of the preferences page is printed by name; the old /notifications/preferences is a door', async () => {
    const h = await page();
    for (const r of STORE4C_REFUSALS.filter((x) => (x.surfaces as readonly string[]).includes('preferences'))) {
      expect(h).toContain(`data-kv-refusal="${r.id}"`); expect(text(h)).toContain(en[r.key as keyof typeof en]);
    }
    expect(() => OldDoor()).toThrow('REDIRECT /account/preferences');
  });
});

describe('STORE-4c · W3134 the review (the server\'s three reviews are the confirm)', () => {
  it('nothing changed → said; nothing held', async () => {
    expect(await redirectOf(reviewPreferencesAction(form(base())))).toBe(`REDIRECT /account/preferences?error=nothing&k=${EK}`);
    expect(text(await page({ error: 'nothing' }))).toContain(en['store4c.error.nothing']);
  });
  it('a forged untick of the LOCKED payment cell is never a change', async () => {
    expect(await redirectOf(reviewPreferencesAction(form(base({ cell: ALL_ON.filter((c) => c !== 'payment.success::push') }))))).toContain('error=nothing');
  });
  it('opting in to offers + switching off order SMS + a new window + Hindi → the review renders the three previews and the consent half', async () => {
    const r = await redirectOf(reviewPreferencesAction(form(base({ promo: 'on', cell: ALL_ON.filter((c) => c !== 'order.created::sms'), starts: '22:30', ends: '07:00', language: 'hi' }))));
    expect(r).toBe(`REDIRECT /account/preferences?step=review&k=${EK}`);
    const h = await page({ step: 'review', k: KEY });
    expect(C.calls).toContainEqual(['notifications.previewPreferences', [
      { eventCode: 'order.created', channel: 'sms', isEnabled: false }, { eventCode: 'tenant.broadcast', channel: 'push', isEnabled: true }, { eventCode: 'tenant.broadcast', channel: 'inapp', isEnabled: true },
    ]]);
    expect(C.calls).toContainEqual(['notifications.previewQuietHours', { starts: '22:30', ends: '07:00' }]);
    expect(C.calls).toContainEqual(['notifications.previewLanguage', 'hi']);
    expect(h).toContain('data-kv-diff="3"'); expect(h).toContain('data-kv-diff-field="order.created::sms"');
    expect(h).toContain('data-kv-consent="grant"'); expect(text(h)).toContain(en['store4c.review.consentGrant']);
    expect(h).toContain(`data-kv-zone="${ORG_ZONE}"`); expect(text(h)).toContain(en['store4c.quiet.zoneFromOrg']);
    expect(text(h)).toContain(en['store4c.review.languageTo'].replace('{language}', 'हिन्दी'));
    expect(h).toMatch(new RegExp(`name="key" value="${KEY}"`)); expect(h).toContain('data-kv-submit');
  });
  it('a refused review (the server says CANNOT_OPT_OUT) shows the refusal and NO Save', async () => {
    await redirectOf(reviewPreferencesAction(form(base({ cell: ALL_ON.filter((c) => c !== 'order.created::sms') }))));
    C.prefsReview = { ready: false, fields: [], refusals: [{ field: 'order.created::sms', code: 'CANNOT_OPT_OUT' }], diff: [], entityType: 'notification_preference', changes: [] };
    const h = await page({ step: 'review', k: KEY });
    expect(h).toContain('data-kv-refused="CANNOT_OPT_OUT"'); expect(h).not.toContain('data-kv-submit'); expect(h).toContain('data-kv-state="blocked"');
  });
});

describe('STORE-4c · W3135 / W3136 the save', () => {
  const review = async (o: Record<string, string | string[]>) => { await redirectOf(reviewPreferencesAction(form(base(o)))); };
  it('Save: the consent FIRST, then the rows, quiet hours, the account language — each with its derived key; the site language cookie set; W3135', async () => {
    await review({ promo: 'on', starts: '22:30', ends: '07:00', language: 'hi' });
    expect(await redirectOf(submitPreferencesAction(form({ chrome: 'platform', key: KEY })))).toBe('REDIRECT /account/preferences?ok=saved');
    const acts = C.calls.filter((c) => ['privacy.setConsent', 'notifications.setPreferences', 'notifications.setQuietHours', 'users.updateMe'].includes(c[0]));
    expect(acts).toEqual([
      ['privacy.setConsent', 'marketing', true, `${KEY}:c`, 'web'],
      ['notifications.setPreferences', [{ eventCode: 'tenant.broadcast', channel: 'push', isEnabled: true }, { eventCode: 'tenant.broadcast', channel: 'inapp', isEnabled: true }], `${KEY}:p`],
      ['notifications.setQuietHours', { starts: '22:30', ends: '07:00' }, `${KEY}:q`],
      ['users.updateMe', { languageCode: 'hi' }],
    ]);
    expect(C.cookies.get('kv_lang')).toBe('hi');
    const h = await page({ ok: 'saved' });
    expect(text(h)).toContain(en['store4c.ok.saved']);
  });
  it('W3136 · CANNOT_OPT_OUT names the event; the values and the SAME key are kept; Retry replays the same keys', async () => {
    await review({ cell: ALL_ON.filter((c) => c !== 'order.created::sms') });
    C.fail.setPreferences = refusal('NOTIFICATION_CANNOT_OPT_OUT', 409, { eventCode: 'payment.success' });
    const r = await redirectOf(submitPreferencesAction(form({ chrome: 'platform', key: KEY })));
    expect(r).toBe(`REDIRECT /account/preferences?step=review&k=${EK}&failure=cannot_opt_out&event=payment.success`);
    const h = await page({ step: 'review', k: KEY, failure: 'cannot_opt_out', event: 'payment.success' });
    expect(text(h)).toContain(en['store4c.failure.cannot_opt_out_event'].replace('{event}', en['store4c.event.payment.success']));
    expect(h).toMatch(new RegExp(`name="key" value="${KEY}"`)); expect(text(h)).toContain(en['store4c.review.retry']);
    C.fail.setPreferences = undefined;
    expect(await redirectOf(submitPreferencesAction(form({ chrome: 'platform', key: KEY })))).toBe('REDIRECT /account/preferences?ok=saved');
    expect(C.calls.filter((c) => c[0] === 'notifications.setPreferences').map((c) => c[2])).toEqual([`${KEY}:p`, `${KEY}:p`]);
  });
  it('W3136 · each failure by name: a bad zone · a concurrent change · the consent (nothing else written) · the server', async () => {
    const cases: Array<[string, SdkError, string]> = [
      ['setQuietHours', refusal('INBOX_FORM_REFUSED', 422, { form: 'quiet_hours' }), 'zone'],
      ['setPreferences', refusal('NOTIFICATION_UPDATE_LOST', 409), 'concurrency'],
      ['setConsent', new SdkError('SERVER', 500, 'x'), 'consent'],
      ['setPreferences', new SdkError('SERVER', 500, 'x'), 'server'],
    ];
    for (const [act, err, named] of cases) {
      reset();
      await review({ promo: 'on', starts: '22:30', ends: '07:00' });
      C.fail[act] = err;
      expect(await redirectOf(submitPreferencesAction(form({ chrome: 'platform', key: KEY })))).toBe(`REDIRECT /account/preferences?step=review&k=${EK}&failure=${named}`);
      expect(text(await page({ step: 'review', k: KEY, failure: named }))).toContain(en[`store4c.failure.${named}` as keyof typeof en]);
      if (named === 'consent') expect(C.calls.some((c) => c[0] === 'notifications.setPreferences')).toBe(false);
    }
  });
});
