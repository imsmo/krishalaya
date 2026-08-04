// apps/mobile/src/app/(system)/permissions.tsx · screen 185 (permissions primer) — rebuilt to the Phase-1 design
// (screens/185-permissions.html): a 🔐 hero, a Required group (SMS / Camera / Microphone) and an Optional group
// (Location / Notifications), each row explaining WHY (store-compliant rationale, §8) with an Allow action, a
// privacy footer, and Skip-optional / Allow-All. Thin screen (guide §3). Static catalog (no backend) — renders
// regardless of flags. Degrade-never-die.
//
// §13 (NOT faked): granting a permission is an OS decision — this primer only EXPLAINS and routes to the OS prompt/
// app settings (the real allow/deny dialog is the platform's, requested at point-of-use). We never claim a grant
// the OS hasn't given. "Skip optional" simply leaves; the app keeps working without the optional permissions (Law 12).
import React from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { permissionsByGroup, permissionTitleKey, permissionWhyKey, type PermissionGroup, type PermissionItem } from '../../features/system/system';

export default function Permissions() {
  const { t } = useTranslation();
  const router = useRouter();
  const openSettings = () => { Linking.openSettings?.().catch(() => { /* best-effort; OS owns the grant */ }); };

  const Group = ({ group }: { group: PermissionGroup }) => (
    <>
      <Text style={styles.section}>{t(`system.permissions.group.${group}`)}</Text>
      <View style={{ gap: space[2] }}>
        {permissionsByGroup(group).map((p: PermissionItem) => (
          <Card key={p.key}>
            <View style={styles.row}>
              <Text style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">{p.icon}</Text>
              <View style={styles.texts}>
                <Text style={styles.title}>{t(permissionTitleKey(p.key))}</Text>
                <Text style={styles.why}>{t(permissionWhyKey(p.key))}</Text>
              </View>
              <Button title={t('system.permissions.allow')} size="md" variant="outline" onPress={openSettings} />
            </View>
          </Card>
        ))}
      </View>
    </>
  );

  return (
    <ScreenScaffold
      title={t('system.permissions.title')}
      scroll
      footer={
        <View style={styles.footer}>
          <View style={{ flex: 1 }}><Button title={t('system.permissions.skipOptional')} variant="outline" onPress={() => router.back()} /></View>
          <View style={{ flex: 1 }}><Button title={t('system.permissions.allowAll')} onPress={openSettings} /></View>
        </View>
      }
    >
      <View style={styles.hero}>
        <Text style={styles.heroIcon}>🔐</Text>
        <Text style={styles.heroTitle}>{t('system.permissions.heroTitle')}</Text>
        <Text style={styles.heroSub}>{t('system.permissions.heroSub')}</Text>
      </View>

      <Group group="required" />
      <Group group="optional" />

      <View style={styles.privacy}><Text style={styles.privacyText}>{t('system.permissions.privacyNote')}</Text></View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space[2], padding: space[5], borderRadius: radius.lg, backgroundColor: color.primary50, marginBottom: space[2] },
  heroIcon: { fontSize: 44 },
  heroTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, textAlign: 'center' },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, textAlign: 'center' },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  icon: { fontSize: 26 },
  texts: { flex: 1 },
  title: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  why: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2 },
  privacy: { marginTop: space[4], padding: space[3], borderRadius: radius.md, backgroundColor: color.earth100 },
  privacyText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, textAlign: 'center', lineHeight: 20 },
  footer: { flexDirection: 'row', gap: space[3] },
});
