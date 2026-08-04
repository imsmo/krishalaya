// apps/mobile/src/app/(owner)/compliance.tsx · screen 81 (Compliance & Reports). Thin screen (guide §3): the
// regulatory-reports / audit-trail / inspections surface. NONE of this has a mobile data contract, so every item is
// a validated hand-off to the web admin console (Law 11 lite boundary; core/deeplink degrades if the console isn't
// openable). Behind `tenant_admin_lite`.
//
// §13 (NOT faked): the section + item TITLES (NABARD / GST / RBI / minimum-wage / activity logs / consent records)
// are fixed UI chrome (i18n). Every DYNAMIC value in the mockup is DROPPED because no contract exposes it and we
// must not fabricate a compliance claim: the "All compliant · No issues" status banner, "Last audit 5 days ago /
// Next Sep 15", the per-report due/filed lines ("Q2 · Due in 12 days", "Last filed Aug 11 · Filed", "Auto-submitted",
// "All 412 worker bookings paid ≥ state min"), the audit counts ("8,247 entries", "1,247 farmers · DPDP compliant"),
// and the "Recent inspections ✓ Pass ✓ Pass ✓ Pass" results — a green "all-pass" compliance assertion with no source
// would be the most dangerous fake on the whole app. Each item instead opens the real compliance console.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ScrollView } from 'react-native';
import { Card, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { openWebConsole } from '../../core/deeplink';
import { WEB_PATHS } from '../../features/tenant/web-console';

const SECTIONS: { key: string; items: { key: string; icon: string }[] }[] = [
  { key: 'reports', items: [
    { key: 'nabard', icon: '📋' }, { key: 'gst', icon: '💼' }, { key: 'rbi', icon: '🏛️' }, { key: 'minwage', icon: '📊' },
  ] },
  { key: 'audit', items: [
    { key: 'logs', icon: '🔒' }, { key: 'consent', icon: '📜' },
  ] },
  { key: 'inspections', items: [
    { key: 'history', icon: '🏢' },
  ] },
];

export default function Compliance() {
  const { t } = useTranslation();
  const enabled = useFlag('tenant_admin_lite');
  const [busy, setBusy] = useState(false);

  if (!enabled) return <ScreenScaffold title={t('owner.compliance.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const open = async () => {
    setBusy(true);
    try { if (!(await openWebConsole(WEB_PATHS.compliance))) Alert.alert(t('owner.compliance.title'), t('owner.web.unavailable')); }
    finally { setBusy(false); }
  };

  return (
    <ScreenScaffold title={t('owner.compliance.title')} scroll={false}>
      <ScrollView contentContainerStyle={{ gap: space[4], paddingBottom: space[6] }} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>{t('owner.compliance.webNote')}</Text>
        {SECTIONS.map((s) => (
          <View key={s.key} style={{ gap: space[2] }}>
            <Text style={styles.section}>{t(`owner.compliance.${s.key}.title`)}</Text>
            {s.items.map((it) => (
              <Pressable key={it.key} onPress={open} disabled={busy} accessibilityRole="button" accessibilityLabel={t(`owner.compliance.item.${it.key}`)}>
                <Card style={styles.row}>
                  <Text style={styles.icon}>{it.icon}</Text>
                  <Text style={styles.itemTitle}>{t(`owner.compliance.item.${it.key}`)}</Text>
                  <Text style={styles.chev}>{'›'}</Text>
                </Card>
              </Pressable>
            ))}
          </View>
        ))}
        <Text style={styles.hint}>{t('owner.web.hint')}</Text>
      </ScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  intro: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, lineHeight: font.size.sm * 1.5 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  icon: { fontSize: font.size.lg },
  itemTitle: { flex: 1, fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  chev: { fontFamily: font.body, fontSize: font.size.xl, color: color.ink400 },
  hint: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center' },
});
