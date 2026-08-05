// apps/mobile/src/app/(store)/batches/index.tsx · the batch & expiry ledger (PC-50 W10-4). REAL product
// batches (product.manage-gated). Expiry is a CALENDAR compare (expired / ≤30-day soon / ok); recall pulls a
// batch from sale with an audited reason. Goods-inward lives on the add screen (idempotent).
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { ProductBatch } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, Toggle, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { myBatches, recallBatch } from '../../../features/store-owner/store.api';
import { expiryState, expiryTone } from '../../../features/store-owner/store';
import { toIsoDate } from '../../../features/dairy/dairy';

export default function BatchLedger() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const [includeExpired, setIncludeExpired] = useState(false);
  const [items, setItems] = useState<ProductBatch[] | null | undefined>(undefined);
  const load = useCallback(async () => { setItems(undefined); setItems(await myBatches(includeExpired)); }, [includeExpired]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const todayIso = toIsoDate(new Date());
  const recall = (b: ProductBatch) => {
    Alert.alert(t('store.batch.recall'), t('store.batch.recallWhy'), [
      { text: t('store.batch.recallExpired'), onPress: () => doRecall(b.id, 'expired stock') },
      { text: t('store.batch.recallDamaged'), onPress: () => doRecall(b.id, 'damaged stock') },
      { text: t('store.batch.recallOther'), onPress: () => doRecall(b.id, 'recalled by store') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };
  const doRecall = async (id: string, reason: string) => {
    try { await recallBatch(id, reason); load(); } catch { Alert.alert(t('store.batch.recall'), t('store.batch.recallFailed')); }
  };

  return (
    <ScreenScaffold title={t('store.batch.title')}>
      <Button title={t('store.batch.add')} onPress={() => router.push('/(store)/batches/add')} />
      <Toggle label={t('store.batch.showExpired')} value={includeExpired} onValueChange={setIncludeExpired} />
      {items === undefined ? <SkeletonCard lines={6} /> : items === null ? (
        <EmptyState title={t('store.batch.loadError')} actionLabel={t('common.retry')} onAction={load} />
      ) : items.length === 0 ? (
        <EmptyState title={t('store.batch.empty')} message={t('store.batch.emptyHint')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => {
            const st = expiryState(item.expiryDate, todayIso);
            return (
              <Card>
                <View style={styles.between}>
                  <Text style={styles.name}>{item.batchNo}</Text>
                  {item.mrpMinor ? <MoneyText minor={item.mrpMinor} langCode={lang} size="sm" /> : null}
                </View>
                <View style={styles.between}>
                  <Text style={styles.muted}>{item.expiryDate ? `${t('store.batch.expires')} ${item.expiryDate}` : t('store.batch.noExpiry')} · {item.qtyReceived ?? ''} {item.unitCode ?? ''}</Text>
                  <StatusPill label={t(`store.expiry.${st}`)} tone={expiryTone(st)} />
                </View>
                {st !== 'expired' && <Button title={t('store.batch.recall')} variant="outline" onPress={() => recall(item)} />}
              </Card>
            );
          }}
        />
      )}
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  name: { fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1], flexShrink: 1 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
