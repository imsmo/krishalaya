// apps/mobile/src/app/(owner)/listings.tsx · screen 79 (tenant Listings). Thin screen (guide §3): a status stat
// strip + a read-only monitor of the tenant's active listings (server tenant-scoped). Money via MoneyText (Law 2).
// Behind `tenant_admin_lite`. Keyset; degrade-never-die.
//
// §13 (NOT faked): the list is the REAL published/active listings from `listings.browse`; "Active" count is the
// REAL `TenantAnalytics.activeListings`. The design's other stat totals (Pending / Sold / Flagged) have no
// status-count read-model exposed to the app → shown as "—", never a fabricated 23/1,847/5. The core of the mockup
// — a PENDING approval QUEUE with ✓ Approve / ✕ Reject / ⚠ Question-price and the "AI-generated · needs photo
// verification" / "price 18% below fair band" flags — has NO mobile moderation contract (browse returns only
// active listings; there is no per-listing tenant approve/reject/flag endpoint here). Listing moderation is a web-
// console capability (Law 11 lite boundary), so we hand off there rather than render buttons that do nothing or a
// fake queue. Seller identity is PII-minimised to a masked ref (only sellerUserId is on the contract); there is no
// createdAt on the card, so no fabricated "12 min ago".
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { ListingCard, TenantAnalytics } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { tenantListings, tenantAnalytics } from '../../features/tenant/tenant.api';
import { openWebConsole } from '../../core/deeplink';

const STATS = ['pending', 'active', 'sold', 'flagged'] as const;

export default function Listings() {
  const { t, lang } = useTranslation();
  const enabled = useFlag('tenant_admin_lite');
  const [items, setItems] = useState<ListingCard[]>([]);
  const [analytics, setAnalytics] = useState<TenantAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [r, an] = await Promise.all([tenantListings(), tenantAnalytics()]);
    setItems(r.items); setAnalytics(an); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('owner.tabs.listings')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  // Only "active" has a real count (analytics.activeListings); the rest degrade to — (no status-count read-model).
  const statValue = (k: (typeof STATS)[number]) => (k === 'active' && analytics ? String(analytics.activeListings) : t('common.dash'));
  const moderate = async () => { if (!(await openWebConsole('/listings'))) Alert.alert(t('owner.tabs.listings'), t('owner.farmer.consoleUnavailable')); };

  const header = (
    <View style={{ gap: space[3], marginBottom: space[2] }}>
      <View style={styles.stats}>
        {STATS.map((k) => (
          <Card key={k} style={styles.stat}>
            <Text style={styles.statVal}>{statValue(k)}</Text>
            <Text style={styles.statLabel}>{t(`owner.listings.stat.${k}`)}</Text>
          </Card>
        ))}
      </View>
      <Card style={{ gap: space[2] }}>
        <Text style={styles.section}>{t('owner.listings.moderateTitle')}</Text>
        <Text style={styles.body}>{t('owner.listings.moderateBody')}</Text>
        <Button title={t('owner.listings.moderateCta')} variant="outline" fullWidth={false} onPress={moderate} />
      </Card>
      <Text style={styles.section}>{t('owner.listings.activeTitle')}</Text>
    </View>
  );

  return (
    <ScreenScaffold title={t('owner.tabs.listings')}>
      {loading ? <SkeletonCard lines={6} /> : (
        <FlatList
          data={items}
          keyExtractor={(l) => l.id}
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState title={t('owner.listings.empty.title')} message={t('owner.listings.empty.message')} actionLabel={t('common.retry')} onAction={load} />}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                <View style={styles.priceWrap}>
                  <MoneyText minor={item.priceMinor} currencyCode={item.currencyCode} langCode={lang} size="md" />
                  <Text style={styles.perUnit}>{t('owner.listings.perUnit', { unit: item.unitCode })}</Text>
                </View>
              </View>
              <View style={[styles.row, { marginTop: space[1] }]}>
                <Text style={styles.meta} numberOfLines={1}>
                  {t('owner.farmer.ref', { id: item.sellerUserId.slice(0, 8).toUpperCase() })}
                  {'  ·  '}
                  {t('owner.listings.qty', { n: String(item.quantityAvailable), unit: item.unitCode })}
                </Text>
                {item.status ? <StatusPill label={t(`listing.status.${item.status}`, { defaultValue: item.status })} tone="neutral" /> : null}
              </View>
            </Card>
          )}
          contentContainerStyle={{ paddingBottom: space[6] }}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  stat: { flexBasis: '47%', flexGrow: 1, alignItems: 'center', paddingVertical: space[3] },
  statVal: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800 },
  statLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  body: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, lineHeight: font.size.sm * 1.5 },
  card: { marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  priceWrap: { flexDirection: 'row', alignItems: 'baseline' },
  perUnit: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  title: { flex: 1, fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  meta: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
});
