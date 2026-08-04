// apps/web-storefront/src/components/LocaleSwitcher.tsx · the header language picker. A real <form> that POSTs to
// /api/lang (which validates + sets the kv_lang cookie + redirects back) — so it works WITHOUT client JS; the
// only reason this is a client component is to capture the current path/query into `from` so the redirect
// returns the user to where they were. No token, no PII.
//
// DEV-21: extended to show the honest "coming soon" set too, per the canon's own language-picker screen
// (`screens/187-language-switcher.html` — a ✓ on the active live row, a disabled "SOON" badge row for a
// not-yet-live language). `COMING_SOON_LANGUAGES` is the FULL 11-language target set from the shared registry
// (was previously not rendered here at all) — never fabricated, always the registry's own truth.
'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { LANGUAGES, COMING_SOON_LANGUAGES } from '@krishalaya/i18n';

export function LocaleSwitcher({ active, label, comingSoonLabel }: { active: string; label: string; comingSoonLabel?: string }) {
  const pathname = usePathname() || '/';
  const qs = useSearchParams()?.toString();
  const from = qs ? `${pathname}?${qs}` : pathname;
  return (
    <form action="/api/lang" method="post" className="kv-locale" aria-label={label}>
      <input type="hidden" name="from" value={from} />
      <span className="kv-locale__label" aria-hidden="true">{label}:</span>
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="submit"
          name="lang"
          value={l.code}
          lang={l.code}
          aria-pressed={l.code === active}
          className={`kv-locale__btn${l.code === active ? ' is-active' : ''}`}
        >
          {l.nameNative}
        </button>
      ))}
      {COMING_SOON_LANGUAGES.length > 0 && (
        <span className="kv-locale__soon-group" aria-label={comingSoonLabel ?? 'Coming soon'}>
          {COMING_SOON_LANGUAGES.map((l) => (
            <span key={l.code} lang={l.code} dir={l.dir} className="kv-locale__soon" aria-disabled="true" title={comingSoonLabel ?? 'Coming soon'}>
              {l.nameNative}
            </span>
          ))}
        </span>
      )}
    </form>
  );
}
