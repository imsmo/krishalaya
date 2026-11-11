// apps/mobile/src/core/i18n/LanguageShell.tsx · PC-56 RTL-1h-1 · the two language lines the app shell (src/app/_layout.tsx) shows
// above every screen:
//  - MachineDraftBanner: whenever the language on screen is Arabic (a machine draft, not reviewed) — one Arabic line and one
//    English line, as the web storefront does. Never under en/hi/gu.
//  - LanguageRestartNotice: after a person chose a language that only takes over on the next open (into or out of Arabic,
//    Q1 → A) — "Close and reopen Krishalaya to switch to …". Shown from any picker that saved such a choice.
import React, { useSyncExternalStore } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { color, font, space } from '@krishalaya/ui-native';
import { i18n } from './i18n';
import { useTranslation } from './useTranslation';
import { restartNoticeText } from './languageChoice';

const BANNER_KEY = 'shell.draftBanner';

export function MachineDraftBanner() {
  const { t, lang } = useTranslation();
  if (lang !== 'ar') return null;
  return (
    <View style={styles.banner} accessibilityRole="alert" testID="machine-draft-banner">
      <Text style={[styles.text, styles.rtl]}>{t(BANNER_KEY)}</Text>
      <Text style={[styles.text, styles.ltr]}>{i18n.english(BANNER_KEY)}</Text>
    </View>
  );
}

export function LanguageRestartNotice() {
  const { t } = useTranslation();
  const pending = useSyncExternalStore((cb) => i18n.subscribe(cb), () => i18n.pending, () => i18n.pending);
  if (!pending) return null;
  return (
    <View style={styles.notice} accessibilityRole="alert" testID="language-restart-notice">
      <Text style={styles.text}>{restartNoticeText(pending, t)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingVertical: space[2], paddingHorizontal: space[4], backgroundColor: color.primary50, gap: 2 },
  notice: { paddingVertical: space[2], paddingHorizontal: space[4], backgroundColor: color.primary50 },
  text: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink800 },
  rtl: { writingDirection: 'rtl' },
  ltr: { writingDirection: 'ltr' },
});
