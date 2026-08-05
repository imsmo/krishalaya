// apps/mobile/src/app/(mcc)/members/[id].tsx · farmer ledger (PC-50 W10-7; canon 239). The SAME
// owner-or-manage endpoints the farmer's own app reads (one truth, two viewers): month-paged slips with
// SERVER-priced amounts and the member's bills. NO client-side money totals — the bill is the total.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import type { DairyCollection, MilkBill } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { memberSlips, memberBills } from '../../../features/mcc-operator/mcc.api';
import { defaultDiaryRange, shiftMonth, billTone } from '../../../features/dairy/dairy';

export default function FarmerLedger() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const [range, setRange] = useState(() => defaultDiaryRange(new Date()));
  const [slips, setSlips] = useState<DairyCollection[] | null | undefined>(undefined);
  const [bills, setBills] = useState<MilkBill[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    setSlips(undefined);
    setSlips(await memberSlips(id, range.from, range.to));
  }, [id, range]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { if (id) memberBills(id).then(setBills); }, [id]);

  return (
    <ScreenScaffold title={t('mcc.ledger.title')}>
      <ScrollView>
        <View style={styles.pager}>
          <Pressable style={styles.pageBtn} onPress={() => setRange((r) => shiftMonth(r.from, -1))}><Text style={styles.pageText}>←</Text></Pressable>
          <Text style={styles.range}>{range.from} → {range.to}</Text>
          <Pressable style={styles.pageBtn} onPress={() => setRange((r) => shiftMonth(r.from, 1))}><Text style={styles.pageText}>→</Text></Pressable>
        </View>
        {slips === undefined ? <SkeletonCard lines={5} /> : slips === null ? (
          <EmptyState title={t('dairyapp.diary.loadError')} actionLabel={t('common.retry')} onAction={load} />
        ) : slips.length === 0 ? (
          <Text style={styles.muted}>{t('dairyapp.diary.empty')}</Text>
        ) : slips.map((s) => (
          <Card key={s.id}>
            <View style={styles.between}>
              <Text style={styles.slip}>{s.collectedOn} · {t(`dairyapp.shift.${s.shift}`) || s.shift}</Text>
              <MoneyText minor={s.amountMinor} langCode={lang} size="sm" />
            </View>
            {s.waterFlag ? <Text style={styles.flag}>{t('dairyapp.diary.waterFlag')}</Text> : null}
          </Card>
        ))}
        <Text style={styles.section}>{t('mcc.ledger.bills')}</Text>
        {bills.length === 0 ? <Text style={styles.muted}>{t('dairyapp.bills.empty')}</Text> : bills.map((b) => (
          <Card key={b.id}>
            <View style={styles.between}>
              <StatusPill label={t(`dairyapp.bill.${b.status}`) || b.status} tone={billTone(b.status)} />
              <MoneyText minor={b.netMinor} langCode={lang} size="sm" />
            </View>
            <Text style={styles.muted}>{b.periodStart} → {b.periodEnd}</Text>
          </Card>
        ))}
        <Text style={styles.muted}>{t('mcc.ledger.totalNote')}</Text>
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[2] },
  pageBtn: { paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: radius.md, borderWidth: 1, borderColor: color.ink100 },
  pageText: { fontSize: font.size.lg, color: color.ink800 },
  range: { fontSize: font.size.sm, color: color.ink800, fontWeight: font.weight.semibold },
  section: { fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  slip: { fontSize: font.size.sm, color: color.ink800 },
  flag: { fontSize: font.size.xs, color: color.danger, marginTop: space[1] },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
