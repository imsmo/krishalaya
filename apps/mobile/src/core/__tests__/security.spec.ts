// Unit tests for the PURE security logic (core/security: pinning, integrity, deeplink-guard, clipboard-policy)
// shipped in the P-30 hardening pass. No React/native deps. These pin the client-side invariants §4 relies on:
// a malformed/short TLS pin set is caught in CI (not the field), the integrity header is PII-free + never claims
// "clean" without proof, inbound deep links are scheme+route allowlisted and reject traversal, and sensitive
// clipboard kinds are never copyable.
import { isValidPin, isValidHostPins, hostOf, isPinnedHost, pinConfigReady } from '../../core/security/pinning';
import { buildIntegrityHeader, isSensitivePath, UNKNOWN_INTEGRITY } from '../../core/security/integrity';
import { parseDeepLink, isSafeParamValue } from '../../core/security/deeplink-guard';
import { isCopyAllowed } from '../../core/security/clipboard-policy';
import { engageSecureScreen, type ScreenCaptureGuard } from '../../core/security/screen-capture-guard';

const PIN_A = 'A'.repeat(43) + '='; // well-formed 44-char base64 SHA-256 SPKI
const PIN_B = 'B'.repeat(43) + '=';

describe('TLS pinning config', () => {
  it('validates pin format', () => {
    expect(isValidPin(PIN_A)).toBe(true);
    expect(isValidPin('too-short')).toBe(false);
    expect(isValidPin('')).toBe(false);
  });
  it('requires ≥2 distinct valid pins (primary + backup for rotation)', () => {
    expect(isValidHostPins({ host: 'api.x.com', pins: [PIN_A, PIN_B] })).toBe(true);
    expect(isValidHostPins({ host: 'api.x.com', pins: [PIN_A] })).toBe(false);       // no backup
    expect(isValidHostPins({ host: 'api.x.com', pins: [PIN_A, PIN_A] })).toBe(false); // dupes
    expect(isValidHostPins({ host: '', pins: [PIN_A, PIN_B] })).toBe(false);
    expect(isValidHostPins(null)).toBe(false);
  });
  it('matches hosts (incl. subdomains when opted in)', () => {
    expect(hostOf('https://api.krishalaya.com/v1/x')).toBe('api.krishalaya.com');
    expect(hostOf('http://insecure.com')).toBeNull(); // not https
    const list = [{ host: 'krishalaya.com', pins: [PIN_A, PIN_B], includeSubdomains: true }];
    expect(isPinnedHost('https://api.krishalaya.com/v1', list)).toBe(true);
    expect(isPinnedHost('https://evil.com', list)).toBe(false);
  });
  it('pinConfigReady gates a valid non-empty prod config', () => {
    expect(pinConfigReady([{ host: 'api.x.com', pins: [PIN_A, PIN_B] }])).toBe(true);
    expect(pinConfigReady([])).toBe(false);
    expect(pinConfigReady([{ host: 'api.x.com', pins: [PIN_A] }])).toBe(false);
  });
});

describe('device-integrity signal', () => {
  it('builds a compact PII-free header and never claims clean without proof', () => {
    expect(buildIntegrityHeader(UNKNOWN_INTEGRITY)).toBe('posture=unknown;root=0;emu=0');
    expect(buildIntegrityHeader({ posture: 'compromised', rootedHint: true, emulatorHint: true })).toBe('posture=compromised;root=1;emu=1');
    // an unrecognized posture degrades to 'unknown' (never silently 'attested')
    expect(buildIntegrityHeader({ posture: 'clean' as any })).toBe('posture=unknown;root=0;emu=0');
  });
  it('classifies sensitive API paths', () => {
    expect(isSensitivePath('auth/verify')).toBe(true);
    expect(isSensitivePath('/payments/intents')).toBe(true);
    expect(isSensitivePath('wallet/withdraw')).toBe(true);
    expect(isSensitivePath('kyc/documents')).toBe(true);
    expect(isSensitivePath('listings')).toBe(false);
  });
});

