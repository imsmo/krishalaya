// apps/web-storefront/src/test/sweep-b.spec.ts · PC-56 STORE-SWEEP-b · C1 / C3 (founders D1–D4) — THE REGISTRY, THE BOUNDARIES' WORDS AND THE LANGUAGE
// PAGE'S RULES, AS PURE CHECKS:
//   • the ten SWEEP canon files each carry a verdict — W292 BUILT (section), W316 / W317 / W320 PARITY-DECOR, W323 BUILT; the SW-b refusals exist in
//     all three catalogues and each English one says no; the SW-b DELTAs are recorded;
//   • W316 as a GUARD over every error / failure key (`*.err.*`, `*.error*`, `*.failed*`, `*.failure*`) in en / hi / gu: no exclamation mark, no "Oops";
//   • W317 as a GUARD over every empty key (`*.empty*`): never "try again later" for a truly empty set, never "closest";
//   • the boundaries' words answer the three questions, name the organisation and its home under a store and the bazaar on the platform, carry the
//     code in small print; no boundary file retries by itself (no timer, no effect calling reset);
//   • the language page's `from`: the link's, else a same-host Referer, else home — never another host, never the language page itself.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { SWEEP_CANON_FILES, SWEEP_DELTAS, SWEEP_REFUSALS, sweepRefusalKeys } from '../features/sweep/refusals';
import { boundaryWords, cookieLang } from '../features/sweep/boundary-words';
import { comingSoonCount, isLanguagePath, languageFrom, liveLanguages } from '../features/sweep/languages';

const CATS = { en, hi, gu } as const;
const SAYS_NO = /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnone\b|\bnobody\b/i;

describe('STORE-SWEEP-b · the registry', () => {
  it('the ten canon files, each with its verdict', () => {
    const v = Object.fromEntries(SWEEP_CANON_FILES.map((f) => [f.file, f.verdict]));
    expect(SWEEP_CANON_FILES).toHaveLength(10);
    expect(v['W292-store-tracking.html']).toMatch(/^BUILT \(section\)/);
    for (const f of ['W316-store-error-canon.html', 'W317-store-empty-canon.html', 'W320-store-degraded-service.html']) expect(v[f]).toMatch(/^PARITY-DECOR/);
    expect(v['W323-store-language.html']).toMatch(/^BUILT —/);
    for (const f of ['W308-store-about.html', 'W309-store-quality-promise.html', 'W310-store-trust-data.html', 'W311-store-help-center.html', 'W312-store-contact.html']) expect(v[f]).toMatch(/^GAP-UI built/);
  });
  it('the SW-b refusals: every key in all three catalogues, every English one says no; per surface', () => {
    for (const s of ['tracking', 'language', 'errors', 'empty', 'degraded'] as const) {
      for (const k of sweepRefusalKeys(s)) {
        for (const [l, cat] of Object.entries(CATS)) expect([l, k, typeof (cat as Record<string, string>)[k]]).toEqual([l, k, 'string']);
        expect([k, SAYS_NO.test(en[k as keyof typeof en] as string)]).toEqual([k, true]);
      }
    }
    expect(sweepRefusalKeys('tracking')).toHaveLength(11);
    expect(sweepRefusalKeys('language')).toHaveLength(4);
    expect(sweepRefusalKeys('errors')).toHaveLength(3);      // auto_retry, role_request + phone_line (carried)
    expect(sweepRefusalKeys('empty')).toHaveLength(2);       // escrow_every_order (carried) + closest_matches (2a's key)
    expect(sweepRefusalKeys('degraded')).toHaveLength(5);    // status_page, next_update, rail_health, photos_queued + short_code (carried)
    expect(new Set(SWEEP_REFUSALS.map((r) => r.id)).size).toBe(SWEEP_REFUSALS.length);
  });
  it('the SW-b DELTAs are recorded; help_language_link is closed', () => {
    const ids = SWEEP_DELTAS.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['tracking_route', 'coming_soon_languages', 'one_language_per_page', 'status_page_queued', 'rules_pages']));
    expect(SWEEP_DELTAS.find((d) => d.id === 'help_language_link')!.built).toMatch(/^CLOSED/);
  });
});

describe('STORE-SWEEP-b · W316 / W317 as guards over the catalogues', () => {
  const ERR = /(^|\.)(err|error|errors|failed|failure)(\.|$)|Error$|\.error[A-Z]|Failed$|\.failed[A-Z]/;
  const EMPTY = /(^|\.)empty(\.|$)|\.empty[A-Z]|Empty$/;
  it.each(Object.entries(CATS))('%s: no error / failure value carries an exclamation mark or "Oops"', (_l, cat) => {
    const keys = Object.keys(cat).filter((k) => ERR.test(k));
    expect(keys.length).toBeGreaterThan(200);
    for (const k of keys) expect([k, /!|Oops/i.test((cat as Record<string, string>)[k])]).toEqual([k, false]);
  });
  it.each(Object.entries(CATS))('%s: no empty-state value says "try again later" or offers "closest" matches', (_l, cat) => {
    const keys = Object.keys(cat).filter((k) => EMPTY.test(k));
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) expect([k, /try again later|please try again|come back later|closest|बाद में फिर|પછી ફરી/i.test((cat as Record<string, string>)[k])]).toEqual([k, false]);
  });
  it('no status-page promise and no "next update" time in any ribbon or kill-switch value', () => {
    for (const cat of Object.values(CATS)) for (const [k, v] of Object.entries(cat)) {
      if (!/^(sweep\.ribbon\.|store2a\.browseOff\.|store2b\.cartOff\.)/.test(k)) continue;
      expect([k, /status page|next update|by \d|\d{1,2}:\d{2}|minutes|hours/i.test(v)]).toEqual([k, false]);
    }
    for (const k of ['store2a.browseOff.title', 'store2b.cartOff.title', 'sweep.ribbon.browseOff', 'sweep.ribbon.cartOff']) expect(en[k as keyof typeof en]).toMatch(/our side/);
    for (const k of ['store2b.cartOff.body', 'sweep.ribbon.cartOff']) expect(en[k as keyof typeof en]).toMatch(/[Nn]othing was charged/);
  });
});

