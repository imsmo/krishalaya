// apps/mobile/src/app/(auth)/language.tsx · screen 02 (Choose Language) — rebuilt to match the Phase-1 design
// (Krishalaya_Design_System/screens/02-language.html): a trilingual hero ("Choose Your Language" + अपनी भाषा
// चुनें + તમારી ભાષા પસંદ કરો + "you can change this anytime"), then three language CARDS — each a circular
// script avatar (अ / A / ગ), the native name, a romanised descriptor, and a check badge when selected — and a
// bilingual "Continue / आगे बढ़ें" CTA. Selecting a card applies the language LIVE (the i18n runtime re-renders
// every consumer) and persists it; Continue → phone. Pure presentation over core/auth + i18n; no fetch → no
// loading/empty/error states (Law 12: still cannot throw). Tokens-only; ≥48px targets; a11y radio semantics.
import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LANGUAGES } from '@krishalaya/i18n';
import { Button, Icon, color, font, space, radius, shadow } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useAuth } from '../../core/auth/auth.store';

// Script avatar glyph per language (matches the design's अ / A / ગ).
const AVATAR: Record<string, string> = { hi: 'अ', en: 'A', gu: 'ગ' };

export default function LanguageScreen() {
  const router = useRouter();
  const { t, lang } = useTranslation();
  const { setLanguage } = useAuth();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero — trilingual title + reassurance */}
        <View style={styles.hero}>
          <Text style={styles.title}>{t('language.title')}</Text>
          <Text style={styles.titleHi}>{t('language.titleHi')}</Text>
          <Text style={styles.titleGu}>{t('language.titleGu')}</Text>
          <Text style={styles.hint}>{t('language.subtitle')}</Text>
        </View>

        {/* Language cards */}
        <View style={styles.cards}>
          {LANGUAGES.map((l) => {
            const active = l.code === lang;
            return (
              <Pressable
                key={l.code}
                onPress={() => setLanguage(l.code)}
                style={[styles.card, active && styles.cardActive]}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${l.nameNative} — ${l.nameEnglish}`}
              >
                <View style={[styles.avatar, active && styles.avatarActive]}>
                  <Text style={[styles.avatarGlyph, active && styles.avatarGlyphActive]}>{AVATAR[l.code] ?? l.nameNative[0]}</Text>
                </View>
                <View style={styles.cardText}>
                  <Text style={styles.native}>{l.nameNative}</Text>
                  <Text style={styles.romanised}>{t(`language.sub.${l.code}`)}</Text>
                </View>
                {active ? (
                  <View style={styles.check}><Icon name="check" size={16} color={color.white} weight={3} /></View>
                ) : (
                  <View style={styles.radio} />
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Button title={t('language.continueBi')} size="lg" onPress={() => router.push('/(auth)/phone')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  scroll: { flexGrow: 1, paddingTop: space[10], paddingHorizontal: space[6] },

  hero: { marginBottom: space[6] },
  title: { fontFamily: font.display, fontSize: font.size['3xl'], fontWeight: font.weight.bold, color: color.ink800, letterSpacing: -0.5, lineHeight: 36 },
  titleHi: { fontFamily: font.vernacular, fontSize: font.size.xl, fontWeight: font.weight.semibold, color: color.primary700, marginTop: space[1] },
  titleGu: { fontFamily: font.vernacular, fontSize: font.size.xl, fontWeight: font.weight.semibold, color: color.primary700, marginTop: 2 },
  hint: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500, marginTop: space[3] },

  cards: { gap: space[3] },
  card: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.earth200, backgroundColor: color.card },
  cardActive: { borderColor: color.primary600, backgroundColor: color.primary50, ...shadow.card },
  avatar: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  avatarActive: { backgroundColor: color.primary600 },
  avatarGlyph: { fontFamily: font.vernacular, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.primary700 },
  avatarGlyphActive: { color: color.white },
  cardText: { flex: 1, minWidth: 0 },
  native: { fontFamily: font.body, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  romanised: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2 },
  check: { width: 28, height: 28, borderRadius: radius.pill, backgroundColor: color.primary600, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 28, height: 28, borderRadius: radius.pill, borderWidth: 2, borderColor: color.earth300 },

  actions: { paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[4] },
});
