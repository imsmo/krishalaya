'use client';
// apps/web-storefront/src/app/global-error.tsx · PC-56 STORE-SWEEP-b · C2 (founder D4, survey F-7 / B12 — canon W316) — THE LAST BOUNDARY: an error in a
// LAYOUT (the root's or a chrome's) had no boundary of ours. Next 14 renders this INSTEAD of the root layout, so it carries its own minimal `<html>`
// (`lang`/`dir` from the `kv_lang` cookie) and NO chrome — no header, no brand, no organisation: the three questions' words, a Try-again button
// (`reset()` only when pressed — never automatically) and the way back to `/`. No stylesheet is assumed (the root layout's CSS may not be there).
import { resolveLanguage } from '@krishalaya/i18n';
import { cookieLang } from '../features/sweep/boundary-words';
import { BoundaryView } from '../components/sweep/BoundaryView';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const lang = resolveLanguage(cookieLang(typeof document !== 'undefined' ? document.cookie : '')); 
  return (
    <html lang={lang.code} dir={lang.dir}>
      <body>
        <main id="main" data-kv-global-error="true">
          <BoundaryView kind="error" code={error?.digest ?? null} onRetry={reset} />
        </main>
      </body>
    </html>
  );
}
