// apps/mobile/src/app/(ambassador)/onboard-scan.tsx · screen 89 (Scan Farmer's Aadhaar). Thin screen (guide §3):
// the Aadhaar-QR scan step — instructions, a viewfinder frame with camera controls, a "QR won't scan" tip, and the
// Type-manually / Use-photo actions. Behind `ambassador_app`. Degrade-never-die.
//
// §13 (NOT faked): there is NO ambassador-assisted "create the farmer's account from a scanned Aadhaar / upload to
// UIDAI" endpoint — account creation is the farmer's own self-service OTP + KYC (P-01/P-03; admin user-create is
// back-office, Law 11), and no live QR-camera pipeline is wired for this flow. So the viewfinder is a designed
// placeholder and the camera affordances (flashlight / switch-camera / Use photo) surface a coming-soon notice
// rather than a fabricated scan-and-create; "Type manually" is the REAL path forward (→ verify, screen 90).
import React from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';

export default function OnboardScan() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('ambassador_app');
  if (!enabled) return <ScreenScaffold title={t('amb.onboard.scanTitle')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const soon = () => Alert.alert(t('amb.onboard.scanTitle'), t('amb.onboard.scan.cameraSoon'));

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('amb.onboard.scan.typeManually')} variant="outline" onPress={() => router.push('/(ambassador)/onboard-verify')} />
      <View style={{ flex: 1 }}><Button title={t('amb.onboard.scan.usePhoto')} onPress={soon} fullWidth /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('amb.onboard.scanTitle')} scroll={false} footer={footer}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[3] }}>
        <View>
          <Text style={styles.h}>{t('amb.onboard.scan.heading')}</Text>
          <Text style={styles.body}>{t('amb.onboard.scan.instruction')}</Text>
        </View>

        {/* Viewfinder — designed placeholder (no live camera pipeline wired; §13) */}
        <View style={styles.viewfinder} accessibilityRole="image" accessibilityLabel={t('amb.onboard.scan.align')}>
          <View style={styles.frame} />
          <Text style={styles.viewfinderHint}>📷 {t('amb.onboard.scan.align')}</Text>
          <View style={styles.controls}>
            <Pressable onPress={soon} accessibilityRole="button" style={styles.control}><Text style={styles.controlTxt}>💡 {t('amb.onboard.scan.flashlight')}</Text></Pressable>
            <Pressable onPress={soon} accessibilityRole="button" style={styles.control}><Text style={styles.controlTxt}>🔄 {t('amb.onboard.scan.switchCamera')}</Text></Pressable>
          </View>
        </View>

        {/* Tip */}
        <Card style={styles.tip}>
          <Text style={styles.tipIcon}>💡</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.tipTitle}>{t('amb.onboard.scan.tipTitle')}</Text>
            <Text style={styles.tipBody}>{t('amb.onboard.scan.tipBody')}</Text>
          </View>
        </Card>
      </ScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  h: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  body: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[1], lineHeight: font.size.sm * 1.5 },
  viewfinder: { backgroundColor: color.ink900, borderRadius: radius.lg, paddingVertical: space[6], paddingHorizontal: space[4], alignItems: 'center', gap: space[4] },
  frame: { width: '80%', aspectRatio: 1, borderWidth: 3, borderColor: color.accent, borderRadius: radius.lg, borderStyle: 'dashed' },
  viewfinderHint: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.white, textAlign: 'center' },
  controls: { flexDirection: 'row', gap: space[3] },
  control: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.white },
  controlTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.white },
  tip: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', backgroundColor: color.warningLight },
  tipIcon: { fontSize: 22 },
  tipTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.warningDark },
  tipBody: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, marginTop: 2, lineHeight: font.size.xs * 1.5 },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
