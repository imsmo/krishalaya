// apps/mobile/src/app/(system)/language.tsx · screen 187 (language switcher) — rebuilt to the Phase-1 design
// (screens/187-language-switcher.html): a 🌐 hero, the supported languages (Gujarati / Hindi / English, in design
// order) each with a sub-label and a ✓ on the active one, a disabled "coming soon" row per target language, a
// "Language settings" group, and Apply. Picking a language applies + persists INSTANTLY via the auth store
// (matches "changes instantly · no app restart"); Apply just confirms and returns. Static (no backend) — renders
// regardless of flags.
//
// §13 (NOT faked): only the registry's SUPPORTED languages (hi/en/gu) are selectable — every target language is
// shown as a real disabled "coming soon" row (never selectable/faked). The "Language settings" switches
// (SMS-in-language / voice-TTS / English-for-technical-terms) have no per-user persistence contract yet, so
// they're LOCAL toggles here (honest UI, not saved server-side) — they'll bind to a preference endpoint when one
// lands.
//
// DEV-21: extended from a single hardcoded "coming soon" row (Marathi only) to the FULL 11-language target set
// from the shared `@krishi-verse/i18n` registry (`COMING_SOON_LANGUAGES`) — native name + script rendered
// directly from the registry (never a per-language translated string, since a native name IS the same string in
// every locale). Dropped the previous Marathi row's invented "Coming Q1 2027" date claim (no rollout date is
// known/verified for ANY of the 11 target languages — Golden Law 12, "no fabricated metric presented as current
// fact") in favor of one honest, generic "Coming soon" sub-label shared by all 11 rows.
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { LANGUAGES, COMING_SOON_LANGUAGES } from '@krishi-verse/i18n';
import { Button, Card, StatusPill, Toggle, ScreenScaffold, color, font, space, radius } from '@krishi-verse/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useAuth } from '../../core/auth/auth.store';
import { orderedLanguageCodes, languageSubKey } from '../../features/system/system';

const SETTINGS = ['sms', 'tts', 'english'] as const;

export default function LanguageSwitcher() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const { setLanguage } = useAuth();
  const [opts, setOpts] = useState<Record<string, boolean>>({ sms: true, tts: true, english: false });

  const byCode = new Map(LANGUAGES.map((l) => [l.code, l]));
  const ordered = orderedLanguageCodes(LANGUAGES.map((l) => l.code));

  return (
    <ScreenScaffold
      title={t('system.language.title')}
      scroll
      footer={<Button title={t('system.language.apply')} onPress={() => router.back()} />}
    >
      {/* Hero */}
      <View style={styles.hero}>
        <Text style={styles.heroIcon}>🌐</Text>
        <Text style={styles.heroTitle}>{t('system.language.heroTitle')}</Text>
        <Text style={styles.heroSub}>{t('system.language.heroSub')}</Text>
      </View>

      {/* Supported languages */}
      <View style={{ gap: space[2], marginTop: space[2] }}>
        {ordered.map((code) => {
          const l = byCode.get(code)!;
          const on = code === lang;
          return (
            <Pressable key={code} onPress={() => setLanguage(code)} accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Card style={[styles.card, on && styles.cardOn]}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{l.nameNative}</Text>
                    <Text style={styles.sub}>{t(languageSubKey(code))}</Text>
                  </View>
                  {on ? <Text style={styles.check}>✓</Text> : null}
                </View>
              </Card>
            </Pressable>
          );
        })}

        {/* Coming soon (disabled) — the full 11-language target set, straight from the shared registry. Native
            name/script are DATA (same string in every locale), never a per-language translated key. */}
        {COMING_SOON_LANGUAGES.map((l) => (
          <Card key={l.code} style={styles.card}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, styles.soonName]}>{l.nameNative}</Text>
                <Text style={styles.sub}>{l.nameEnglish} · {t('system.language.comingSoonSub')}</Text>
              </View>
              <StatusPill label={t('system.language.soonBadge')} tone="neutral" />
            </View>
          </Card>
        ))}
      </View>

      {/* Language settings */}
      <Text style={styles.section}>{t('system.language.settings')}</Text>
      <Card>
        {SETTINGS.map((k) => (
          <Toggle key={k} label={t(`system.language.opt.${k}`)} value={!!opts[k]} onValueChange={(v) => setOpts((o) => ({ ...o, [k]: v }))} />
        ))}
      </Card>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space[2], padding: space[5], borderRadius: radius.lg, backgroundColor: color.primary50 },
  heroIcon: { fontSize: 44 },
  heroTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, textAlign: 'center' },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, textAlign: 'center' },
  card: { borderWidth: 1.5, borderColor: color.ink100, borderRadius: radius.lg },
  cardOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  name: { fontFamily: font.body, fontSize: font.size.lg, fontWeight: font.weight.semibold, color: color.ink800 },
  soonName: { color: color.ink500 },
  sub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2 },
  check: { fontFamily: font.body, fontSize: font.size.lg, color: color.primary700 },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[5], marginBottom: space[2] },
});
