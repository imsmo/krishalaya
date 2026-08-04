// apps/mobile/src/app/(owner)/campaigns.tsx · screen 158 (Targeted Campaigns). Thin screen (guide §3): the
// tenant's broadcast history as campaign cards with Live / Scheduled / Done tabs (live counts from the loaded
// page) and per-campaign real stats. A "New broadcast" entry routes to the composer (157). Behind
// `tenant_admin_lite`. Keyset via the SDK; degrade-never-die (loading skeleton / designed empty / inline retry).
//
// §13 (NOT faked): title, status, audienceRoleCode, recipientCount, sentCount are REAL TenantBroadcast fields;
// the tab buckets map the real status enum (queued→sending→sent|failed). The mockup's engagement FUNNEL
// ("Opened 84%", "Acted 142", "Completed 49% conversion", "Claimed / Listed"), the "Day 3 of 7" progress, the
// crop/segment-specific audience ("567 wheat farmers", "47 pending", "89 new") and the "Suggested campaign"
// re-engagement card are NOT on the broadcast contract — there's no open/click/act analytics, no schedule-window,
// no segment read-model and no recommendation engine exposed to mobile. So we DON'T fabricate them: audience shows
// the real role + recipientCount, stats show only Recipients + Sent (both real), and the funnel/progress/suggestion
// are omitted (flagged). Counts are over the loaded page (no counts-aggregate endpoint). No money on this screen.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { TenantBroadcast } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, SegmentedControl, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { listCampaigns } from '../../features/tenant/tenant.api';
import { campaignTab, campaignTabCounts, filterCampaignsByTab, type CampaignTab } from '../../features/tenant/tenant-admin';

const TABS: CampaignTab[] = ['live', 'scheduled', 'done'];
function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'sending') return 'success';
  if (status === 'queued') return 'warning';
  if (status === 'failed') return 'danger';
  return 'neutral';
}

export default function Campaigns() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tenant_admin_lite');
  const [items, setItems] = useState<TenantBroadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<CampaignTab>('live');

  const load = useCallback(async () => { setItems(await listCampaigns()); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  const counts = useMemo(() => campaignTabCounts(items), [items]);
  const shown = useMemo(() => filterCampaignsByTab(items, tab), [items, tab]);

  if (!enabled) return <ScreenScaffold title={t('owner.campaigns.heading')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold
      title={t('owner.campaigns.heading')}
      footer={<Button title={t('owner.campaigns.new')} onPress={() => router.push('/(owner)/broadcast')} />}
    >
      <View style={{ marginBottom: space[3] }}>
        <SegmentedControl
          options={TABS.map((k) => ({ value: k, label: `${t(`owner.campaigns.tab.${k}`)} · ${counts[k]}` }))}
          value={tab}
          onChange={(v) => setTab(v as CampaignTab)}
          accessibilityLabel={t('owner.campaigns.heading')}
        />
      </View>
      {loading ? (
        <View style={{ gap: space[3] }}><SkeletonCard lines={4} /><SkeletonCard lines={4} /></View>
      ) : shown.length === 0 ? (
        <EmptyState title={t('owner.campaigns.empty.title')} message={t('owner.campaigns.empty.message')} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                <StatusPill label={t(`owner.campaigns.status.${item.status}`, { defaultValue: item.status })} tone={statusTone(item.status)} />
              </View>
              <Text style={styles.audience} numberOfLines={1}>
                {t('owner.campaigns.audienceLine', { audience: item.audienceRoleCode ? t(`owner.campaigns.role.${item.audienceRoleCode}`, { defaultValue: item.audienceRoleCode }) : t('owner.campaigns.role.all') })}
              </Text>
              <View style={styles.stats}>
                <Stat n={item.recipientCount} label={t('owner.campaigns.recipients')} />
                <Stat n={item.sentCount} label={t('owner.campaigns.sent')} />
              </View>
            </Card>
          )}
          contentContainerStyle={{ paddingBottom: space[6] }}
        />
      )}
    </ScreenScaffold>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statN}>{typeof n === 'number' ? String(n) : '—'}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[2], gap: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  title: { flex: 1, fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  audience: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  stats: { flexDirection: 'row', gap: space[3], marginTop: space[1] },
  stat: { flex: 1, alignItems: 'center', paddingVertical: space[2], backgroundColor: color.earth50, borderRadius: radius.md },
  statN: { fontFamily: font.body, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  statLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
});
