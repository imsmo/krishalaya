// packages/ui/src/components/Input.tsx · DEV-15 (Phase D3, packages/ui port batch 1).
// Ports canon classes `.kvw-field` / `.kvw-label` / `.kvw-label-required` / `.kvw-input` / `.kvw-helper` /
// `.kvw-error-text` / `.kvw-input-money` / `.kvw-input-affix` verbatim from
// `Phase-1 all screen design/Krishi_Verse_Design_System/system/web/web-components.css` lines 43-74.
//
// Golden Law 3: a money-affixed input NEVER hardcodes "₹" or a 3-letter currency code in markup. Canon's
// own mechanism is a CSS `content: var(--currency-symbol)` token (screen-scoped, static per locale). This
// component generalizes that into a runtime-safe equivalent: `Intl.NumberFormat(locale, {style:'currency',
// currency}).formatToParts(0)` derives the real symbol/code for whatever currency is passed — proven by
// this file's own test to render both ₹ (INR) and AED correctly, never a baked default.
import * as React from 'react';

export interface InputMoneyAffix {
  /** ISO 4217 currency code, e.g. "INR" | "AED" — never assumed, always passed by the caller. */
  currencyCode: string;
  /** 'symbol' (₹, $) vs 'code' (AED, SAR) — BRAND-024 disambiguation rule: some currencies have no
   * unambiguous bare glyph, so the caller decides which display form applies. */
  display?: 'symbol' | 'code';
  /** BCP-47 locale used to resolve the symbol/code (default 'en-IN'). */
  locale?: string;
}

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  id: string;
  label: string;
  helperText?: string;
  /** When set, renders as an error state (`aria-invalid`, `.kvw-error-text`) instead of `helperText`. */
  errorText?: string;
  /** Renders the canon `.kvw-input-money` numeric styling (tabular figures, end-aligned). */
  money?: InputMoneyAffix;
}

function resolveCurrencyAffix(money: InputMoneyAffix): string {
  const locale = money.locale ?? 'en-IN';
  const parts = new Intl.NumberFormat(locale, { style: 'currency', currency: money.currencyCode }).formatToParts(0);
  const currencyPart = parts.find((p) => p.type === 'currency');
  if (money.display === 'code') return money.currencyCode;
  return currencyPart ? currencyPart.value : money.currencyCode;
}

export function Input(props: InputProps): React.ReactElement {
  const { id, label, helperText, errorText, money, required, className, ...rest } = props;
  const helperId = helperText ? `${id}-helper` : undefined;
  const errorId = errorText ? `${id}-error` : undefined;
  const describedBy = [helperId, errorId].filter(Boolean).join(' ') || undefined;

  const input = (
    <input
      {...rest}
      id={id}
      required={required}
      aria-invalid={errorText ? true : undefined}
      aria-describedby={describedBy}
      className={['kvw-input', money ? 'kvw-input-money' : '', className || ''].filter(Boolean).join(' ')}
    />
  );

  return (
    <div className="kvw-field">
      <label className={['kvw-label', required ? 'kvw-label-required' : ''].filter(Boolean).join(' ')} htmlFor={id}>
        {label}
      </label>
      {money ? (
        <span className="kvw-input-affix">
          {/* Not aria-hidden: a screen-reader user needs the currency announced too (gate 10) — it precedes
             the input in DOM order, so it reads naturally as "<symbol/code> <label>, edit text". */}
          <span className="affix">{resolveCurrencyAffix(money)}</span>
          {input}
        </span>
      ) : input}
      {errorText ? (
        <p id={errorId} className="kvw-error-text" role="alert">{errorText}</p>
      ) : helperText ? (
        <p id={helperId} className="kvw-helper">{helperText}</p>
      ) : null}
    </div>
  );
}

/** CSS fragment, ported verbatim from web-components.css lines 43-74 (selectors/structure byte-identical). */
export const inputStyles = `
.kvw-field { display: flex; flex-direction: column; gap: var(--space-1); margin-block-end: var(--space-4); }
.kvw-label { font-size: var(--text-sm); font-weight: 600; color: var(--color-ink-700); }
.kvw-label-required::after { content: " *"; color: var(--color-danger); }
.kvw-input {
  min-height: var(--web-control-h); padding-inline: var(--space-3);
  border: 1px solid var(--border-default); border-radius: var(--radius-md);
  background: var(--surface-card); color: var(--color-ink-700);
  font-family: inherit; font-size: var(--text-sm); width: 100%;
}
.kvw-input:focus-visible {
  outline: none; border-color: var(--color-primary-600); box-shadow: var(--web-focus-ring);
}
.kvw-input[aria-invalid="true"] { border-color: var(--color-danger); }
.kvw-helper { font-size: var(--text-xs); color: var(--color-ink-400); }
.kvw-error-text { font-size: var(--text-xs); color: var(--color-danger); font-weight: 500; }
.kvw-input-money { font-family: var(--font-mono); font-weight: 700; text-align: end; }
.kvw-input-affix { position: relative; display: flex; align-items: center; }
.kvw-input-affix .affix {
  position: absolute; inset-inline-start: var(--space-3);
  color: var(--color-ink-400); font-size: var(--text-sm); pointer-events: none;
}
.kvw-input-affix .kvw-input { padding-inline-start: var(--space-8); }
`;
