// PC-56 MOB-STORE-1 — store-readiness logic that must not regress: (1) the Sentry beforeSend/beforeBreadcrumb scrub (no phone
// numbers, OTPs, tokens or bank data leave the device) + the init options (no DSN → disabled); (2) push registers for EVERY
// signed-in role (not only farmers) and a tap routes to that role's screens; (3) the OTA path through the real expo-updates
// adapter is gated by the `ota_updates` flag; (4) the store version feeds the forced-update floor. Pure — no native deps.
import { scrubSentryEvent, scrubSentryBreadcrumb, scrubText, sentryOptions, stripQuery } from '../observability/sentry-scrub';
import { shouldRegisterPush } from '../push/registration-policy';
import { routeForNotification } from '../push/notification-router';
import { ROLES } from '../auth/role-switcher';
import { checkAndFetchOta, otaProviderFrom, installExpoOtaProvider, setOtaProvider, type UpdatesModuleLike } from '../release/ota';
import { decideUpdate } from '../release/update-gate';
import appConfig, { APP_VERSION } from '../../../app.config';

const PHONE = '9876543210';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

describe('Sentry scrub (beforeSend)', () => {
  const event = {
    message: `login failed for +91 ${PHONE}, OTP is 482913`,
    logentry: { message: `otp: 1234 for ${PHONE}`, params: [{ phone: PHONE }] },
    exception: { values: [{ type: 'Error', value: `Bearer ${JWT} rejected`, stacktrace: { frames: [{ filename: 'app.js', vars: { otp: '482913', pin: '1234' } }] } }] },
    breadcrumbs: [
      { category: 'fetch', message: 'POST /auth/verify', data: { url: `https://api.example.com/v1/auth/otp?phone=${PHONE}&code=482913`, status_code: 401 } },
      { category: 'console', message: 'paying to ramesh@okaxis via SBIN0001234' },
    ],
    request: { url: `https://api.example.com/v1/wallet?token=${JWT}`, headers: { Authorization: `Bearer ${JWT}` }, cookies: 'sid=abc', data: { accountNumber: '123456789012' }, query_string: `phone=${PHONE}` },
    user: { id: 'u-42', phone: PHONE, username: 'Ramesh', ip_address: '1.2.3.4', email: 'r@example.com' },
    extra: { accountNumber: '123456789012', note: `call ${PHONE}`, ifsc: 'HDFC0000123' },
    contexts: { app: { app_version: '1.0.0' }, session: { refreshToken: 'r-tok' } },
    tags: { screen: 'wallet' },
  };
  const out = scrubSentryEvent(event)!;
  const json = JSON.stringify(out);

  it('removes phone numbers, OTPs, tokens, bank data and UPI ids everywhere', () => {
    for (const secret of [PHONE, '482913', JWT, '123456789012', 'ramesh@okaxis', 'SBIN0001234', 'HDFC0000123', 'r-tok', 'sid=abc', 'r@example.com', '1.2.3.4', 'Ramesh']) {
      expect(json).not.toContain(secret);
    }
  });
  it('keeps the context needed to read the crash', () => {
    expect(out.message).toContain('login failed');
    expect(out.exception!.values![0].value).toContain('rejected');
    expect(out.breadcrumbs![0].data!.status_code).toBe(401);
    expect(out.tags!.screen).toBe('wallet');
    expect((out.contexts!.app as Record<string, unknown>).app_version).toBe('1.0.0');
  });
  it('reduces the user to its id and the request to its path', () => {
    expect(out.user).toEqual({ id: 'u-42' });
    expect(out.request).toEqual({ url: 'https://api.example.com/v1/wallet' });
  });
  it('drops stack-frame local variables', () => {
    expect(out.exception!.values![0].stacktrace!.frames![0]).toEqual({ filename: 'app.js' });
  });
  it('does not mutate the original event', () => {
    expect(event.user.phone).toBe(PHONE);
  });
  it('drops (never sends unscrubbed) an event it cannot scrub', () => {
    const hostile = { get message(): string { throw new Error('boom'); } };
    expect(scrubSentryEvent(hostile as never)).toBeNull();
  });
  it('scrubs breadcrumbs on their own (beforeBreadcrumb) and URL query strings', () => {
    const c = scrubSentryBreadcrumb({ message: `OTP 5521 sent to ${PHONE}`, data: { to: `https://x.test/a?mobile=${PHONE}`, url: `https://x.test/p?otp=5521` } });
    expect(JSON.stringify(c)).not.toMatch(/5521|9876543210/);
    expect(stripQuery('https://x.test/path?a=1#f')).toBe('https://x.test/path');
    expect(scrubText('your verification code is 778899')).not.toContain('778899');
  });
});

