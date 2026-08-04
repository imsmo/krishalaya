// apps/mobile/src/app/(owner)/farmers.tsx · screen 76 (tenant Farmers roster). Thin screen (guide §3): three REAL
// stat pills (total / active / pending-KYC), filter tabs over the real roster, a "Top sellers" section from the
// tenant's OWN analytics, and the PII-minimised member list. Money via MoneyText (Law 2). Behind `tenant_admin_lite`.
// Degrade-never-die. "+ Add farmer" admin-creates a member (server authorises — no god-mode, Law 11).
//
// §13 (NOT faked): counts (total/active/pending-KYC) come from the real `rbac.assignments` roster; Top sellers come
// from `TenantAnalytics.topSellers` (real orders + salesMinor). The design's rich rows — member NAMES ("Ramesh
// Patel"), ⭐ RATINGS, LISTING COUNTS, REGION, "#FPO-A-247" codes, JOIN years, "by Vikas J." — have NO contract the
// tenant-admin app is authorised to read (the roster is PII-minimised: RoleAssignment carries only userId + role +
// kycStatus + active; there is no users.get for other members — Law 11 / DPDP). So rows degrade to a role + KYC
// status + a short user ref, never invented names/ratings/counts. The "Active 7d" / "Inactive 30d" RECENCY windows
// aren't on the contract either (no last-active timestamp) — the tabs use membership-active, labelled without a
// fabricated day-window. The org name ("Anand FPO") is not readable here, so the header shows just "Farmers".
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { RoleAssignment, TenantAnalytics } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, SegmentedControl, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { assignments, tenantAnalytics } from '../../features/tenant/tenant.api';
import { approvalStatusTone, rosterCounts, filterRoster, type RosterTab } from '../../features/tenant/tenant-admin';

const TABS: RosterTab[] = ['all', 'active', 'pending_kyc', 'inactive'];

export default function Farmers() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tenant_admin_lite');
  const [roster, setRoster] = useState<RoleAssignment[]>([]);
  const [analytics, setAnalytics] = useState<TenantAnalytics | null>(null);
  const [tab, setTab] = useState<RosterTab>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [a, an] = await Promise.all([assignments(), tenantAnalytics()]);
    setRoster(a); setAnalytics(an); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('owner.farmers.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const counts = rosterCounts(roster);
  const shown = filterRoster(roster, tab);
  const topSellers = analytics?.topSellers ?? [];

  const tabOptions = TABS.map((v) => ({
    value: v,
    label: v === 'all' ? `${t('owner.farmers.tab.all')} · ${counts.all}`
      : v === 'pending_kyc' ? `${t('owner.farmers.tab.pendingKyc')} · ${counts.pendingKyc}`
      : t(`owner.farmers.tab.${v}`),
  }));

  const header = (
    <View style={{ gap: space[3], marginBottom: space[2] }}>
      <View style={styles.stats}>
        <Stat value={String(counts.all)} label={t('owner.farmers.stat.total')} />
        <Stat value={String(counts.active)} label={t('owner.farmers.stat.active')} />
        <Stat value={String(counts.pendingKyc)} label={t('owner.farmers.stat.pendingKyc')} />
      </View>
      <SegmentedControl options={tabOptions} value={tab} onChange={(v) => setTab(v as RosterTab)} accessibilityLabel={t('owner.farmers.filterA11y')} />
      {topSellers.length > 0 ? (
        <View style={{ gap: space[2] }}>
          <Text style={styles.section}>{t('owner.farmers.topSellers')}</Text>
          {topSellers.map((s) => (
            <Card key={s.sellerUserId} style={styles.sellerCard}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{s.sellerUserId.slice(0, 2).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ref}>{t('owner.farmer.ref', { id: s.sellerUserId.slice(0, 8).toUpperCase() })}</Text>
                <Text style={styles.sub}>{t('owner.farmers.orders', { n: s.orders })}</Text>
              </View>
              <MoneyText minor={s.salesMinor} currencyCode={analytics!.currencyCode} langCode={lang} size="sm" />
            </Card>
          ))}
        </View>
      ) : null}
      <Text style={styles.section}>{t('owner.farmers.rosterTitle')}</Text>
    </View>
  );

  return (
    <ScreenScaffold title={t('owner.farmers.title')} footer={<Button title={t('owner.addFarmer.cta')} onPress={() => router.push('/(owner)/add-farmer')} />}>
      {loading ? <SkeletonCard lines={6} /> : counts.all === 0 ? (
        <EmptyState title={t('owner.farmers.empty.title')} message={t('owner.farmers.empty.message')} actionLabel={t('owner.addFarmer.cta')} onAction={() => router.push('/(owner)/add-farmer')} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(a) => a.id}
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState title={t('owner.farmers.tabEmpty.title')} message={t('owner.farmers.tabEmpty.message')} />}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push({ pathname: '/(owner)/farmer/[id]', params: { id: item.userId } })} accessibilityRole="button">
              <Card style={styles.card}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{item.userId.slice(0, 2).toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.role}>{t(`role.${item.roleCode}`, { defaultValue: item.roleCode })}</Text>
                  <Text style={styles.ref}>{t('owner.farmer.ref', { id: item.userId.slice(0, 8).toUpperCase() })}</Text>
                </View>
                <StatusPill label={t(`kyc.status.${item.kycStatus}`, { defaultValue: item.kycStatus })} tone={approvalStatusTone(item.kycStatus)} />
              </Card>
            </Pressable>
          )}
          contentContainerStyle={{ paddingBottom: space[6] }}
        />
      )}
    </ScreenScaffold>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Card style={styles.stat}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: space[3] },
  stat: { flex: 1, alignItems: 'center', paddingVertical: space[3] },
  statVal: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800 },
  statLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1], textAlign: 'center' },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[1] },
  sellerCard: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  card: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[2] },
  avatar: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font.display, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.primary600 },
  role: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  ref: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[1] },
  sub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
});
