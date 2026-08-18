// apps/web-admin/src/components/Sidebar.tsx · the god-mode console chrome (server component).
//
// DEV-61 (UI Port Program batch 4, shell adoption): rewired from this app's own hand-rolled `<nav>`/`<ul>`
// (`.kv-sidebar*` CSS, now deleted from `globals.css`) onto `@krishalaya/ui`'s ported `Sidebar` component —
// the SAME rewire `web-tenant` proved at DEV-18 (`apps/web-tenant/src/components/Sidebar.tsx` is the direct
// precedent). The nav item list (`features/nav/nav-model.ts` — the single reachability source of truth,
// UNCHANGED by this batch), the "(soon)" non-link treatment for unbuilt routes, and the sign-out form are
// preserved; only the render target moved.
//
// REALM: `realm="admin"` + `realmLabel` (the real i18n `nav.godmode` string, "GOD MODE" — the same text the
// pre-existing `.kv-godmode` span rendered, now flowing through `packages/ui`'s own `RealmKind`/`realmLabel`
// slot instead of a hand-written class, per this batch's "express realm through the package, not a hand-
// written class" instruction). `AppShell`'s `realm="admin"` prop (set in `layout.tsx`) drives the gold
// top-border accent on the Topbar (`[data-kv-realm="admin"] .kvw-topbar`, already built at DEV-17) — this
// component only needs to render the sidebar-brand pill, matching `AppShell`'s own realm.
//
// ARIA-CURRENT (DEV-61, a genuine ADDITION — see `middleware.ts`'s header comment: the pre-existing Sidebar
// had none): `pathname` is forwarded from `layout.tsx` (itself fed by `middleware.ts`'s `x-pathname` header)
// and resolved via `nav-model.ts`'s own `activeNavHref()` — kept there, not here, so the active-item logic
// stays pure/unit-tested rather than embedded in JSX.
//
// KNOWN INTEGRATION TRADE-OFF (disclosed, same one `web-tenant` already named at DEV-18): `@krishalaya/ui`'s
// `Sidebar` is framework-agnostic (cannot import `next/link`) and renders each nav item as a plain `<a href>`,
// not Next's `<Link>` — every sidebar nav click is now a full page navigation, not a client-side transition.
// A real, stated cost of adopting the shared library, not silently absorbed.
import { Sidebar as UiSidebar } from '@krishalaya/ui';
import type { SidebarNavSection } from '@krishalaya/ui';
import { getTranslator } from '../lib/i18n';
import { liveNav, soonNav, activeNavHref } from '../features/nav/nav-model';
import { env } from '../lib/env';

export function Sidebar({ pathname }: { pathname: string }) {
  const t = getTranslator();
  const active = activeNavHref(pathname);

  const sections: SidebarNavSection[] = [
    {
      key: 'primary',
      items: [
        ...liveNav().map((n) => ({ key: n.href, href: n.href, label: t.t(n.labelKey), current: n.href === active })),
        // "(soon)" items have no real route yet. `packages/ui`'s `Sidebar` had no way to express a nav entry
        // that must NOT navigate (its `href` was always rendered as a real `<a>`) — this batch added
        // `SidebarNavItem.disabled` for exactly this shape (see that component's own header comment), rather
        // than rendering a real, broken link. Kept as its own mapped list, immediately after the live items,
        // matching the pre-existing order exactly. The "why is this greyed out" explanation is folded into
        // the visible label itself (`nav.soon` = "(soon)") rather than an invisible-until-hover tooltip (the
        // pre-existing `title=` attribute this replaces) — visible text is keyboard/touch discoverable, a
        // hover-only tooltip is not, so this is a genuine a11y improvement, not just a like-for-like port.
        ...soonNav().map((n) => ({
          key: n.href,
          href: n.href,
          label: `${t.t(n.labelKey)} ${t.t('nav.soon')}`,
          disabled: true,
        })),
      ],
    },
  ];

  return (
    <UiSidebar
      brand={{ name: env.appName }}
      sections={sections}
      realm="admin"
      realmLabel={t.t('nav.godmode')}
      footer={
        <form action="/api/session" method="post">
          <input type="hidden" name="_action" value="logout" />
          <button type="submit" className="kv-btn kv-btn--muted">{t.t('nav.signOut')}</button>
        </form>
      }
      navLabel={t.t('nav.primary')}
    />
  );
}
