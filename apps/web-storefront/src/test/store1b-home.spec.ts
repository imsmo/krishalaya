// apps/web-storefront/src/test/store1b-home.spec.ts · PC-56 STORE-1b — the pure rules behind the two homes:
//   load-result  error ≠ empty (a 404 is not_found, anything else unavailable — never an empty list); Retry = the same URL, never a mutation;
//                the "N published" count is capped ("1,000+"); "members-only" is said only when counted;
//   money        the price band uses the CURRENCY's exponent (INR 2, JPY 0, BHD 3) — never a hard-coded 2; an unknown currency parses nothing;
//   refusals     every brief §E refusal is in the map, each rendered one has a key in all three catalogues, none prints a figure;
//   trace code   the camera-less "Scan a trace QR" form goes only to /trace/<url-safe code>.
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { listState, loadResult, publishedCount, reloadHref, retryIsMutation, showsMembersOnly } from '../features/home/load-result';
import { currencyExponent } from '../features/discovery/money';
import { minorToMajor, parseMajorToMinor, toListingQuery } from '../features/discovery/query';
import { STORE1B_CHAIN_PAGES, STORE1B_REFUSALS, refusalKey } from '../features/home/refusals';
import { traceCodeHref } from '../features/home/trace-code';

describe('STORE-1b · load-result — error is not empty', () => {
  it('a 404 is not_found; a timeout / 5xx / network failure is unavailable; a success keeps its (possibly empty) data', async () => {
    expect(await loadResult(async () => ({ items: [] }))).toEqual({ ok: true, data: { items: [] } });
    expect(await loadResult(async () => { throw Object.assign(new Error('x'), { status: 404 }); })).toEqual({ ok: false, kind: 'not_found' });
    expect(await loadResult(async () => { throw Object.assign(new Error('x'), { status: 503 }); })).toEqual({ ok: false, kind: 'unavailable' });
    expect(await loadResult(async () => { throw new TypeError('fetch failed'); })).toEqual({ ok: false, kind: 'unavailable' });
  });
  it('listState: rows → ok, a successful empty answer → empty, any failure → error (never empty)', () => {
    expect(listState({ ok: true, data: { items: [1] } })).toBe('ok');
    expect(listState({ ok: true, data: { items: [] } })).toBe('empty');
    expect(listState({ ok: false, kind: 'unavailable' })).toBe('error');
    expect(listState({ ok: false, kind: 'not_found' })).toBe('error');
  });
  it('Retry reloads the SAME URL (path + query) and is not a mutation (no confirm step wraps a read)', () => {
    expect(reloadHref('/')).toBe('/');
    expect(reloadHref('/anand-fpo', { q: 'wheat', saleType: 'direct', cursor: 'abc' })).toBe('/anand-fpo?q=wheat&saleType=direct&cursor=abc');
    expect(reloadHref('/discover', { category: ['a', 'b'] })).toBe('/discover?category=a&category=b');
    expect(retryIsMutation()).toBe(false);
  });
  it('"N published" is exact up to the cap and "cap+" above it; unknown when the API did not say', () => {
    expect(publishedCount(38, 1000)).toEqual({ n: 38, capped: false });
    expect(publishedCount(1000, 1000)).toEqual({ n: 1000, capped: false });
    expect(publishedCount(1001, 1000)).toEqual({ n: 1000, capped: true });
    expect(publishedCount(null, 1000)).toBeNull();
    expect(publishedCount(undefined, undefined)).toBeNull();
  });
  it('"Some lots are members-only" only when at least one was counted', () => {
    expect(showsMembersOnly(1)).toBe(true);
    expect(showsMembersOnly(0)).toBe(false);
    expect(showsMembersOnly(null)).toBe(false);
  });
});

