// packages/ui/src/components/Toast.tsx · DEV-18 (Phase D3, packages/ui port batch 4 — specialized
// components). Ports `.kvw-toast` verbatim from `web-components.css` line 432-436, matching the real canon
// demo (`web-component-library.html` line 522: `<div class="kvw-toast" style="position:static;display:
// inline-flex">✓ Payout batch released</div>`, tagged "newly documented" — a real, shipped canon class, not
// invented; this is the canon's own console notification affordance, verified per the founder's own brief
// item ("verify it exists in web-components.css") before building.
//
// A11Y (aria-live, per the brief's explicit instruction "Toast aria-live"): the canon's own demo carries no
// `role`/`aria-live` at all (a static HTML mock has no need for one) — this is a genuine, disclosed
// engineering addition on top of the ported class, required for the component to be a real accessible live
// region rather than a silent visual-only box a screen-reader user would never learn about. Default
// `role="status"` + `aria-live="polite"` (the correct choice for a non-critical confirmation like "Payout
// batch released" — matches the canon's own example tone); `urgent` switches to `role="alert"` +
// `aria-live="assertive"` for a genuinely time-critical message (e.g. a failed money action, Law 6).
//
// HONEST MINIMUM (disclosed, same "caller owns the interactive state" class as `Drawer.tsx`'s DEV-17
// precedent): this component has NO internal auto-dismiss timer and NO hooks — `open` is 100%
// caller-controlled, exactly like `Drawer`/`Modal`. This keeps `Toast` a plain, hook-free function
// component (no `'use client'` directive needed here in isolation — see this file's own RSC note below);
// a consuming screen that wants an auto-dismiss timer owns that `setTimeout`/`useEffect` itself (a Client
// Component concern, not this shared atom's).
//
// RSC NOTE: unlike `Modal.tsx`/`FileUpload.tsx` (DEV-18) and the DEV-15/16/17 fix to `DataTable.tsx`/
// `Drawer.tsx`, this file intentionally carries NO `'use client'` directive — it has zero hooks and the
// optional `onDismiss` callback is passed straight through to a native `<button>`'s `onClick`, which (per
// this batch's own RSC-boundary finding, see `dev18_report.md`) DOES require the consumer to render this
// component from within an existing Client Component boundary if `onDismiss` is supplied. Left as the
// caller's responsibility (same "the caller owns the boundary" discipline the AppShell/Sidebar/PageHeader
// trio already established at DEV-17 for their own callback slots) rather than force this presentational
// atom to always be a Client Component even when a consumer only ever needs the dismiss-less, static variant
// (e.g. an SSR'd one-shot confirmation banner with no close button at all).
import * as React from 'react';

export interface ToastProps {
  /** Caller-i18n-resolved message content (Law 3) — may include an inline icon/emphasis, matching the
   * canon's own "✓ Payout batch released" example. */
  children: React.ReactNode;
  /** Caller-owned visibility — this component renders nothing at all when `false` (same discipline as
   * `Drawer`/`Modal`: no internal open/close state, no CSS transition wiring). */
  open: boolean;
  /** Optional dismiss affordance — omit for a purely informational, non-dismissible toast. Requires a
   * Client Component boundary somewhere above this render (see header comment). */
  onDismiss?: () => void;
  /** Caller-i18n-resolved accessible name for the dismiss button — required whenever `onDismiss` is
   * supplied (Law 3 slot, gate 10 requirement). */
  dismissLabel?: string;
  /** Escalates to `role="alert"` + `aria-live="assertive"` for a genuinely time-critical message (e.g. a
   * failed money-moving action). Defaults to the canon's own non-critical confirmation tone
   * (`role="status"` + `aria-live="polite"`). */
  urgent?: boolean;
  className?: string;
}

export function Toast({ children, open, onDismiss, dismissLabel, urgent, className }: ToastProps): React.ReactElement | null {
  if (!open) return null;
  return (
    <div
      className={['kvw-toast', className || ''].filter(Boolean).join(' ')}
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
    >
      <span className="kvw-toast-body">{children}</span>
      {onDismiss ? (
        <button type="button" className="kvw-toast-dismiss" aria-label={dismissLabel} onClick={onDismiss}>
          {'×'}
        </button>
      ) : null}
    </div>
  );
}

/** CSS fragment. `.kvw-toast` ported verbatim from `web-components.css` lines 432-436. `.kvw-toast-body`/
 * `.kvw-toast-dismiss` are engineering-addition layout helpers (the canon's own demo has no dismiss button
 * at all — a static mock never needs one) built only from already-defined tokens, zero new hex/pixel value
 * invented.
 *
 * QA-FIX [DEV-18, 2026-07-25]: .kvw-toast-dismiss originally shipped with the physical shorthand
 * "padding: 0 0 0 var(--space-2)" — always padded the LEFT edge regardless of direction, so under
 * dir="rtl" the gap between the toast body text and the dismiss glyph would sit on the wrong side (a
 * real, undisclosed logical-CSS/gate-10 violation, the same discipline DEV-15/16/17 were held to and the
 * one class of bug this batch's own RtlSmoke-style grep would have missed, since that test only matches
 * named margin-left/right/padding-left/right properties, not multi-value shorthand). Fixed below to the
 * logical property, which tracks the reading-direction start edge in both LTR and RTL. */
export const toastStyles = `
.kvw-toast {
  position: fixed; inset-block-end: var(--space-6); inset-inline-end: var(--space-6);
  display: flex; align-items: center; gap: var(--space-3);
  background: var(--color-ink-800); color: var(--color-text-inverse); padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md); box-shadow: var(--shadow-lg); font-size: var(--text-sm); z-index: var(--web-z-toast);
}
.kvw-toast-body { flex: 1; }
.kvw-toast-dismiss {
  flex: none; border: none; background: transparent; color: inherit; cursor: pointer;
  font-size: var(--text-base); line-height: 1; padding-inline-start: var(--space-2);
}
.kvw-toast-dismiss:focus-visible { outline: none; box-shadow: var(--web-focus-ring); border-radius: var(--radius-sm); }
`;
