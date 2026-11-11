// apps/web-tenant/src/test/locale-url.spec.ts · DEV-26, Q16 (URL/locale scheme) — pure logic, no Next runtime.
import { pickChosenLang, pickUrlLang, withUrlLang } from '../lib/locale-url';

describe('pickUrlLang (Q16 URL/locale scheme, web-tenant console)', () => {
  it('resolves a valid live language code from ?lang=', () => {
    expect(pickUrlLang(new URL('https://kv.example/dashboard?lang=hi'))).toBe('hi');
    expect(pickUrlLang(new URL('https://kv.example/settings?lang=gu'))).toBe('gu');
  });
  it('returns null when no lang param is present', () => {
    expect(pickUrlLang(new URL('https://kv.example/dashboard'))).toBeNull();
  });
  it('returns null for an unknown code — never invents a locale', () => {
    expect(pickUrlLang(new URL('https://kv.example/?lang=xx'))).toBeNull();
  });
  it('returns null for a registered-but-not-live (coming soon) code', () => {
    expect(pickUrlLang(new URL('https://kv.example/?lang=bn'))).toBeNull();
  });
});

describe('withUrlLang (console)', () => {
  it('appends ?lang= to a bare path', () => {
    expect(withUrlLang('/dashboard', 'gu')).toBe('/dashboard?lang=gu');
  });
  it('replaces an existing lang param', () => {
    expect(withUrlLang('/dashboard?lang=en', 'hi')).toBe('/dashboard?lang=hi');
  });
});

// PC-56 RTL-1b-1 (founder Q1 "Draft all, opt-in only"): `?lang=ar` and the switcher's posted `ar` ARE the explicit choice,
// so they serve the Arabic machine draft; every other not-live code stays refused exactly as above.
describe('the explicit Arabic preview (RTL-1b-1)', () => {
  it('?lang=ar (and ar-AE) is a choice → ar', () => {
    expect(pickUrlLang(new URL('https://kv.example/listings?lang=ar'))).toBe('ar');
    expect(pickChosenLang('ar-AE')).toBe('ar');
  });
  it('the switcher post: live codes as before, ar served, everything else refused (→ the route\'s en default)', () => {
    expect(pickChosenLang('hi')).toBe('hi');
    expect(pickChosenLang('gu')).toBe('gu');
    expect(pickChosenLang('en')).toBe('en');
    expect(pickChosenLang('ar')).toBe('ar');
    expect(pickChosenLang('ur')).toBeNull();
    expect(pickChosenLang('bn')).toBeNull();
    expect(pickChosenLang('xx')).toBeNull();
    expect(pickChosenLang('')).toBeNull();
    expect(pickChosenLang(undefined)).toBeNull();
  });
});
