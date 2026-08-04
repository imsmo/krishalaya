// packages/ui/src/components/AppShell.tsx · DEV-17 (Phase D3, packages/ui port batch 3 —
// navigation/layout primitives). Ports the console FRAME verbatim from
// `Phase-1 all screen design/Krishalaya_Design_System/system/web/web-frame.css` — THIS batch's primary
// source per the brief (unlike DEV-15/16's `web-components.css`): `.web-shell` grid (lines 22-35),
// `.kvw-impersonation` banner (131-140), `.kvw-content` + grid helpers (143-180), responsive collapse
// (183-208), print (210-215). Sidebar/Topbar themselves are separate components (this file only owns the
// outer shell + content region + impersonation banner + realm wiring), matching the brief's own item
// breakdown (1. AppShell/Frame, 2. Sidebar, 3. Topbar are three distinct scope items).
//
// REALM SYSTEM (admin gold / gov blue pill, founder G0-4 ratifications) — grounded, not invented:
//   - ADMIN: the canon already ships a real, promoted `.realm-admin` class (`web-tokens.css` lines 317-329:
//     "ADMIN REALM v2 — environment indicator, NOT red chrome") — `.realm-admin .kvw-topbar` gets a 3px
//     `--color-accent-500` (gold) top border; `.realm-admin .kvw-sidebar-brand::after` renders a
//     CSS-`content: "ADMIN"` pill. That `::after` text is a LITERAL HARDCODED STRING in already-shipped
//     canon CSS — fine for the canon file itself (Law 4 applies to visual fidelity, not to code this batch
//     authors), but this batch's own brief is explicit: "the pill is a PROP/slot, never baked." So this
//     component does NOT apply the literal `.realm-admin` class (which would silently re-introduce a
//     hardcoded "ADMIN" via ::after with no way for a caller to override it) — instead it reproduces the
//     SAME ratified visual decision (gold top border on the topbar) via an equivalent, disclosed selector
//     (`[data-kv-realm="admin"] .kvw-topbar`) and leaves the actual pill text to `Sidebar`'s `realmLabel`
//     prop (a real, caller-supplied, i18n-resolved slot — see Sidebar.tsx).
//   - GOV: grep-verified ZERO `.realm-gov` class exists anywhere in `web-tokens.css`/`web-components.css` —
//     the only real precedent is `web-screens/W358-gov-chrome-canon.html`'s own inline-styled pattern
//     (`border-block-start:3px solid var(--color-info)` on the sidebar `<aside>`, line 28) plus an inline
//     `<span class="kvw-badge" style="background:var(--color-info-light);color:var(--color-info-dark)">
//     GOV</span>` pill (line 29) — ratified as intentional realm differentiation at G0-R3/G0-2 Q31 (that
//     file's own inline comment, line 66: "the blue GOV pill + top border is confirmed intentional realm
//     differentiation (vs. Admin's gold top border) — KEEP + DOCUMENT, no change"). Note the gov canon
//     example borders the SIDEBAR, not the topbar (asymmetric vs admin) — reproduced exactly as shown, not
//     invented symmetric. `[data-kv-realm="gov"] .kvw-sidebar` gets the border; the GOV pill itself is
//     rendered by `Sidebar` using the REAL `.kvw-badge`/`.kvw-badge-info` classes (not an inline style, a
//     real promoted class combo), driven by the same caller-supplied `realmLabel` prop.
//   ENGINEERING-OWED (disclosed, not fixed here): a future HAND-3-style batch could promote a real
//   `.realm-gov` class into `web-tokens.css` mirroring `.realm-admin`'s structure — out of this batch's
//   scope (packages/ui consumes canon, never edits it, contract §2).
//
// WHITE-LABEL (Rule Zero): `brand` is a REQUIRED prop on `Sidebar` (this file has no brand of its own) —
// no Krishalaya name/mark/wordmark is ever rendered as a fallback default anywhere in this file or
// `Sidebar.tsx`/`Topbar.tsx` (grep-verified zero occurrences of the literal string "Krishalaya" in any
// component source this batch touches — see dev17_report.md).
import * as React from 'react';

export type RealmKind = 'default' | 'admin' | 'gov';

export interface ImpersonationBannerProps {
  /** Caller-i18n-resolved message, e.g. "You are viewing as Anand FPO (impersonation)." (Law 3). */
  message: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}

/** `.kvw-impersonation` — mandatory banner when a platform operator is acting-as a tenant (contract's own
 * audit-trail requirement). Rendered by `AppShell` only when the `impersonation` prop is supplied. */
