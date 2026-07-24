// packages/ui/src/components/KpiCard.tsx · DEV-16 (Phase D3, packages/ui port batch 2 — data display).
// Ports canon classes `.kvw-card`/`.kvw-kpi`/`.label`/`.value`/`.value.money`/`.delta`/`.delta.up`/
// `.delta.down` verbatim from
// `Phase-1 all screen design/Krishi_Verse_Design_System/system/web/web-components.css` lines 394-400
// (`.kvw-card` base itself lines 148-152) + dark-mode AA text-role overrides lines 533/542, matching a
// REAL canon usage (`W128-tenant-listings-bulk.html` lines 85-88: 4-up `.kvw-grid.kvw-grid-4` of
// `<div class="kvw-card kvw-kpi">` stat cards) — not invented markup.
//
// Golden Law 2/3: `value` is a caller-PRE-FORMATTED display string (e.g. already run through `MoneyText`/
// `Intl.NumberFormat`, or a plain count) — this component never formats currency or computes a delta
// itself, it only renders what it is given. `label`/`deltaLabel` are 100% caller-i18n-resolved (Q52: no
// baked vocabulary — "vs last month", "flagged for review" etc. are all caller strings).
import * as React from 'react';

export type KpiDeltaDirection = 'up' | 'down';

export interface KpiCardProps {
  /** Caller-i18n-resolved stat name (e.g. "Rows in file", canon W128 line 85). */
  label: string;
  /** Caller-PRE-FORMATTED display value — never computed/formatted in here (Law 2/3). */
  value: string;
  /** Applies `.value.money` (monospace/tabular numerals) — set when `value` is a money string. */
  isMoney?: boolean;
  /** Caller-i18n-resolved delta/context text (e.g. "kharif_listings_jul.xlsx", "+12% vs last month"). */
  deltaLabel?: string;
  /** Drives `.delta.up`/`.delta.down` color only — a UI-styling hint, not business vocabulary. */
  deltaDirection?: KpiDeltaDirection;
  icon?: React.ReactNode;
  className?: string;
}

export function KpiCard(props: KpiCardProps): React.ReactElement {
  const { label, value, isMoney, deltaLabel, deltaDirection, icon, className } = props;
  const valueClass = ['value', isMoney ? 'money' : ''].filter(Boolean).join(' ');
  const deltaClass = ['delta', deltaDirection || ''].filter(Boolean).join(' ');

  return (
    <div className={['kvw-card', 'kvw-kpi', className || ''].filter(Boolean).join(' ')} data-kv-component="kpi-card">
      <span className="label">{label}</span>
      <span className={valueClass}>{value}</span>
      {deltaLabel ? (
        <span className={deltaClass}>
          {icon}
          {deltaLabel}
        </span>
      ) : null}
    </div>
  );
}

/** CSS fragment. `.kvw-card` base ported verbatim from web-components.css lines 148-152 (byte-identical
 * duplicate of `EmptyState.tsx`'s own `.kvw-card` rule — disclosed, same "safe to load twice" pattern as
 * DEV-15's precedent). `.kvw-kpi` block ported verbatim from lines 394-400; dark overrides from 533/542.
 * QA-FIX [2026-07-25]: `box-shadow: var(--shadow-lip, none);` (canon line 151) restored, same fix as
 * `EmptyState.tsx`'s own `.kvw-card` duplicate — see that file's header comment. */
export const kpiCardStyles = `
.kvw-card {
  background: var(--surface-card); border: 1px solid var(--border-default);
  border-radius: var(--radius-lg); padding: var(--space-5);
  box-shadow: var(--shadow-lip, none);
}
.kvw-kpi { display: flex; flex-direction: column; gap: var(--space-1); }
.kvw-kpi .label { font-size: var(--text-xs); font-weight: 550; color: var(--color-ink-500); }
.kvw-kpi .value { font-family: var(--font-display); font-size: var(--text-3xl); font-weight: 700; letter-spacing: -0.01em; }
.kvw-kpi .value.money { font-family: var(--font-mono); }
.kvw-kpi .delta { font-size: var(--text-xs); font-weight: 700; display: inline-flex; align-items: center; gap: var(--space-1); }
.kvw-kpi .delta.up { color: var(--color-success-dark); }
.kvw-kpi .delta.down { color: var(--color-danger-dark); }
[data-theme="dark"] .kvw-kpi .delta.up { color: var(--color-success-text-dark); }
[data-theme="dark"] .kvw-kpi .delta.down { color: var(--color-danger-text-dark); }
`;
