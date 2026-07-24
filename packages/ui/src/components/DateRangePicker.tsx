// packages/ui/src/components/DateRangePicker.tsx · DEV-17 (Phase D3, packages/ui port batch 3 —
// navigation/layout primitives). Ports the HAND-2 date-RANGE picker verbatim from `web-components.css`
// lines 605-634 (`.kvw-datepicker-range`/`.kvw-daterange-bar`/`.kvw-daterange-field`/`.kvw-daterange-arrow`/
// `.kvw-daterange-body`/`.kvw-range-presets`/`.kvw-range-preset`/`.kvw-cal-month`) PLUS the pre-existing
// base `.kvw-datepicker`/`.kvw-cal`/`.day`/`.day.in-range`/`.day.is-selected`/`.day.is-today` rules those
// range rules compose with (HAND-2's own header comment: "reusing the EXISTING … rules verbatim, zero
// changes to those" — lines 610-613), matching the real canon demo (`web-component-library.html` lines
// 370-38x: linked "From"/"To" inputs + a mirroring arrow icon + a `role="group"` preset-chip column).
//
// STATIC PATTERN, PER THE BRIEF: linked inputs + preset chips are a REAL, complete port (structure, a11y,
// tokens). The two-month CALENDAR GRID (day-cell computation, month navigation, click-to-set-range logic)
// is EXPLICITLY the brief's own "interactive calendar logic = honest minimum, boundary stated" — this
// component does NOT compute calendar days itself (that is real date-math/interaction scope this batch does
// not claim); it ships the CSS (`.kvw-cal-month`/`.month-label` + the base `.kvw-datepicker`/`.kvw-cal`/
// `.day*` rules) so a future screen can render real day cells with those exact classes, and exposes an
// optional `calendar` slot for that content — never fabricating a calendar-day engine to look "done".
import * as React from 'react';

export interface DateRangePreset {
  key: string;
  /** Caller-i18n-resolved label, e.g. "Last 7 days" (Law 3). */
  label: string;
  active?: boolean;
  onSelect: () => void;
}

export interface DateRangePickerProps {
  fromLabel: string;
  /** Already-formatted, caller-supplied display value (e.g. "01 Jul 2026") — this component invents no
   * date-formatting/locale logic (Law 3: date formatting is a caller/i18n concern, not baked here). */
  fromValue: string;
  fromInputId?: string;
  toLabel: string;
  toValue: string;
  toInputId?: string;
  presets: readonly DateRangePreset[];
  /** Accessible name for the presets `role="group"`, e.g. "Quick ranges" (Law 3 slot). */
  presetsGroupLabel: string;
  /** OPTIONAL two-month calendar grid slot — see header comment; this component ships the CSS classes for
   * it (`.kvw-cal-month` etc.) but does not compute day cells itself. */
  calendar?: React.ReactNode;
  className?: string;
}

