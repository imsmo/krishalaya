// apps/mobile/src/app/(system)/tutorial.tsx · screen 186 (app tour) — rebuilt to the Phase-1 design
// (screens/186-tutorial.html): a centered icon + title + body, an optional example quote (the Speak-to-Sell step),
// a "Step N of 5" progress line, and Skip-Tour / Next actions. Thin screen (guide §3): a static, paged intro to the
// app's core actions — no backend. Degrade-never-die.
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';

// The tour's fixed steps (UI chrome — copy lives in i18n). `example` shows the localized sample voice line.
const STEPS: { key: string; icon: string; example?: boolean }[] = [
  { key: 'sell', icon: '🌾' },
  { key: 'speak', icon: '🎤', example: true },
  { key: 'buy', icon: '🛒' },
  { key: 'pay', icon: '💰' },
  { key: 'help', icon: '🆘' },
];

export default function Tutorial() {
  const { t } = useTranslation();
  const router = useRouter();
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const finish = () => router.back();

  return (
    <ScreenScaffold
      title={t('system.tutorial.title')}
      footer={
        <View style={styles.footer}>
          <View style={{ flex: 1 }}><Button title={t('system.tutorial.skip')} variant="ghost" onPress={finish} /></View>
          <View style={{ flex: 1 }}><Button title={last ? t('system.tutorial.done') : t('common.next')} onPress={() => (last ? finish() : setI((n) => n + 1))} /></View>
        </View>
      }
    >
      <View style={styles.body}>
        <Text style={styles.icon}>{step.icon}</Text>
        <Text style={styles.h}>{t(`system.tutorial.${step.key}.title`)}</Text>
        <Text style={styles.desc}>{t(`system.tutorial.${step.key}.body`)}</Text>
        {step.example ? (
          <View style={styles.quote}><Text style={styles.quoteText}>{t(`system.tutorial.${step.key}.example`)}</Text></View>
        ) : null}
      </View>

      <View style={styles.dots}>
        {STEPS.map((s, n) => <View key={s.key} style={[styles.dot, n === i && styles.dotActive]} />)}
      </View>
      <Text style={styles.step}>{t('system.tutorial.stepOf', { n: i + 1, total: STEPS.length })}</Text>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', paddingVertical: space[6], gap: space[3] },
  icon: { fontSize: 64 },
  h: { fontFamily: font.display, fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: color.ink900, textAlign: 'center' },
  desc: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600, textAlign: 'center', lineHeight: 24 },
  quote: { marginTop: space[2], padding: space[4], borderRadius: radius.md, backgroundColor: color.primary50, alignSelf: 'stretch' },
  quoteText: { fontFamily: font.body, fontSize: font.size.md, fontStyle: 'italic', color: color.primary700, textAlign: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space[2], marginTop: space[2] },
  dot: { width: 8, height: 8, borderRadius: 999, backgroundColor: color.ink200 },
  dotActive: { backgroundColor: color.primary600, width: 20 },
  step: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, textAlign: 'center', marginTop: space[2] },
});
