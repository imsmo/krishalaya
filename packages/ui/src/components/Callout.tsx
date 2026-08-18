// packages/ui/src/components/Callout.tsx · DEV-16 (Phase D3, packages/ui port batch 2 — data display).
// Extended DEV-60 (UI Port Program batch 3, Part 1: `live` prop) — see that batch's spec_dev60.md for
// the full decision record; summary of the extension is in this header, below the original DEV-16 comment.
//
// Ports canon classes `.kvw-callout`/`-info`/`-danger`/`-success` verbatim from
// `Phase-1 all screen design/Krishi_Verse_Design_System/system/web/web-components.css` lines 694-700
// (dark-mode text-role overrides included in the same block) — matching a real canon usage
// (`W128-tenant-listings-bulk.html` line 104: the info-toned "Bulk-created listings still walk the normal
// path…" note). Per that CSS block's own header comment (lines 689-693): the bare `.kvw-callout` default
// IS the warning tone (5 existing canon files already render exactly this box with an inline style this
// class now replaces) — `tone="warning"` is therefore the default here too, matching the canon default
// 1:1, not an arbitrary choice.
//
// Golden Law 3: `children` is fully caller-i18n-resolved content (may include inline links/emphasis, e.g.
// the canon's own "idempotent" claim) — this component owns zero copy.
//
// DEV-60 EXTENSION — why a `live` prop, not a free `role` passthrough:
// Three parallel DEV-60 slices independently found ~68 `web-admin` sites carrying `role="alert"` or
// `role="status"` on what would otherwise be a `kv-note`/`kv-notice` → `Callout` conversion, and all three
// correctly refused to convert them, because this component hardcoded `role="note"` with no override —
// doing so would have silently downgraded an assertive money/security announcement to a passive note.
// Checked canon itself (Law 4) before designing a fix: canon's OWN two note-shaped classes (`.kvw-callout`,
// this component's box; `.kvw-alert`, a separate flex-shaped box, `web-components.css` lines 427-431) are,
// in every real canon screen that uses either one, rendered with `role="note"` — canon's static HTML mockups
// never model `role="alert"`/`role="status"` at all, because they don't model live client-side action
// results (a Server Action's success/failure banner is a runtime concept a static mockup can't show). So
// there is no canon example to be "byte-true" to here; the ARIA requirement comes from real dynamic
// behavior canon's screens don't capture, not from a canon deviation.
// The API is a constrained `live` union (`'off' | 'polite' | 'assertive'`), not a raw `role` string prop,
// specifically so the wrong combination cannot be expressed: `role="alert"` already implies
// `aria-live="assertive"` per the ARIA spec, and a free `role` prop would let a caller accidentally pair
// `role="alert"` with an explicit conflicting `aria-live="polite"`. `live` maps 1:1 to `role` and nothing
// else changes — `aria-live` is never rendered explicitly (every real web-admin call site this targets
// already omits it too, relying on the role's implicit value — confirmed by grep before this was written),
// so this is a byte-true match to the markup being replaced. Tone/visual styling is completely orthogonal
// to `live` — the `kvw-callout*` class list does not change based on `live`, so a danger-toned assertive
// alert and a danger-toned static note render pixel-identically, only the ARIA role differs.
import * as React from 'react';

export type CalloutTone = 'warning' | 'info' | 'danger' | 'success';

/**
 * ARIA live-region semantics for the box's outer element.
 * - 'off' (default): `role="note"` — a static aside, never interrupts, never re-announced. This is the
 *   ORIGINAL, UNCHANGED default — every existing call site that does not pass `live` behaves exactly as
 *   before this prop was added.
 * - 'polite': `role="status"` — assistive tech announces when the user is next idle. Use for a
 *   success/ok/informational action-result banner.
 * - 'assertive': `role="alert"` — assistive tech interrupts immediately. Use for an error/danger
 *   action-result banner (the money/security-critical case this extension exists for).
 */
export type CalloutLive = 'off' | 'polite' | 'assertive';

const ROLE_FOR_LIVE: Record<CalloutLive, 'note' | 'status' | 'alert'> = {
  off: 'note',
  polite: 'status',
  assertive: 'alert',
};

export interface CalloutProps {
  tone?: CalloutTone;
  /** See `CalloutLive`. Defaults to `'off'` (`role="note"`) — identical to pre-DEV-60 behavior. */
  live?: CalloutLive;
  children: React.ReactNode;
  className?: string;
}

export function Callout({ tone = 'warning', live = 'off', children, className }: CalloutProps): React.ReactElement {
  const classes = [
    'kvw-callout',
    tone !== 'warning' ? `kvw-callout-${tone}` : '',
    className || '',
  ].filter(Boolean).join(' ');
  return (
    <div className={classes} role={ROLE_FOR_LIVE[live]} data-kv-component="callout">
      {children}
    </div>
  );
}

/** CSS fragment, ported verbatim from web-components.css lines 694-700. */
export const calloutStyles = `
.kvw-callout { background: var(--color-warning-light); border: 1px solid var(--color-warning); border-radius: var(--radius-lg); padding: var(--space-3) var(--space-4); font-size: var(--text-sm); color: var(--color-warning-dark); }
.kvw-callout-info { background: var(--color-info-light); border-color: var(--color-info); color: var(--color-info-dark); }
.kvw-callout-danger { background: var(--color-danger-light); border-color: var(--color-danger); color: var(--color-danger-dark); }
.kvw-callout-success { background: var(--color-success-light); border-color: var(--color-success); color: var(--color-success-dark); }
[data-theme="dark"] .kvw-callout-info { color: var(--color-info-text-dark); }
[data-theme="dark"] .kvw-callout-danger { color: var(--color-danger-text-dark); }
[data-theme="dark"] .kvw-callout-success { color: var(--color-success-text-dark); }
`;
