// apps/mobile/src/app/(owner)/farmer-analytics.tsx · screen 150 (Farmer Analytics). Thin screen (guide §3): the
// tenant's REAL roster health — active-farmer count, an Active/Inactive segment split, and Top performers from the
// analytics read-model — plus re-engagement + CSV handoffs to the web console. Money via MoneyText (Law 2). Behind
// `tenant_admin_lite`. Degrade-never-die (loading/empty/error).
//
// §13 (NOT faked): Active farmers = rosterCounts.active (real membership). Segments = the REAL Active/Inactive split
// (rosterCounts) with pctOf() shares — NOT the mockup's four frequency tiers (Highly active 5+/mo, Regular, Casual,
// Inactive 30+d), which need a per-farmer activity-frequency read-model that doesn't exist → we show only what we
// can compute and flag the rest. Top performers = analytics.topSellers rows (real salesMinor via MoneyText + rank);
// SELLER NAMES aren't resolvable (sellerUserId only, not god-mode — Law 11) → masked ref, never the invented "Ramesh
// Patel". DROPPED as pure fabrication (no contract): "↑12% vs Jul" delta, "98% retention", the 9-month growth-trend
// chart, "inactive 14+ days" recency + "47% past success". The inactive COUNT is real; the re-engagement SMS + CSV
// export are heavy ops with no mobile API → web-console handoff. Every read is tenant-scoped SERVER-SIDE.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { RoleAssignment, TenantAnalytics } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { assignments, tenantAnalytics } from '../../features/tenant/tenant.api';
import { rosterCounts, pctOf } from '../../features/tenant/tenant-admin';
import { openWebConsole } from '../../core/deeplink';
import { WEB_PATHS } from '../../features/tenant/web-console';

function sellerRef(id: string): string { const c = (id ?? '').replace(/[^A-Za-z0-9]/g, ''); return c ? `#${c.slice(0, 6).toUpperCase()}` : '—'; }

export default function FarmerAnalytics() {
  const { t, lang } = useTranslation();
  const enabled = useFlag('tenant_admin_lite');
  const [asg, setAsg] = useState<RoleAssignment[]>([]);
  const [an, setAn] = useState<TenantAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    const [a, analytics] = await Promise.all([assignments().catch(() => null), tenantAnalytics()]);
    if (!a) setError(true);
    setAsg(a ?? []); setAn(analytics); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) load(); }, [enabled, load]));

  const counts = useMemo(() => rosterCounts(asg), [asg]);
  const openWeb = useCallback(async (path: string) => {
    setBusy(true);
    try { const ok = await openWebConsole(path); if (!ok) Alert.alert(t('owner.farmerAnalytics.title'), t('owner.web.unavailable')); }
    finally { setBusy(false); }
  }, [t]);

  if (!enabled) return <ScreenScaffold title={t('owner.farmerAnalytics.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const segments = [
    { key: 'active', count: counts.active },
    { key: 'inactive', count: counts.inactive },
  ];
  const top = an?.topSellers ?? [];

  return (
    <ScreenScaffold title={t('owner.farmerAnalytics.title')} scroll>
      {loading ? <SkeletonCard lines={6} /> : error ? (
        <View>
          <EmptyState title={t('common.somethingWrong')} message={t('common.retryHint')} />
          <Pressable onPress={load} accessibilityRole="button" style={styles.retry}><Text style={styles.retryText}>{t('common.retry')}</Text></Pressable>
        </View>
      ) : (
        <View style={{ gap: space[4] }}>
          {/* Active farmers headline */}
          <Card style={styles.headline}>
            <Text style={styles.headLabel}>{t('owner.farmerAnalytics.activeFarmers')}</Text>
            <Text style={styles.headValue}>{String(counts.active)}</Text>
            <Text style={styles.headSub}>{t('owner.farmerAnalytics.ofTotal', { total: String(counts.all) })}</Text>
          </Card>

          {/* Segments — real Active / Inactive split */}
          <Text style={styles.section}>{t('owner.farmerAnalytics.segments')}</Text>
          <Card style={{ gap: space[3] }}>
            {segments.map((s) => (
              <View key={s.key} style={styles.segRow}>
                <Text style={styles.segLabel}>{t(`owner.farmerAnalytics.seg.${s.key}`)}</Text>
                <Text style={styles.segVal}>{String(s.count)} · {String(pctOf(s.count, counts.all))}%</Text>
              </View>
            ))}
            <Text style={styles.note}>{t('owner.farmerAnalytics.segNote')}</Text>
          </Card>

          {/* Top performers */}
          <Text style={styles.section}>{t('owner.farmerAnalytics.topPerformers')}</Text>
          {top.length ? (
            <Card>
              {top.map((s, i) => (
                <View key={s.sellerUserId} style={[styles.row, i > 0 && styles.rowBorder]}>
                  <Text style={styles.rank}>#{String(i + 1)}</Text>
                  <Text style={styles.perfRef}>{t('owner.farmerAnalytics.sellerRef', { ref: sellerRef(s.sellerUserId) })}</Text>
                  <MoneyText minor={s.salesMinor} currencyCode={an!.currencyCode} langCode={lang} size="sm" />
                </View>
              ))}
            </Card>
          ) : (
            <EmptyState title={t('owner.farmerAnalytics.noPerformers')} />
          )}

          {/* Re-engagement — real inactive count + web handoff */}
          {counts.inactive > 0 ? (
            <Card style={{ gap: space[2] }}>
              <Text style={styles.reTitle}>{t('owner.farmerAnalytics.reengage.title', { count: String(counts.inactive) })}</Text>
              <Pressable disabled={busy} onPress={() => openWeb(WEB_PATHS.broadcast)} accessibilityRole="button" style={styles.reBtn}>
                <Text style={styles.reBtnText}>{t('owner.farmerAnalytics.reengage.cta')} ↗</Text>
              </Pressable>
            </Card>
          ) : null}

          {/* Export */}
          <Pressable disabled={busy} onPress={() => openWeb(WEB_PATHS.export)} accessibilityRole="button" style={styles.export}>
            <Text style={styles.exportText}>{t('owner.farmerAnalytics.export')} ↗</Text>
          </Pressable>
          <Text style={styles.lite}>{t('owner.farmerAnalytics.webNote')}</Text>
        </View>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  headline: { alignItems: 'center', gap: space[1], paddingVertical: space[5] },
  headLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  headValue: { fontFamily: font.display, fontSize: font.size['3xl'], fontWeight: font.weight.bold, color: color.ink800 },
  headSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  segRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  segLabel: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700 },
  segVal: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.earth200 },
  rank: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.primary600, width: 30 },
  perfRef: { flex: 1, fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  reTitle: { fontFamily: font.body, fontSize: font.size.sm, color: color.warningDark },
  reBtn: { alignItems: 'center', paddingVertical: space[3], borderRadius: radius.md, backgroundColor: color.primary50 },
  reBtnText: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary700 },
  export: { alignItems: 'center', paddingVertical: space[3], borderRadius: radius.md, borderWidth: 1.5, borderColor: color.earth200 },
  exportText: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink700 },
  lite: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center' },
});
