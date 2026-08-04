// apps/mobile/src/app/(owner)/worker-analytics.tsx · screen 152 (Worker Bookings Analytics). Thin screen (guide
// §3). Behind `tenant_admin_lite`. Degrade-never-die.
//
// §13 (NOT faked): the ENTIRE mockup — bookings-this-month (412), "↑24% vs Jul", ₹1.65L wages paid, 98% show-up
// rate, ⭐4.6 avg rating, ₹400 avg daily wage, 3 wage disputes, the Top-workers list (Sunita/Rajesh/Meena with jobs
// + ratings + ₹ earnings), the Most-booked-tasks breakdown (Wheat/Cotton/Weeding/Spraying with counts + %), and the
// "100% at/above ₹350 Gujarat minimum wage · 0 violations" compliance line — is a LABOUR/WORKER analytics dashboard
// for which there is NO tenant-scoped mobile read-model (the labour SDK exposes booking CRUD only, no aggregate).
// So the app fabricates NONE of it: it shows a designed notice and hands off to the web console (Download Report),
// where the report is generated server-side. When a tenant worker-analytics read-model ships, this screen renders it
// like the GMV/order analytics screens; until then it degrades honestly. Every read is tenant-scoped SERVER-SIDE.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { Card, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { openWebConsole } from '../../core/deeplink';
import { WEB_PATHS } from '../../features/tenant/web-console';

export default function WorkerAnalytics() {
  const { t } = useTranslation();
  const enabled = useFlag('tenant_admin_lite');
  const [busy, setBusy] = useState(false);

  const download = useCallback(async () => {
    setBusy(true);
    try { const ok = await openWebConsole(WEB_PATHS.export); if (!ok) Alert.alert(t('owner.workerAnalytics.title'), t('owner.web.unavailable')); }
    finally { setBusy(false); }
  }, [t]);

  if (!enabled) return <ScreenScaffold title={t('owner.workerAnalytics.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('owner.workerAnalytics.title')} scroll>
      <View style={{ gap: space[4] }}>
        <Card>
          <EmptyState title={t('owner.workerAnalytics.notice.title')} message={t('owner.workerAnalytics.notice.message')} />
        </Card>
        <Pressable disabled={busy} onPress={download} accessibilityRole="button" style={styles.export}>
          <Text style={styles.exportText}>{t('owner.workerAnalytics.export')} ↗</Text>
        </Pressable>
        <Text style={styles.lite}>{t('owner.workerAnalytics.webNote')}</Text>
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  export: { alignItems: 'center', paddingVertical: space[3], borderRadius: radius.md, backgroundColor: color.primary50 },
  exportText: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary700 },
  lite: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center' },
});
