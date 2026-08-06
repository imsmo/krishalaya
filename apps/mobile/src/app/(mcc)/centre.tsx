// apps/mobile/src/app/(mcc)/centre.tsx · my centre (PC-50 W10-7; canon 236 + BMC status). REAL registry facts
// (code, capacity, analyzer, active flag) + the active rate charts the counter prices from.
//
// PC-55 B6 · THE DAY SHEET. The old honest limit ("MCC-wide day totals need a read-model that doesn't exist") went
// stale when W54-5 shipped `mcc-shift-summary`, so the note is replaced by the real thing: per-SHIFT slips, litres,
// amount and water-flag counts for one date, AGGREGATED BY THE SERVER from ledgered slips. The operator's app still
// adds up nothing itself — that was the whole reason the old screen refused to show totals, and it remains true.
// The water-flag count is shown because it is the number a supervisor asks about, and hiding it would make the sheet
// comfortable rather than useful.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { DairyMcc, DairyRateCard } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useAuth } from '../../core/auth/auth.store';
import { myMcc, mccDaySheet } from '../../features/mcc-operator/mcc.api';
import { activeRateCards } from '../../features/dairy/dairy.api';

export default function Centre() {
  const { t, lang } = useTranslation();
  const { state } = useAuth();
  const [mcc, setMcc] = useState<DairyMcc | null | undefined>(undefined);
  const [rates, setRates] = useState<DairyRateCard[]>([]);
  const [sheet, setSheet] = useState<Array<{ shift: string; slips: number; weightKg: string; amountMinor: string; waterFlags: number }>>([]);
  const [date] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    const userId = state.profile?.id;
    if (!userId) { setMcc(null); return; }
    const [centre, r] = await Promise.all([myMcc(userId), activeRateCards()]);
    setMcc(centre); setRates(r);
    // The day sheet needs the centre's id, so it follows the registry read rather than racing it.
    setSheet(centre ? await mccDaySheet(centre.id, date) : []);
  }, [state.profile?.id, date]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (mcc === undefined) return <ScreenScaffold title={t('mcc.centre.title')}><SkeletonCard lines={6} /></ScreenScaffold>;
  if (mcc === null) return <ScreenScaffold title={t('mcc.centre.title')}><EmptyState title={t('mcc.noCentre')} message={t('mcc.noCentreHint')} /></ScreenScaffold>;

  const fact = (label: string, value?: string | null) => value ? (
    <View style={styles.between}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>
  ) : null;

  return (
    <ScreenScaffold title={mcc.defaultName}>
      <ScrollView>
        <Card>
          <View style={styles.between}>
            <Text style={styles.value}>{mcc.code}</Text>
            <StatusPill label={mcc.isActive ? t('mcc.centre.open') : t('mcc.centre.closed')} tone={mcc.isActive ? 'success' : 'danger'} />
          </View>
          {fact(t('mcc.centre.capacity'), mcc.capacityLitresShift ? `${mcc.capacityLitresShift} ${t('dairyapp.bills.litres')}` : null)}
        </Card>
        <Text style={styles.section}>{t('mcc.day.title', { date })}</Text>
        {sheet.length === 0 ? <Text style={styles.muted}>{t('mcc.day.empty')}</Text> : sheet.map((row) => (
          <Card key={row.shift}>
            <View style={styles.between}>
              <Text style={styles.value}>{t(`dairyapp.shift.${row.shift}`) || row.shift}</Text>
              <MoneyText minor={row.amountMinor} langCode={lang} size="sm" />
            </View>
            <View style={styles.between}><Text style={styles.label}>{t('mcc.day.slips')}</Text><Text style={styles.value}>{String(row.slips)}</Text></View>
            <View style={styles.between}><Text style={styles.label}>{t('mcc.day.litres')}</Text><Text style={styles.value}>{row.weightKg}</Text></View>
            <View style={styles.between}>
              <Text style={styles.label}>{t('mcc.day.waterFlags')}</Text>
              <Text style={row.waterFlags > 0 ? styles.flagged : styles.value}>{String(row.waterFlags)}</Text>
            </View>
          </Card>
        ))}
        <Text style={styles.muted}>{t('mcc.day.note')}</Text>

        <Text style={styles.section}>{t('dairyapp.rates.title')}</Text>
        {rates.length === 0 ? <Text style={styles.muted}>{t('dairyapp.rates.empty')}</Text> : rates.map((r) => (
          <Card key={r.id}>
            <Text style={styles.value}>{r.defaultName}</Text>
            <Text style={styles.muted}>{t(`dairyapp.animal.${r.animalType}`) || r.animalType}</Text>
            {r.ratePerKgFatMinor ? <View style={styles.between}><Text style={styles.label}>{t('dairyapp.rates.fat')}</Text><MoneyText minor={r.ratePerKgFatMinor} langCode={lang} size="sm" /></View> : null}
            {r.ratePerKgSnfMinor ? <View style={styles.between}><Text style={styles.label}>{t('dairyapp.rates.snf')}</Text><MoneyText minor={r.ratePerKgSnfMinor} langCode={lang} size="sm" /></View> : null}
            {r.baseRatePerLitreMinor ? <View style={styles.between}><Text style={styles.label}>{t('dairyapp.rates.base')}</Text><MoneyText minor={r.baseRatePerLitreMinor} langCode={lang} size="sm" /></View> : null}
          </Card>
        ))}
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  section: { fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  label: { fontSize: font.size.xs, color: color.ink500 },
  value: { fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[2] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space[1] },
  flagged: { fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.danger },
});
