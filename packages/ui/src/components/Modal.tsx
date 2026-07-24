// packages/ui/src/components/Modal.tsx · DEV-18 (Phase D3, packages/ui port batch 4 — specialized
// components). Ports `.kvw-modal`/`.kvw-modal-title`/`.kvw-modal-body`/`.kvw-modal-footer`/
// `.kvw-confirm-danger`/`.kvw-audit-note` verbatim from `web-components.css` lines 329-345, matching the
// real canon demo (`web-component-library.html` lines 316-320: a suspend-tenant confirm-danger dialog with
// Cancel/"Request suspension" footer buttons). Reuses `.kvw-backdrop` (line 330) directly — unlike
// `Drawer.tsx` (DEV-17), Modal's own z-index IS `--web-z-modal` and canon's `.kvw-backdrop` is defined as
// exactly `calc(var(--web-z-modal) - 1)`, i.e. it is CORRECT here (no z-index bug like Drawer's — verified,
// not assumed: Drawer's bug existed only because it reused the MODAL-tuned backdrop for a DIFFERENT,
// lower z-index layer; Modal is the layer `.kvw-backdrop` was authored for).
//
// DEFERRED FROM DEV-17 (`dev17_report.md` §6, `DEV_TRACKER.md` DEV-17 STATE block): the founder's own
// DEV-17 brief named only Drawer/Sheet as the required overlay for that batch; Modal was explicitly
// deferred to "DEV-18 (specialized components)" — built here, not invented.
//
// A11Y (this batch's own upgraded requirement over Drawer's "honest minimum" — the brief names "Modal focus
// trap + aria-modal" explicitly, not just aria-modal alone): a REAL focus trap is implemented via
// `getFocusableElements` (a container query, pure DOM-API usage) + `shouldWrapFocus` (a PURE, fully unit-
// testable decision function with zero DOM dependency — same "extract the pure predicate" discipline as
// `Tabs.tsx`'s `nextTabKey` / `Drawer.tsx`'s `isCloseKey`). On open: focus moves to the first focusable
// element inside the dialog (or the dialog container itself if none exists); on close/unmount: focus
// returns to whatever was focused immediately before opening. Tab/Shift+Tab wrap at the first/last
// focusable element so focus can never escape to the page behind the backdrop.
//
// TEST-ENV DISCLOSURE (honest, not hidden): `packages/ui`'s jest harness runs `testEnvironment: 'node'`
// (see `jest.config.js`'s own header comment, DEV-15) — no real DOM exists, so the live focus-trap behavior
// (actual `document.activeElement` movement, real `querySelectorAll`) cannot be exercised by THIS package's
// test suite. `shouldWrapFocus` is 100% pure (no DOM) and is fully unit-tested here. The live DOM behavior
// (focus actually lands inside the dialog, Tab actually wraps) is instead exercised by the DEV-18 REAL
// consuming-app smoke test's jsdom render test in `apps/web-tenant` (see `dev18_report.md`), which is a real
// browser-like DOM — the correct place to prove this, not a workaround for a gap in this package.
//
// 'use client' (Next.js RSC boundary — DEV-18's own audit finding, see `dev18_report.md` §"RSC boundary
// audit"): this component uses `useRef`/`useEffect`/a live `onKeyDown` handler — all client-only. Declared
// here, in the component's own source file, per the same pattern this batch applied to fix `DataTable.tsx`/
// `Drawer.tsx`'s pre-existing gap (a shared component library that ships hook-using components into
// Next.js apps must carry this directive itself; the directive is preserved through `tsc`'s compile step
// since it is a plain top-of-file string-literal expression statement, not stripped).
'use client';
import * as React from 'react';
import { isCloseKey } from './Drawer';

export { isCloseKey };

/** Query every element inside `container` this component considers focusable, in DOM order. Pure aside
 * from the single `querySelectorAll` call — no other side effects, fully mockable with any object exposing
 * `querySelectorAll` (see `Modal.test.tsx`, which exercises this without a real DOM). */
export function getFocusableElements(container: { querySelectorAll: (selector: string) => ArrayLike<unknown> }): HTMLElement[] {
  const selector = [
    'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
    'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
  ].join(', ');
  return Array.from(container.querySelectorAll(selector) as ArrayLike<HTMLElement>);
}

/** PURE decision function for the WAI-ARIA dialog focus-trap pattern: given whether the currently-active
 * element is the first/last focusable node and whether Shift was held, decide where Tab should wrap to (or
 * `null` if the browser's native Tab order should proceed untouched). Zero DOM dependency — fully testable
 * with plain booleans, mirroring `Tabs.tsx`'s `nextTabKey` / `Drawer.tsx`'s `isCloseKey` discipline. */
