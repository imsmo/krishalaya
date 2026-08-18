// apps/web-admin/src/components/AdminTopbar.tsx · DEV-61 (UI Port Program batch 4, shell adoption). NEW FILE —
// wraps `@krishalaya/ui`'s `Topbar` for the god-mode console shell, mirroring `web-tenant`'s own
// `ConsoleTopbar.tsx` (the DEV-18 precedent for this exact composition).
//
// HONEST BOUNDARY (disclosed, not silently absorbed — same "never fake a surface" law `ConsoleTopbar` already
// applied): this console has no real search implementation and no notification/unread-count data source
// (grep-verified: no such endpoint exists anywhere in this app's server actions or admin-api client calls) —
// `Topbar`'s `search`/`notification` slots are left EMPTY rather than fabricated with fake placeholder
// behavior. Worth naming explicitly: canon's OWN `web-component-library.html` demo of this exact chrome marks
// both the search box and the notification bell with `data-decor` — canon's own screens flag these as
// decorative/illustrative, not live-data-backed, in the one real canon demo of this composition. Leaving them
// out here is therefore not a shortfall against canon; it is canon's own disclosed boundary, honoured.
//
// `userMenu` shows the real, already-available operator identity — `adminUserId()` (the session token's
// UNVERIFIED `sub` claim, display-gating only per `lib/admin-auth.ts`'s own extensive doc comment; the SAME
// value every maker-checker page in this app already reads for "is this my own request"). No invented avatar-
// initials scheme (per `Avatar`'s own header comment: never guess initials from an arbitrary id string) — a
// plain identity readout, exactly the `ConsoleTopbar` precedent's own shape.
import { Topbar } from '@krishalaya/ui';
import { adminUserId } from '../lib/admin-auth';
import { getTranslator } from '../lib/i18n';

export function AdminTopbar() {
  const t = getTranslator();
  const who = adminUserId();
  return (
    <Topbar
      userMenu={<span className="kv-muted">{who ?? t.t('nav.operatorUnknown')}</span>}
    />
  );
}
