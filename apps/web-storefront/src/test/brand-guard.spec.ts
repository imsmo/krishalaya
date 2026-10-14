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
    // PC-56 STORE-1b · C1: the two homes' new keys too (the tenant home, the platform home, the headers / footers, /discover, /organisations,
    // /trace, the as-of stamp) — the platform's name only ever arrives as {platform} / {store}.
    const STORE1B = /^(meta\.|header\.|footer\.(about|col\.help|col\.farmers|help|returns|contact|soon|openStorefront|traceHow)$|home\.(hero|cta|glance|refusal|categories|fresh|orgs|trace)\.|home\.retry$|card\.soldBy$|discover\.(title|lead|empty|error|showMore|clearSearch)$|orgs\.|trace\.(how|code)\.|asOf\.|tenant\.)/;
    const scoped = [...SURVEY_KEYS, ...Object.keys(cat).filter((k) => k.startsWith('auth.') || STORE1B.test(k))];
    expect(scoped.filter((k) => STORE1B.test(k)).length).toBe(91);   // every key STORE-1b added
    for (const k of scoped) {
      const v = (cat as Record<string, string>)[k];
      for (const lit of PLATFORM_LITERALS) expect([k, v.includes(lit)]).toEqual([k, false]);
    }
    for (const k of SURVEY_KEYS) expect([k, (cat as Record<string, string>)[k].includes('{platform}')]).toEqual([k, true]);
  });
  it('STORE-1b: the vernacular sub-line is catalogue copy (founder D2) — "किसान से सीधे" / "ખેડૂતથી સીધું"; the store name itself is the token', () => {
    expect(hi['header.subline']).toBe('किसान से सीधे');
    expect(gu['header.subline']).toBe('ખેડૂતથી સીધું');
    for (const cat of Object.values(CATS)) {
      expect(cat['meta.platformTitle']).toContain('{store}');
      expect(cat['tenant.since']).toContain('{platform}');
      expect(cat['meta.platformDescription']).toContain('{platform}');
      for (const v of Object.values(cat)) expect(v.includes(PLATFORM_BRAND.platformStoreName)).toBe(false);
    }
  });
  // PC-56 STORE-1c (Law 3, survey F-13): "₹0" / "From ₹999/mo" lived in all three catalogues as /pricing's tiers. Money is printed from the
  // server's bigint minor units through the formatter — so NO catalogue value carries a currency sign, and no STORE-1c string (signup.*,
  // pricing.*) carries a digit: every figure on W307 and /pricing is interpolated (plans, TTL, waits, trial days, the name-length rules).
  it.each(Object.entries(CATS))('%s: no ₹ (or any currency sign) in any value; no digit in a STORE-1c value; {platform}, never the name', (_l, cat) => {
    for (const [k, v] of Object.entries(cat)) expect([k, /[₹$€£¥]/.test(v)]).toEqual([k, false]);
    const store1c = Object.keys(cat).filter((k) => k.startsWith('signup.') || k.startsWith('pricing.'));
    expect(store1c.length).toBe(118);   // the 117 STORE-1c keys + pricing.title (kept)
    for (const k of store1c) {
      const v = (cat as Record<string, string>)[k].replace(/\{[a-z]+\}/gi, '');
      expect([k, /[0-9०-९૦-૯]/.test(v)]).toEqual([k, false]);
      for (const lit of PLATFORM_LITERALS) expect([k, (cat as Record<string, string>)[k].includes(lit)]).toEqual([k, false]);
    }
  });

  it('the one brand entry: the token name in English, the decided vernacular spellings in hi / gu', () => {
    expect(en['brand.platform']).toBe(PLATFORM_BRAND.name);
    expect(hi['brand.platform']).toBe('कृषालय');
    expect(gu['brand.platform']).toBe('કૃષાલય');
  });
});
