// packages/ui/src/components/Breadcrumbs.tsx · DEV-17 (Phase D3, packages/ui port batch 3 —
// navigation/layout primitives). Ports `.kvw-breadcrumb` verbatim from `web-frame.css` lines 150-158,
// matching the real canon demo (`web-component-library.html` line 151, `W358-gov-chrome-canon.html` line 51).
//
// RTL-MIRRORING SEPARATOR (APPLY-6): the canon's `li + li::before { content: "/"; margin-inline-end }`
// already uses a LOGICAL margin property — the "/" glyph itself is direction-agnostic (unlike an arrow
// glyph, it needs no `scaleX(-1)` mirror), so under `dir="rtl"` the separator's spacing flips automatically
// via the logical property with zero override needed (same "logical prop already flips, no override
// needed" precedent APPLY-6/HAND-2 established for the drawer's `inset-inline-end` and the diff-viewer's
// grid track order). Verified here, not assumed — see the RTL smoke test in `__tests__/RtlSmoke.test.tsx`.
import * as React from 'react';

export interface BreadcrumbItem {
  /** Caller-i18n-resolved label (Law 3). */
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  /** Accessible name for the `<nav>` landmark, e.g. "Breadcrumb" (Law 3 — canon's own demos happen to use
   * the English word as a mock label; a real screen must supply its own i18n-resolved string). */
  ariaLabel: string;
  className?: string;
}

/** The LAST item is always rendered as the current page (canon: plain text + `aria-current="page"`, never
 * a link) regardless of whether an `href` was supplied for it — matching every canon example, which never
 * links the trailing crumb. */
export function Breadcrumbs({ items, ariaLabel, className }: BreadcrumbsProps): React.ReactElement {
  return (
    <nav aria-label={ariaLabel} className={className}>
      <ol className="kvw-breadcrumb">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} aria-current={isLast ? 'page' : undefined}>
              {!isLast && item.href ? <a href={item.href}>{item.label}</a> : item.label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** CSS fragment ported verbatim from `web-frame.css` lines 150-158. */
export const breadcrumbsStyles = `
.kvw-breadcrumb {
  display: flex; align-items: center; gap: var(--space-2);
  font-size: var(--text-sm); color: var(--color-ink-400);
  margin-block-end: var(--space-3); list-style: none; padding: 0;
}
.kvw-breadcrumb a { color: var(--color-ink-500); text-decoration: none; }
.kvw-breadcrumb a:hover { color: var(--color-primary-600); text-decoration: underline; }
.kvw-breadcrumb li + li::before { content: "/"; margin-inline-end: var(--space-2); color: var(--color-earth-300); }
.kvw-breadcrumb [aria-current="page"] { color: var(--color-ink-700); font-weight: 500; }
`;
