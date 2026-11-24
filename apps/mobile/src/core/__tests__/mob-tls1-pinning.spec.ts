// PC-56 MOB-TLS-1 · the TLS public-key pin config builder, the pin-failure reporting path, and the Android network-security
// plugin output. Pure — no React Native. Pins: docs/mobile/TLS-PINNING.md.
import {
  AMAZON_TRUST_PINS, PIN_EXPIRATION_DATE, buildPinningOptions, pinningOptionsValid, isDevHost, isThirdPartyHost,
  httpsHostOf, makePinFailureReporter, PIN_FAILURE_ERROR_NAME,
} from '../../core/security/tls-pins';
import { isValidPin } from '../../core/security/pinning';

// eslint-disable-next-line @typescript-eslint/no-var-requires, no-restricted-syntax -- CommonJS config plugin
const nsc = require('../../../plugins/with-android-network-security') as { releaseNetworkSecurityXml(): string; debugNetworkSecurityXml(): string };

const API = 'https://api.krishalaya.com';

describe('MOB-TLS-1 CA pins', () => {
  it('ships the five Amazon Trust Services / Starfield G2 SPKI pins, all well-formed and distinct', () => {
    const spkis = AMAZON_TRUST_PINS.map((p) => p.spki);
    expect(spkis).toEqual([
      '++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=', // Amazon Root CA 1
      'f0KW/FtqTjs108NpYj42SrGvOB2PpxIVM8nWxjPqJGE=', // Amazon Root CA 2
      'NqvDJlas/GRcYbcWE8S/IceH9cq77kg0jVhZeAPXq8k=', // Amazon Root CA 3
      '9+ze1cZgR9KO1kZrVDxA4HQ6voHRCSVNz4RdTCx4U8U=', // Amazon Root CA 4
      'KwccWaCgrnaw6tsrrSO61FgLacNgG2MMLq8GE6+oP5I=', // Starfield Services Root CA - G2
    ]);
    expect(spkis.every(isValidPin)).toBe(true);
    expect(new Set(spkis).size).toBe(spkis.length);
  });
  it('expires 12–24 months out (fail open for never-updated apps) and is a real yyyy-MM-dd date', () => {
    expect(PIN_EXPIRATION_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const exp = Date.parse(`${PIN_EXPIRATION_DATE}T00:00:00Z`);
    const introduced = Date.parse('2026-11-24T00:00:00Z');
    const months = (exp - introduced) / (30.44 * 24 * 3600 * 1000);
    expect(months).toBeGreaterThan(12);
    expect(months).toBeLessThan(24);
  });
});

describe('MOB-TLS-1 buildPinningOptions', () => {
  it('pins the API host in production and staging (preview) builds, with ≥2 pins + the expiry, exact host only', () => {
    for (const appEnv of ['production', 'staging']) {
      const o = buildPinningOptions({ appEnv, apiUrl: `${API}/` });
      expect(Object.keys(o!)).toEqual(['api.krishalaya.com']);
      expect(o!['api.krishalaya.com'].publicKeyHashes.length).toBeGreaterThanOrEqual(2);
      expect(o!['api.krishalaya.com'].expirationDate).toBe(PIN_EXPIRATION_DATE);
      expect(o!['api.krishalaya.com'].includeSubdomains).toBe(false);
      expect(pinningOptionsValid(o)).toBe(true);
    }
    expect(Object.keys(buildPinningOptions({ appEnv: 'staging', apiUrl: 'https://api.staging.krishalaya.com:443/v1' })!)).toEqual(['api.staging.krishalaya.com']);
  });
  it('never pins in development / unknown / unset environments', () => {
    for (const appEnv of ['development', 'test', 'preview', '', undefined]) {
      expect(buildPinningOptions({ appEnv, apiUrl: API })).toBeNull();
    }
  });
  it('never pins dev hosts (localhost, LAN/loopback IPs, tunnels, .local) or plain http, even in a release env', () => {
    for (const apiUrl of [
      'http://localhost:3000', 'https://localhost:3000', 'https://127.0.0.1', 'https://10.0.2.2:3000', 'https://192.168.1.20:3000',
      'https://172.16.4.2', 'https://[::1]:3000', 'https://my-mac.local', 'https://abcd.ngrok-free.app', 'https://abcd.ngrok.io',
      'https://xyz.exp.direct', 'http://api.krishalaya.com', '', undefined, 'not a url',
    ]) {
      expect(buildPinningOptions({ appEnv: 'production', apiUrl })).toBeNull();
    }
    expect(isDevHost('api.krishalaya.com')).toBe(false);
  });
  it('never pins third parties (Razorpay, Sentry, Expo, Google, AWS-owned names) even if passed in', () => {
    const third = ['https://api.razorpay.com', 'https://o1.ingest.sentry.io', 'https://u.expo.dev', 'https://exp.host',
      'https://fcm.googleapis.com', 'https://www.google.com', 'https://bucket.s3.ap-south-1.amazonaws.com', 'https://d1.cloudfront.net'];
    for (const url of third) {
      expect(isThirdPartyHost(httpsHostOf(url)!)).toBe(true);
      expect(buildPinningOptions({ appEnv: 'production', apiUrl: url })).toBeNull();
    }
    const o = buildPinningOptions({ appEnv: 'production', apiUrl: API, extraUrls: [...third, 'https://rt.krishalaya.com'] });
    expect(Object.keys(o!).sort()).toEqual(['api.krishalaya.com', 'rt.krishalaya.com']);
    expect(isThirdPartyHost('notrazorpay.com')).toBe(false); // suffix match is on a label boundary
  });
  it('the CI gate rejects short, duplicated, malformed, unexpiring or third-party configs', () => {
    const good = buildPinningOptions({ appEnv: 'production', apiUrl: API })!;
    const h = good['api.krishalaya.com'];
    expect(pinningOptionsValid(null)).toBe(false);
    expect(pinningOptionsValid({})).toBe(false);
    expect(pinningOptionsValid({ 'api.krishalaya.com': { ...h, publicKeyHashes: [h.publicKeyHashes[0]] } })).toBe(false);
    expect(pinningOptionsValid({ 'api.krishalaya.com': { ...h, publicKeyHashes: [h.publicKeyHashes[0], h.publicKeyHashes[0]] } })).toBe(false);
    expect(pinningOptionsValid({ 'api.krishalaya.com': { ...h, publicKeyHashes: ['nope', 'nope2'] } })).toBe(false);
    expect(pinningOptionsValid({ 'api.krishalaya.com': { ...h, expirationDate: '' } })).toBe(false);
    expect(pinningOptionsValid({ 'api.razorpay.com': h })).toBe(false);
    expect(pinningOptionsValid({ localhost: h })).toBe(false);
  });
});

describe('MOB-TLS-1 pin-failure reporting', () => {
  it('reports once per host, hostname only (no URL / path / query / native message), named TlsPinFailure', () => {
    const calls: Array<[Error, Record<string, unknown>]> = [];
    const report = makePinFailureReporter((e, c) => calls.push([e, c]), 'android');
    report({ serverHostname: 'api.krishalaya.com', message: 'Certificate pinning failure!\n Peer certificate chain: sha256/abc… CN=mitmproxy' });
    report({ serverHostname: 'api.krishalaya.com', message: 'again' });
    report({ serverHostname: 'API.krishalaya.com/v1/auth/otp?phone=9876543210' });
    report({ serverHostname: 'rt.krishalaya.com' });
    expect(calls).toHaveLength(2);
    expect(calls[0][0].name).toBe(PIN_FAILURE_ERROR_NAME);
    expect(calls[0][1]).toEqual({ kind: 'tls_pin_failure', host: 'api.krishalaya.com', platform: 'android' });
    expect(calls[1][1].host).toBe('rt.krishalaya.com');
    const serialized = JSON.stringify(calls.map(([e, c]) => [e.message, c]));
    expect(serialized).not.toMatch(/mitmproxy|sha256|\?|9876543210|\/v1/);
  });
  it('never throws — a broken reporter or a junk event cannot crash the app', () => {
    const report = makePinFailureReporter(() => { throw new Error('sentry down'); }, 'ios');
    expect(() => report({ serverHostname: 'api.krishalaya.com' })).not.toThrow();
    expect(() => report(undefined as never)).not.toThrow();
    const calls: unknown[] = [];
    makePinFailureReporter((_e, c) => calls.push(c), 'ios')({});
    expect(calls).toEqual([{ kind: 'tls_pin_failure', host: 'unknown', platform: 'ios' }]);
  });
});

describe('MOB-TLS-1 Android network security config (plugin output)', () => {
  it('release: no cleartext, system CAs only — user-installed CAs NOT trusted, no pin-set (pins are runtime + reported)', () => {
    const xml = nsc.releaseNetworkSecurityXml();
    expect(xml).toContain('cleartextTrafficPermitted="false"');
    expect(xml).toContain('<certificates src="system" />');
    expect(xml).not.toContain('src="user"');
    expect(xml).not.toContain('pin-set');
    expect(xml).not.toContain('debug-overrides');
  });
  it('debug overlay (debug build type only) allows Metro cleartext + dev-proxy user CAs', () => {
    const xml = nsc.debugNetworkSecurityXml();
    expect(xml).toContain('cleartextTrafficPermitted="true"');
    expect(xml).toContain('<certificates src="user" />');
  });
});

describe('MOB-TLS-1 runtime install (tls-pinning.runtime)', () => {
  type Lib = { isSslPinningAvailable: jest.Mock; initializeSslPinning: jest.Mock; addSslPinningErrorListener: jest.Mock };
  function load(appEnv: string, apiUrl: string, lib: Partial<Lib> = {}) {
    jest.resetModules();
    const capture = jest.fn();
    const full: Lib = {
      isSslPinningAvailable: jest.fn(() => true),
      initializeSslPinning: jest.fn(() => Promise.resolve()),
      addSslPinningErrorListener: jest.fn(),
      ...lib,
    };
    const libFactory = jest.fn(() => full);
    jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }), { virtual: true });
    jest.doMock('../../core/config', () => ({ config: { appEnv, apiUrl } }));
    jest.doMock('../../core/observability', () => ({ captureError: capture }));
    jest.doMock('react-native-ssl-public-key-pinning', libFactory, { virtual: true });
    // eslint-disable-next-line @typescript-eslint/no-var-requires, no-restricted-syntax -- fresh module per scenario
    const rt = require('../../core/security/tls-pinning.runtime') as typeof import('../../core/security/tls-pinning.runtime');
    return { rt, capture, full, libFactory };
  }
  afterEach(() => jest.resetModules());

  it('development build: the native library is never loaded, nothing pinned', async () => {
    const { rt, libFactory } = load('development', 'http://192.168.1.5:3000');
    await rt.tlsPinningReady();
    expect(libFactory).not.toHaveBeenCalled();
  });
  it('production build: registers the failure listener, then pins the API host once (idempotent)', async () => {
    const { rt, full, capture } = load('production', API);
    await Promise.all([rt.tlsPinningReady(), rt.tlsPinningReady()]);
    expect(full.addSslPinningErrorListener).toHaveBeenCalledTimes(1);
    expect(full.initializeSslPinning).toHaveBeenCalledTimes(1);
    const opts = full.initializeSslPinning.mock.calls[0][0];
    expect(Object.keys(opts)).toEqual(['api.krishalaya.com']);
    // the registered listener reports through captureError with the hostname only
    full.addSslPinningErrorListener.mock.calls[0][0]({ serverHostname: 'api.krishalaya.com', message: 'Certificate pinning failure' });
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ name: 'TlsPinFailure' }), { kind: 'tls_pin_failure', host: 'api.krishalaya.com', platform: 'android' });
  });
  it('a native set-up failure never rejects (boot continues) and is reported', async () => {
    const { rt, capture } = load('staging', API, { initializeSslPinning: jest.fn(() => Promise.reject(new Error('boom'))) });
    await expect(rt.tlsPinningReady()).resolves.toBeUndefined();
    expect(capture).toHaveBeenCalledWith(expect.any(Error), { kind: 'tls_pin_init_failed', platform: 'android' });
  });
  it('a pinned build without the native module is reported, not crashed', async () => {
    const { rt, capture, full } = load('production', API, { isSslPinningAvailable: jest.fn(() => false) });
    await rt.tlsPinningReady();
    expect(full.initializeSslPinning).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith(expect.any(Error), { kind: 'tls_pin_unavailable', platform: 'android' });
  });
});
