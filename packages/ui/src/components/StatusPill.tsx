// packages/ui/src/components/StatusPill.tsx · DEV-15 (Phase D3, packages/ui port batch 1).
// Ports canon classes `.kvw-badge` / `.kvw-badge-{success,warning,danger,info,ai,neutral}` verbatim from
// `Phase-1 all screen design/Krishi_Verse_Design_System/system/web/web-components.css` lines 121-134.
//
// Golden Law 3 (Q52 ruling: "vocabulary = master data, never an enum baked into a UI string"): this
// component owns ZERO business vocabulary. `tone` is a pure UI-styling hint (one of the 6 canon color
// classes — a design-system verb, not a status enum), and `label` is a caller-supplied string/i18n-key
// slot — the actual status TEXT ("Approved", "मंजूर", "Pending KYC" …) always comes from the calling
// screen's own i18n/master-data lookup, never a hardcoded switch inside this file.
import * as React from 'react';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'ai' | 'neutral';

export interface StatusPillProps {
  /** Caller-resolved display text (i18n key already resolved by the caller — never resolved in here). */
  label: string;
  tone?: StatusTone;
  /** Optional leading glyph — canon renders a plain 6px dot by default (`.dot`), any icon may replace it. */
  icon?: React.ReactNode;
  className?: string;
}

export function StatusPill({ label, tone = 'neutral', icon, className }: StatusPillProps): React.ReactElement {
  const classes = ['kvw-badge', `kvw-badge-${tone}`, className || ''].filter(Boolean).join(' ');
  return (
    <span className={classes} data-kv-component="status-pill">
      {icon ?? <span className="dot" aria-hidden="true" />}
      {label}
    </span>
  );
}

/** CSS fragment, ported verbatim from web-components.css lines 121-134. */
export const statusPillStyles = `
.kvw-badge {
  display: inline-flex; align-items: center; gap: var(--space-1);
  padding: 2px var(--space-2); border-radius: var(--radius-full);
  font-size: var(--text-xs); font-weight: 600; line-height: 1.6;
  background: var(--color-earth-200); color: var(--color-ink-600);
}
.kvw-badge svg, .kvw-badge .dot { width: 6px; height: 6px; border-radius: var(--radius-full); background: currentColor; }
.kvw-badge-success { background: var(--color-success-light); color: var(--color-success-dark); }
.kvw-badge-warning { background: var(--color-warning-light); color: var(--color-warning-dark); }
.kvw-badge-danger { background: var(--color-danger-light); color: var(--color-danger-dark); }
.kvw-badge-info { background: var(--color-info-light); color: var(--color-info-dark); }
.kvw-badge-ai { background: var(--color-ai-light); color: var(--color-ai-dark); }
.kvw-badge-neutral { background: var(--color-earth-200); color: var(--color-ink-500); }
/* Dark-mode text-role overrides, ported verbatim from web-components.css lines 534/538/543/547/551
   (APPLIED at APPLY-7 per G0-2 Q40 — the light-mode "-dark" semantic fails AA as TEXT on the dark card;
   these AA-corrected tokens are the canon fix, not a new decision made here). */
[data-theme="dark"] .kvw-badge-danger { color: var(--color-danger-text-dark); }
[data-theme="dark"] .kvw-badge-info { color: var(--color-info-text-dark); }
[data-theme="dark"] .kvw-badge-success { color: var(--color-success-text-dark); }
[data-theme="dark"] .kvw-badge-warning { color: var(--color-warning-text-dark); }
[data-theme="dark"] .kvw-badge-ai { color: var(--color-ai-text-dark); }
`;
