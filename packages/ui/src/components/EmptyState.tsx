// packages/ui/src/components/EmptyState.tsx · DEV-16 (Phase D3, packages/ui port batch 2 — data display).
// Ports canon classes `.kvw-card` (web-components.css lines 148-152) + `.kvw-table-state` (lines 226-229)
// verbatim, generalized to a standalone atom — the canon itself already uses this exact markup shape
// OUTSIDE a table (`web-component-library.html` lines 220-233's 3-card "States" grid; W128-tenant-listings-
// bulk.html lines 105-114's 6-card states section) so this is a real, cited canon pattern, not invented.
//
// Golden Law 3 (Q52): title/body/actionLabel are 100% caller-i18n-resolved slots. `icon` is a caller-
// supplied ReactNode (canon shows either an inline SVG or a plain emoji glyph depending on screen — never
// baked into this shared atom).
//
// DataTable (this same batch) composes THIS component for its empty/error/denied/flagged-off cell states
// ("EmptyState integration" per the DEV-16 brief) instead of re-implementing the state-card markup inline —
// one citation of `.kvw-table-state`, one place that gets it right.
import * as React from 'react';

export type EmptyStateVariant = 'empty' | 'error' | 'denied' | 'flagged-off';

export interface EmptyStateProps {
  /** Drives ARIA role (error → `alert`, everything else → `status`) and the `kvw-state-error` marker
   * class the canon itself applies on error cards (`web-component-library.html` line 225) — no dedicated
   * CSS rule backs that marker class in web-components.css (grep-verified), it is carried here only
   * because the canon markup itself carries it; callers may hook it for future styling. */
  variant?: EmptyStateVariant;
  title: string;
  body?: string;
  /** Caller-supplied, `aria-hidden` (decorative) — canon renders either inline SVG or a plain glyph. */
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyState(props: EmptyStateProps): React.ReactElement {
  const { variant = 'empty', title, body, icon, actionLabel, onAction, className } = props;
  const role = variant === 'error' ? 'alert' : 'status';
  const classes = [
    'kvw-card',
    'kvw-table-state',
    variant === 'error' ? 'kvw-state-error' : '',
    className || '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} role={role} data-kv-component="empty-state" data-kv-variant={variant}>
      {icon ? <div className="icon" aria-hidden="true">{icon}</div> : null}
      <div className="title">{title}</div>
      {body ? <div className="body">{body}</div> : null}
      {actionLabel && onAction ? (
        <button type="button" className="kvw-btn kvw-btn-secondary kvw-btn-sm" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

/** CSS fragment. `.kvw-card` ported verbatim from web-components.css lines 148-152 (base box only — the
 * full Card primitive incl. `.kvw-card-header`/`.kvw-card-title`/`.kvw-card-actions`/`.kvw-card-flush` is
 * deferred to a future layout-primitives batch [00_DEV_PENDING_MASTER.md DEV-17], out of this batch's data-
 * display scope; only the minimal box EmptyState/KpiCard need is ported here, disclosed, not invented).
 * `.kvw-table-state` ported verbatim from lines 226-229.
 * QA-FIX [2026-07-25]: `box-shadow: var(--shadow-lip, none);` (canon line 151) restored — it was dropped
 * from the initial port without disclosure even though `--shadow-lip` is a real, defined token
 * (web-tokens.css line 299), not a no-op fallback; now byte-true to the cited canon lines. */
export const emptyStateStyles = `
.kvw-card {
  background: var(--surface-card); border: 1px solid var(--border-default);
  border-radius: var(--radius-lg); padding: var(--space-5);
  box-shadow: var(--shadow-lip, none);
}
.kvw-table-state { padding: var(--space-10) var(--space-6); text-align: center; }
.kvw-table-state .icon { width: 40px; height: 40px; margin-inline: auto; color: var(--color-earth-300); margin-block-end: var(--space-3); }
.kvw-table-state .title { font-weight: 700; margin-block-end: var(--space-1); }
.kvw-table-state .body { font-size: var(--text-sm); color: var(--color-ink-500); margin-block-end: var(--space-4); }
`;
