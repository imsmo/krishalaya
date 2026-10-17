// apps/web-storefront/src/test/brand-guard.spec.ts · PC-56 STORE-1a · C10 (survey F-5) — THE ABANDONED BRAND NEVER COMES BACK.
// The hi/gu catalogues carried "कृषि-वर्स" / "કૃષિ-વર્સ" (Krishi-Verse) on 11 lines each, four of them on TENANT routes. The decided
// vernacular spellings are "कृषालय" / "કૃષાલય" (web-gov, web-ops, web-tenant). And a sentence a TENANT route renders never carries the
// platform's name as a literal: it interpolates `{platform}` (from `brand.platform`, the catalogue's one brand entry), so a white-label
// decision is one place, not a grep. Scope of that second rule: the keys STORE-1a touches (auth.*) plus the five the survey named.
import { PLATFORM_BRAND } from '@krishalaya/tokens';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { STORE_RENDERED_SURFACES, STORE_RENDERED_SURFACES_B, SWEEP_REFUSALS } from '../features/sweep/refusals';

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
    expect(scoped.filter((k) => STORE1B.test(k)).length).toBe(90);   // every key STORE-1b added (PC-56 STORE-SWEEP-a: − footer.soon, the retired "coming soon")
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

  // PC-56 STORE-2b · C7: the cart is a TENANT route (/<slug>/cart under the organisation's header) — none of its sentences names the platform
  it.each(Object.entries(CATS))('%s: no STORE-2b value carries the platform\'s name (the cart is the organisation\'s)', (_l, cat) => {
    const keys = Object.keys(cat).filter((k) => k.startsWith('store2b.') || /^cart\.(titleOrg|signin|otherStore|refused\.|reason\.|drift\.|confirm\.|done\.|status\.|line\.)/.test(k));
    expect(keys.length).toBeGreaterThan(60);
    for (const k of keys) for (const lit of PLATFORM_LITERALS) expect([k, (cat as Record<string, string>)[k].includes(lit)]).toEqual([k, false]);
  });

  // PC-56 STORE-3a · C5: the order pages are TENANT routes (/<slug>/orders…) — none of their sentences names the platform
  it.each(Object.entries(CATS))('%s: no STORE-3a value carries the platform\'s name (the orders are the organisation\'s)', (_l, cat) => {
    const keys = Object.keys(cat).filter((k) => k.startsWith('store3a.') || k.startsWith('order.cancelReason.'));
    expect(keys.length).toBeGreaterThan(110);
    for (const k of keys) for (const lit of PLATFORM_LITERALS) expect([k, (cat as Record<string, string>)[k].includes(lit)]).toEqual([k, false]);
  });

  // PC-56 STORE-3b · C5: the offer pages are TENANT routes (/<slug>/offers…) — none of their sentences names the platform
  it.each(Object.entries(CATS))('%s: no STORE-3b value carries the platform\'s name (the offers are the organisation\'s)', (_l, cat) => {
    const keys = Object.keys(cat).filter((k) => k.startsWith('store3b.'));
    expect(keys.length).toBeGreaterThan(100);
    for (const k of keys) for (const lit of PLATFORM_LITERALS) expect([k, (cat as Record<string, string>)[k].includes(lit)]).toEqual([k, false]);
  });

  // PC-56 STORE-5b · C7 (founder D7 / Q15): the trace, verify, export, certificate and dairy pages live under the HOST's chrome (an organisation's
  // store shows its own mark) — none of their sentences names the platform or carries a brand-domain literal; the screens and the pure helpers
  // carry no `krishalaya.in` either (the QR's URL is the host's own /trace/<token>)
  it.each(Object.entries(CATS))('%s: no STORE-5b value carries the platform\'s name or a brand domain', (_l, cat) => {
    const keys = Object.keys(cat).filter((k) => k.startsWith('store5b.') || k.startsWith('trace.step.') || k.startsWith('trace.meta.'));
    expect(keys.length).toBeGreaterThan(150);
    for (const k of keys) {
      const v = (cat as Record<string, string>)[k];
      for (const lit of PLATFORM_LITERALS) expect([k, v.includes(lit)]).toEqual([k, false]);
      expect([k, /krishalaya\.in|\.in\/c\//i.test(v)]).toEqual([k, false]);
    }
  });
  it('STORE-5b: no brand-domain literal in the trace screens, routes or helpers', () => {
    const { readdirSync, readFileSync, statSync } = jest.requireActual('node:fs') as typeof import('node:fs');
    const { join } = jest.requireActual('node:path') as typeof import('node:path');
    const files: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(e)) files.push(p); } };
    for (const d of ['components/trace', 'features/store5b', 'app/(platform)/trace', 'app/(platform)/certificates', 'app/[tenantSlug]/trace', 'app/[tenantSlug]/certificates']) walk(join(__dirname, '..', d));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect([f, /krishalaya\.in/i.test(readFileSync(f, 'utf8'))]).toEqual([f, false]);
  });

  // PC-56 STORE-6a · D6 / D7 (founders Q6 / Q10): the offline page, the queued-actions list and the install page live under the organisation's chrome
  // on its store — none of their sentences names the platform; the manifest's description names the organisation alone ({tenant}, no {platform})
  it.each(Object.entries(CATS))('%s: no store6 value carries the platform\'s name; the tenant manifest description has no {platform}', (_l, cat) => {
    const keys = Object.keys(cat).filter((k) => k.startsWith('store6.'));
    expect(keys.length).toBeGreaterThan(150);
    for (const k of keys) {
      const v = (cat as Record<string, string>)[k];
      for (const lit of PLATFORM_LITERALS) expect([k, v.includes(lit)]).toEqual([k, false]);
      expect([k, v.includes('{platform}')]).toEqual([k, false]);
    }
    expect((cat as Record<string, string>)['store6.manifest.description']).toContain('{tenant}');
  });

  // PC-56 STORE-SWEEP-a · C2 (founders D4 / D8): Help, the quality promise and a store's contact page render under a STORE's chrome — every sentence a
  // store renders (help.*, sweep.quality.*, sweep.storeContact.*, the footer's new keys, the refusals printed on those three surfaces) names no
  // platform: no literal name, no {platform} (organisation-neutral words; the platform's own help question opens no store). About, Press, Trust and
  // the platform's Contact are the platform's pages (a store host redirects them).
  it.each(Object.entries(CATS))('%s: no store-rendered SWEEP-a value carries the platform\'s name or {platform}', (_l, cat) => {
    const storeRefusals = SWEEP_REFUSALS.filter((r) => r.surfaces.some((x) => STORE_RENDERED_SURFACES.includes(x))).map((r) => r.key);
    const keys = [...Object.keys(cat).filter((k) => /^(help\.|sweep\.quality\.|sweep\.storeContact\.|sweep\.footer\.)/.test(k)), ...storeRefusals];
    expect(keys.length).toBe(96);   // help.* 44 · sweep.quality.* 17 · sweep.storeContact.* 9 · sweep.footer.* 2 · the 22 refusals printed on help / quality / contact_store · PC-56 STORE-SWEEP-b: + help.link.language, + sweep.footer.language
    for (const k of keys) {
      const v = (cat as Record<string, string>)[k];
      for (const lit of PLATFORM_LITERALS) expect([k, v.includes(lit)]).toEqual([k, false]);
      expect([k, v.includes('{platform}')]).toEqual([k, false]);
    }
  });

  // PC-56 STORE-SWEEP-b · C2 (founders D1 / D3 / D4): the delivery section, the language page, the store's boundary words and the ribbon render under a
  // STORE's chrome — no platform name, no {platform} (the boundaries name the organisation as {org}; the platform's own "Back to the bazaar" is a plain
  // word, never the brand); the middleware's words name nobody at all.
  it.each(Object.entries(CATS))('%s: no store-rendered SWEEP-b value carries the platform\'s name or {platform}', (_l, cat) => {
    const storeRefusals = SWEEP_REFUSALS.filter((r) => r.surfaces.some((x) => STORE_RENDERED_SURFACES_B.includes(x))).map((r) => r.key);
    const keys = [...Object.keys(cat).filter((k) => /^sweep\.(tracking|language|err|edge|ribbon)\./.test(k)), ...storeRefusals];
    expect(keys.length).toBe(66);   // tracking 21 · language 8 · err 14 · edge 3 · ribbon 5 · the 15 refusals printed on tracking / language
    for (const k of keys) {
      const v = (cat as Record<string, string>)[k];
      for (const lit of PLATFORM_LITERALS) expect([k, v.includes(lit)]).toEqual([k, false]);
      expect([k, v.includes('{platform}')]).toEqual([k, false]);
    }
  });

  it('the one brand entry: the token name in English, the decided vernacular spellings in hi / gu', () => {
    expect(en['brand.platform']).toBe(PLATFORM_BRAND.name);
    expect(hi['brand.platform']).toBe('कृषालय');
    expect(gu['brand.platform']).toBe('કૃષાલય');
  });
});
