// apps/mobile/src/app/(owner)/analytics.tsx · screen 84 (GMV Analytics). Thin screen (guide §3): a window
// selector, a headline GMV card with order count + average order value, Top Products + Top Sellers rows, and a
// "view full reports / export on web" handoff. Money via MoneyText / avgOrderMinor (Law 2). Behind
// `tenant_admin_lite`. Degrade-never-die (loading / empty / error-inline).
//
// §13 (NOT faked): headline GMV = analytics.gmvMinor over the SELECTED real window; "N orders" = analytics.orders;
// "avg" = avgOrderMinor(gmv, orders) (bigint floor div, real); Top Products = analytics.topProducts rows (real
// salesMinor + quantity); Top Sellers = analytics.topSellers rows (real salesMinor + orders). What is DROPPED and
// why: the mockup's "↑24% vs last month" DELTA — no period-comparison contract exists, so we never fabricate it.
// The 14-day DAILY-GMV bar chart — TenantAnalytics carries no daily buckets, so a chart would be invented data;
// omitted. CATEGORY names + emoji — topProducts carries only productId (no category taxonomy), so we show a masked
// product reference, never an invented "Vegetables 🥬". SELLER names — topSellers carries only sellerUserId (the
// app is not authorised to resolve arbitrary users' names, and it's not god-mode, Law 11), so we show a masked
// seller reference; full names + CSV export live on the web console. Every read is tenant-scoped SERVER-SIDE.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { TenantAnalytics } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SegmentedControl, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { openWebConsole } from '../../core/deeplink';
import { WEB_PATHS } from '../../features/tenant/web-console';
import { tenantAnalytics } from '../../features/tenant/tenant.api';
import { avgOrderMinor, windowRange, type GmvWindow } from '../../features/tenant/tenant-admin';

const WINDOWS: GmvWindow[] = ['7d', '30d', '3mo', '1yr', 'all'];
/** A masked, non-PII reference for an opaque id (product/seller) — honest placeholder, never an invented name. */
function shortRef(id: string): string {
  const clean = (id ?? '').replace(/[^A-Za-z0-9]/g, '');
  return clean ? `#${clean.slice(0, 6).toUpperCase()}` : '—';
}

export default function GmvAnalytics() {
  const { t, lang } = useTranslation();
  const router = useRouter();
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

  const openExport = useCallback(async () => {
    setBusy(true);
    try { const ok = await openWebConsole(WEB_PATHS.export); if (!ok) Alert.alert(t('owner.gmv.title'), t('owner.web.unavailable')); }
    finally { setBusy(false); }
  }, [t]);

  const windowOpts = useMemo(() => WINDOWS.map((w) => ({ value: w, label: t(`owner.gmv.window.${w}`) })), [t, lang]);

  if (!enabled) return <ScreenScaffold title={t('owner.gmv.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('owner.gmv.title')} scroll>
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
          {/* Headline GMV */}
          <Card style={styles.headline}>
            <Text style={styles.headLabel}>{t('owner.gmv.gmvLabel')}</Text>
            <MoneyText minor={data.gmvMinor} currencyCode={data.currencyCode} langCode={lang} size="xl" />
            <View style={styles.headMeta}>
              <Text style={styles.metaText}>{t('owner.gmv.ordersCount', { count: String(data.orders) })}</Text>
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.metaText}>{t('owner.gmv.avgLabel')} </Text>
              <MoneyText minor={avgOrderMinor(data.gmvMinor, data.orders)} currencyCode={data.currencyCode} langCode={lang} size="sm" />
            </View>
          </Card>

          {/* Top products */}
          <Text style={styles.section}>{t('owner.gmv.topProducts')}</Text>
          {data.topProducts?.length ? (
            <Card>
              {data.topProducts.map((p, i) => (
                <View key={p.productId} style={[styles.row, i > 0 && styles.rowBorder]}>
                  <Text style={styles.rank}>{String(i + 1)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{t('owner.gmv.productRef', { ref: shortRef(p.productId) })}</Text>
                    <Text style={styles.rowSub}>{t('owner.gmv.qtySold', { qty: String(p.quantity) })}</Text>
                  </View>
                  <MoneyText minor={p.salesMinor} currencyCode={data.currencyCode} langCode={lang} size="sm" />
                </View>
              ))}
            </Card>
          ) : (
            <EmptyState title={t('owner.gmv.empty')} />
          )}

          {/* Top sellers */}
          <Text style={styles.section}>{t('owner.gmv.topSellers')}</Text>
          {data.topSellers?.length ? (
            <Card>
              {data.topSellers.map((s, i) => (
                <View key={s.sellerUserId} style={[styles.row, i > 0 && styles.rowBorder]}>
                  <Text style={styles.rank}>{String(i + 1)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{t('owner.gmv.sellerRef', { ref: shortRef(s.sellerUserId) })}</Text>
                    <Text style={styles.rowSub}>{t('owner.gmv.ordersCount', { count: String(s.orders) })}</Text>
                  </View>
                  <MoneyText minor={s.salesMinor} currencyCode={data.currencyCode} langCode={lang} size="sm" />
                </View>
              ))}
            </Card>
          ) : (
            <EmptyState title={t('owner.gmv.empty')} />
          )}

          {/* Names + full charts + CSV live on the web console (honest handoff, not fabricated in-app) */}
          <Text style={styles.note}>{t('owner.gmv.namesOnWeb')}</Text>
          <Pressable disabled={busy} onPress={openExport} accessibilityRole="button" style={styles.export}>
            <Text style={styles.exportText}>{t('owner.gmv.download')} ↗</Text>
          </Pressable>
        </View>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  headline: { alignItems: 'center', gap: space[2], paddingVertical: space[5] },
  headLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  headMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  metaText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  metaDot: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400, marginHorizontal: space[2] },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.earth200 },
  rank: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.primary600, width: 20, textAlign: 'center' },
  rowTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  rowSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center' },
  export: { alignItems: 'center', paddingVertical: space[3], borderRadius: radius.md, backgroundColor: color.primary50 },
  exportText: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary700 },
  retry: { alignItems: 'center', paddingVertical: space[3], marginTop: space[2] },
  retryText: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary600 },
});
