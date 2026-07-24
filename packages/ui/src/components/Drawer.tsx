'use client';
// packages/ui/src/components/Drawer.tsx · DEV-17 (Phase D3, packages/ui port batch 3 —
// navigation/layout primitives). Ports `.kvw-drawer`/`.kvw-drawer-header`/`.kvw-drawer-body`/
// `.kvw-drawer-footer` verbatim from `web-components.css` lines 347-359 + `.kvw-backdrop` (line 330),
// matching the real canon demo (`web-component-library.html` lines 349-352: header/body/footer, "Opens
// from the reading-end (inset-inline-end) — mirrors under RTL automatically, no override needed").
// Brief's own item 4 names "Drawer/Sheet if canon shows one (verify; don't invent)" — verified real,
// not invented (see DEV_TRACKER.md STATE block's boundary note on the ~8-component cap).
//
// HONEST MINIMUM (disclosed, gate-8 "don't invent" discipline): no focus-trap library, no return-focus
// management, no CSS open/close transition wiring beyond the canon's own static classes — this component
// renders `null` when `open` is false (fully unmounts) rather than animating, and relies on the caller to
// manage focus (e.g. moving focus into the drawer on open). Escape-to-close is wired via a real `onKeyDown`
// handler on the dialog itself; the pure predicate `isCloseKey` below is extracted for the same
// static-harness-testable-interaction-logic reason `Tabs.tsx`'s `nextTabKey` is.
//
// QA-FIX [DEV-18, 2026-07-24] — RSC BOUNDARY: this component uses `React.useMemo` (the drawer's title-id
// generator, below) but shipped through DEV-17 with no `'use client'` directive — the same latent bug
// class as `DataTable.tsx`'s (found by DEV-18's own consuming-app smoke test, see `dev18_report.md`). Fixed
// forward with the directive above.
import * as React from 'react';

export function isCloseKey(key: string): boolean {
  return key === 'Escape';
}

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Rendered inside `.kvw-drawer-header` and used as the dialog's accessible name via `aria-labelledby`. */
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Accessible name for the close affordance if the caller renders one in `footer` — this component does
   * not render its own close button (canon's own demo puts "Close" inside the caller-composed footer,
   * `web-component-library.html` line 351), so no label is required here; kept optional for a future
   * built-in close-icon-button variant, not wired yet (boundary stated). */
  closeLabel?: string;
  className?: string;
}

let drawerIdSeq = 0;

export function Drawer({ open, onClose, title, children, footer, className }: DrawerProps): React.ReactElement | null {
  const titleId = React.useMemo(() => `kv-drawer-title-${++drawerIdSeq}`, []);
  if (!open) return null;
  return (
    <>
      <div className="kvw-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className={['kvw-drawer', className || ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => { if (isCloseKey(e.key)) onClose(); }}
      >
        <div className="kvw-drawer-header" id={titleId}>{title}</div>
        <div className="kvw-drawer-body">{children}</div>
        {footer ? <div className="kvw-drawer-footer">{footer}</div> : null}
      </div>
    </>
  );
}

/** CSS fragment. `.kvw-drawer`/header/body/footer ported verbatim from `web-components.css` lines 347-359.
 * `.kvw-drawer-backdrop` is a DISCLOSED, deliberate deviation from reusing the canon's own `.kvw-backdrop`
 * (line 330) as-is: that class's z-index is `calc(var(--web-z-modal) - 1)` = 99 (one below the MODAL layer,
 * 100) — correct for a modal's own backdrop, but `--web-z-drawer` is 90 (`web-tokens.css` line 83), BELOW
 * that 99, so reusing `.kvw-backdrop` verbatim here would render the backdrop ON TOP of the drawer panel, a
 * real visual bug, not a cosmetic nit. This rule keeps the identical visual (`--surface-overlay` tint) but
 * at the correct z-index relative to `--web-z-drawer`, since Modal itself is out of this batch's scope
 * (boundary stated in `dev17_report.md`) and no fix-forward to the shared canon class is authorized here
 * (packages/ui consumes canon, never edits it). */
export const drawerStyles = `
.kvw-drawer-backdrop { position: fixed; inset: 0; background: var(--surface-overlay); z-index: calc(var(--web-z-drawer) - 1); }
.kvw-drawer {
  position: fixed; inset-block: 0; inset-inline-end: 0; width: min(480px, 100vw);
  background: var(--surface-card); box-shadow: var(--shadow-xl); z-index: var(--web-z-drawer);
  display: flex; flex-direction: column;
}
[dir="rtl"] .kvw-drawer { inset-inline-end: 0; }
.kvw-drawer-header { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-5); border-block-end: 1px solid var(--border-subtle); }
.kvw-drawer-body { flex: 1; overflow-y: auto; padding: var(--space-5); }
.kvw-drawer-footer { padding: var(--space-4) var(--space-5); border-block-start: 1px solid var(--border-subtle); display: flex; justify-content: flex-end; gap: var(--space-3); }
`;
