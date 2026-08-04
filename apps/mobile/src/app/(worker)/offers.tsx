// apps/mobile/src/app/(worker)/offers.tsx · screen 141 (job offers). Thin screen (guide §3): the worker's own
// assignments via features/labour.myOffers (box=mine, keyset). Tap → offer detail to accept/decline. Money via
// MoneyText (Law 2). Behind `worker_app`. Degrade-never-die.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { LabourAssignment } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { myOffers } from '../../features/labour/labour.api';
import { assignmentStatusTone } from '../../features/labour/labour-status';

export default function Offers() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_app');
  const [items, setItems] = useState<LabourAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => { setItems((await myOffers()).items); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  if (!enabled) return <ScreenScaffold title={t('worker.tabs.offers')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('worker.tabs.offers')} scroll={false}>
      {loading ? <View style={{ gap: space[3] }}><SkeletonCard /><SkeletonCard /></View> : (
        <FlatList
          data={items}
          keyExtractor={(a) => a.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
          ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
          ListEmptyComponent={<EmptyState title={t('worker.offers.empty.title')} message={t('worker.offers.empty.message')} />}
          renderItem={({ item }) => (
            <Card onPress={() => router.push({ pathname: '/(worker)/offers/[id]', params: { id: item.id } })} accessibilityLabel={t('worker.offerTitle')}>
              <View style={styles.row}>
                <Text style={styles.title}>{t('worker.offerTitle')}</Text>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <MoneyText minor={item.wageMinor} langCode={lang} />
                  <StatusPill label={t(`worker.offerStatus.${item.status}`)} tone={assignmentStatusTone(item.status)} />
                </View>
              </View>
            </Card>
          )}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: font.body, fontSize: font.size.lg, fontWeight: font.weight.semibold, color: color.ink800 },
});
