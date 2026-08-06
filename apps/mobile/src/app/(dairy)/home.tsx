// apps/mobile/src/app/(dairy)/home.tsx · dairy-farmer home (PC-50 W10-2). My REAL MCC memberships (member
// code, cycle, centre name) + the latest bill's honest status. D2C consumer subscriptions have NO backend →
// PC-55 B6: the D2C coming-note is gone — the subscription tab shipped on W54-5, so the note had become false.
// It now points at the tab where the standing order actually lives.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { DairyMembership, MilkBill } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { myMemberships, mccNames, myBills } from '../../features/dairy/dairy.api';
import { billTone } from '../../features/dairy/dairy';

export default function DairyHome() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const [memberships, setMemberships] = useState<DairyMembership[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [latestBill, setLatestBill] = useState<MilkBill | null>(null);

  useFocusEffect(useCallback(() => {
    (async () => {
      const [m, n, b] = await Promise.all([myMemberships(), mccNames(), myBills()]);
      setMemberships(m); setNames(n); setLatestBill(b[0] ?? null);
    })();
  }, []));

  return (
    <ScreenScaffold title={t('dairyapp.home.title')}>
      <ScrollView>
        {memberships === null ? <SkeletonCard lines={4} /> : memberships.length === 0 ? (
          <EmptyState title={t('dairyapp.home.noMembership')} message={t('dairyapp.home.noMembershipHint')} />
        ) : memberships.map((m) => (
          <Pressable key={m.id} onPress={() => router.push('/(dairy)/diary')}>
            <Card>
              <Text style={styles.name}>{names[m.mccId] ?? t('dairyapp.home.mcc')}</Text>
              <Text style={styles.muted}>{t('dairyapp.home.memberCode')} {m.memberCode} · {t(`dairyapp.cycle.${m.paymentCycle}`) || m.paymentCycle}</Text>
            </Card>
          </Pressable>
        ))}
        {latestBill && (
          <>
            <Text style={styles.section}>{t('dairyapp.home.latestBill')}</Text>
            <Pressable onPress={() => router.push(`/(dairy)/bills/${latestBill.id}`)}>
              <Card>
                <View style={styles.between}>
                  <StatusPill label={t(`dairyapp.bill.${latestBill.status}`) || latestBill.status} tone={billTone(latestBill.status)} />
                  <MoneyText minor={latestBill.netMinor} langCode={lang} />
                </View>
                <Text style={styles.muted}>{latestBill.periodStart} → {latestBill.periodEnd}</Text>
              </Card>
            </Pressable>
          </>
        )}
        <Text style={styles.muted}>{t('dairyapp.home.d2cWhere')}</Text>
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  name: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  section: { fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
