// apps/mobile/src/app/(owner)/payment-settings.tsx · screen 159 (Payment Gateway Settings). Thin screen (guide
// §3): a read-only, sectioned view of the tenant's payment configuration — Active gateways, Settlement rules,
// Tenant receivables bank — that hands off to the web console to VIEW/EDIT. Behind `tenant_admin_lite`.
// FLAG_SECURE (money + bank screen, §4). Degrade-never-die.
//
// §13 (NOT faked): the section headings + the quiet-hours/handoff copy are fixed i18n chrome. Every DATUM the
// mockup shows — gateway list & fees ("Razorpay 2.0%", "PhonePe 0.4%", "SBI 0.5%", "COD ₹25"), settlement rules
// (escrow "3 days", auto-payout "T+0", platform fee "2.5%", TDS "1%", GST), and the tenant receivables bank
// ("Anand FPO", "SBI XXXX 4782", "IFSC SBIN0001247") — is SENSITIVE tenant money/bank config with NO mobile
// read-model, and editing payment routing / moving money is a web-console + SERVER-authorised capability (Law 11,
// the app never configures money movement). Bank details are DPDP-masked, never plaintext (§4). So we DON'T
// fabricate any of it: each section shows a "viewed & managed on the web console" line, and the CTA opens the
// bounded, audited console. When a tenant-facing read contract ships, this renders the real (masked) values.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Button, Card, EmptyState, ScreenScaffold, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useSecureScreen } from '../../core/security/screen-guard';
import { openWebConsole } from '../../core/deeplink';
import { WEB_PATHS } from '../../features/tenant/web-console';

const SECTIONS = [
  { key: 'gateways', icon: '💳' },
  { key: 'settlement', icon: '📊' },
  { key: 'bank', icon: '🏦' },
] as const;

export default function PaymentSettings() {
  const { t } = useTranslation();
  const enabled = useFlag('tenant_admin_lite');
  useSecureScreen(); // FLAG_SECURE — payment + bank config
  const [busy, setBusy] = useState(false);

  const openWeb = useCallback(async () => {
    setBusy(true);
    try { const ok = await openWebConsole(WEB_PATHS.paymentSettings); if (!ok) Alert.alert(t('owner.paymentSettings.heading'), t('owner.web.unavailable')); }
    finally { setBusy(false); }
  }, [t]);

  if (!enabled) return <ScreenScaffold title={t('owner.paymentSettings.heading')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold
      title={t('owner.paymentSettings.heading')}
      scroll
      footer={<Button title={t('owner.paymentSettings.manageWeb')} loading={busy} onPress={openWeb} />}
    >
      <View style={{ gap: space[3] }}>
        {SECTIONS.map((s) => (
          <Card key={s.key} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.icon}>{s.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{t(`owner.paymentSettings.${s.key}.title`)}</Text>
                <Text style={styles.desc}>{t(`owner.paymentSettings.${s.key}.desc`)}</Text>
              </View>
            </View>
          </Card>
        ))}
        <Text style={styles.note}>{t('owner.paymentSettings.webNote')}</Text>
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  card: {},
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  icon: { fontSize: font.size['2xl'] },
  title: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  desc: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[1] },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center', marginTop: space[1] },
});
