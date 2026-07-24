// packages/ui/src/components/Toolbar.tsx · DEV-18 (Phase D3, packages/ui port batch 4 — specialized
// components). Ports `.kvw-toolbar` — promoted at HAND-2 from ad-hoc usage (`web-components.css` line 715,
// census bucket (c): 11 files, ALL previously bare `class="kvw-toolbar"` with ZERO prior CSS anywhere per
// `hand2_component_census.json`'s own `a_defined_but_undocumented`/`promotion_candidates_used_5_or_more_
// times` lists — the HAND-2 comment at that CSS rule's own site states plainly this is "the first real
// definition: a genuine visual fix … not a preserved-behaviour promotion"). Matches the real canon demo
// (`web-component-library.html` lines 481-483: a row of filter chips, "All channels / push / sms /
// whatsapp / email"). Substituted for the founder's own "honesty-chip family" candidate after that family
// was verified ABSENT from canon (see `dev18_report.md` §1 / `DEV_TRACKER.md` DEV-18 STATE block) — a real,
// grounded gap, not an invented placeholder to hit the batch's component count.
//
// Server-safe: this component is a bare flex-wrap CONTAINER only — it renders zero interactive elements of
// its own (the canon demo's chips are the caller's own `Chip`/`Button` children, already shipped by DEV-15/
// DEV-16); no hooks, no event-handler props on native elements — no `'use client'` needed.
import * as React from 'react';

export interface ToolbarProps {
  /** Caller-composed content — typically a row of `<Chip>`/`<Button>` filter controls (this package's own
   * DEV-16 `Chip` component, per the canon demo's own markup shape) — this component owns zero business
   * vocabulary or interactive logic of its own, purely the `.kvw-toolbar` flex-wrap layout. */
  children: React.ReactNode;
  /** Accessible name for the toolbar landmark — required whenever the toolbar groups related controls a
   * screen-reader user would benefit from being told about as a set (gate 10); optional because a purely
   * decorative spacing wrapper with no semantic grouping need not carry one. When supplied, this renders
   * `role="toolbar"` + `aria-label` (WAI-ARIA toolbar pattern) rather than a bare `<div>`. */
  label?: string;
  className?: string;
}

export function Toolbar({ children, label, className }: ToolbarProps): React.ReactElement {
  const classes = ['kvw-toolbar', className || ''].filter(Boolean).join(' ');
  if (label) {
    return <div className={classes} role="toolbar" aria-label={label}>{children}</div>;
  }
  return <div className={classes}>{children}</div>;
}

/** CSS fragment. `.kvw-toolbar` ported verbatim from `web-components.css` line 715 (the HAND-2 promotion —
 * see header comment for the "genuine visual fix, not a preserved-behaviour promotion" disclosure already
 * made at that CSS rule's own site; reproduced here unchanged). */
export const toolbarStyles = `
.kvw-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); padding-block-end: var(--space-3); }
`;
