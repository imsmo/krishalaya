// apps/mobile/src/app/(delivery)/history.tsx · finished work (PC-50 W10-5, earnings added PC-55 A7).
// Delivered/returned/cancelled shipments from box=mine, now with the rider's REAL payout statement on top:
// per-drop + charge-share + COD-handling under the terms that were in force on each delivery's own date
// (server-computed; the app never prices its own pay). The note still tells the truth — the statement says
// what the work EARNED, and settlement.paid stays false until the operator's payouts actually run.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Shipment, RiderPayoutStatement } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { myTasks, myPayoutStatement } from '../../features/delivery-partner/delivery.api';
import { isActiveTask, shipmentTone } from '../../features/delivery-partner/delivery';

export default function RiderHistory() {
  const { t, lang } = useTranslation();
  const [items, setItems] = useState<Shipment[] | null>(null);
  const [statement, setStatement] = useState<RiderPayoutStatement | null | undefined>(undefined);
  useFocusEffect(useCallback(() => { myTasks().then(setItems); myPayoutStatement().then(setStatement); }, []));

  const done = items?.filter((s) => !isActiveTask(s.status) && s.status !== 'pending') ?? null;
  return (
    <ScreenScaffold title={t('rider.history.title')}>
      {done === null ? <SkeletonCard lines={6} /> : done.length === 0 ? (
        <EmptyState title={t('rider.history.empty')} message={t('rider.history.emptyHint')} />
      ) : (
        <FlatList
          data={done}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.between}>
                <Text style={styles.awb}>{item.awbNo ? `AWB ${item.awbNo}` : item.id.slice(0, 8)}</Text>
                <StatusPill label={t(`rider.status.${item.status}`) || item.status} tone={shipmentTone(item.status)} />
              </View>
              {item.deliveredAt ? <Text style={styles.muted}>{new Date(item.deliveredAt).toLocaleString()}</Text> : null}
            </Card>
          )}
          ListHeaderComponent={
            statement === undefined ? <SkeletonCard lines={3} /> : statement === null ? (
              <Text style={styles.muted}>{t('rider.earn.unavailable')}</Text>
            ) : (
              <Card>
                <View style={styles.between}>
                  <Text style={styles.earnLabel}>{t('rider.earn.thisPeriod')}</Text>
                  <MoneyText minor={statement.totalMinor} currencyCode={statement.currencyCode} langCode={lang} tone="positive" />
                </View>
                <Text style={styles.muted}>
                  {t('rider.earn.counts', { delivered: String(statement.deliveredCount), failed: String(statement.failedCount) })}
                </Text>
                {statement.activeTerms ? (
                  <Text style={styles.muted}>
                    {t('rider.earn.terms')} {statement.activeTerms.termsName}
                    {statement.activeTerms.pctOfChargeBps > 0 ? ` · ${(statement.activeTerms.pctOfChargeBps / 100).toFixed(2)}%` : ''}
                  </Text>
                ) : (
                  <Text style={styles.warn}>{t('rider.earn.noTerms')}</Text>
                )}
                {statement.unpriced.length > 0 ? (
                  <Text style={styles.warn}>{t('rider.earn.unpriced', { count: String(statement.unpriced.length) })}</Text>
                ) : null}
                {/* The truth, verbatim from the server — never a promise that money has moved. */}
                <Text style={styles.muted}>{statement.settlement.note}</Text>
              </Card>
            )
          }
        />
      )}
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  awb: { fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  warn: { fontSize: font.size.xs, color: color.warningDark, marginTop: space[1] },
  earnLabel: { fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
