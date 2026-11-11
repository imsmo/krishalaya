// apps/web-storefront/src/components/LocaleSwitcher.tsx · the header language picker. A real <form> that POSTs to
// /api/lang (which validates + sets the kv_lang cookie + redirects back) — so it works WITHOUT client JS; the
// only reason this is a client component is to capture the current path/query into `from` so the redirect
// returns the user to where they were. No token, no PII.
//
// DEV-21: extended to show the honest "coming soon" set too, per the canon's own language-picker screen
// (`screens/187-language-switcher.html` — a ✓ on the active live row, a disabled "SOON" badge row for a
// not-yet-live language). `COMING_SOON_LANGUAGES` is the FULL 11-language target set from the shared registry
// (was previously not rendered here at all) — never fabricated, always the registry's own truth.
//
// PC-56 RTL-1c (founder Q1 "Draft all, opt-in only" — web-tenant's RTL-1b-1 picker): a PREVIEW language (`PREVIEW_LANGUAGES` — Arabic) is offered
// as a real choice, labelled as a machine draft beside its native name; pressing it is the explicit act that serves it. It is taken out of the
// "coming soon" group (it is choosable now) and is never reached from a browser language.
'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { LANGUAGES, COMING_SOON_LANGUAGES, PREVIEW_LANGUAGES } from '@krishalaya/i18n';

const PREVIEW = COMING_SOON_LANGUAGES.filter((l) => PREVIEW_LANGUAGES.includes(l.code));
const SOON = COMING_SOON_LANGUAGES.filter((l) => !PREVIEW_LANGUAGES.includes(l.code));

// PC-56 STORE-1a (survey F-16): the "coming soon" label is REQUIRED and localized by the caller — the English literal fallback is gone.
// PC-56 RTL-1c: so is the machine-draft tag (`draftLabel`, the reader's language — Law 7).
export function LocaleSwitcher({ active, label, comingSoonLabel, draftLabel }: { active: string; label: string; comingSoonLabel: string; draftLabel: string }) {
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
      {PREVIEW.map((l) => (
        <button key={l.code} type="submit" name="lang" value={l.code} aria-pressed={l.code === active}
          className={`kv-locale__btn kv-locale__btn--draft${l.code === active ? ' is-active' : ''}`}>
          <bdi lang={l.code} dir={l.dir}>{l.nameNative}</bdi> <span className="kv-locale__draft">({draftLabel})</span>
        </button>
      ))}
      {SOON.length > 0 && (
        <span className="kv-locale__soon-group" aria-label={comingSoonLabel}>
          {SOON.map((l) => (
            <span key={l.code} lang={l.code} dir={l.dir} className="kv-locale__soon" aria-disabled="true" title={comingSoonLabel}>
              {l.nameNative}
            </span>
          ))}
        </span>
      )}
    </form>
  );
}
