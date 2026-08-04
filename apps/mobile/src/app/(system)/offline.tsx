// apps/mobile/src/app/(system)/offline.tsx · screen 188 (offline fallback) — rebuilt to the Phase-1 design
// (screens/188-offline.html): a 📡 hero, a "Still works offline" checklist, a "Need internet" note, and
// Use-Offline / Retry-Connection actions. A global fallback (Law 12) — static, no backend. Connectivity is read
// live (NetInfo); queued writes replay automatically when it returns (sync engine). Degrade-never-die.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useConnectivity } from '../../core/connectivity/connectivity';

const WORKS = ['listings', 'orders', 'tips', 'draft', 'sms'] as const;

export default function Offline() {
  const { t } = useTranslation();
  const router = useRouter();
  const online = useConnectivity();

  return (
    <ScreenScaffold
      title={t('system.offline.title')}
      scroll
      footer={
        <View style={styles.footer}>
          <View style={{ flex: 1 }}><Button title={t('system.offline.useOffline')} variant="outline" onPress={() => router.back()} /></View>
          <View style={{ flex: 1 }}><Button title={`↻ ${t('system.offline.retry')}`} onPress={() => { if (online) router.back(); }} /></View>
        </View>
      }
    >
      {/* Hero */}
      <View style={styles.hero}>
        <Text style={styles.heroIcon}>📡</Text>
        <Text style={styles.heroTitle}>{online ? t('system.offline.back') : t('system.offline.heading')}</Text>
        <Text style={styles.heroSub}>{t('system.offline.message')}</Text>
      </View>

      {/* Still works offline */}
      <Card style={styles.okCard}>
        <Text style={styles.okTitle}>{`✓ ${t('system.offline.stillTitle')}`}</Text>
        {WORKS.map((k) => (
          <View key={k} style={styles.row}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.rowText}>{t(`system.offline.works.${k}`)}</Text>
          </View>
        ))}
      </Card>

      {/* Need internet */}
      <Card style={styles.warnCard}>
        <Text style={styles.warnTitle}>{`⚠ ${t('system.offline.needTitle')}`}</Text>
        <Text style={styles.warnText}>{t('system.offline.need')}</Text>
      </Card>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space[2], padding: space[5], borderRadius: radius.lg, backgroundColor: color.earth100, marginBottom: space[2] },
  heroIcon: { fontSize: 48 },
  heroTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, textAlign: 'center' },
  heroSub: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600, textAlign: 'center' },
  okCard: { marginTop: space[3], backgroundColor: color.successLight },
  okTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.successDark, marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], paddingVertical: space[1] },
  bullet: { fontFamily: font.body, fontSize: font.size.md, color: color.successDark, lineHeight: 22 },
  rowText: { flex: 1, fontFamily: font.body, fontSize: font.size.md, color: color.ink700, lineHeight: 22 },
  warnCard: { marginTop: space[3], backgroundColor: color.warningLight },
  warnTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.warningDark, marginBottom: space[1] },
  warnText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, lineHeight: 20 },
  footer: { flexDirection: 'row', gap: space[3] },
});