export function DateRangePicker({
  fromLabel, fromValue, fromInputId = 'kv-daterange-from', toLabel, toValue, toInputId = 'kv-daterange-to',
  presets, presetsGroupLabel, calendar, className,
}: DateRangePickerProps): React.ReactElement {
  return (
    <div className={['kvw-datepicker', 'kvw-datepicker-range', className || ''].filter(Boolean).join(' ')}>
      <div className="kvw-daterange-bar">
        <div className="kvw-daterange-field">
          <label htmlFor={fromInputId}>{fromLabel}</label>
          <input className="kvw-input" id={fromInputId} value={fromValue} readOnly />
        </div>
        <span className="kvw-daterange-arrow" aria-hidden="true">
          <svg className="icon-mirrors" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
        <div className="kvw-daterange-field">
          <label htmlFor={toInputId}>{toLabel}</label>
          <input className="kvw-input" id={toInputId} value={toValue} readOnly />
        </div>
      </div>
      <div className="kvw-daterange-body">
        <div className="kvw-range-presets" role="group" aria-label={presetsGroupLabel}>
          {presets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className="kvw-range-preset"
              aria-pressed={!!preset.active}
              onClick={preset.onSelect}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {calendar}
      </div>
    </div>
  );
}

/** CSS fragment. Range-specific rules ported verbatim from `web-components.css` lines 614-634; base
 * `.kvw-datepicker`/`.kvw-cal`/`.day*` rules (lines 314-326) duplicated here under the same disclosed
 * "safe to load twice" precedent since `DateRangePicker` composes `.kvw-datepicker.kvw-datepicker-range`
 * (the range modifier alone is not self-sufficient — it depends on the base class's box/shadow/padding). */
export const dateRangePickerStyles = `
.kvw-datepicker { width: 280px; background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); padding: var(--space-3); }
.kvw-datepicker .head { display: flex; align-items: center; justify-content: space-between; font-weight: 700; font-size: var(--text-sm); margin-block-end: var(--space-2); }
.kvw-cal { width: 100%; border-collapse: collapse; font-size: var(--text-xs); text-align: center; }
.kvw-cal th { color: var(--color-ink-400); font-weight: 600; padding: var(--space-1); }
.kvw-cal td { padding: 2px; }
/* QA-FIX [2026-07-25]: this fragment's own header comment claims the base .kvw-cal .day rule is
   "duplicated here under the same disclosed 'safe to load twice' precedent" (i.e. byte-identical to
   web-components.css line 319) but it was NOT -- dimensions (28px vs canon's 32px), shape (--radius-sm
   vs canon's --radius-full, a rounded-square vs a true circle), and 3 declarations
   (border: none; background: transparent; font-weight: 500;) were silently dropped, a real canon-
   fidelity gap (gate 7 / Law 4): a future screen filling the optional calendar slot with real
   button.day day-cells would render square 28px buttons with default browser button
   chrome (visible border/background) instead of canon's 32px true-circle day cells. Restored byte-true
   to web-components.css line 319-322. */
.kvw-cal .day {
  width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--radius-full); cursor: pointer; border: none; background: transparent; font-weight: 500;
}
.kvw-cal .day:hover { background: var(--color-earth-100); }
.kvw-cal .day.is-selected { background: var(--color-primary-600); color: var(--color-text-inverse); }
.kvw-cal .day.in-range { background: var(--color-primary-50); border-radius: 0; }
.kvw-cal .day.is-today { box-shadow: inset 0 0 0 1px var(--color-primary-600); }
.kvw-datepicker-range { width: min(640px, 92vw); }
.kvw-daterange-bar { display: flex; align-items: flex-end; gap: var(--space-3); margin-block-end: var(--space-3); }
.kvw-daterange-field { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.kvw-daterange-field label { font-size: var(--text-xs); font-weight: 600; color: var(--color-ink-400); }
.kvw-daterange-field .kvw-input { min-height: 32px; font-size: var(--text-xs); }
.kvw-daterange-arrow { flex: none; color: var(--color-ink-400); padding-block-end: var(--space-2); display: inline-flex; }
.kvw-daterange-body { display: flex; gap: var(--space-4); align-items: flex-start; }
.kvw-range-presets { display: flex; flex-direction: column; gap: var(--space-1); padding-inline-end: var(--space-3); border-inline-end: 1px solid var(--border-subtle); flex: none; min-width: 132px; }
.kvw-cal-month { flex: 1; min-width: 0; }
.kvw-cal-month .month-label { font-size: var(--text-xs); font-weight: 700; text-align: center; color: var(--color-ink-500); margin-block-end: var(--space-2); }
.kvw-range-preset {
  display: block; width: 100%; text-align: start; border: none; background: transparent; cursor: pointer;
  padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm);
  font-family: inherit; font-size: var(--text-xs); font-weight: 500; color: var(--color-ink-600);
}
.kvw-range-preset:hover { background: var(--color-earth-100); }
.kvw-range-preset:focus-visible { outline: none; box-shadow: var(--web-focus-ring); }
.kvw-range-preset[aria-pressed="true"] { background: var(--color-primary-50); color: var(--color-primary-700); font-weight: 600; }
[data-theme="dark"] .kvw-range-preset[aria-pressed="true"] { color: var(--color-primary-400); }
/* .icon-mirrors — the canon's own RTL icon-mirroring utility (web-components.css lines 481-490: applies to
   the 18 rows tagged MIRRORS in that file's own table, including the "arrow" family this component's
   from/to connector icon belongs to), duplicated here under the same disclosed "safe to load twice"
   precedent (needed by the arrow svg above, not previously exported by any DEV-15/16 fragment). */
.icon-mirrors { transform: none; }
[dir="rtl"] .icon-mirrors { transform: scaleX(-1); }
`;
