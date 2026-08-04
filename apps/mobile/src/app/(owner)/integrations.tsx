// apps/mobile/src/app/(owner)/integrations.tsx · screen 161 (Integrations). Thin screen (guide §3): a read-only,
// sectioned view of the tenant's integrations — Connected, Available to connect, Developer API access — that hands
// off to the web console to view/connect. Behind `tenant_admin_lite`. Degrade-never-die.
//
// §13 (NOT faked): the section headings + handoff copy are fixed i18n chrome. The mockup's connected-integration
// list & live status ("NABARD ✓ auto-submit", "GSTN GSTR-1 auto-filed", "eNAM live feed", "IMD 15-min refresh"),
// the available-to-connect catalogue (Tally/Zoho, Delhivery/Porter, KCC loan APIs, FSSAI labs), and the Developer
// "API access · REST · Webhooks · Scale tier" row are per-tenant integration STATE + a connect flow that writes
// provider SECRETS — connecting an integration is a web-console + SERVER-authorised capability and secrets are
// NEVER entered/shown on mobile (§4, Law 11). There's no mobile read-model for per-tenant connection status. So we
// DON'T fabricate any of it: each section shows a "viewed & managed on the web console" line and the CTA opens the
// bounded, audited console. When a tenant integrations read contract ships, this renders the real connection state.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Button, Card, EmptyState, ScreenScaffold, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { openWebConsole } from '../../core/deeplink';
import { WEB_PATHS } from '../../features/tenant/web-console';

const SECTIONS = [
  { key: 'connected', icon: '🔌' },
  { key: 'available', icon: '➕' },
  { key: 'developer', icon: '🔑' },
] as const;

export default function Integrations() {
  const { t } = useTranslation();
  const enabled = useFlag('tenant_admin_lite');
  const [busy, setBusy] = useState(false);

  const openWeb = useCallback(async () => {
    setBusy(true);
    try { const ok = await openWebConsole(WEB_PATHS.integrations); if (!ok) Alert.alert(t('owner.integrations.heading'), t('owner.web.unavailable')); }
    finally { setBusy(false); }
  }, [t]);

  if (!enabled) return <ScreenScaffold title={t('owner.integrations.heading')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold
      title={t('owner.integrations.heading')}
      scroll
      footer={<Button title={t('owner.integrations.manageWeb')} loading={busy} onPress={openWeb} />}
    >
      <View style={{ gap: space[3] }}>
        {SECTIONS.map((s) => (
          <Card key={s.key}>
            <View style={styles.row}>
              <Text style={styles.icon}>{s.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{t(`owner.integrations.${s.key}.title`)}</Text>
                <Text style={styles.desc}>{t(`owner.integrations.${s.key}.desc`)}</Text>
              </View>
            </View>
          </Card>
        ))}
        <Text style={styles.note}>{t('owner.integrations.webNote')}</Text>
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
