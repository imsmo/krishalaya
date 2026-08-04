// apps/mobile/src/app/(farmer)/profile/farm.tsx · screen 120 "My Farm Details". Thin screen (guide §3): a summary
// header + stat tiles, the caller's own land PLOTS (parcels — area, survey no, GPS-verification, all real/server-
// owned), a real "Add plot" register form (area + unit + optional survey, idempotent), and a recent-harvests
// section. Behind `farmer_profile`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • Per-plot CROP / IRRIGATION-type name / SOIL type, the "active crops" + "Drip irrigated" summary, the
//    "crops history" count, and the region NAME — none are on the LandParcel contract (irrigationTypeId/regionId
//    are uuids; there's no crop/soil field) → shown as a coming-soon note, never invented (no "Wheat"/"Drip"/"Black soil").
//  • Recent harvests (qtl + ₹ per season) have no harvest/crop-season contract → a designed coming-soon block,
//    never fabricated yields/amounts.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { LandParcel } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { myParcels, registerParcel } from '../../../features/profile/profile.api';
import { buildParcelDraft, parcelAreaLabel, parcelStatusTone, landHoldingLabel } from '../../../features/profile/profile';

export default function FarmDetails() {
  const { t } = useTranslation();
  const enabled = useFlag('farmer_profile');
  const [items, setItems] = useState<LandParcel[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [areaValue, setAreaValue] = useState('');
  const [surveyNo, setSurveyNo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // myParcels() degrades a fetch error (e.g. the land module 404ing where it's not yet live at a pilot tenant)
  // to an empty page (Law 12: never a crash) — so an empty FIRST page can't be told apart from "genuinely no
  // plots" by item count alone. Same heuristic as the wallet history screens: a failed initial fetch shows a
  // retry instead of the ordinary "add your first plot" copy.
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (next?: string) => {
    const r = await myParcels(next);
    setItems((prev) => (next ? [...prev, ...r.items] : r.items));
    setCursor(r.nextCursor);
    setFailed(!next && r.items.length === 0 && r.nextCursor === null);
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  const more = useCallback(async () => {
    if (!cursor || paging) return; setPaging(true);
    try { const r = await myParcels(cursor); setItems((p) => [...p, ...r.items]); setCursor(r.nextCursor); } finally { setPaging(false); }
  }, [cursor, paging]);

  const land = useMemo(() => landHoldingLabel(items), [items]);

  if (!enabled) return <ScreenScaffold title={t('profile.farm.myTitle')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const add = async () => {
    const draft = buildParcelDraft({ areaValue, surveyNo });
    if (!draft.ok || !draft.input) { setError(t('profile.farm.areaInvalid')); return; }
    setSaving(true); setError(undefined);
    try { await registerParcel(draft.input); setAreaValue(''); setSurveyNo(''); setShowAdd(false); await load(); }
    catch { Alert.alert(t('profile.farm.myTitle'), t('profile.farm.failed')); }
    finally { setSaving(false); }
  };

  return (
    <ScreenScaffold title={t('profile.farm.myTitle')}>
      {loading ? <SkeletonCard lines={8} /> : (
        <ScrollView contentContainerStyle={{ paddingBottom: space[6] }} showsVerticalScrollIndicator={false}>
          {/* Summary */}
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>{land ? `${land.area} ${land.unit}` : t('profile.farm.noLand')}</Text>
            <Text style={styles.summarySub}>{t('profile.farm.plotsSummary', { n: items.length })}</Text>
          </View>

          {/* Stat tiles */}
          <View style={styles.stats}>
            <Stat value={land ? land.area : '0'} label={t('profile.farm.acresTotal')} />
            <Stat value={String(items.length)} label={t('profile.farm.plots')} />
            <Stat value="—" label={t('profile.farm.cropsHistory')} muted />
          </View>

          {/* My plots */}
          <View style={styles.sectionHead}>
            <Text style={styles.section}>{t('profile.farm.myPlots')}</Text>
            <Pressable onPress={() => setShowAdd((s) => !s)} accessibilityRole="button"><Text style={styles.addLink}>+ {t('profile.farm.addPlot')}</Text></Pressable>
          </View>

          {showAdd ? (
            <Card style={styles.form}>
              <Input label={t('profile.farm.area')} value={areaValue} onChangeText={setAreaValue} keyboardType="decimal-pad" maxLength={11} error={error} />
              <Input label={t('profile.farm.surveyNo')} value={surveyNo} onChangeText={setSurveyNo} maxLength={60} />
              <View style={{ marginTop: space[2] }}><Button title={t('profile.farm.add')} loading={saving} onPress={add} /></View>
            </Card>
          ) : null}

          {items.length === 0 ? (
            <EmptyState
              title={t('profile.farm.empty.title')}
              message={t('profile.farm.empty.message')}
              actionLabel={failed ? t('common.retry') : undefined}
              onAction={failed ? () => { setLoading(true); load(); } : undefined}
            />
          ) : items.map((item, i) => (
            <Card key={item.id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.plotName}>{t('profile.farm.plotN', { letter: plotLetter(i) })} · {parcelAreaLabel(item)}</Text>
                <StatusPill label={t(`profile.farm.status.${item.verificationStatus}`, { defaultValue: item.verificationStatus })} tone={parcelStatusTone(item.verificationStatus)} />
              </View>
              <Text style={styles.meta}>
                {item.surveyNo ? `${t('profile.farm.surveyNo')} ${item.surveyNo}` : t('profile.farm.noSurvey')}
                {item.verificationStatus === 'verified' ? ` · ${t('profile.farm.gpsVerified')}` : ''}
              </Text>
              <Text style={styles.soon}>{t('profile.farm.plotTagsSoon')}</Text>
            </Card>
          ))}
          {paging ? <SkeletonCard lines={1} /> : cursor ? (
            <Pressable onPress={more} accessibilityRole="button" style={styles.moreRow}><Text style={styles.addLink}>{t('common.loadMore')}</Text></Pressable>
          ) : null}

          {/* Recent harvests — §13 */}
          <Text style={[styles.section, { marginTop: space[5] }]}>{t('profile.farm.recentHarvests')}</Text>
          <Card><Text style={styles.soon}>{t('profile.farm.harvestsSoon')}</Text></Card>

          <View style={{ marginTop: space[4] }}>
            <Button title={t('profile.farm.updateInfo')} variant="outline" onPress={() => setShowAdd(true)} />
          </View>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function plotLetter(i: number): string { return String.fromCharCode(65 + (i % 26)); }
function Stat({ value, label, muted }: { value: string; label: string; muted?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statVal, muted && styles.statMuted]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  summary: { alignItems: 'center', paddingVertical: space[3] },
  summaryTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900 },
  summarySub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2 },
  stats: { flexDirection: 'row', gap: space[2], marginBottom: space[4] },
  stat: { flex: 1, alignItems: 'center', backgroundColor: color.card, borderRadius: radius.lg, borderWidth: 1, borderColor: color.ink100, paddingVertical: space[3] },
  statVal: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.primary700 },
  statMuted: { color: color.ink400 },
  statLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2, textAlign: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[2] },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink900 },
  addLink: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700, minHeight: 44, paddingVertical: space[2] },
  form: { marginBottom: space[3] },
  card: { marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  plotName: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, flex: 1 },
  meta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[1] },
  soon: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[1] },
  moreRow: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
