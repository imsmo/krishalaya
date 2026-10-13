// apps/web-storefront/src/test/brand-guard.spec.ts · PC-56 STORE-1a · C10 (survey F-5) — THE ABANDONED BRAND NEVER COMES BACK.
// The hi/gu catalogues carried "कृषि-वर्स" / "કૃષિ-વર્સ" (Krishi-Verse) on 11 lines each, four of them on TENANT routes. The decided
// vernacular spellings are "कृषालय" / "કૃષાલય" (web-gov, web-ops, web-tenant). And a sentence a TENANT route renders never carries the
// platform's name as a literal: it interpolates `{platform}` (from `brand.platform`, the catalogue's one brand entry), so a white-label
// decision is one place, not a grep. Scope of that second rule: the keys STORE-1a touches (auth.*) plus the five the survey named.
import { PLATFORM_BRAND } from '@krishalaya/tokens';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const SURVEY_KEYS = ['storefront.metaDescription', 'listing.auctionNote', 'listing.serviceNote', 'listing.traceNote', 'trace.metaDescription'];
const PLATFORM_LITERALS = [PLATFORM_BRAND.name, 'कृषालय', 'કૃષાલય'];

describe('STORE-1a · brand guard', () => {
  it.each(Object.entries(CATS))('%s: no "Krishi", no "कृषि-वर्स", no "કૃષિ-વર્સ" anywhere', (_l, cat) => {
    for (const [k, v] of Object.entries(cat)) {
      expect([k, /Krishi|कृषि-वर्स|કૃષિ-વર્સ/i.test(v)]).toEqual([k, false]);
    }
  });
  it.each(Object.entries(CATS))('%s: tenant-route sentences interpolate {platform}, never the literal name', (_l, cat) => {
    const scoped = [...SURVEY_KEYS, ...Object.keys(cat).filter((k) => k.startsWith('auth.'))];
    for (const k of scoped) {
      const v = (cat as Record<string, string>)[k];
      for (const lit of PLATFORM_LITERALS) expect([k, v.includes(lit)]).toEqual([k, false]);
    }
    for (const k of SURVEY_KEYS) expect([k, (cat as Record<string, string>)[k].includes('{platform}')]).toEqual([k, true]);
  });
  it('the one brand entry: the token name in English, the decided vernacular spellings in hi / gu', () => {
    expect(en['brand.platform']).toBe(PLATFORM_BRAND.name);
    expect(hi['brand.platform']).toBe('कृषालय');
    expect(gu['brand.platform']).toBe('કૃષાલય');
  });
});