export function ImpersonationBanner({ message, actionLabel, onAction }: ImpersonationBannerProps): React.ReactElement {
  return (
    <div className="kvw-impersonation" role="status">
      <span>{message}</span>
      {actionLabel && onAction ? (
        <button type="button" className="kvw-btn kvw-btn-secondary kvw-btn-sm" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export interface AppShellProps {
  /** Rendered `<Sidebar .../>` — this component owns zero sidebar markup itself (see brief's own item split). */
  sidebar: React.ReactNode;
  /** Rendered `<Topbar .../>`. */
  topbar: React.ReactNode;
  /** Main content — wrapped in `.kvw-content` (`web-frame.css` lines 143-149). */
  children: React.ReactNode;
  /** `.web-shell.is-collapsed` (icon-only sidebar) — caller-owned state; this component has no internal
   * collapse state of its own (canon is pure-CSS/modifier-class, no JS owns this — web-frame.css header
   * comment: "No JS: responsive behaviour is pure CSS; interactive states are shown via modifier classes"). */
  collapsed?: boolean;
  impersonation?: ImpersonationBannerProps;
  realm?: RealmKind;
  className?: string;
}

export function AppShell({ sidebar, topbar, children, collapsed, impersonation, realm = 'default', className }: AppShellProps): React.ReactElement {
  const classes = [
    'web-shell',
    collapsed ? 'is-collapsed' : '',
    impersonation ? 'has-impersonation' : '',
    className || '',
  ].filter(Boolean).join(' ');
  return (
    <div className={classes} data-kv-realm={realm !== 'default' ? realm : undefined}>
      {impersonation ? <ImpersonationBanner {...impersonation} /> : null}
      {sidebar}
      {topbar}
      <main className="kvw-content">{children}</main>
    </div>
  );
}

/** CSS fragment. `.web-shell`/`.kvw-impersonation`/`.kvw-content`/grid-helpers/responsive/print ported
 * verbatim from `web-frame.css` lines 22-35, 131-180, 183-215. The two `[data-kv-realm]` rules below are
 * this component's OWN disclosed equivalent of canon's `.realm-admin` (see header comment) — same ratified
 * color decision, no hardcoded pill text. */
export const appShellStyles = `
.web-shell {
  display: grid;
  grid-template-columns: var(--web-sidebar-w) 1fr;
  grid-template-rows: var(--web-topbar-h) 1fr;
  grid-template-areas: "sidebar topbar" "sidebar content";
  min-height: 100vh;
}
.web-shell.is-collapsed { grid-template-columns: var(--web-sidebar-w-collapsed) 1fr; }
.web-shell.has-impersonation {
  grid-template-rows: auto var(--web-topbar-h) 1fr;
  grid-template-areas: "banner banner" "sidebar topbar" "sidebar content";
}
[data-kv-realm="admin"] .kvw-topbar { border-block-start: 3px solid var(--color-accent-500); }
[data-kv-realm="gov"] .kvw-sidebar { border-block-start: 3px solid var(--color-info); }
.kvw-impersonation {
  grid-area: banner;
  display: flex; align-items: center; justify-content: center; gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: var(--color-warning-light); color: var(--color-warning-dark);
  border-block-end: 1px solid var(--color-warning);
  font-size: var(--text-sm); font-weight: 600;
}
.kvw-impersonation .kvw-btn { min-height: 28px; }
.kvw-content {
  grid-area: content;
  padding: var(--web-page-pad);
  max-width: calc(var(--web-content-max) + 2 * var(--web-page-pad));
  width: 100%;
  margin-inline: auto;
}
.kvw-grid { display: grid; gap: var(--web-card-gap); }
.kvw-grid-2 { grid-template-columns: repeat(2, 1fr); }
.kvw-grid-3 { grid-template-columns: repeat(3, 1fr); }
.kvw-grid-4 { grid-template-columns: repeat(4, 1fr); }
.kvw-split { display: grid; grid-template-columns: 2fr 1fr; gap: var(--web-card-gap); align-items: start; }
.kvw-master-detail { display: grid; grid-template-columns: 360px 1fr; gap: var(--web-card-gap); align-items: start; }
@media (max-width: 1024px) {
  .web-shell { grid-template-columns: var(--web-sidebar-w-collapsed) 1fr; }
  .kvw-grid-4 { grid-template-columns: repeat(2, 1fr); }
  .kvw-grid-3 { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 768px) {
  .web-shell { grid-template-columns: 1fr; grid-template-areas: "topbar" "content"; }
  .web-shell.has-impersonation { grid-template-areas: "banner" "topbar" "content"; }
  .kvw-grid-2, .kvw-grid-3, .kvw-grid-4, .kvw-split, .kvw-master-detail { grid-template-columns: 1fr; }
  .kvw-content { padding: var(--space-4); }
}
@media print {
  .kvw-sidebar, .kvw-topbar, .kvw-page-actions, .kvw-impersonation { display: none !important; }
  .web-shell { display: block; }
  body.web { background: var(--color-text-inverse); }
}
`;
