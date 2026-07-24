// packages/ui/src/components/Topbar.tsx · DEV-17 (Phase D3, packages/ui port batch 3 —
// navigation/layout primitives). Ports `.kvw-topbar`/`.kvw-topbar-search`/`.kvw-topbar-actions`/
// `.kvw-topbar-iconbtn` verbatim from `web-frame.css` lines 96-129, matching the real canon demo
// (`web-component-library.html` line 149: search box + notification-bell iconbtn w/ `.dot` unread marker +
// `.kvw-avatar` initials). Search/notification-bell/user-menu are all SLOTS per the brief's own item 3 —
// this component owns only the chrome container classes, never business content.
import * as React from 'react';

export interface TopbarNotification {
  /** Caller-i18n-resolved accessible name, e.g. "Notifications (3 unread)" (Law 3 — the count/plurality is
   * resolved by the caller, never templated here). */
  label: string;
  hasUnread?: boolean;
  onClick?: () => void;
  icon?: React.ReactNode;
}

export interface TopbarProps {
  /** Rendered inside `.kvw-topbar-search[role="search"]` — a full slot (input, `⌘K` hint, whatever the
   * consuming app needs); this component never assumes a search implementation. */
  search?: React.ReactNode;
  /** Accessible name for the search region (Law 3 slot) — required whenever `search` is supplied. */
  searchLabel?: string;
  notification?: TopbarNotification;
  /** Rendered as-is inside `.kvw-topbar-actions`, e.g. an `<Avatar/>` + dropdown menu — a full slot,
   * never a baked user-menu implementation (white-label: no assumed avatar-initials scheme). */
  userMenu?: React.ReactNode;
  className?: string;
}

export function Topbar({ search, searchLabel, notification, userMenu, className }: TopbarProps): React.ReactElement {
  return (
    <header className={['kvw-topbar', className || ''].filter(Boolean).join(' ')}>
      {search ? (
        <div className="kvw-topbar-search" role="search" aria-label={searchLabel}>
          {search}
        </div>
      ) : null}
      <div className="kvw-topbar-actions">
        {notification ? (
          <button type="button" className="kvw-topbar-iconbtn" aria-label={notification.label} onClick={notification.onClick}>
            {notification.icon ?? <span aria-hidden="true">{'\u{1F514}'}</span>}
            {notification.hasUnread ? <span className="dot" aria-hidden="true" /> : null}
          </button>
        ) : null}
        {userMenu}
      </div>
    </header>
  );
}

export interface AvatarProps {
  /** Caller-supplied initials/label text (e.g. "PO") — never derived/guessed here (Law 3: no invented
   * name-splitting logic that could mis-render a non-Latin name). */
  label: string;
  size?: 'md' | 'lg';
  className?: string;
}

/** `.kvw-avatar`/`.kvw-avatar-lg` (`web-components.css` lines 452-453) — an optional convenience export for
 * `Topbar`'s `userMenu` slot; entirely optional, not required by any white-label consumer. */
export function Avatar({ label, size = 'md', className }: AvatarProps): React.ReactElement {
  return (
    <span className={['kvw-avatar', size === 'lg' ? 'kvw-avatar-lg' : '', className || ''].filter(Boolean).join(' ')}>
      {label}
    </span>
  );
}

/** CSS fragment ported verbatim from `web-frame.css` lines 96-129 + `.kvw-avatar`/`.kvw-avatar-lg`
 * (`web-components.css` lines 452-453, dark override line 527). */
export const topbarStyles = `
.kvw-topbar {
  grid-area: topbar;
  position: sticky; inset-block-start: 0;
  display: flex; align-items: center; gap: var(--space-4);
  padding-inline: var(--space-5);
  background: var(--surface-card);
  border-block-end: 1px solid var(--border-subtle);
  z-index: var(--web-z-topbar);
}
.kvw-topbar-search {
  flex: 1; max-width: 480px; display: flex; align-items: center; gap: var(--space-2);
  height: var(--web-control-h); padding-inline: var(--space-3);
  background: var(--color-earth-100); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md); color: var(--color-ink-400); font-size: var(--text-sm);
}
.kvw-topbar-search kbd {
  margin-inline-start: auto; font-family: var(--font-mono); font-size: var(--text-xs);
  border: 1px solid var(--border-default); border-radius: var(--radius-sm); padding: 1px 5px;
}
.kvw-topbar-actions { margin-inline-start: auto; display: flex; align-items: center; gap: var(--space-3); }
.kvw-topbar-iconbtn {
  position: relative; width: var(--web-control-h); height: var(--web-control-h);
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; border-radius: var(--radius-md);
  color: inherit; cursor: pointer;
}
.kvw-topbar-iconbtn:hover { background: var(--color-earth-100); }
.kvw-topbar-iconbtn:focus-visible { outline: none; box-shadow: var(--web-focus-ring); }
.kvw-topbar-iconbtn .dot {
  position: absolute; inset-block-start: 7px; inset-inline-end: 7px;
  width: 8px; height: 8px; border-radius: var(--radius-full);
  background: var(--color-danger); border: 2px solid var(--surface-card);
}
.kvw-avatar { width: 32px; height: 32px; border-radius: var(--radius-full); background: var(--color-primary-100); color: var(--color-primary-700); display: inline-flex; align-items: center; justify-content: center; font-size: var(--text-xs); font-weight: 700; }
.kvw-avatar-lg { width: 48px; height: 48px; font-size: var(--text-base); }
[data-theme="dark"] .kvw-avatar { color: var(--color-primary-avatar-dark); }
`;
