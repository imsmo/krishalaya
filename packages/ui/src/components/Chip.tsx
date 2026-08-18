// packages/ui/src/components/Chip.tsx · DEV-16 (Phase D3, packages/ui port batch 2 — data display).
// Ports canon classes `.kvw-chip`/`.kvw-chip-active` verbatim from
// `Phase-1 all screen design/Krishi_Verse_Design_System/system/web/web-components.css` lines 135-141 —
// matching a real canon usage (`web-component-library.html` lines 163-164, the table toolbar's filter
// chips: `<span class="kvw-chip kvw-chip-active">Status: live</span>`). Completes the "badge/chips family"
// alongside DEV-15's `StatusPill`/`AiBadge` (badges) — chips are the toolbar-filter sibling, a distinct
// canon class the prior batch did not port.
//
// Golden Law 3: `label` is caller-i18n-resolved (e.g. "Status: live", "Crop: All") — this component owns
// zero vocabulary. Rendered as a real `<button>` (not the canon's literal `<span>`) whenever `onClick` is
// supplied so the toggle is keyboard-operable (gate 10) — a disclosed a11y enhancement, not a silent
// visual deviation (canon CSS already declares `cursor: pointer` on `.kvw-chip`, implying an interactive
// affordance the literal `<span>` markup can't actually deliver via keyboard).
//
// POLYMORPHIC `as` (DEV-59 addition, mirrors `Button.tsx`'s own DEV-59 addition and rationale exactly):
// `web-admin`'s census found many real filter-chip controls rendered as `<Link>` (Next.js, navigating to
// a new query-string filter) styled with the app's own `kv-chip`/`kv-chip is-active` classes — real
// navigation, not a client `onClick` toggle. Canon's `.kvw-chip`/`.kvw-chip-active` have no `<button>`- or
// `<span>`-specific selector (verified: `web-components.css` 135-141, plain class rules only), so they
// render pixel-identically on an `<a>`/router-Link as on a `<span>`/`<button>`. `as` lets the caller
// supply its own element/component (e.g. `as={Link}` + `href`) while this component still owns the canon
// `kvw-chip`/`kvw-chip-active` classes.
//
// `children` AS AN ALTERNATIVE TO `label` (DEV-59 addition): the same census found real filter-chip call
// sites whose content isn't a single caller string — e.g. `{t.t('support.filterAll')}{chipCount()}`, a
// translated label followed by a nested count badge. Forcing those into a single `label: string` prop
// would either lose the count badge or require inventing string concatenation this component has no
// business doing (Golden Law 3 — this component owns zero vocabulary/formatting). `children` is accepted
// as a `ReactNode` and takes priority over `label` when supplied, so both the plain-string call sites
// (existing `label` usage, unchanged) and the mixed-content call sites can be ported byte-for-byte.
import * as React from 'react';

export interface ChipProps {
  /** Caller-i18n-resolved chip text. Ignored if `children` is supplied. */
  label?: string;
  /** Alternative to `label` (DEV-59) — use when the chip's content isn't a single string, e.g. a label
   * plus a nested count badge. Takes priority over `label` when both are present. */
  children?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  /** Polymorphic escape hatch (DEV-59) — render as this element/component instead of the default
   * `<span>`/`<button>` choice (e.g. `as={NextLink}` + `href`). Extra props pass through via `...rest`. */
  as?: React.ElementType;
  [extra: string]: unknown;
}

export function Chip({ label, children, active, onClick, className, as, ...rest }: ChipProps): React.ReactElement {
  const classes = ['kvw-chip', active ? 'kvw-chip-active' : '', className || ''].filter(Boolean).join(' ');
  const content = children !== undefined ? children : label;
  if (as) {
    const Comp = as;
    return (
      <Comp {...rest} className={classes} data-kv-component="chip">
        {content}
      </Comp>
    );
  }
  if (onClick) {
    return (
      <button type="button" className={classes} aria-pressed={active} onClick={onClick} data-kv-component="chip" {...rest}>
        {content}
      </button>
    );
  }
  return (
    <span className={classes} data-kv-component="chip" {...rest}>
      {content}
    </span>
  );
}

/** CSS fragment, ported verbatim from web-components.css lines 135-141. */
export const chipStyles = `
.kvw-chip {
  display: inline-flex; align-items: center; gap: var(--space-2);
  min-height: 28px; padding-inline: var(--space-3);
  border: 1px solid var(--border-default); border-radius: var(--radius-full);
  background: var(--surface-card); font-size: var(--text-xs); font-weight: 500; cursor: pointer;
}
.kvw-chip-active { background: var(--color-primary-600); border-color: var(--color-primary-600); color: var(--color-text-inverse); }
`;
