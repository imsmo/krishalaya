// packages/ui/src/components/Sidebar.tsx · DEV-17 (Phase D3, packages/ui port batch 3 —
// navigation/layout primitives). Ports `.kvw-sidebar`/`.kvw-sidebar-brand`/`.kvw-sidebar-tenant`/`.kvw-nav`/
// `.kvw-nav-section`/`.kvw-nav-item`/`.kvw-nav-badge` verbatim from `web-frame.css` lines 37-94, plus the
// collapsed-state selectors (lines 89-94, 183-208) and `.kvw-sidebar-foot` (`web-components.css` line 683,
// "promoted HAND-2" — 244 pre-existing consumers per that file's own comment, library demo line 147).
//
// ARIA-CURRENT (W-D30 post-pass convention, mirrored exactly): the active nav item's `<a>` carries
// `aria-current="page"` — canon's own CSS targets BOTH `[aria-current="page"]` and `[aria-current="true"]`
// (`web-frame.css` lines 77-86, a historical dual-selector the canon itself keeps for back-compat with
// older screens that used the non-standard `"true"` value) but this component only ever EMITS `"page"`,
// the WAI-ARIA-correct value for the current-page-in-a-navigation-set case — never `"true"`.
//
// COLLAPSE: pure-CSS per `web-frame.css`'s own header comment ("No JS: responsive behaviour is pure CSS").
// This component renders identically regardless of `.is-collapsed` — the collapse behavior is entirely
// owned by the ANCESTOR `.web-shell.is-collapsed` class (`AppShell`'s `collapsed` prop) via descendant
// selectors already shipped in canon (ported verbatim below). The mobile drawer variant (`<=768px` /
// `.kvw-sidebar.is-open`) is controlled by this component's own `mobileOpen` prop.
//
// REALM PILL: see `AppShell.tsx`'s header comment for the full grounding. This component renders the pill
// as a real `<span className="kvw-badge kvw-badge-warning|kvw-badge-info">{realmLabel}</span>` inside
// `.kvw-sidebar-brand` — driven entirely by the caller-supplied `realmLabel` prop (Law 3: no "ADMIN"/"GOV"
// baked in here), never the canon's own `::after`-hardcoded text.
//
// WHITE-LABEL (Rule Zero): `brand.name`/`brand.mark`/`footer` are ALL caller-supplied, REQUIRED-or-slot
// props — this file contains zero hardcoded tenant/platform name anywhere (grep-verified, see
// dev17_report.md). The canon's own demo screens happen to show "Krishalaya"/"Powered by Krishalaya" as
// CONTENT (a mock's own tenant choice, same as DEV-15's MoneyText ₹-mock-vs-code distinction) — this
// component never bakes that content, it is 100% the `brand`/`footer` prop values.
import * as React from 'react';
import type { RealmKind } from './AppShell';

export interface SidebarNavBadge {
  /** Caller-i18n-resolved badge text (e.g. a count already formatted per-locale — Law 3). */
  label: string;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'ai' | 'neutral';
}

export interface SidebarNavItem {
  key: string;
  /** Caller-i18n-resolved label (Law 3). */
  label: string;
  href: string;
  icon?: React.ReactNode;
  /** Renders `aria-current="page"` + the canon's active-item treatment (web-frame.css lines 77-86). */
  current?: boolean;
  badge?: SidebarNavBadge;
}

export interface SidebarNavSection {
  key: string;
  /** Caller-i18n-resolved section heading (e.g. "Operations") — omit for an unheaded item group. */
  title?: string;
  items: SidebarNavItem[];
}

export interface SidebarProps {
  /** White-label brand slot (Rule Zero) — REQUIRED, no Krishalaya fallback exists anywhere in this file. */
  brand: { name: string; mark?: React.ReactNode };
  /** `.kvw-sidebar-tenant` slot, e.g. `<strong>Anand FPO</strong> Tenant Admin` — fully caller-composed. */
  tenant?: React.ReactNode;
  sections: SidebarNavSection[];
  /** `.kvw-sidebar-foot` slot (promoted at HAND-2, `web-components.css` line 683) — caller-supplied, e.g.
   * "Powered by {tenant}" or a plain app-version string; never hardcoded here. */
  footer?: React.ReactNode;
  realm?: RealmKind;
  /** Required alongside a non-`'default'` `realm` — the pill's own visible text (Law 3 slot, never baked). */
  realmLabel?: string;
  /** Mobile drawer variant (`<=768px`, `web-frame.css` lines 193-200) — `.kvw-sidebar.is-open`. */
  mobileOpen?: boolean;
  /** Accessible name for the `<nav>` landmark (gate 10 requirement) — a11y enhancement over the canon's
   * literal markup, which wraps nav items in a bare `<ul>` with no landmark; disclosed, not a deviation
   * that changes any visual output. */
  navLabel: string;
  className?: string;
}

