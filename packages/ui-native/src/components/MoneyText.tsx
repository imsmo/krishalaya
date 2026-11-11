// packages/ui-native/src/components/MoneyText.tsx · renders money from bigint MINOR-unit strings (Law 2 — never
// a float, never a JS number that could lose precision past 2^53). Delegates the actual formatting to
// @krishalaya/i18n's formatMoneyMinor (Indian lakh/crore grouping, locale-aware). The component only owns
// presentation (size/tone).
//
// PC-56 RTL-1h-2: under a preview (right-to-left) language (Arabic) the amount prints in the INDIAN shape (the formatter's en →
// en-IN, "₹1,23,456.50" — the lead's money shape, as on web) wrapped in LRI…PDI (U+2066 … U+2069), so it stays one left-to-right
// run inside an Arabic screen. Under en/hi/gu the text is byte-identical to before (no marks). The rule follows
// @krishalaya/i18n's PREVIEW_LANGUAGES, not the literal "ar" (apps/mobile/src/core/i18n/money.ts is the same rule for text).
import React from 'react';
import { StyleSheet, Text, TextStyle } from 'react-native';
import { formatMoneyMinor, PREVIEW_LANGUAGES } from '@krishalaya/i18n';
import { color, font } from '../theme';

export interface MoneyTextProps {
  /** Amount in MINOR units as a string (e.g. "1245000" paise = ₹12,450.00). bigint also accepted. */
  minor: string | bigint;
  currencyCode?: string;
  langCode?: string;
  size?: keyof typeof font.size;
  tone?: 'default' | 'positive' | 'negative' | 'muted';
  style?: TextStyle;
  testID?: string;
}

const TONE: Record<NonNullable<MoneyTextProps['tone']>, string> = {
  default: color.ink800, positive: color.successDark, negative: color.dangerDark, muted: color.ink400,
};

const LRI = '\u2066';
const PDI = '\u2069';

/** The text MoneyText prints: the language's own shape under ltr; the Indian shape, isolated, under a preview (rtl) language. */
export function moneyTextFor(minor: string | bigint, currencyCode: string, langCode: string): string {
  const preview = PREVIEW_LANGUAGES.includes(langCode);
  const text = formatMoneyMinor(minor, currencyCode, preview ? 'en' : langCode);
  return preview ? `${LRI}${text}${PDI}` : text;
}

export function MoneyText({ minor, currencyCode = 'INR', langCode = 'en', size = 'lg', tone = 'default', style, testID }: MoneyTextProps) {
  let text: string;
  try { text = moneyTextFor(minor, currencyCode, langCode); }
  catch { text = '—'; }   // never throw in a render path (Law 12)
  return (
    <Text testID={testID} style={[styles.base, { fontSize: font.size[size], color: TONE[tone] }, style]} numberOfLines={1}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: { fontFamily: font.body, fontWeight: font.weight.bold },
});
