// apps/mobile/src/app/(owner)/order-analytics.tsx · screen 151 (Order Analytics). Thin screen (guide §3): a window
// selector, headline order count + average order value, and a REAL order-health breakdown from the tenant analytics
// read-model. Money via MoneyText / avgOrderMinor (Law 2). Behind `tenant_admin_lite`. Degrade-never-die.
//
// §13 (NOT faked): order count = analytics.orders over the SELECTED window; avg value = avgOrderMinor(gmv, orders);
// the breakdown rows = the REAL fields the contract carries — total orders, disputes-open, refunded-orders. What is
// DROPPED (no contract, never fabricated): the "↑18% vs Jul" delta; the four-way DELIVERY status split (Delivered /
// In transit / Pending / Disputed) — TenantAnalytics has no per-delivery-status counts, so we show only the real
// subset and flag the rest; the "Top buyers" list — there is NO buyer-analytics read-model (only topSellers /
// topProducts), so we do NOT relabel sellers as buyers; the "Avg fulfillment time" funnel (order→confirm→pickup→
// delivery) — no timing contract. Full delivery-status + buyer analytics + fulfillment timing live on the web
// console (Export). Every read is tenant-scoped SERVER-SIDE.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { TenantAnalytics } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SegmentedControl, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { tenantAnalytics } from '../../features/tenant/tenant.api';
import { avgOrderMinor, windowRange, type GmvWindow } from '../../features/tenant/tenant-admin';
import { openWebConsole } from '../../core/deeplink';
import { WEB_PATHS } from '../../features/tenant/web-console';

const WINDOWS: GmvWindow[] = ['7d', '30d', '3mo', '1yr'];

export default function OrderAnalytics() {
  const { t, lang } = useTranslation();
  const enabled = useFlag('tenant_admin_lite');
  const [win, setWin] = useState<GmvWindow>('30d');
  const [data, setData] = useState<TenantAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    const { from, to } = windowRange(win, Date.now());
    const an = await tenantAnalytics(from, to);
    if (!an) setError(true);
    setData(an); setLoading(false);
  }, [win]);
  useFocusEffect(useCallback(() => { if (enabled) load(); }, [enabled, load]));

  const windowOpts = useMemo(() => WINDOWS.map((w) => ({ value: w, label: t(`owner.gmv.window.${w}`) })), [t, lang]);

  const openExport = useCallback(async () => {
    setBusy(true);
    try { const ok = await openWebConsole(WEB_PATHS.export); if (!ok) Alert.alert(t('owner.orderAnalytics.title'), t('owner.web.unavailable')); }
    finally { setBusy(false); }
  }, [t]);

  if (!enabled) return <ScreenScaffold title={t('owner.orderAnalytics.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('owner.orderAnalytics.title')} scroll>
      <SegmentedControl options={windowOpts} value={win} onChange={(v) => setWin(v as GmvWindow)} accessibilityLabel={t('owner.gmv.window.label')} />

      {loading ? (
        <View style={{ marginTop: space[4] }}><SkeletonCard lines={5} /></View>
      ) : error || !data ? (
        <View style={{ marginTop: space[4] }}>
          <EmptyState title={t('common.somethingWrong')} message={t('common.retryHint')} />
          <Pressable onPress={load} accessibilityRole="button" style={styles.retry}><Text style={styles.retryText}>{t('common.retry')}</Text></Pressable>
        </View>
      ) : (
        <View style={{ gap: space[4], marginTop: space[4] }}>
          {/* Headline */}
          <Card style={styles.headline}>
            <Text style={styles.headLabel}>{t('owner.orderAnalytics.orders')}</Text>
            <Text style={styles.headValue}>{String(data.orders)}</Text>
            <View style={styles.headMeta}>
              <Text style={styles.metaText}>{t('owner.orderAnalytics.avgLabel')} </Text>
              <MoneyText minor={avgOrderMinor(data.gmvMinor, data.orders)} currencyCode={data.currencyCode} langCode={lang} size="sm" />
            </View>
          </Card>

          {/* Real order-health breakdown */}
          <Text style={styles.section}>{t('owner.orderAnalytics.statusBreakdown')}</Text>
          <Card style={{ gap: space[3] }}>
            <Row label={t('owner.orderAnalytics.status.orders')} value={String(data.orders)} />
            <Row label={t('owner.orderAnalytics.status.disputes')} value={String(data.disputesOpen)} />
            <Row label={t('owner.orderAnalytics.status.refunded')} value={String(data.refundedOrders)} />
            <Text style={styles.note}>{t('owner.orderAnalytics.statusNote')}</Text>
          </Card>

          {/* Export + honest note on what lives on web */}
          <Pressable disabled={busy} onPress={openExport} accessibilityRole="button" style={styles.export}>
            <Text style={styles.exportText}>{t('owner.orderAnalytics.export')} ↗</Text>
          </Pressable>
          <Text style={styles.lite}>{t('owner.orderAnalytics.webNote')}</Text>
        </View>
      )}
    </ScreenScaffold>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowVal}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  headline: { alignItems: 'center', gap: space[1], paddingVertical: space[5] },
  headLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  headValue: { fontFamily: font.display, fontSize: font.size['3xl'], fontWeight: font.weight.bold, color: color.ink800 },
  headMeta: { flexDirection: 'row', alignItems: 'center' },
  metaText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700 },
  rowVal: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  export: { alignItems: 'center', paddingVertical: space[3], borderRadius: radius.md, backgroundColor: color.primary50 },
  exportText: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary700 },
  lite: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center' },
  retry: { alignItems: 'center', paddingVertical: space[3], marginTop: space[2] },
  retryText: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary600 },
});
