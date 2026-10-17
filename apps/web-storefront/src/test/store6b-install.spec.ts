// apps/web-storefront/src/test/store6b-install.spec.ts · PC-56 STORE-6b · D3 (founder Q8) — THE INSTALL INVITATION'S RULE, pure:
//   first visit no · second yes · "Not now" 29 days no / 31 days yes (30 exactly: yes) · already added no · no browser prompt (iOS, Firefox) no ·
//   the organisation's flag OFF no (the platform host: OFF) · `kvs_visits` counted once per calendar day · the `/app` states and status line.
import {
  INSTALL_COOKIE, INSTALL_PAGE_STATES, NOT_NOW_DAYS, SECOND_VISIT, VISITS_COOKIE, bumpVisits, cookieValue, dayOf, deviceCookie, installStatus, installValue,
  notNowUntil, readInstall, readInstallState, readVisits, shouldInvite, type InviteFacts,
} from '../features/store6b/install';
import { DAY_MS } from '../features/store6b/drafts';
import { appHref, readSyncState, syncHref } from '../features/store6b/paths';
import { PLATFORM_CHROME, tenantChrome } from '../features/store4a/account';

const NOW = Date.parse('2026-10-17T10:00:00.000Z');
const f = (o: Partial<InviteFacts> = {}): InviteFacts => ({ visits: SECOND_VISIT, notNowAt: null, installed: false, supported: true, flagOn: true, ...o });

describe('STORE-6b · shouldInvite (founder Q8)', () => {
  it('the constants: the second visit, 30 days', () => { expect([SECOND_VISIT, NOT_NOW_DAYS]).toEqual([2, 30]); expect([VISITS_COOKIE, INSTALL_COOKIE]).toEqual(['kvs_visits', 'kvs_install']); });
  it('the FIRST visit: no sheet; the second and later: yes', () => {
    expect(shouldInvite(f({ visits: 0 }), NOW)).toBe(false);
    expect(shouldInvite(f({ visits: 1 }), NOW)).toBe(false);
    expect(shouldInvite(f({ visits: 2 }), NOW)).toBe(true);
    expect(shouldInvite(f({ visits: 9 }), NOW)).toBe(true);
  });
  it('"Not now" is honoured 30 days: 29 days later no, 30 days yes, 31 days yes', () => {
    expect(shouldInvite(f({ notNowAt: NOW - 1000 }), NOW)).toBe(false);
    expect(shouldInvite(f({ notNowAt: NOW - 29 * DAY_MS }), NOW)).toBe(false);
    expect(shouldInvite(f({ notNowAt: NOW - (30 * DAY_MS - 1) }), NOW)).toBe(false);
    expect(shouldInvite(f({ notNowAt: NOW - 30 * DAY_MS }), NOW)).toBe(true);
    expect(shouldInvite(f({ notNowAt: NOW - 31 * DAY_MS }), NOW)).toBe(true);
  });
  it('already added → no; no browser prompt (iOS, Firefox) → no; the flag OFF (the platform host) → no', () => {
    expect(shouldInvite(f({ installed: true }), NOW)).toBe(false);
    expect(shouldInvite(f({ supported: false }), NOW)).toBe(false);
    expect(shouldInvite(f({ flagOn: false }), NOW)).toBe(false);
  });
});

