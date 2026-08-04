// apps/mobile/src/app/(owner)/disputes.tsx · screen 155 (Disputes Inbox). Thin screen (guide §3): the tenant
// moderation queue (box=all) with Open / In review / Resolved tabs (live counts from the loaded page) and per-
// dispute cards — ref, category, order context, age, urgency + status, the complaint quote, and (when resolved)
// the resolution amount. Tap → dispute detail to action (server-enforced; NOT god-mode, Law 11). Behind
// `tenant_admin_lite`. Keyset; degrade-never-die (loading skeleton / designed empty / inline retry).
//
// §13 (NOT faked): id-ref, status, description, createdAt, slaDueAt, orderId and resolutionAmountMinor are REAL
// Dispute fields. The tab labels + the "URGENT/REVIEW" pills are UI chrome (URGENT is DERIVED from the real
// slaDueAt, not a fabricated priority). The mockup's party NAMES ("Mehta Trading vs Ramesh Patel"), the human
// category ("Quality dispute"), the "₹14,400 in escrow" line and "3 attachments" are NOT on the list contract —
// the Dispute read-model returns user IDs (not display names), a reasonId (not a label), no in-escrow amount and
// no attachment count. So we degrade: show the real order ref instead of names, a reason label only if reasonId
// resolves to an i18n key (else a generic "Dispute"), the resolution amount via MoneyText ONLY when the server
// supplies it, and omit escrow/attachments. Counts are over the loaded page (there's no counts-aggregate endpoint),
// never the mockup's fixed 142. Money is bigint minor via MoneyText (Law 2).
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { Dispute } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { Card, EmptyState, MoneyText, SegmentedControl, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { disputesList } from '../../features/tenant/tenant.api';
import { disputeStatusTone, disputeTab, disputeTabCounts, filterDisputesByTab, daysAgo, isDisputeUrgent, type DisputeTab } from '../../features/tenant/tenant-admin';

const TABS: DisputeTab[] = ['open', 'review', 'resolved'];
const DT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

export default function Disputes() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tenant_admin_lite');
  const [items, setItems] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<DisputeTab>('open');

  const load = useCallback(async () => { const r = await disputesList(); setItems(r.items); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  const counts = useMemo(() => disputeTabCounts(items), [items]);
  const shown = useMemo(() => filterDisputesByTab(items, tab), [items, tab]);

  if (!enabled) return <ScreenScaffold title={t('owner.tabs.disputes')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const relAge = (iso?: string) => {
    const d = daysAgo(iso);
    if (d === null) return '';
    if (d === 0) return t('owner.disputes.today');
    if (d === 1) return t('owner.disputes.dayAgo');
    return t('owner.disputes.daysAgo', { n: String(d) });
  };

  return (
    <ScreenScaffold title={t('owner.tabs.disputes')} subtitle={t('owner.disputes.subtitle')}>
      <View style={{ marginBottom: space[3] }}>
        <SegmentedControl
          options={TABS.map((k) => ({ value: k, label: `${t(`owner.disputes.tab.${k}`)} · ${counts[k]}` }))}
          value={tab}
          onChange={(v) => setTab(v as DisputeTab)}
          accessibilityLabel={t('owner.disputes.subtitle')}
        />
      </View>
      {loading ? (
        <View style={{ gap: space[3] }}><SkeletonCard lines={4} /><SkeletonCard lines={4} /></View>
      ) : shown.length === 0 ? (
        <EmptyState title={t('owner.disputes.empty.title')} message={t('owner.disputes.empty.message')} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => {
            const urgent = isDisputeUrgent(item.slaDueAt, item.status);
            return (
              <Pressable onPress={() => router.push({ pathname: '/(owner)/dispute/[id]', params: { id: item.id } })} accessibilityRole="button">
                <Card style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.no} numberOfLines={1}>
                      {t('owner.dispute.ref', { id: item.id.slice(0, 8).toUpperCase() })} · {t(`owner.disputeReason.${item.reasonId ?? 'none'}`, { defaultValue: t('owner.disputes.genericCategory') })}
                    </Text>
                    <View style={styles.pills}>
                      {urgent ? <StatusPill label={t('owner.disputes.urgent')} tone="danger" /> : null}
                      <StatusPill label={t(`owner.disputeStatus.${item.status}`, { defaultValue: item.status })} tone={disputeStatusTone(item.status)} />
                    </View>
                  </View>
                  <Text style={styles.meta} numberOfLines={1}>
                    {t('owner.disputes.orderRef', { id: (item.orderId ?? '').slice(0, 8).toUpperCase() })}{relAge(item.createdAt) ? ` · ${relAge(item.createdAt)}` : ''}
                  </Text>
                  {item.description ? <Text style={styles.desc} numberOfLines={3}>“{item.description}”</Text> : null}
                  {item.resolutionAmountMinor ? (
                    <View style={styles.escrow}>
                      <Text style={styles.escrowLabel}>{t('owner.disputes.resolutionAmount')}</Text>
                      <MoneyText minor={item.resolutionAmountMinor} langCode={lang} style={styles.escrowVal} />
                    </View>
                  ) : null}
                </Card>
              </Pressable>
            );
          }}
          contentContainerStyle={{ paddingBottom: space[6] }}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[2], gap: space[1] },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[2] },
  no: { flex: 1, fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  pills: { flexDirection: 'row', gap: space[1], flexShrink: 0 },
  meta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  desc: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, fontStyle: 'italic', marginTop: space[1] },
  escrow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[2], paddingTop: space[2], borderTopWidth: 1, borderTopColor: color.ink100 },
  escrowLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  escrowVal: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
});
