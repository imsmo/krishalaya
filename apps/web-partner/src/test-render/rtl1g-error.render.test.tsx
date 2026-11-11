// apps/web-partner/src/test-render/rtl1g-error.render.test.tsx · PC-56 RTL-1g (owed since RTL-1d) — the REAL app/error.tsx under each cookie.
// Before RTL-1g the boundary read the en catalogue only; a page error on an Arabic page printed English. Now it follows the storefront's
// boundary-words pattern: the `kv_lang` cookie, EXPLICIT (Arabic only when chosen), `lang`/`dir` on the boundary only under Arabic.
// en / hi / gu are proven BYTE-IDENTICAL to the 93aa6915 boundary (copied verbatim below as `Before`): partner hi/gu lack the four
// boundary keys (part of the owed 378-key backfill), so they fall back to English exactly as before.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useEffect } from 'react';
import ErrorBoundary from '../app/error';
import { boundaryWords, cookieLang, boundaryText } from '../features/rtl/boundary-words';
import { LANG_COOKIE } from '../features/partner6/language';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ar } from '../i18n/ar';

// ---- the 93aa6915 app/error.tsx, verbatim (the en-only boundary) ------------------------------------------------------------
function Before({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { /* hook for client telemetry; never logs PII/secrets/tokens */ }, [error]);
  return (
    <section className="kv-empty-state" role="alert">
      <h1>{en['common.errorTitle']}</h1>
      <p>{en['common.errorBody']}</p>
      <div className="kv-actions">
        <button type="button" className="kv-btn" onClick={() => reset()}>{en['common.retry']}</button>
        <a className="kv-btn kv-btn--muted" href="/login">{en['common.signInAgain']}</a>
      </div>
    </section>
  );
}

const g = globalThis as unknown as { document?: { cookie: string } };
function render(cookie: string | null, C: React.ComponentType<{ error: Error; reset: () => void }> = ErrorBoundary): string {
  if (cookie !== null) g.document = { cookie };
  try { return renderToStaticMarkup(<C error={new Error('x')} reset={() => undefined} />); } finally { delete g.document; }
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

describe('app/error.tsx reads the person\'s chosen language (RTL-1g)', () => {
  it('kv_lang=ar → the four Arabic boundary strings, with lang="ar" dir="rtl" on the boundary', () => {
    const html = render(`${LANG_COOKIE}=ar`);
    expect(html).toContain('<section class="kv-empty-state" role="alert" lang="ar" dir="rtl">');
    for (const k of ['common.errorTitle', 'common.errorBody', 'common.retry', 'common.signInAgain']) {
      expect(html).toContain(esc(ar[k]));
      expect(html).not.toContain(esc(en[k]));
    }
    expect(html).toContain('href="/login"');
  });
  it('the cookie among others, URL-encoded or not, is found', () => {
    expect(render(`a=1; ${LANG_COOKIE}=ar; b=2`)).toContain(`<h1>${esc(ar['common.errorTitle'])}</h1>`);
    expect(cookieLang(`x=1;${LANG_COOKIE}=ar`)).toBe('ar');
    expect(cookieLang(`kv_language=ar`)).toBe('en');   // a different cookie that merely starts the same way is not ours
  });
  it.each([['en'], ['hi'], ['gu'], ['ur'], ['xx'], ['']])('kv_lang=%s → byte-identical to the 93aa6915 boundary (English, no lang/dir)', (code) => {
    const cookie = code ? `${LANG_COOKIE}=${code}` : '';
    expect(render(cookie)).toBe(render(cookie, Before));
  });
  it('no document (the server render) → byte-identical English', () => {
    expect(render(null)).toBe(render(null, Before));
  });
  it('and the comparison can see a difference: under ar the boundary is not the 93aa6915 one', () => {
    expect(render(`${LANG_COOKIE}=ar`)).not.toBe(render(`${LANG_COOKIE}=ar`, Before));
  });
});

describe('features/rtl/boundary-words (pure)', () => {
  it('a key the catalogue lacks falls back to en (hi/gu are partial: the four boundary keys are in the owed backfill)', () => {
    for (const k of ['common.errorTitle', 'common.errorBody', 'common.retry', 'common.signInAgain']) {
      expect((hi as Record<string, string>)[k]).toBeUndefined();
      expect((gu as Record<string, string>)[k]).toBeUndefined();
      expect(boundaryText('hi', k)).toBe(en[k]);
    }
    expect(boundaryText('ar', 'no.such.key')).toBe('no.such.key');
  });
  it('a hi/gu value, once the backfill adds one, is used (the lookup is by the chosen language first)', () => {
    const k = Object.keys(hi).find((x) => (hi as Record<string, string>)[x] !== en[x])!;
    expect(boundaryText('hi', k)).toBe((hi as Record<string, string>)[k]);
  });
  it('lang/dir only under a preview language', () => {
    expect(boundaryWords(`${LANG_COOKIE}=ar`)).toMatchObject({ lang: 'ar', dir: 'rtl' });
    for (const c of ['en', 'hi', 'gu']) expect(boundaryWords(`${LANG_COOKIE}=${c}`)).toMatchObject({ lang: undefined, dir: undefined });
  });
});