export function shouldWrapFocus(activeIsFirst: boolean, activeIsLast: boolean, shiftKey: boolean): 'first' | 'last' | null {
  if (shiftKey && activeIsFirst) return 'last';
  if (!shiftKey && activeIsLast) return 'first';
  return null;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Rendered inside `.kvw-modal-title` (an `<h2>`) and wired as the dialog's accessible name via
   * `aria-labelledby` — caller-i18n-resolved (Law 3). */
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** `.kvw-confirm-danger` tone (canon: a destructive confirmation, e.g. "Suspend tenant?") — a class
   * modifier only, never a baked confirmation string (Law 3: `title`/`children`/`footer` remain the
   * caller's own copy). */
  danger?: boolean;
  /** Clicking the backdrop closes the modal by default, matching the canon's implicit dismiss affordance;
   * set `false` for a modal that must be dismissed only via an explicit footer action (e.g. a
   * maker-checker confirm that must not be accidentally backdrop-dismissed). */
  closeOnBackdrop?: boolean;
  /** Caller-i18n-resolved accessible name for `role="alertdialog"` vs the default `role="dialog"` — pass
   * `true` when the modal represents an urgent/blocking confirmation (canon's own `.kvw-confirm-danger`
   * case), matching the WAI-ARIA alertdialog pattern more precisely than a plain dialog. Optional, defaults
   * to the plain dialog role so existing non-destructive modals are unaffected. */
  alert?: boolean;
  className?: string;
}

let modalIdSeq = 0;

export function Modal({
  open, onClose, title, children, footer, danger, closeOnBackdrop = true, alert, className,
}: ModalProps): React.ReactElement | null {
  const titleId = React.useMemo(() => `kv-modal-title-${++modalIdSeq}`, []);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previouslyFocused = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return undefined;
    previouslyFocused.current = (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
    const node = dialogRef.current;
    const focusables = node ? getFocusableElements(node) : [];
    (focusables[0] ?? node)?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isCloseKey(e.key)) {
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const node = dialogRef.current;
    if (!node) return;
    const focusables = getFocusableElements(node);
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const wrap = shouldWrapFocus(active === first, active === last, e.shiftKey);
    if (wrap === 'first') {
      e.preventDefault();
      first.focus();
    } else if (wrap === 'last') {
      e.preventDefault();
      last.focus();
    }
  };

  if (!open) return null;
  const classes = ['kvw-modal', danger ? 'kvw-confirm-danger' : '', className || ''].filter(Boolean).join(' ');
  return (
    <>
      <div className="kvw-backdrop" onClick={closeOnBackdrop ? onClose : undefined} aria-hidden="true" />
      <div
        ref={dialogRef}
        className={classes}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
      >
        <h2 className="kvw-modal-title" id={titleId}>{title}</h2>
        <div className="kvw-modal-body">{children}</div>
        {footer ? <div className="kvw-modal-footer">{footer}</div> : null}
      </div>
    </>
  );
}

/** CSS fragment. `.kvw-modal`/-title/-body/-footer/`.kvw-confirm-danger` ported verbatim from
 * `web-components.css` lines 331-340 + dark override line 532. `.kvw-backdrop` is reused UNMODIFIED (see
 * header comment — this is the layer canon's own backdrop rule was authored for, unlike Drawer). */
export const modalStyles = `
.kvw-backdrop { position: fixed; inset: 0; background: var(--surface-overlay); z-index: calc(var(--web-z-modal) - 1); }
.kvw-modal {
  position: fixed; inset: 0; margin: auto; height: fit-content; max-height: 85vh; overflow: auto;
  width: min(560px, calc(100vw - 32px));
  background: var(--surface-card); border-radius: var(--radius-xl); box-shadow: var(--shadow-xl);
  padding: var(--space-6); z-index: var(--web-z-modal);
}
.kvw-modal-title { font-family: var(--font-display); font-size: var(--text-xl); font-weight: 700; margin: 0 0 var(--space-2); }
.kvw-modal-body { font-size: var(--text-sm); color: var(--color-ink-500); }
.kvw-modal-footer { display: flex; justify-content: flex-end; gap: var(--space-3); margin-block-start: var(--space-6); }
.kvw-confirm-danger .kvw-modal-title { color: var(--color-danger-dark); }
[data-theme="dark"] .kvw-confirm-danger .kvw-modal-title { color: var(--color-danger-text-dark); }
.kvw-audit-note {
  display: flex; align-items: center; gap: var(--space-2);
  margin-block-start: var(--space-4); padding: var(--space-2) var(--space-3);
  background: var(--color-earth-100); border-radius: var(--radius-md);
  font-size: var(--text-xs); color: var(--color-ink-500);
}
`;
