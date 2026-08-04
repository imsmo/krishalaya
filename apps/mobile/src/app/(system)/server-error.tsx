// apps/mobile/src/app/(system)/server-error.tsx · screen 189 (server-error fallback) — rebuilt to the Phase-1 design
// (screens/189-server-error.html): a 🛠 hero (heading + "Error 500 · Server hiccup" + reassurance), a "What you can
// do" checklist, an optional support Ref line, and Call-Helpline / Retry actions. The global 5xx fallback so a
// failed call NEVER white-screens (Law 12). Static, no backend. Degrade-never-die.
//
// §13 (NOT faked): the Ref shown is the REAL request/correlation id passed via `?ref=` from the SDK error (never a
// fabricated code) and only renders when present — never PII. "Call Helpline" has no support-phone in config, so it
// routes to the in-app Help screen (a real destination) rather than dialing an invented number.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Button, Card, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';

const DOS = ['wait', 'offline', 'voice'] as const;

export default function ServerError() {
  const { t } = useTranslation();
  const router = useRouter();
  const { ref } = useLocalSearchParams<{ ref?: string }>();

  return (
    <ScreenScaffold
      title={t('system.error.title')}
      scroll
      footer={
        <View style={styles.footer}>
          <View style={{ flex: 1 }}><Button title={`📞 ${t('system.error.callHelpline')}`} variant="outline" onPress={() => router.push('/(farmer)/profile/help')} /></View>
          <View style={{ flex: 1 }}><Button title={`↻ ${t('system.error.retry')}`} onPress={() => router.back()} /></View>
        </View>
      }
    >
      <View style={styles.hero}>
        <Text style={styles.heroIcon}>🛠</Text>
        <Text style={styles.heroTitle}>{t('system.error.heading')}</Text>
        <Text style={styles.heroSub}>{t('system.error.subtitle')}</Text>
        <Text style={styles.body}>{t('system.error.message')}</Text>
      </View>

      <Text style={styles.section}>{t('system.error.whatYouCan')}</Text>
      <Card>
        {DOS.map((k) => (
          <View key={k} style={styles.row}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.rowText}>{t(`system.error.do.${k}`)}</Text>
          </View>
        ))}
      </Card>

      {ref ? <Text style={styles.ref}>{t('system.error.ref', { ref })}</Text> : null}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space[2], padding: space[5], borderRadius: radius.lg, backgroundColor: color.dangerLight, marginBottom: space[2] },
  heroIcon: { fontSize: 48 },
  heroTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, textAlign: 'center' },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.danger, textAlign: 'center' },
  body: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600, textAlign: 'center', lineHeight: 22 },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], paddingVertical: space[1] },
  bullet: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500, lineHeight: 22 },
  rowText: { flex: 1, fontFamily: font.body, fontSize: font.size.md, color: color.ink700, lineHeight: 22 },
  ref: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center', marginTop: space[4] },
});
