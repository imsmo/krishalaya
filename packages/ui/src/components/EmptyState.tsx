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
//
// `children` (DEV-60, UI Port Program batch 3, Part 2): the built-in `actionLabel`/`onAction` slot is a single
// plain `<button onClick>` — real web-admin call sites census'd this batch need MORE than that: `not-found.tsx`
// needs a navigation action (`<Button as={Link}>`, not a client `onClick`), and `error.tsx`'s boundary needs
// TWO actions (retry + re-auth). Rather than work around this in the app (the brief's own instruction: "if a
// needed variant is missing from the package, ADD IT"), `children` is accepted as an additional, optional slot
// rendered after the built-in title/body/action — callers needing a real `<Button as={Link}>`/multiple actions
// render their own markup via `children`; the simple single-`onClick` case keeps using `actionLabel`/`onAction`
// unchanged. Same "additive, non-breaking, canon-true" discipline as Chip's own `children`-as-alternative-to-
// `label` addition at DEV-59.
//
// `titleAs` (DEV-61 Part 0, fixing a DEV-60 QA-escalated P0 candidate): `title` rendered as a plain
// `<div className="title">`, never a heading tag, which is CANON-EXACT for this component's typical inline
// usage — `web-component-library.html` lines 220-233/271 are the only real canon markup for
// `.kvw-card.kvw-table-state`, and every one of them uses `<div class="title">`, never `<h*>`, because those
// cards are always inline content on a page that already carries its OWN `<h1>`/`.kvw-page-title` elsewhere
// (Law 4: canon is the spec, and canon genuinely has no heading-tag example here to copy). But two REAL
// call sites use `EmptyState` as an entire page's content with no other heading anywhere on that page —
// `apps/web-admin/src/app/not-found.tsx`/`error.tsx` — and both previously rendered a real `<h1>` before the
// DEV-60 conversion; losing it is a genuine regression (a screen-reader user navigating by heading, the `H`
// key, finds nothing on a 404/error page), named explicitly in `DEV_TRACKER.md`'s "DEV-60 QA" STATE block.
// `titleAs` defaults to `'div'` (byte-identical output for every existing/typical consumer — zero risk of
// the "needs a CSS audit across every consumer" blast radius QA flagged) and is opt-in: a caller whose
// `EmptyState` IS the page passes `titleAs="h1"` (or `"h2"` for a state nested under its own section heading)
// explicitly. The CSS below resets user-agent heading margin/font-size for every heading tag this prop can
// produce, so choosing a heading element changes ONLY the accessibility tree, never a rendered pixel — the
// correct fix shape per WCAG 1.3.1 / WAI-ARIA-APG ("a heading must be a real heading element whenever it
// functions as a landmark, not a styled div"), not a blind global default that would risk exactly the
// visual regression QA warned against.
import * as React from 'react';

export type EmptyStateVariant = 'empty' | 'error' | 'denied' | 'flagged-off';
export type EmptyStateTitleTag = 'div' | 'h1' | 'h2' | 'h3' | 'h4';

export interface EmptyStateProps {
  /** Drives ARIA role (error → `alert`, everything else → `status`) and the `kvw-state-error` marker
   * class the canon itself applies on error cards (`web-component-library.html` line 225) — no dedicated
   * CSS rule backs that marker class in web-components.css (grep-verified), it is carried here only
   * because the canon markup itself carries it; callers may hook it for future styling. */
  variant?: EmptyStateVariant;
  title: string;
  /** Heading tag for `title` (DEV-61). Defaults to `'div'` — canon-exact for inline/table-state usage.
   * Pass `'h1'`/`'h2'` when this `EmptyState` is the page's own heading (e.g. a 404/error boundary with no
   * other heading on the page) — see header comment for the full a11y grounding. */
  titleAs?: EmptyStateTitleTag;
  body?: string;
  /** Caller-supplied, `aria-hidden` (decorative) — canon renders either inline SVG or a plain glyph. */
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  /** Additional action(s) rendered after the built-in action (DEV-60) — use when a caller needs navigation
   * (`as={Link}`) or more than one action; not mutually exclusive with `actionLabel`/`onAction`. */
  children?: React.ReactNode;
  className?: string;
}

export function EmptyState(props: EmptyStateProps): React.ReactElement {
  const { variant = 'empty', title, titleAs = 'div', body, icon, actionLabel, onAction, children, className } = props;
  const role = variant === 'error' ? 'alert' : 'status';
  const classes = [
    'kvw-card',
    'kvw-table-state',
    variant === 'error' ? 'kvw-state-error' : '',
    className || '',
  ].filter(Boolean).join(' ');
  const Title = titleAs;

  return (
    <div className={classes} role={role} data-kv-component="empty-state" data-kv-variant={variant}>
      {icon ? <div className="icon" aria-hidden="true">{icon}</div> : null}
      <Title className="title">{title}</Title>
      {body ? <div className="body">{body}</div> : null}
      {actionLabel && onAction ? (
        <button type="button" className="kvw-btn kvw-btn-secondary kvw-btn-sm" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
      {children ?? null}
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
/* DEV-61 Part 0: when \`titleAs\` renders a real heading tag (h1-h4) instead of the canon-exact \`<div>\`,
   reset every user-agent heading default (font-size/margin/line-height) so the choice of tag changes ONLY
   the accessibility tree, never a rendered pixel — see EmptyState.tsx header comment for the full grounding. */
.kvw-table-state h1.title, .kvw-table-state h2.title, .kvw-table-state h3.title, .kvw-table-state h4.title {
  font-size: inherit; font-weight: 700; margin: 0 0 var(--space-1); line-height: inherit;
}
.kvw-table-state .body { font-size: var(--text-sm); color: var(--color-ink-500); margin-block-end: var(--space-4); }
`;
