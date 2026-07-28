// apps/web-storefront/src/test/locale-url.spec.ts · DEV-26, Q16 (URL/locale scheme) — pure logic, no Next runtime.
import { pickUrlLang, withUrlLang } from '../lib/locale-url';

describe('pickUrlLang (Q16 URL/locale scheme)', () => {
  it('resolves a valid live language code from ?lang=', () => {
    expect(pickUrlLang(new URL('https://kv.example/?lang=hi'))).toBe('hi');
    expect(pickUrlLang(new URL('https://kv.example/pricing?lang=gu'))).toBe('gu');
  });
  it('accepts a BCP-47 style value and normalizes to the short code (e.g. hi-IN -> hi)', () => {
    expect(pickUrlLang(new URL('https://kv.example/?lang=hi-IN'))).toBe('hi');
  });
  it('returns null when no lang param is present (fall through to cookie/Accept-Language unchanged)', () => {
    expect(pickUrlLang(new URL('https://kv.example/pricing'))).toBeNull();
  });
  it('returns null for an unknown/unregistered code — never invents a locale', () => {
    expect(pickUrlLang(new URL('https://kv.example/?lang=zz'))).toBeNull();
  });
  it('returns null for a REGISTERED but not-yet-LIVE (coming-soon) code — Q16 only wires selectable languages', () => {
    // 'mr' (Marathi) is in the full 14-entry registry but status='machine-draft-pending-review', not live.
    expect(pickUrlLang(new URL('https://kv.example/?lang=mr'))).toBeNull();
  });
  it('preserves other query params and only sets/replaces lang', () => {
    expect(pickUrlLang(new URL('https://kv.example/discover?category=grain&lang=hi'))).toBe('hi');
  });
});

describe('withUrlLang (round-trip: switching language produces a real, shareable URL)', () => {
  it('appends ?lang= to a bare path', () => {
    expect(withUrlLang('/pricing', 'hi')).toBe('/pricing?lang=hi');
  });
  it('replaces an existing lang param rather than duplicating it', () => {
    expect(withUrlLang('/pricing?lang=en', 'gu')).toBe('/pricing?lang=gu');
  });
  it('preserves other existing query params alongside lang', () => {
    const out = withUrlLang('/discover?category=grain', 'hi');
    expect(out).toContain('category=grain');
    expect(out).toContain('lang=hi');
  });
});