describe('STORE-SWEEP-b · the boundaries\' words', () => {
  const STORE = { slug: 'anand-fpo', name: 'Anand FPO Mandi' };
  it('a store\'s 404: the three questions; "Back to <organisation>" → /<slug>; the code in small print', () => {
    const w = boundaryWords('not_found', STORE, 'en');
    expect([w.title, w.what, w.safe, w.now]).toEqual([en['sweep.err.notFound.title'], en['sweep.err.notFound.what'], en['sweep.err.notFound.safe'], 'Go back to Anand FPO Mandi and find it from there.']);
    expect([w.back, w.backHref, w.code]).toEqual(['Back to Anand FPO Mandi', '/anand-fpo', 'For support: 404']);
  });
  it('the platform\'s error: our side, nothing charged or lost, what to do; "Back to the bazaar" → /; your orders; the digest only when given', () => {
    const w = boundaryWords('error', null, 'en', 'd1g3st');
    expect(w.what).toMatch(/our side/);
    expect(w.safe).toMatch(/Nothing was charged and nothing was lost/);
    expect(w.now).toMatch(/before paying again/);
    expect([w.back, w.backHref, w.ordersHref, w.code]).toEqual(['Back to the bazaar', '/', '/orders', 'For support: d1g3st']);
    expect(boundaryWords('error', null, 'en').code).toBeNull();
    expect(boundaryWords('error', STORE, 'en').ordersHref).toBe('/anand-fpo/orders');
  });
  it('in Hindi and Gujarati; a code with no catalogue falls back to English; the cookie is read', () => {
    expect(boundaryWords('not_found', STORE, 'hi').back).toBe('Anand FPO Mandi पर वापस');
    expect(boundaryWords('not_found', null, 'gu').title).toBe(gu['sweep.err.notFound.title']);
    expect(boundaryWords('not_found', null, 'xx').title).toBe(en['sweep.err.notFound.title']);
    expect(cookieLang('a=1; kv_lang=gu; b=2')).toBe('gu');
    expect(cookieLang('')).toBe('en');
    expect(hi['sweep.err.backPlatform']).not.toMatch(/कृषालय/);
  });
  it('no boundary retries by itself: no timer, no effect, reset() only inside a click handler', () => {
    const files = ['app/[tenantSlug]/error.tsx', 'app/[tenantSlug]/not-found.tsx', 'app/(platform)/error.tsx', 'app/(platform)/not-found.tsx', 'app/error.tsx',
      'app/not-found.tsx', 'app/global-error.tsx', 'components/sweep/BoundaryView.tsx'];
    for (const f of files) {
      const src = readFileSync(join(__dirname, '..', f), 'utf8').replace(/^\s*\/\/.*$/gm, '');
      expect([f, /setTimeout|setInterval|useEffect|requestAnimationFrame/.test(src)]).toEqual([f, false]);
      expect([f, /reset\(\)/.test(src.replace(/onClick=\{\(\) => onRetry\(\)\}/, ''))]).toEqual([f, false]);
    }
  });
});

describe('STORE-SWEEP-b · the language page\'s rules', () => {
  it('the live languages and the "not available yet" count come from the registry', () => {
    expect(liveLanguages().map((l) => l.code)).toEqual(['hi', 'en', 'gu']);
    expect(liveLanguages().map((l) => l.nameNative)).toEqual(['हिन्दी', 'English', 'ગુજરાતી']);
    expect(comingSoonCount()).toBe(11);
  });
  it('`from`: the link\'s same-origin path, else a same-host Referer, else home — never another host, never the language page', () => {
    expect(languageFrom('/anand-fpo/orders?x=1', null, 'shop.test', '/')).toBe('/anand-fpo/orders?x=1');
    expect(languageFrom('//evil.test/x', 'https://shop.test/listings/1?a=b', 'shop.test', '/')).toBe('/listings/1?a=b');
    expect(languageFrom(undefined, 'https://evil.test/listings/1', 'shop.test', '/anand-fpo')).toBe('/anand-fpo');
    expect(languageFrom(undefined, 'https://shop.test/language', 'shop.test', '/')).toBe('/');
    expect(languageFrom('/anand-fpo/language', null, 'shop.test', '/anand-fpo')).toBe('/anand-fpo');
    expect(languageFrom(['https://evil.test'], 'not a url', 'shop.test', '/')).toBe('/');
    expect(isLanguagePath('/language?from=/x')).toBe(true);
    expect(isLanguagePath('/languages')).toBe(false);
  });
});
