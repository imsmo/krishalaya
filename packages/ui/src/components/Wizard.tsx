// packages/ui/src/components/Wizard.tsx · DEV-18 (Phase D3, packages/ui port batch 4 — specialized
// components). Ports `.kvw-wizard-shell` (promoted at HAND-2 from ad-hoc usage — `web-components.css` line
// 711, census bucket (c), 5 real consumers: W113-115 tenant signup wizard, W265-266 partner onboarding, all
// ≥5-use promotion threshold per `hand2_component_census.json`'s own `promotion_candidates_used_5_or_more_
// times` list) + `.kvw-stepper`/`.kvw-step` (web-components.css lines 298-309, "STEPPER (wizards /
// maker-checker flows)"), matching the real canon demo (`web-component-library.html` lines 242-247: a
// 4-step KYC → Bank account → Plan selection → Go live stepper) and the wizard-shell demo (lines 486-490:
// a full-bleed topbar + content area, "Step 1 of 4 · Create account").
//
// TWO EXPORTS, one file (mirrors DEV-17's AppShell+ImpersonationBanner / Topbar+Avatar sub-export
// precedent — `Stepper` is the wizard's own step-indicator, always used INSIDE a `Wizard` shell in canon,
// never standalone):
//   - `Wizard`: the full-bleed `.kvw-wizard-shell` page layout (a wizard replaces the console's normal
//     Sidebar+Topbar chrome entirely per its own canon markup — the demo's `.kvw-wizard-shell` contains
//     ONLY a topbar + centered content, no sidebar at all).
//   - `Stepper`: the `.kvw-stepper`/`.kvw-step` progress indicator, a slot a caller places inside `Wizard`'s
//     content (or anywhere else needing a step indicator, e.g. a maker-checker approval flow per the
//     canon's own section heading "STEPPER (wizards / maker-checker flows)" — not wizard-exclusive).
//
// Server-safe: pure presentational, zero hooks, zero event-handler props on native elements — no
// `'use client'` needed.
import * as React from 'react';

export interface WizardProps {
  /** Rendered inside `.kvw-topbar` at the top of the shell — typically a brand mark + step-progress text
   * (e.g. "Step 1 of 4 · Create account", matching the canon demo verbatim) — a full caller-composed slot,
   * never baked copy (Law 3). */
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** `.kvw-wizard-shell` — a full-bleed page layout replacing the console chrome for a signup/onboarding
 * flow (canon's own real usage: W113-115, W265-266). `.kvw-wizard-body` (the centered content region) is an
 * ENGINEERING ADDITION, not a canon class — the demo achieves the same centering with an inline style
 * (`web-component-library.html` line 489: `style="flex:1;display:flex;align-items:center;justify-content:
 * center"`); promoted to a real class here so a consumer doesn't have to re-type that inline style, same
 * visual result, zero new value invented (every declaration is copied from that exact inline style). */
export function Wizard({ header, children, className }: WizardProps): React.ReactElement {
  return (
    <div className={['kvw-wizard-shell', className || ''].filter(Boolean).join(' ')}>
      {header ? <div className="kvw-topbar" style={{ position: 'static' }}>{header}</div> : null}
      <div className="kvw-wizard-body">{children}</div>
    </div>
  );
}

export interface WizardStep {
  key: string;
  /** Caller-i18n-resolved step label (Law 3), e.g. "KYC" / "Bank account". */
  label: string;
  status: 'complete' | 'active' | 'upcoming';
  /** Rendered inside `.n` for a complete step — canon's own demo uses a checkmark glyph; caller-supplied so
   * this component never bakes a specific glyph/locale-direction assumption (e.g. an RTL tenant may prefer
   * a different affordance). Falls back to the step's own 1-based index when omitted. */
  completeMark?: React.ReactNode;
}

export interface StepperProps {
  steps: WizardStep[];
  /** Accessible name for the whole indicator (gate 10 — the canon's own markup has no implicit landmark
   * name; rendered as `aria-label` on a `<nav>` wrapper around the steps). */
  label: string;
  className?: string;
}

/** `.kvw-stepper`/`.kvw-step`/`.n` — ported verbatim from `web-components.css` lines 298-309. Canon's own
 * demo renders plain `<div>`s (no landmark, no current-step signalling) — this component adds a `<nav>`
 * wrapper + `aria-current="step"` on the active item as a disclosed a11y enhancement (same class of
 * addition as `Sidebar.tsx`'s `.kvw-nav-landmark` at DEV-17), zero visual change. */
export function Stepper({ steps, label, className }: StepperProps): React.ReactElement {
  return (
    <nav aria-label={label} className={['kvw-stepper', className || ''].filter(Boolean).join(' ')}>
      {steps.map((step, i) => (
        <div
          key={step.key}
          className={['kvw-step', step.status === 'complete' ? 'is-complete' : '', step.status === 'active' ? 'is-active' : ''].filter(Boolean).join(' ')}
          aria-current={step.status === 'active' ? 'step' : undefined}
        >
          <span className="n">{step.status === 'complete' ? (step.completeMark ?? i + 1) : i + 1}</span>
          {' '}{step.label}
        </div>
      ))}
    </nav>
  );
}

/** CSS fragment. `.kvw-wizard-shell` ported verbatim from `web-components.css` line 711 (HAND-2 promotion —
 * see header comment). `.kvw-stepper`/`.kvw-step`/`.n` ported verbatim from lines 298-309. */
export const wizardStyles = `
.kvw-wizard-shell { min-height: 100vh; display: flex; flex-direction: column; background: var(--surface-page); }
.kvw-wizard-body { flex: 1; display: flex; align-items: center; justify-content: center; padding: var(--web-page-pad); }
.kvw-stepper { display: flex; gap: var(--space-2); margin-block-end: var(--space-6); }
.kvw-step { flex: 1; display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-xs); font-weight: 600; color: var(--color-ink-400); }
.kvw-step .n {
  width: 24px; height: 24px; flex: none; display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--radius-full); border: 2px solid var(--border-default); background: var(--surface-card);
}
.kvw-step::after { content: ""; flex: 1; height: 2px; background: var(--border-subtle); }
.kvw-step:last-child::after { display: none; }
.kvw-step.is-complete { color: var(--color-primary-700); }
.kvw-step.is-complete .n { background: var(--color-primary-600); border-color: var(--color-primary-600); color: var(--color-text-inverse); }
.kvw-step.is-complete::after { background: var(--color-primary-600); }
.kvw-step.is-active { color: var(--color-ink-700); }
.kvw-step.is-active .n { border-color: var(--color-primary-600); color: var(--color-primary-700); }
`;
