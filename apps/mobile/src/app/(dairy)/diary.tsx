// apps/mobile/src/app/(dairy)/diary.tsx · the milk diary (PC-50 W10-2). The farmer's OWN collection slips for
// a month window (server owner-checks the membership — no IDOR). Each slip's amount is the SERVER-priced
// minor string from the rate card at record time. NO client-side period total — that's the BILL's job
// (Law 2/11); the footer says so honestly.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import type { DairyMembership, DairyCollection } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { myMemberships, myCollections } from '../../features/dairy/dairy.api';
import { defaultDiaryRange, shiftMonth } from '../../features/dairy/dairy';

export default function MilkDiary() {
  const { t, lang } = useTranslation();
  const [memberships, setMemberships] = useState<DairyMembership[] | null>(null);
  const [membershipId, setMembershipId] = useState('');
  const [range, setRange] = useState(() => defaultDiaryRange(new Date()));
  const [rows, setRows] = useState<DairyCollection[] | null | undefined>(undefined);

  useEffect(() => {
    myMemberships().then((m) => { setMemberships(m); if (m.length > 0) setMembershipId((prev) => prev || m[0].id); });
  }, []);
  const load = useCallback(async () => {
    if (!membershipId) return;
    setRows(undefined);
    setRows(await myCollections(membershipId, range.from, range.to));
  }, [membershipId, range]);
  useEffect(() => { load(); }, [load]);

  if (memberships !== null && memberships.length === 0) {
    return <ScreenScaffold title={t('dairyapp.diary.title')}><EmptyState title={t('dairyapp.home.noMembership')} message={t('dairyapp.home.noMembershipHint')} /></ScreenScaffold>;
  }

  return (
    <ScreenScaffold title={t('dairyapp.diary.title')}>
      <View style={styles.pager}>
        <Pressable style={styles.pageBtn} onPress={() => setRange((r) => shiftMonth(r.from, -1))}><Text style={styles.pageText}>←</Text></Pressable>
        <Text style={styles.range}>{range.from} → {range.to}</Text>
        <Pressable style={styles.pageBtn} onPress={() => setRange((r) => shiftMonth(r.from, 1))}><Text style={styles.pageText}>→</Text></Pressable>
      </View>
      {memberships && memberships.length > 1 && (
        <View style={styles.wrap}>
          {memberships.map((m) => (
            <Pressable key={m.id} style={[styles.chip, membershipId === m.id && styles.chipOn]} onPress={() => setMembershipId(m.id)}>
              <Text style={styles.chipText}>{m.memberCode}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {rows === undefined ? <SkeletonCard lines={6} /> : rows === null ? (
        <EmptyState title={t('dairyapp.diary.loadError')} actionLabel={t('common.retry')} onAction={load} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('dairyapp.diary.empty')} message={t('dairyapp.diary.emptyHint')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.between}>
                <Text style={styles.slipDate}>{item.collectedOn} · {t(`dairyapp.shift.${item.shift}`) || item.shift}</Text>
                <MoneyText minor={item.amountMinor} langCode={lang} size="md" />
              </View>
              {item.waterFlag ? <Text style={styles.flag}>{t('dairyapp.diary.waterFlag')}</Text> : null}
              {item.milkBillId ? <Text style={styles.muted}>{t('dairyapp.diary.billed')}</Text> : null}
            </Card>
          )}
          ListFooterComponent={<Text style={styles.muted}>{t('dairyapp.diary.totalNote')}</Text>}
        />
      )}
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[2] },
  pageBtn: { paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: radius.md, borderWidth: 1, borderColor: color.ink100 },
  pageText: { fontSize: font.size.lg, color: color.ink800 },
  range: { fontSize: font.size.sm, color: color.ink800, fontWeight: font.weight.semibold },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1], marginBottom: space[2] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: radius.pill, borderWidth: 1, borderColor: color.ink100 },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontSize: font.size.xs, color: color.ink800 },
  slipDate: { fontSize: font.size.sm, color: color.ink800 },
  flag: { fontSize: font.size.xs, color: color.danger, marginTop: space[1] },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
