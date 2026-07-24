// packages/ui/src/components/Skeleton.tsx · DEV-16 (Phase D3, packages/ui port batch 2 — data display).
//
// ENGINEERING EXTENSION (contract §8 — disclosed, not silently invented): web-components.css defines only
// `.kvw-skeleton-row td span` (lines 230-234), a TABLE-scoped shimmer rule (`DataTable.tsx` already ports
// it verbatim). No standalone `.kvw-skeleton` block class exists anywhere in the canon (grep-verified,
// zero hits for any bare `.kvw-skeleton{` selector) — a generic loading-placeholder primitive for use
// OUTSIDE a table (e.g. a KPI card's loading state, a list row) is a real, common need the canon simply
// never named as its own class. This component reuses the EXACT gradient/animation VALUES already cited
// from `.kvw-skeleton-row td span` (same tokens, same `kvw-shimmer` keyframe — no new color/motion value
// introduced) under a new, honestly-named class (`kvw-skeleton-block`, not pretending to be a canon
// selector) — same escalation discipline DEV-15 used for `AiBadge`'s `banner` variant.
//
// Golden Law 3: purely decorative, `aria-hidden` always — a loading REGION (e.g. a card, a `DataTable`
// `tbody`) is responsible for its own `aria-busy`/`role="status"`, this is just the visual unit.
import * as React from 'react';

export interface SkeletonProps {
  /** CSS length, caller controls layout — never guessed here (e.g. `'140px'`, `'60%'`). */
  width?: string;
  height?: string;
  className?: string;
}

export function Skeleton({ width = '100%', height = '12px', className }: SkeletonProps): React.ReactElement {
  return (
    <span
      className={['kvw-skeleton-block', className || ''].filter(Boolean).join(' ')}
      style={{ width, height }}
      aria-hidden="true"
      data-kv-component="skeleton"
    />
  );
}

/** CSS fragment. Gradient/animation values are a byte-identical duplicate of `DataTable.tsx`'s
 * `.kvw-skeleton-row td span` rule (disclosed "safe to load twice" pattern, DEV-15 precedent) — reused
 * under the new `.kvw-skeleton-block` selector name since this primitive is not table-scoped. The
 * `kvw-shimmer` keyframe is also redeclared identically here (harmless duplicate at the CSS level; a
 * consumer using ONLY `Skeleton` without `DataTable` mounted still gets a working animation). */
export const skeletonStyles = `
.kvw-skeleton-block {
  display: block; border-radius: var(--radius-sm);
  background: linear-gradient(90deg, var(--color-earth-100), var(--color-earth-200), var(--color-earth-100));
  background-size: 200% 100%; animation: kvw-shimmer 1.4s infinite;
}
@keyframes kvw-shimmer { to { background-position: -200% 0; } }
`;
