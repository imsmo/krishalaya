// apps/mobile/src/app/(ambassador)/earnings.tsx · ambassador commission earnings. Thin screen (guide §3): the
// caller's own accrued commission (BigInt sum, Law 2) + the list. Payout is initiated SERVER-SIDE / back-office
// (the app never moves money — Law 11), so this is read-only with an unpaid total. Behind `ambassador_app`.
// Degrade-never-die.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { AmbassadorEarning } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { myEarnings } from '../../features/ambassador/ambassador.api';
import { sumEarningsMinor } from '../../features/ambassador/referral-flow';

export default function AmbassadorEarnings() {
  const { t, lang } = useTranslation();
  const enabled = useFlag('ambassador_app');
  const [items, setItems] = useState<AmbassadorEarning[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => { const r = await myEarnings(); setItems(r.items); setMore(!!r.nextCursor); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('amb.tabs.earnings')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('amb.tabs.earnings')}>
      {loading ? <SkeletonCard lines={5} /> : (
        <>
          <Card>
            <Text style={styles.k}>{t('amb.earnings.total')}</Text>
            <View style={styles.amount}><MoneyText minor={sumEarningsMinor(items)} langCode={lang} size="xl" /></View>
            <View style={[styles.row, { marginTop: space[2] }]}>
              <Text style={styles.k}>{t('amb.earnings.unpaid')}</Text>
              <MoneyText minor={sumEarningsMinor(items, true)} langCode={lang} size="md" />
            </View>
            {more ? <Text style={styles.more}>{t('worker.earnings.more')}</Text> : null}
            <Text style={styles.note}>{t('amb.earnings.payoutNote')}</Text>
          </Card>
          {items.length === 0 ? (
            <EmptyState title={t('amb.earnings.empty.title')} message={t('amb.earnings.empty.message')} />
          ) : (
            <FlatList
              data={items}
              keyExtractor={(e) => e.id}
              renderItem={({ item }) => (
                <Card style={styles.rowCard}>
                  <Text style={styles.k}>{t('amb.earnings.item')}{item.payoutId ? ` · ${t('amb.earnings.paid')}` : ''}</Text>
                  <MoneyText minor={item.amountMinor} langCode={lang} size="md" />
                </Card>
              )}
              contentContainerStyle={{ paddingVertical: space[3] }}
            />
          )}
        </>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  k: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  amount: { alignItems: 'center', marginTop: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  more: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[2], textAlign: 'center' },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400, marginTop: space[3] },
  rowCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[2] },
});
