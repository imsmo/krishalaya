// packages/ui/src/components/Callout.tsx · DEV-16 (Phase D3, packages/ui port batch 2 — data display).
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
import * as React from 'react';

export type CalloutTone = 'warning' | 'info' | 'danger' | 'success';

export interface CalloutProps {
  tone?: CalloutTone;
  children: React.ReactNode;
  className?: string;
}

export function Callout({ tone = 'warning', children, className }: CalloutProps): React.ReactElement {
  const classes = [
    'kvw-callout',
    tone !== 'warning' ? `kvw-callout-${tone}` : '',
    className || '',
  ].filter(Boolean).join(' ');
  return (
    <div className={classes} role="note" data-kv-component="callout">
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
