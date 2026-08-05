// apps/mobile/src/app/(dairy)/bills/[id].tsx · bill detail (PC-50 W10-2). Server-generated settlement facts:
// period, litres, gross, EVERY deduction line, net, status, dispute window. If the window is still open the
// farmer is told exactly how to dispute (at the MCC / support) — the dispute WRITE lives with the operator
// lifecycle, so no fake in-app dispute button is shown.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import type { MilkBill } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { getBill } from '../../../features/dairy/dairy.api';
import { billTone, disputeWindowOpen } from '../../../features/dairy/dairy';

export default function BillDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const [bill, setBill] = useState<MilkBill | null | undefined>(undefined);
  useFocusEffect(useCallback(() => { if (id) getBill(id).then(setBill); }, [id]));

  if (bill === undefined) return <ScreenScaffold title={t('dairyapp.billDetail.title')}><SkeletonCard lines={6} /></ScreenScaffold>;
  if (bill === null) return <ScreenScaffold title={t('dairyapp.billDetail.title')}><EmptyState title={t('dairyapp.billDetail.notFound')} /></ScreenScaffold>;

  const windowOpen = disputeWindowOpen(bill.disputeWindowEnds, new Date());
  const row = (label: string, node: React.ReactNode) => (
    <View style={styles.between}><Text style={styles.label}>{label}</Text>{node}</View>
  );

  return (
    <ScreenScaffold title={t('dairyapp.billDetail.title')}>
      <ScrollView>
        <Card>
          <View style={styles.between}>
            <StatusPill label={t(`dairyapp.bill.${bill.status}`) || bill.status} tone={billTone(bill.status)} />
            <Text style={styles.muted}>{bill.periodStart} → {bill.periodEnd}</Text>
          </View>
          {row(t('dairyapp.billDetail.litres'), <Text style={styles.value}>{bill.totalLitres}</Text>)}
          {row(t('dairyapp.billDetail.gross'), <MoneyText minor={bill.grossMinor} langCode={lang} size="md" />)}
          {bill.deductions.map((d, i) => <React.Fragment key={`${d.type}-${i}`}>{row(`− ${d.type}`, <MoneyText minor={d.amountMinor} langCode={lang} size="sm" tone="negative" />)}</React.Fragment>)}
          {row(t('dairyapp.billDetail.net'), <MoneyText minor={bill.netMinor} langCode={lang} />)}
        </Card>
        {windowOpen && (
          <Card>
            <Text style={styles.value}>{t('dairyapp.billDetail.disputeOpen')}</Text>
            <Text style={styles.muted}>{t('dairyapp.billDetail.disputeHow')}</Text>
            <Text style={styles.muted}>{t('dairyapp.billDetail.disputeEnds')} {new Date(bill.disputeWindowEnds!).toLocaleString()}</Text>
          </Card>
        )}
        {bill.status === 'paid' && <Text style={styles.muted}>{t('dairyapp.billDetail.paidNote')}</Text>}
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  label: { fontSize: font.size.xs, color: color.ink500 },
  value: { fontSize: font.size.sm, color: color.ink800, fontWeight: font.weight.semibold },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space[2] },
});