describe('Sentry options', () => {
  it('is disabled without a DSN, and never sends default PII / screenshots / replays', () => {
    const o = sentryOptions({ dsn: undefined, appEnv: 'development', appVersion: APP_VERSION });
    expect(o.enabled).toBe(false);
    expect(o.sendDefaultPii).toBe(false);
    expect(o.attachScreenshot).toBe(false);
    expect(o.attachViewHierarchy).toBe(false);
    expect(o.replaysSessionSampleRate).toBe(0);
    expect(o.replaysOnErrorSampleRate).toBe(0);
    expect(o.tracesSampleRate).toBe(0);
  });
  it('production: enabled, conservative trace sampling, release + environment from the app version', () => {
    const o = sentryOptions({ dsn: 'https://k@o0.ingest.sentry.io/1', appEnv: 'production', appVersion: '1.0.0' });
    expect(o.enabled).toBe(true);
    expect(o.tracesSampleRate).toBeLessThanOrEqual(0.05);
    expect(o.release).toBe('com.krishalaya.app@1.0.0');
    expect(o.environment).toBe('production');
  });
});

describe('push registration — every signed-in role', () => {
  it.each(ROLES.map((r) => r.role))('registers for %s', (role) => {
    expect(shouldRegisterPush({ status: 'authenticated', activeRole: role, notificationsOn: true })).toBe(true);
  });
  it('not before sign-in, not before a role is chosen, not with the notifications kill-switch off', () => {
    expect(shouldRegisterPush({ status: 'anonymous', activeRole: 'buyer', notificationsOn: true })).toBe(false);
    expect(shouldRegisterPush({ status: 'booting', activeRole: 'buyer', notificationsOn: true })).toBe(false);
    expect(shouldRegisterPush({ status: 'authenticated', activeRole: undefined, notificationsOn: true })).toBe(false);
    expect(shouldRegisterPush({ status: 'authenticated', activeRole: 'buyer', notificationsOn: false })).toBe(false);
  });
  it('routes a tapped push to the buyer screens for a buyer', () => {
    expect(routeForNotification({}, 'order.shipped', 'buyer')).toBe('/(buyer)/orders');
    expect(routeForNotification({}, 'offer.countered', 'buyer')).toBe('/(buyer)/offers');
    expect(routeForNotification({}, 'auction.outbid', 'buyer')).toBe('/(buyer)/auctions');
    expect(routeForNotification({}, 'something.else', 'buyer')).toBe('/(buyer)/home');
  });
  it('other roles open their own home; farmer / unknown role keep the farmer routes', () => {
    expect(routeForNotification({}, 'job.assigned', 'worker')).toBe('/(worker)/home');
    expect(routeForNotification({}, 'task.assigned', 'delivery')).toBe('/(delivery)/tasks');
    expect(routeForNotification({}, 'order.x', 'farmer')).toBe('/(farmer)/orders');
    expect(routeForNotification({}, 'order.x', 'nonsense')).toBe('/(farmer)/orders');
  });
  it('a safe internal deep link still wins for any role; an external one never does', () => {
    expect(routeForNotification({ deepLink: '/(buyer)/orders' }, 'x', 'buyer')).toBe('/(buyer)/orders');
    expect(routeForNotification({ deepLink: 'https://evil.example.com' }, 'order.x', 'buyer')).toBe('/(buyer)/orders');
  });
});