describe('inbound deep-link guard', () => {
  it('accepts our scheme on an allowlisted route', () => {
    expect(parseDeepLink('krishiverse://order/abc123')).toEqual({ ok: true, path: 'order/abc123' });
    expect(parseDeepLink('krishiverse://listing/xyz?ref=sms')).toEqual({ ok: true, path: 'listing/xyz' });
  });
  it('rejects foreign schemes, non-allowlisted routes, and traversal/junk', () => {
    expect(parseDeepLink('evil://order/1').reason).toBe('scheme');
    expect(parseDeepLink('krishiverse://wallet/withdraw').reason).toBe('route'); // money flows NOT link-reachable
    expect(parseDeepLink('krishiverse://order/../../etc').reason).toBe('malformed');
    expect(parseDeepLink('').reason).toBe('malformed');
  });
  it('accepts https app-links only for allowlisted hosts', () => {
    expect(parseDeepLink('https://app.krishalaya.com/order/1', ['app.krishalaya.com'])).toEqual({ ok: true, path: 'order/1' });
    expect(parseDeepLink('https://evil.com/order/1', ['app.krishalaya.com']).reason).toBe('scheme');
  });
  it('isSafeParamValue rejects hostile param values', () => {
    expect(isSafeParamValue('abc-123_ID.4')).toBe(true);
    expect(isSafeParamValue('../etc')).toBe(false);
    expect(isSafeParamValue('a b')).toBe(false);
    expect(isSafeParamValue('x'.repeat(200))).toBe(false);
  });
});

describe('clipboard policy', () => {
  it('allows only non-sensitive allowlisted kinds; refuses OTP/token/bank/PII', () => {
    expect(isCopyAllowed('orderNo')).toBe(true);
    expect(isCopyAllowed('ticketNo')).toBe(true);
    expect(isCopyAllowed('otp')).toBe(false);
    expect(isCopyAllowed('token')).toBe(false);
    expect(isCopyAllowed('bank')).toBe(false);
    expect(isCopyAllowed('aadhaar')).toBe(false);
    expect(isCopyAllowed('whatever')).toBe(false);
  });
});

// MF-01: the FLAG_SECURE screen guard used to be wired to React mount/unmount, but Tabs/native-stack screens
// don't unmount on navigation — only focus/blur fire. That left the OS secure flag stuck on after visiting any
// money/KYC screen, blacking out every later screen in a recording (the "pure black void" bug). engageSecureScreen
// is the pure on/blur-cleanup unit the hook now wires to useFocusEffect instead of useEffect — tested here without
// any React renderer.
describe('secure-screen focus guard (FLAG_SECURE)', () => {
  function fakeGuard() {
    let secure = false;
    const guard: ScreenCaptureGuard = {
      preventScreenCaptureAsync: async () => { secure = true; },
      allowScreenCaptureAsync: async () => { secure = false; },
    };
    return { guard, isSecure: () => secure };
  }

  it('engages capture-prevention immediately on focus', () => {
    const { guard, isSecure } = fakeGuard();
    engageSecureScreen(guard);
    expect(isSecure()).toBe(true);
  });

  it('releases capture-prevention when the returned blur cleanup runs', async () => {
    const { guard, isSecure } = fakeGuard();
    const onBlur = engageSecureScreen(guard);
    expect(isSecure()).toBe(true);
    onBlur();
    await Promise.resolve(); // flush the allow-capture microtask
    expect(isSecure()).toBe(false);
  });

  it('degrades silently (never throws) if the native module rejects', () => {
    const throwingGuard: ScreenCaptureGuard = {
      preventScreenCaptureAsync: () => Promise.reject(new Error('no native module')),
      allowScreenCaptureAsync: () => Promise.reject(new Error('no native module')),
    };
    let onBlur: () => void;
    expect(() => { onBlur = engageSecureScreen(throwingGuard); }).not.toThrow();
    expect(() => onBlur!()).not.toThrow();
  });

  it('re-engages on a second focus after a blur (simulates leaving and returning to a secure screen)', () => {
    const { guard, isSecure } = fakeGuard();
    const onBlur1 = engageSecureScreen(guard);
    expect(isSecure()).toBe(true);
    onBlur1();
    engageSecureScreen(guard); // focused again
    expect(isSecure()).toBe(true);
  });
});
