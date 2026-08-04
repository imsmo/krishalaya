// apps/mobile/src/app/(farmer)/hire/book/where.tsx · screen 62 (Book Worker · Step 3 of 5 — Work Location).
// Thin screen (guide §3): the farmer sets WHERE the worker should come. The booking's navigation coordinates come
// from a real GPS fix (core/location) — the ONLY source of lat/lng — and the farmer can pick which saved parcel is
// the context. Carries the wizard selections + farmLat/farmLng (+ optional landmark) forward to the wage step.
// Behind `labour_hire`. Degrade-never-die.
//
// §13 — REAL: the farmer's own land parcels (survey no + region + area, via myParcels + lookups) as saved-location
// options, and the GPS fix that sets the booking coordinates. HONESTLY degraded (NEVER faked — no contract field):
// the design's street ADDRESS line + "2.4 km away" DISTANCE (parcels carry no address/coords) → a "GPS location
// set" confirmation instead; the LANDMARK free-text is captured + carried but has no booking-contract field yet, so
// it is flagged (not yet persisted server-side) rather than silently pretended.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { LandParcel, LabourLookups } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../../core/i18n/useTranslation';
import { useFlag } from '../../../../core/flags/useFlag';
import { getCurrentFix } from '../../../../core/location';
import { myParcels } from '../../../../features/profile/profile.api';
import { labourLookups } from '../../../../features/labour/hire.api';
import { savedLocationRows, canContinueLocation, normalizeLandmark } from '../../../../features/labour/book-location';

export default function BookWhere() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ workerId?: string; taskSkillId?: string; startDate?: string; hours?: string }>();
  const enabled = useFlag('labour_hire');

  const [parcels, setParcels] = useState<LandParcel[]>([]);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fix, setFix] = useState<{ lat: number; lng: number } | null>(null);
  const [landmark, setLandmark] = useState('');
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, lk] = await Promise.all([myParcels(), labourLookups()]);
    setParcels(p.items); setLookups(lk);
    setSelectedId((cur) => cur ?? p.items[0]?.id ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const useMyLocation = useCallback(async () => {
    setLocating(true);
    try {
      const r = await getCurrentFix();
      if (r.ok && r.fix) setFix({ lat: r.fix.lat, lng: r.fix.lng });
      else Alert.alert(t('bookWhere.locationTitle'), t(`worker.clockIn.gps.${r.reason ?? 'error'}`));
    } finally { setLocating(false); }
  }, [t]);

  if (!enabled) return <ScreenScaffold title={t('bookWhere.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const rows = savedLocationRows(parcels, lookups, selectedId);
  const canContinue = canContinueLocation(fix);

  const next = () => {
    if (!fix) return;
    const lm = normalizeLandmark(landmark);
    router.push({
      pathname: '/(farmer)/hire/book',
      params: {
        ...(params.workerId ? { workerId: params.workerId } : {}),
        ...(params.taskSkillId ? { taskSkillId: params.taskSkillId } : {}),
        ...(params.startDate ? { startDate: params.startDate } : {}),
        ...(params.hours ? { hours: params.hours } : {}),
        farmLat: String(fix.lat), farmLng: String(fix.lng),
        ...(lm ? { landmark: lm } : {}),
      },
    });
  };

  const workerName = params.workerId ? t('bookWorker.workerAnon', { id: params.workerId.slice(0, 6).toUpperCase() }) : t('bookTask.aWorker');
  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('common.back')} variant="outline" onPress={() => router.back()} />
      <View style={{ flex: 1 }}><Button title={t('bookWhere.continue')} onPress={next} disabled={!canContinue} fullWidth /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('bookTask.bookName', { name: workerName })} scroll={false} footer={footer}>
      {/* Step 3 of 5 progress */}
      <View style={styles.progress}>
        <View style={styles.bar}>
          <View style={[styles.seg, styles.done]} /><View style={[styles.seg, styles.done]} /><View style={[styles.seg, styles.active]} /><View style={styles.seg} /><View style={styles.seg} />
        </View>
        <Text style={styles.step}>{t('bookWhere.step')}</Text>
      </View>

      {loading ? (
        <View style={{ gap: space[3] }}><SkeletonCard lines={3} /><SkeletonCard lines={4} /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[8], gap: space[3] }}>
          <View>
            <Text style={styles.h1}>{t('bookWhere.heading')}</Text>
            <Text style={styles.hVern}>{t('bookWhere.headingVern')}</Text>
            <Text style={styles.helper}>{t('bookWhere.gpsHint')}</Text>
          </View>

          {/* Selected work location — GPS is the source of truth (no address/distance on the contract → not faked). */}
          <Card>
            <View style={styles.locHead}>
              <Text style={styles.locTitle}>📍 {t('bookWhere.myFarm')}</Text>
              <Pressable onPress={useMyLocation} accessibilityRole="button"><Text style={styles.edit}>{fix ? t('bookWhere.edit') : t('bookWhere.setGps')}</Text></Pressable>
            </View>
            <Text style={[styles.locState, canContinue && styles.locStateOk]}>{canContinue ? t('bookWhere.gpsSet') : t('bookWhere.gpsMissing')}</Text>
            {locating ? <Text style={styles.helper}>{t('bookWhere.locating')}</Text> : null}
          </Card>

          {/* Landmark (helps worker find you) — captured + carried; no server field yet (flagged, not persisted). */}
          <Card>
            <Text style={styles.label}>{t('bookWhere.landmark')}</Text>
            <Input value={landmark} onChangeText={setLandmark} placeholder={t('bookWhere.landmarkPlaceholder')} maxLength={120} />
          </Card>

          {/* Saved locations — the farmer's REAL parcels; selection is context (coords still come from GPS). */}
          <View>
            <Text style={styles.section}>{t('bookWhere.savedTitle')}</Text>
            {rows.length === 0 ? (
              <EmptyState title={t('bookWhere.noParcels')} message={t('bookWhere.noParcelsMsg')} actionLabel={t('bookWhere.addParcel')} onAction={() => router.push('/(farmer)/profile/farm')} />
            ) : rows.map((r) => (
              <Pressable key={r.id} onPress={() => setSelectedId(r.id)} style={[styles.saved, r.selected && styles.savedOn]} accessibilityRole="button" accessibilityState={{ selected: r.selected }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.savedTitle}>{r.isDefault ? '★ ' : ''}{r.title}</Text>
                  {r.subtitle ? <Text style={styles.savedSub} numberOfLines={1}>{r.subtitle}</Text> : null}
                </View>
                {r.selected ? <Text style={styles.tick}>✓</Text> : null}
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  progress: { gap: 6, marginBottom: space[2] },
  bar: { flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.ink100 },
  done: { backgroundColor: color.primary600 },
  active: { backgroundColor: color.primary400 ?? color.primary600 },
  step: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.primary700 },
  h1: { fontFamily: font.display, fontSize: font.size.xl, color: color.ink900 },
  hVern: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600, marginTop: 2 },
  helper: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[1] },
  locHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  locTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  edit: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  locState: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400, marginTop: space[2] },
  locStateOk: { color: color.success ?? color.primary700, fontWeight: font.weight.semibold },
  label: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700, marginBottom: space[2] },
  section: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600, marginBottom: space[2] },
  saved: { flexDirection: 'row', alignItems: 'center', gap: space[2], padding: space[3], borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card, marginBottom: space[2] },
  savedOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  savedTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  savedSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  tick: { fontSize: 18, color: color.primary700, fontWeight: '700' },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
});
