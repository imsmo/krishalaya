// apps/mobile/src/app/(system)/app-update.tsx · screen 190 (app update) — rebuilt to the Phase-1 design
// (screens/190-app-update.html): a 🚀 hero (heading + version subtitle), a "What's new" section, a download-size
// line, and Skip / Update-Now actions. When the build is below the configured minimum (forced-update floor, §8)
// Skip is hidden. If the build is at/above the floor it shows the "you're up to date" state. Config-driven, no
// backend. Degrade-never-die.
//
// §13 (NOT faked): the target version shown is the REAL configured minimum-supported version (never the mock's
// "2.4.0"), and the version line is omitted if none is configured. The per-release changelog bullets and the
// "~18 MB" download size in the mock come from an app-release-notes service the mobile app has NO contract for yet,
// so we show an honest generic "latest improvements and bug fixes" line and omit the fabricated size — flagged here.
import React from 'react';
import { View, Text, StyleSheet, Linking, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { config } from '../../core/config';
import { isUpdateRequired } from '../../features/system/system';

export default function AppUpdate() {
  const { t } = useTranslation();
  const router = useRouter();
  const target = config.minSupportedVersion;
  const required = isUpdateRequired(config.appVersion, target);
  const upToDate = !!target && !required;
  const storeUrl = Platform.OS === 'ios' ? config.iosStoreUrl : config.androidStoreUrl;

  const openStore = () => {
    if (storeUrl && /^https:\/\//i.test(storeUrl)) Linking.openURL(storeUrl).catch(() => Alert.alert(t('system.update.title'), t('common.error.generic')));
    else Alert.alert(t('system.update.title'), t('system.update.noStore'));
  };

  if (upToDate) {
    return (
      <ScreenScaffold title={t('system.update.title')}>
        <Card>
          <Text style={styles.h}>{t('system.update.currentHeading')}</Text>
          <Text style={styles.body}>{t('system.update.currentBody')}</Text>
          <Text style={styles.ver}>{t('system.update.version', { v: config.appVersion })}</Text>
        </Card>
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold
      title={t('system.update.title')}
      scroll
      footer={
        <View style={styles.footer}>
          {!required ? <View style={{ flex: 1 }}><Button title={t('system.update.skip')} variant="outline" onPress={() => router.back()} /></View> : null}
          <View style={{ flex: required ? undefined : 2 }}><Button title={`📥 ${t('system.update.cta')}`} fullWidth={required} onPress={openStore} /></View>
        </View>
      }
    >
      <View style={styles.hero}>
        <Text style={styles.heroIcon}>🚀</Text>
        <Text style={styles.heroTitle}>{t('system.update.needHeading')}</Text>
        <Text style={styles.heroSub}>{target ? t('system.update.subtitle', { v: target }) : t('system.update.subtitleGeneric')}</Text>
      </View>

      <Text style={styles.section}>{t('system.update.whatsNew')}</Text>
      <Card><Text style={styles.notes}>{t('system.update.notesGeneric')}</Text></Card>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space[2], padding: space[5], borderRadius: radius.lg, backgroundColor: color.primary50, marginBottom: space[2] },
  heroIcon: { fontSize: 48 },
  heroTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, textAlign: 'center' },
  heroSub: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600, textAlign: 'center' },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  notes: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700, lineHeight: 22 },
  h: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900 },
  body: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700, marginTop: space[2], lineHeight: 22 },
  ver: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400, marginTop: space[3] },
  footer: { flexDirection: 'row', gap: space[3] },
});
