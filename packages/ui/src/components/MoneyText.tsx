// packages/ui/src/components/MoneyText.tsx · DEV-15 (Phase D3, packages/ui port batch 1).
// LAW 3 FLAGSHIP. Ports canon classes `.kvw-money` / `.kvw-money small` / `.kvw-money.in` / `.kvw-money.out`
// / `.kvw-money-code` verbatim from
// `Phase-1 all screen design/Krishi_Verse_Design_System/system/web/web-components.css` lines 60/74/142-145.
//
// Golden Law 2 (money is BIGINT + explicit currency_code, never a float/assumed ₹) and Golden Law 3
// (currency renders through the locale/token formatter, NEVER a hardcoded literal): this component takes
// `amountMinor` (the smallest currency unit — paise/fils, matching the ledger's own `amount_minor BIGINT`
// column) + `currencyCode` (ISO 4217) — there is NO `₹` literal, NO default currency, and NO fallback symbol
// anywhere in this file. Proven by `MoneyText.test.tsx`: the exact same component renders correctly for INR
// AND AED from the SAME code path.
//
// DEV-26/Q15: the actual formatting now delegates to `@krishi-verse/i18n`'s `formatMoneyMinor` — the platform's
// ONE canonical money formatter (mobile's `packages/ui-native/MoneyText.tsx` already used it; this web
// component previously hand-rolled its own `Number(amountMinor) / 10**exponent` conversion, which silently lost
// precision for any amount beyond `Number.MAX_SAFE_INTEGER` — a real Law-2 gap, now closed, with ZERO change to
// this component's own public props/output). The `locale` prop stays a raw BCP-47 Intl tag (unchanged contract
// for every existing caller) and is passed through via `formatMoneyMinor`'s `opts.intlLocale` escape hatch —
// `@krishi-verse/i18n`'s own `formatMoneyMinor` normally takes a LANGUAGE_REGISTRY code, not a raw Intl locale,
// so a full prop-signature unification with mobile's `MoneyText` was evaluated and rejected here (it would have
// silently changed behavior for the `locale='ja-JP'`/`'ar-AE'` style callers this component's own tests exercise)
// — the underlying bigint-exact/no-float ALGORITHM is now shared; only the two components' distinct
// locale-parameter conventions remain separate, disclosed rather than silently forced together.
import * as React from 'react';
import { formatMoneyMinor } from '@krishi-verse/i18n';

export interface MoneyTextProps {
  /** Smallest currency unit (paise/fils/etc.) — matches the ledger's `amount_minor BIGINT` column exactly.
   * Accepts `bigint` directly (Law 2 native type) or `number` for already-JS-safe call sites. */
  amountMinor: number | bigint;
  /** ISO 4217 currency code — always required, there is no default (Law 3: never assume ₹). */
  currencyCode: string;
  /** BCP-47 locale for Intl formatting (default 'en-IN'; pass the screen's active locale for real i18n). */
  locale?: string;
  /** 'in' (credit, canon success-green) / 'out' (debit, canon neutral ink) — a UI tone hint only, not a
   * business meaning encoded here; the ledger's own sign/type decides which to pass. */
  direction?: 'in' | 'out';
  /** BRAND-024 symbol-vs-code disambiguation: force ISO-code display (e.g. "AED 1,250") instead of the
   * locale-default symbol for currencies with no unambiguous glyph. Defaults to Intl's own 'symbol'. */
  currencyDisplay?: 'symbol' | 'code';
  /** Small trailing caption (canon `.kvw-money small`, e.g. "excl. fees") — plain caller-supplied text. */
  suffix?: string;
  className?: string;
}

export function MoneyText(props: MoneyTextProps): React.ReactElement {
  const { amountMinor, currencyCode, locale = 'en-IN', direction, currencyDisplay = 'symbol', suffix, className } = props;

  // Bigint-exact, no float at any step (DEV-26/Q15) — see this file's header for why this delegates to
  // `@krishi-verse/i18n`'s canonical formatter instead of its own former `Number(amountMinor)` conversion.
  const formatted = formatMoneyMinor(BigInt(amountMinor), currencyCode, undefined, { currencyDisplay, intlLocale: locale });

  const classes = ['kvw-money', direction || '', className || ''].filter(Boolean).join(' ');

  return (
    <span className={classes} data-kv-component="money-text" data-currency={currencyCode}>
      {formatted}
      {suffix ? <small>{suffix}</small> : null}
    </span>
  );
}

/** CSS fragment, ported verbatim from web-components.css lines 60/74/142-145 (`.kvw-money`/`small`/`.in`/
 * `.out`/`.kvw-money-code`, cited in this file's header). `.kvw-input-money` (canon line 60) is ALSO
 * emitted here — it is the same rule Input.tsx exports (and cites in its own header, lines 43-74) for its
 * money-affixed text input; MoneyText re-emits it verbatim (byte-identical, not re-typed) because a
 * `.kvw-money`-only consumer that never renders `<Input money=…>` still needs this rule for numeric
 * end-alignment. Duplicate-but-identical, same "safe to load twice" pattern AiBadge.tsx documents for its
 * shared `.kvw-badge-ai` rule with StatusPill.tsx — disclosed here, not a silent citation gap. */
export const moneyTextStyles = `
.kvw-money { font-family: var(--font-mono); font-weight: 700; font-variant-numeric: tabular-nums; }
.kvw-money small { font-family: var(--font-body-en); font-weight: 500; color: var(--color-ink-400); }
.kvw-money.in { color: var(--color-success-dark); }
.kvw-money.out { color: var(--color-ink-700); }
[data-theme="dark"] .kvw-money.in { color: var(--color-success-text-dark); }
.kvw-input-money { font-family: var(--font-mono); font-weight: 700; text-align: end; }
.kvw-money-code::before { content: var(--currency-code-display); }
`;
