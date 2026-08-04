// apps/mobile/src/app/(owner)/home.tsx · screen 08 (Tenant Dashboard). Thin screen (guide §3): an admin header +
// greeting, four REAL KPI cards, a Quick Actions grid into the lite-admin surface, and the subscription apply/pending
// nudge. Money via MoneyText (Law 2). Behind `tenant_admin_lite`. Degrade-never-die.
//
// §13 (NOT faked): Today's GMV = analytics.gmvMinor over a real today-window; Active Farmers = dashboardKpis.farmers
// from the real roster; Active Listings = analytics.activeListings; Open Disputes = dashboardKpis.openDisputes — all
// live. The mockup's KPI DELTAS ("+18%", "+24 this week", "+12 today", "3 overdue") are DROPPED: no period-comparison
// or overdue-orders contract exists, so we never fabricate them. The tenant/business NAME is not on any contract the
// app is authorised to read (UserProfile carries no org name) → the header shows the admin's own name + a generic
// "Admin Console" label, never the mockup's invented "Anand FPO". Recent Activity is OMITTED: there is no tenant
// activity-feed contract, so a designed feed would be pure fabrication. Every action is authorised server-side against
// the admin's OWN permissions (no god-mode, Law 11); a 403 surfaces as a friendly "not allowed" on the target screen.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { RoleAssignment, Dispute, Subscription, TenantAnalytics } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { Button, Card, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useAuth } from '../../core/auth/auth.store';
import { assignments, disputesList, currentSubscription, tenantAnalytics } from '../../features/tenant/tenant.api';
import { dashboardKpis, subscriptionTone, needsToApply, isPending } from '../../features/tenant/tenant-admin';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_FMT: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };

const QUICK_ACTIONS = [
  { key: 'users', icon: '👥', route: '/(owner)/team' },
  { key: 'listings', icon: '🏷️', route: '/(owner)/listings' },
  { key: 'approvals', icon: '✅', route: '/(owner)/approvals' },
  { key: 'wallet', icon: '💰', route: '/(owner)/payouts' },
  { key: 'reports', icon: '📊', route: '/(owner)/analytics' },
  { key: 'settings', icon: '⚙️', route: '/(owner)/payment-settings' },
] as const;

export default function OwnerDashboard() {
  const { t, lang } = useTranslation();
  const { state } = useAuth();
  const router = useRouter();
  const enabled = useFlag('tenant_admin_lite');
  const [asg, setAsg] = useState<RoleAssignment[]>([]);
  const [disp, setDisp] = useState<Dispute[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [analytics, setAnalytics] = useState<TenantAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const now = Date.now();
    const from = new Date(now - (now % DAY_MS)).toISOString(); // start of the current UTC day
    const to = new Date(now).toISOString();
    const [a, d, s, an] = await Promise.all([assignments(), disputesList(), currentSubscription(), tenantAnalytics(from, to)]);
    setAsg(a); setDisp(d.items); setSub(s); setAnalytics(an); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('owner.dashboard.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const name = state.profile?.displayName ?? t('owner.dashboard.defaultName');
  const initial = name.trim().charAt(0).toUpperCase() || 'A';
  const k = dashboardKpis({ assignments: asg, disputes: disp });
  const today = formatDate(new Date().toISOString(), lang, DATE_FMT);

  return (
    <ScreenScaffold title={t('owner.dashboard.title')} scroll>
      {loading ? <SkeletonCard lines={6} /> : (
        <View style={{ gap: space[4] }}>
          {/* Admin header */}
          <View style={styles.header}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerName} numberOfLines={1}>{name}</Text>
              <Text style={styles.headerSub}>{t('owner.dashboard.console')}</Text>
            </View>
          </View>

          {/* Greeting */}
          <View>
            <Text style={styles.greeting}>{t('owner.dashboard.greeting', { name })}</Text>
            <Text style={styles.glance}>{t('owner.dashboard.glance', { date: today })}</Text>
          </View>

          {/* Subscription nudge */}
          {needsToApply(sub) ? (
            <Card>
              <View style={styles.subRow}>
                <Text style={styles.subLabel}>{t('owner.subscription')}</Text>
                <Button title={t('owner.apply.cta')} fullWidth={false} onPress={() => router.push('/(owner)/apply')} />
              </View>
            </Card>
          ) : isPending(sub) ? (
            <Card>
              <View style={styles.subRow}>
                <StatusPill label={t(`owner.subStatus.${sub!.status}`)} tone={subscriptionTone(sub!.status)} />
                <Pressable onPress={() => router.push('/(owner)/pending')}><Text style={styles.link}>{t('owner.dashboard.viewStatus')}</Text></Pressable>
              </View>
              <Text style={styles.note}>{t('owner.pendingNote')}</Text>
            </Card>
          ) : null}

          {/* KPI grid */}
          <View style={styles.kpis}>
            <Card style={styles.kpi}>
              <Text style={styles.kpiLabel}>{t('owner.dashboard.kpi.gmvToday')}</Text>
              {analytics ? (
                <MoneyText minor={analytics.gmvMinor} currencyCode={analytics.currencyCode} langCode={lang} size="lg" />
              ) : (
                <Text style={styles.kpiVal}>{t('common.dash')}</Text>
              )}
            </Card>
            <Card style={styles.kpi} onPress={() => router.push('/(owner)/farmers')}>
              <Text style={styles.kpiLabel}>{t('owner.dashboard.kpi.activeFarmers')}</Text>
              <Text style={styles.kpiVal}>{String(k.farmers)}</Text>
            </Card>
            <Card style={styles.kpi} onPress={() => router.push('/(owner)/listings')}>
              <Text style={styles.kpiLabel}>{t('owner.dashboard.kpi.activeListings')}</Text>
              <Text style={styles.kpiVal}>{analytics ? String(analytics.activeListings) : t('common.dash')}</Text>
            </Card>
            <Card style={styles.kpi} onPress={() => router.push('/(owner)/disputes')}>
              <Text style={styles.kpiLabel}>{t('owner.dashboard.kpi.openDisputes')}</Text>
              <Text style={styles.kpiVal}>{String(k.openDisputes)}</Text>
            </Card>
          </View>

          {/* Quick actions */}
          <Text style={styles.section}>{t('owner.dashboard.quickActions')}</Text>
          <View style={styles.grid}>
            {QUICK_ACTIONS.map((a) => (
              <Pressable key={a.key} style={styles.tile} onPress={() => router.push(a.route)}>
                <Text style={styles.tileIcon}>{a.icon}</Text>
                <Text style={styles.tileLabel}>{t(`owner.dashboard.action.${a.key}`)}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.lite}>{t('owner.liteNote')}</Text>
        </View>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: color.primary600, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.white },
  headerName: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  headerSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  greeting: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800 },
  glance: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[1] },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subLabel: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600 },
  link: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary600 },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.warningDark, marginTop: space[2] },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  kpi: { flexBasis: '47%', flexGrow: 1, gap: space[2], paddingVertical: space[4] },
  kpiVal: { fontFamily: font.display, fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: color.ink800 },
  kpiLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  tile: { flexBasis: '30%', flexGrow: 1, alignItems: 'center', gap: space[2], paddingVertical: space[4], borderRadius: radius.lg, backgroundColor: color.primary50 },
  tileIcon: { fontSize: font.size.xl },
  tileLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink700, textAlign: 'center' },
  lite: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center', marginTop: space[2] },
});