export function Sidebar({ brand, tenant, sections, footer, realm = 'default', realmLabel, mobileOpen, navLabel, className }: SidebarProps): React.ReactElement {
  const badgeTone = realm === 'gov' ? 'kvw-badge-info' : 'kvw-badge-warning';
  return (
    <aside className={['kvw-sidebar', mobileOpen ? 'is-open' : '', className || ''].filter(Boolean).join(' ')}>
      <div className="kvw-sidebar-brand">
        {brand.mark ? <span className="brand-mark" aria-hidden="true">{brand.mark}</span> : null}
        <span>{brand.name}</span>
        {realm !== 'default' && realmLabel ? (
          <span className={['kvw-badge', 'kvw-sidebar-brand-realm', badgeTone].join(' ')}>{realmLabel}</span>
        ) : null}
      </div>
      {tenant ? <div className="kvw-sidebar-tenant">{tenant}</div> : null}
      <nav aria-label={navLabel} className="kvw-nav-landmark">
        <ul className="kvw-nav">
          {sections.map((section) => (
            <React.Fragment key={section.key}>
              {section.title ? <li className="kvw-nav-section">{section.title}</li> : null}
              {section.items.map((item) => (
                <li className="kvw-nav-item" key={item.key}>
                  <a href={item.href} aria-current={item.current ? 'page' : undefined}>
                    {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
                    <span>{item.label}</span>
                    {item.badge ? (
                      <span className={['kvw-nav-badge', 'kvw-badge', `kvw-badge-${item.badge.tone ?? 'neutral'}`].join(' ')}>
                        {item.badge.label}
                      </span>
                    ) : null}
                  </a>
                </li>
              ))}
            </React.Fragment>
          ))}
        </ul>
      </nav>
      {footer ? <div className="kvw-sidebar-foot">{footer}</div> : null}
    </aside>
  );
}

/** CSS fragment ported verbatim from `web-frame.css` lines 38-94 + collapse/mobile-drawer rules 89-94,
 * 183-208 + `kvw-sidebar-foot` (`web-components.css` line 683). `.kvw-badge*` classes reused from
 * `web-components.css` lines 122-134 (already ported by `Chip`'s sibling badge family — DEV-15's
 * `StatusPill`/`AiBadge` — duplicated here under the same disclosed "safe to load twice, identical rules"
 * precedent since this file is a standalone port and must not assume load order). */
export const sidebarStyles = `
.kvw-sidebar {
  grid-area: sidebar;
  position: sticky; inset-block-start: 0; height: 100vh;
  background: var(--surface-card);
  border-inline-end: 1px solid var(--border-subtle);
  display: flex; flex-direction: column;
  z-index: var(--web-z-sidebar);
  overflow-y: auto;
}
.kvw-sidebar-brand {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-4) var(--space-4);
  min-height: var(--web-topbar-h);
  border-block-end: 1px solid var(--border-subtle);
  font-family: var(--font-display); font-weight: 700; font-size: var(--text-lg);
  color: var(--color-primary-700);
}
.kvw-sidebar-brand .brand-mark { width: 28px; height: 28px; flex: none; }
.kvw-sidebar-brand-realm { margin-inline-start: 6px; }
.kvw-sidebar-tenant {
  margin: var(--space-3); padding: var(--space-2) var(--space-3);
  background: var(--color-earth-100); border-radius: var(--radius-md);
  font-size: var(--text-xs); color: var(--color-ink-500);
  display: flex; align-items: center; gap: var(--space-2);
}
.kvw-sidebar-tenant strong { color: var(--color-ink-700); font-size: var(--text-sm); display: block; }
/* .kvw-nav-landmark is an ENGINEERING ADDITION (this component's own <nav> a11y-landmark wrapper, see
   header comment) -- carries the flex-grow/scroll role .kvw-nav held directly against .kvw-sidebar in
   the canon's flatter markup, since introducing the landmark element added one extra flex-child level. */
.kvw-nav-landmark { flex: 1; min-height: 0; overflow-y: auto; }
.kvw-nav { list-style: none; margin: 0; padding: var(--space-2); }
.kvw-nav-section {
  font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--color-ink-400); padding: var(--space-4) var(--space-3) var(--space-1);
}
.kvw-nav-item a {
  display: flex; align-items: center; gap: var(--space-3);
  padding: 0 var(--space-3); min-height: 34px;
  border-radius: var(--radius-md);
  color: var(--color-ink-500); text-decoration: none;
  font-size: var(--text-sm); font-weight: 500;
}
.kvw-nav-item a:hover { background: var(--color-earth-100); color: var(--color-ink-700); }
.kvw-nav-item a:focus-visible { outline: none; box-shadow: var(--web-focus-ring); }
.kvw-nav-item a[aria-current="page"],
.kvw-nav-item a[aria-current="true"] {
  background: var(--color-primary-50); color: var(--color-primary-700); font-weight: 600;
  position: relative;
}
.kvw-nav-item a[aria-current="page"]::before,
.kvw-nav-item a[aria-current="true"]::before {
  content: ""; position: absolute; inset-inline-start: -8px; inset-block: 8px;
  width: 3px; border-radius: var(--radius-full); background: var(--color-primary-600);
}
.kvw-nav-item svg { width: 18px; height: 18px; flex: none; }
.kvw-nav-badge { margin-inline-start: auto; }
.web-shell.is-collapsed .kvw-sidebar-brand span,
.web-shell.is-collapsed .kvw-sidebar-tenant,
.web-shell.is-collapsed .kvw-nav-section,
.web-shell.is-collapsed .kvw-nav-item a > span { display: none; }
.web-shell.is-collapsed .kvw-nav-item a { justify-content: center; }
.kvw-sidebar-foot { display: flex; align-items: center; gap: 6px; padding: var(--space-3) var(--space-4); border-block-start: 1px solid var(--border-subtle); margin-block-start: auto; }
/* .kvw-badge* duplicated from web-components.css 122-134 — see header comment */
.kvw-badge {
  display: inline-flex; align-items: center; gap: var(--space-1);
  padding: 2px var(--space-2); border-radius: var(--radius-full);
  font-size: var(--text-xs); font-weight: 600;
}
.kvw-badge-warning { background: var(--color-warning-light); color: var(--color-warning-dark); }
.kvw-badge-info { background: var(--color-info-light); color: var(--color-info-dark); }
.kvw-badge-success { background: var(--color-success-light); color: var(--color-success-dark); }
.kvw-badge-danger { background: var(--color-danger-light); color: var(--color-danger-dark); }
.kvw-badge-ai { background: var(--color-ai-light); color: var(--color-ai-dark); }
.kvw-badge-neutral { background: var(--color-earth-200); color: var(--color-ink-500); }
@media (max-width: 1024px) {
  .kvw-sidebar-brand span, .kvw-sidebar-tenant, .kvw-nav-section, .kvw-nav-item a > span { display: none; }
  .kvw-nav-item a { justify-content: center; }
}
@media (max-width: 768px) {
  .kvw-sidebar { position: fixed; inset-inline-start: 0; inset-block: 0; width: var(--web-sidebar-w);
    transform: translateX(-100%); transition: transform var(--web-transition-panel); z-index: var(--web-z-drawer); }
  [dir="rtl"] .kvw-sidebar { transform: translateX(100%); }
  .kvw-sidebar.is-open { transform: translateX(0); }
  .kvw-sidebar-brand span, .kvw-sidebar-tenant, .kvw-nav-section, .kvw-nav-item a > span { display: revert; }
  .kvw-nav-item a { justify-content: flex-start; }
}
[data-theme="dark"] .kvw-badge-danger { color: var(--color-danger-text-dark); }
[data-theme="dark"] .kvw-badge-info { color: var(--color-info-text-dark); }
[data-theme="dark"] .kvw-badge-success { color: var(--color-success-text-dark); }
[data-theme="dark"] .kvw-badge-warning { color: var(--color-warning-text-dark); }
[data-theme="dark"] .kvw-badge-ai { color: var(--color-ai-text-dark); }
`;