describe('STORE-1b · money — the currency\'s own exponent (survey F-15)', () => {
  it('Intl\'s ISO 4217 minor units: INR 2, USD 2, JPY 0, BHD 3; junk → null', () => {
    expect(currencyExponent('INR')).toBe(2); expect(currencyExponent('usd')).toBe(2);
    expect(currencyExponent('JPY')).toBe(0); expect(currencyExponent('BHD')).toBe(3);
    expect(currencyExponent('')).toBeNull(); expect(currencyExponent('RUPEE')).toBeNull(); expect(currencyExponent(null)).toBeNull();
  });
  it('the price band parses with that exponent — never a hard-coded 2', () => {
    expect(parseMajorToMinor('123.45', 2)).toBe('12345');
    expect(parseMajorToMinor('1500', 0)).toBe('1500');
    expect(parseMajorToMinor('1500.5', 0)).toBeUndefined();       // a 0-decimal currency has no minor part
    expect(parseMajorToMinor('1.234', 3)).toBe('1234');
    expect(parseMajorToMinor('1.2', 3)).toBe('1200');
    expect(minorToMajor('1500', 0)).toBe('1500');
    expect(minorToMajor('1234', 3)).toBe('1.234');
    expect(toListingQuery({ priceMin: '1500', priceMax: '2000' }, 0)).toMatchObject({ priceMinMinor: '1500', priceMaxMinor: '2000' });
    expect(toListingQuery({ priceMin: '1.5' }, 3).priceMinMinor).toBe('1500');
  });
  it('an UNKNOWN currency (null) applies no price band at all rather than guessing two decimals', () => {
    const q = toListingQuery({ priceMin: '10', priceMax: '50', q: 'rice' }, null);
    expect(q.priceMinMinor).toBeUndefined(); expect(q.priceMaxMinor).toBeUndefined(); expect(q.q).toBe('rice');
  });
});

describe('STORE-1b · the refusal map (brief §E) and the nine chain pages (C4)', () => {
  const ids = STORE1B_REFUSALS.map((r) => r.id);
  it('every refusal the brief names is in the map, once', () => {
    for (const id of ['gmv_yesterday', 'mandi_pulse', 'graded_rate', 'org_rating', 'why_buy_copy', 'org_description', 'region_restricted',
      'group_lots_platform_home', 'farmer_names_on_cards', 'trace_demo', 'oncall_paging', 'platform_footer_on_tenant', 'confirm_over_reload',
      'camera_scanner']) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('a RENDERED refusal has a key in en / hi / gu that states the refusal and carries no figure; recorded / delta ones carry no key', () => {
    for (const r of STORE1B_REFUSALS) {
      if (r.answer === 'rendered') {
        for (const cat of [en, hi, gu]) {
          const v = (cat as Record<string, string>)[r.key!];
          expect([r.id, typeof v]).toEqual([r.id, 'string']);
          expect([r.id, /₹|\d{2,}|98\.2|4\.7|1800|\*123#/.test(v)]).toEqual([r.id, false]);
        }
      } else {
        expect([r.id, r.key]).toEqual([r.id, undefined]);
      }
    }
    expect(refusalKey('gmv_yesterday')).toBe('home.refusal.gmv');
    expect(() => refusalKey('region_restricted')).toThrow();
  });
  it('the nine Retry chain pages are recorded with their verdicts (no page is built for a reload)', () => {
    expect(STORE1B_CHAIN_PAGES.map((p) => p.file.split('-')[0])).toEqual(['W3055', 'W3056', 'W3057', 'W2463', 'W2464', 'W2465', 'W3071', 'W3072', 'W3073']);
    for (const p of STORE1B_CHAIN_PAGES) expect(p.verdict).toMatch(/^PARITY-DECOR/);
  });
});

describe('STORE-1b · the camera-less trace entry', () => {
  it('a url-safe code goes to /trace/<code>; anything else is answered on the page', () => {
    expect(traceCodeHref('  AbC-123_x ')).toBe('/trace/AbC-123_x');
    expect(traceCodeHref(['tok1234'])).toBe('/trace/tok1234');
    expect(traceCodeHref('../../etc')).toBeNull();
    expect(traceCodeHref('ab')).toBeNull();
    expect(traceCodeHref('https://evil.example/x')).toBeNull();
    expect(traceCodeHref(undefined)).toBeNull();
  });
});
