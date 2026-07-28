// apps/web-tenant/src/test/locale-url.spec.ts · DEV-26, Q16 (URL/locale scheme) — pure logic, no Next runtime.
import { pickUrlLang, withUrlLang } from '../lib/locale-url';

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
