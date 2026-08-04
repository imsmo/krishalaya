// packages/ui-native/src/components/MoneyText.tsx · renders money from bigint MINOR-unit strings (Law 2 — never
// a float, never a JS number that could lose precision past 2^53). Delegates the actual formatting to
// @krishalaya/i18n's formatMoneyMinor (Indian lakh/crore grouping, locale-aware). The component only owns
// presentation (size/tone).
import React from 'react';
import { StyleSheet, Text, TextStyle } from 'react-native';
import { formatMoneyMinor } from '@krishalaya/i18n';
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

export function MoneyText({ minor, currencyCode = 'INR', langCode = 'en', size = 'lg', tone = 'default', style, testID }: MoneyTextProps) {
  let text: string;
  try { text = formatMoneyMinor(minor, currencyCode, langCode); }
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