describe('STORE-6b · kvs_visits — once per calendar day, written by the client', () => {
  it('the first load counts 1; another load the same day changes nothing; the next day counts 2', () => {
    const a = bumpVisits(null, '2026-10-17');
    expect(a).toEqual({ value: '1:2026-10-17', visits: 1, changed: true });
    const b = bumpVisits(a.value, '2026-10-17');
    expect(b).toEqual({ value: '1:2026-10-17', visits: 1, changed: false });
    const c = bumpVisits(b.value, '2026-10-18');
    expect(c).toEqual({ value: '2:2026-10-18', visits: 2, changed: true });
    expect(shouldInvite(f({ visits: b.visits }), NOW)).toBe(false);   // ten loads on the first day are still the first visit
    expect(shouldInvite(f({ visits: c.visits }), NOW)).toBe(true);
  });
  it('a malformed cookie reads as no visit; the day is the device\'s local date', () => {
    expect(readVisits('garbage')).toEqual({ visits: 0, day: null });
    expect(readVisits('3:2026-10-01')).toEqual({ visits: 3, day: '2026-10-01' });
    expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('STORE-6b · kvs_install and the /app page', () => {
  it('the marks: notnow:<ISO> / added:<ISO>; anything else null', () => {
    const v = installValue('notnow', new Date(NOW));
    expect(v).toBe('notnow:2026-10-17T10:00:00.000Z');
    expect(readInstall(v)).toEqual({ kind: 'notnow', at: NOW });
    expect(readInstall(encodeURIComponent(installValue('added', new Date(NOW))))).toEqual({ kind: 'added', at: NOW });
    for (const bad of [null, '', 'later:2026', 'notnow:nope']) expect(readInstall(bad as string)).toBeNull();
  });
  it('the status line: "Not now — until <date>" for 30 days, then nothing; "added" stays', () => {
    expect(installStatus({ kind: 'notnow', at: NOW }, NOW + DAY_MS)).toEqual({ kind: 'notnow', until: notNowUntil(NOW) });
    expect(notNowUntil(NOW) - NOW).toBe(30 * DAY_MS);
    expect(installStatus({ kind: 'notnow', at: NOW }, NOW + 31 * DAY_MS)).toBeNull();
    expect(installStatus({ kind: 'added', at: NOW }, NOW + 400 * DAY_MS)).toEqual({ kind: 'added' });
    expect(installStatus(null, NOW)).toBeNull();
  });
  it('the ?install= states (W3139 / W3140 / W3137) and the hrefs under both chromes', () => {
    expect(INSTALL_PAGE_STATES).toEqual(['success', 'failure', 'error']);
    expect(readInstallState('success')).toBe('success'); expect(readInstallState(['error'])).toBe('error'); expect(readInstallState('x')).toBeNull();
    expect(appHref(PLATFORM_CHROME, 'failure')).toBe('/app?install=failure');
    expect(appHref(tenantChrome('anand-fpo'))).toBe('/anand-fpo/app');
  });
  it('the device cookie line: JS-readable (no HttpOnly), a year, Lax; Secure on https; read back', () => {
    const line = deviceCookie(VISITS_COOKIE, '2:2026-10-18', true);
    expect(line).toBe('kvs_visits=2%3A2026-10-18; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
    expect(line).not.toMatch(/HttpOnly/);
    expect(cookieValue('a=1; kvs_visits=2%3A2026-10-18; b=2', VISITS_COOKIE)).toBe('2:2026-10-18');
    expect(cookieValue('xkvs_visits=1', VISITS_COOKIE)).toBeNull();
  });
});

describe('STORE-6b · the /sync chain paths (W3151–W3153)', () => {
  const ID = 'd_ABCDEFGHIJKLMNOPQRSTUV';
  it('list · confirm · discarded · failed — under both chromes', () => {
    expect(syncHref(PLATFORM_CHROME)).toBe('/sync');
    expect(syncHref(tenantChrome('anand-fpo'), { kind: 'confirm', id: ID })).toBe(`/anand-fpo/sync?discard=${ID}`);
    expect(syncHref(PLATFORM_CHROME, { kind: 'discarded' })).toBe('/sync?done=discarded');
    expect(syncHref(PLATFORM_CHROME, { kind: 'failed', id: ID })).toBe(`/sync?done=failed&discard=${ID}`);
  });
  it('the query read back; a malformed id is the plain list', () => {
    expect(readSyncState({ discard: ID })).toEqual({ kind: 'confirm', id: ID });
    expect(readSyncState({ done: 'discarded' })).toEqual({ kind: 'discarded' });
    expect(readSyncState({ done: 'failed', discard: ID })).toEqual({ kind: 'failed', id: ID });
    expect(readSyncState({ discard: '<script>' })).toEqual({ kind: 'list' });
    expect(readSyncState({})).toEqual({ kind: 'list' });
  });
});