describe('OTA — expo-updates adapter behind the ota_updates flag', () => {
  function fakeUpdates(over: Partial<UpdatesModuleLike> = {}) {
    const calls = { check: 0, fetch: 0, reload: 0 };
    const u: UpdatesModuleLike = {
      isEnabled: true,
      checkForUpdateAsync: async () => { calls.check++; return { isAvailable: true }; },
      fetchUpdateAsync: async () => { calls.fetch++; return { isNew: true }; },
      reloadAsync: async () => { calls.reload++; },
      ...over,
    };
    return { u, calls };
  }
  afterEach(() => setOtaProvider(null));

  it('no provider when updates are off in the binary (dev client, no EAS project id) or the module is absent', () => {
    expect(otaProviderFrom(null)).toBeNull();
    expect(otaProviderFrom(fakeUpdates({ isEnabled: false }).u)).toBeNull();
    expect(installExpoOtaProvider(() => null)).toBe(false);
    expect(installExpoOtaProvider(() => { throw new Error('not linked'); })).toBe(false);
  });
  it('flag OFF → never touches expo-updates', async () => {
    const { u, calls } = fakeUpdates();
    expect(installExpoOtaProvider(() => u)).toBe(true);
    expect(await checkAndFetchOta({ enabled: false, isCriticalFlow: false })).toEqual({ staged: false });
    expect(calls).toEqual({ check: 0, fetch: 0, reload: 0 });
  });
  it('flag ON → checks + fetches (staged for the next cold start), never reloads by itself', async () => {
    const { u, calls } = fakeUpdates();
    installExpoOtaProvider(() => u);
    expect(await checkAndFetchOta({ enabled: true, isCriticalFlow: false })).toEqual({ staged: true });
    expect(calls).toEqual({ check: 1, fetch: 1, reload: 0 });
  });
  it('flag ON but mid-critical-flow, nothing available, or a native error → nothing staged', async () => {
    const a = fakeUpdates(); installExpoOtaProvider(() => a.u);
    expect(await checkAndFetchOta({ enabled: true, isCriticalFlow: true })).toEqual({ staged: false });
    expect(a.calls.check).toBe(0);
    installExpoOtaProvider(() => fakeUpdates({ checkForUpdateAsync: async () => ({ isAvailable: false }) }).u);
    expect(await checkAndFetchOta({ enabled: true, isCriticalFlow: false })).toEqual({ staged: false });
    installExpoOtaProvider(() => fakeUpdates({ fetchUpdateAsync: async () => { throw new Error('network'); } }).u);
    expect(await checkAndFetchOta({ enabled: true, isCriticalFlow: false })).toEqual({ staged: false });
  });
});

describe('store version → forced-update floor', () => {
  it('version 1.0.0 is the one value both the store and the release_gate see', () => {
    expect(APP_VERSION).toBe('1.0.0');
    expect(appConfig.version).toBe(APP_VERSION);
    expect((appConfig.extra as Record<string, unknown>).appVersion).toBe(APP_VERSION);
  });
  it('compares correctly against minimum versions around the first store release', () => {
    expect(decideUpdate(APP_VERSION, '0.1.0')).toBe('none');
    expect(decideUpdate(APP_VERSION, '1.0.0')).toBe('none');
    expect(decideUpdate(APP_VERSION, '1.0.1')).toBe('forced');
    expect(decideUpdate(APP_VERSION, '1.1')).toBe('forced');
    expect(decideUpdate('0.1.0', APP_VERSION)).toBe('forced'); // a pre-store build is below the 1.0.0 floor
  });
  it('declares no tracking and only foreground location (privacy manifest + Android permissions)', () => {
    expect(appConfig.ios?.privacyManifests?.NSPrivacyTracking).toBe(false);
    expect(appConfig.ios?.privacyManifests?.NSPrivacyCollectedDataTypes?.every((d) => d.NSPrivacyCollectedDataTypeTracking === false)).toBe(true);
    expect(appConfig.android?.permissions).not.toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
    expect(appConfig.android?.blockedPermissions).toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
  });
});
