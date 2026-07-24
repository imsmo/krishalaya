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
import * as React from 'react';

export interface ChipProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}

export function Chip({ label, active, onClick, className }: ChipProps): React.ReactElement {
  const classes = ['kvw-chip', active ? 'kvw-chip-active' : '', className || ''].filter(Boolean).join(' ');
  if (onClick) {
    return (
      <button type="button" className={classes} aria-pressed={active} onClick={onClick} data-kv-component="chip">
        {label}
      </button>
    );
  }
  return (
    <span className={classes} data-kv-component="chip">
      {label}
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
