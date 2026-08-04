// apps/mobile/src/app/(owner)/notif-settings.tsx · screen 160 (Notification Settings). Thin screen (guide §3): a
// read-only, sectioned view of the tenant's alert configuration — Critical alerts, Daily digest, Farmer/buyer SMS
// limits — that hands off to the web console to view/edit. Behind `tenant_admin_lite`. Degrade-never-die.
// (Personal device notification prefs live in the user's OWN settings, not here.)
//
// §13 (NOT faked): the section headings + handoff copy are fixed i18n chrome. Every DATUM the mockup shows — the
// per-alert channel mixes ("Push + Email + SMS", "Large transactions >₹50K"), the digest schedule ("8 AM summary",
// "Weekly Mon · PDF"), the SMS quota ("10,000 / month · 8,420 used"), and the DLT sender ID ("ANDFPO") — is
// TENANT-LEVEL notification config with NO mobile read-model; the mobile comm surface only exposes a USER's own
// prefs/quiet-hours, not the tenant's alert-routing rules or SMS-provider quota/sender registration. So we DON'T
// fabricate any of it: each section shows a "viewed & managed on the web console" line and the CTA opens the
// bounded, audited console. When a tenant notif-config read contract ships, this renders the real values.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Button, Card, EmptyState, ScreenScaffold, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { openWebConsole } from '../../core/deeplink';
import { WEB_PATHS } from '../../features/tenant/web-console';

const SECTIONS = [
  { key: 'critical', icon: '🚨' },
  { key: 'digest', icon: '📊' },
  { key: 'sms', icon: '📱' },
] as const;

export default function NotifSettings() {
  const { t } = useTranslation();
  const enabled = useFlag('tenant_admin_lite');
  const [busy, setBusy] = useState(false);

  const openWeb = useCallback(async () => {
    setBusy(true);
    try { const ok = await openWebConsole(WEB_PATHS.notifications); if (!ok) Alert.alert(t('owner.notifSettings.heading'), t('owner.web.unavailable')); }
    finally { setBusy(false); }
  }, [t]);

  if (!enabled) return <ScreenScaffold title={t('owner.notifSettings.heading')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold
      title={t('owner.notifSettings.heading')}
      scroll
      footer={<Button title={t('owner.notifSettings.manageWeb')} loading={busy} onPress={openWeb} />}
    >
      <View style={{ gap: space[3] }}>
        {SECTIONS.map((s) => (
          <Card key={s.key}>
            <View style={styles.row}>
              <Text style={styles.icon}>{s.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{t(`owner.notifSettings.${s.key}.title`)}</Text>
                <Text style={styles.desc}>{t(`owner.notifSettings.${s.key}.desc`)}</Text>
              </View>
            </View>
          </Card>
        ))}
        <Text style={styles.note}>{t('owner.notifSettings.webNote')}</Text>
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  icon: { fontSize: font.size['2xl'] },
  title: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  desc: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[1] },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center', marginTop: space[1] },
});
