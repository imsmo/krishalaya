// apps/web-storefront/src/app/not-found.tsx · the global 404 boundary. Server component; localized. Rendered by
// notFound() (e.g. a missing listing/tenant) AND by any not-yet-built route (e.g. /login, /cart before their
// wave) — a friendly localized page, never a crash (degrade, never die).
// PC-56 STORE-SWEEP-b · D4 (canon W316): what is LEFT for the root — an unknown, non-live or (to an anonymous visitor) trial organisation's `/<slug>`
// (the tenant layout's notFound(): there is no store to stay in) and a path no route matches. A missing page UNDER a store is `[tenantSlug]/not-found`
// (the store's chrome); under the platform, `(platform)/not-found`. The three questions' words, "Back to the bazaar" → `/`.
import { getLang } from '../lib/i18n';
import { BoundaryProvider } from '../components/sweep/BoundaryContext';
import { BoundaryView } from '../components/sweep/BoundaryView';

export default function NotFound() {
  return (
    // PC-56 STORE-1b: the root layout no longer wraps pages in <main> (each route group does), so the 404 carries its own landmark
    <main className="kv-container" id="main">
      <BoundaryProvider store={null} lang={getLang()}>
        <BoundaryView kind="not_found" />
      </BoundaryProvider>
    </main>
  );
}
