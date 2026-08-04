// apps/mobile/src/app/(farmer)/crop-hub.tsx · screen 104 "Crop Knowledge Hub". Thin screen (guide §3): quick
// entries (AI assistant / voice search / saved), the REAL editorial crop-agronomy calendar (P1-5: a crop picker
// + a season/duration header + an ordered growth-stage timeline with per-stage day-windows + advisories, all
// straight from the server's editorial content), and the REAL "Top tips" list. Reads cached content → offline.
// Behind `tips_assistant`. Degrade-never-die.
// §13 (rendered honestly, never faked): the calendar is EDITORIAL reference agronomy — it is NOT personalised to
// the farmer's parcel. A crop VARIETY, today's MANDI price, soil MOISTURE, and the farmer's CURRENT stage/date
// need a per-farm crop-season contract that doesn't exist yet, so those stay omitted (a small "add your farm"
// note points at the roadmap). We never invent a variety, a ₹ price, a moisture %, or a "you are here" marker.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { LearningResource, CropCalendar } from '@krishalaya/sdk-js';
import { Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { listTips, listCropCalendars } from '../../features/content/content.api';
import { readTimeMinutes, cropNames, seasonLabelKey, sortStages, stageDayLabel, durationLabel } from '../../features/content/content';

function kindGlyph(kind: string): string {
  switch (kind) {
    case 'video': return '📹';
    case 'audio': return '🎧';
    case 'blog': return '📝';
    case 'post': return '📣';
    default: return '🌾';
  }
}

export default function CropHub() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tips_assistant');
  const [all, setAll] = useState<LearningResource[]>([]);
  const [calendars, setCalendars] = useState<CropCalendar[]>([]);
  const [crop, setCrop] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [r, cals] = await Promise.all([listTips(), listCropCalendars()]);
    setAll(r.items); setCalendars(cals); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));
  const topTips = useMemo(() => all.slice(0, 6), [all]);

  const crops = useMemo(() => cropNames(calendars), [calendars]);
  const selectedCrop = crop && crops.includes(crop) ? crop : crops[0] ?? null;
  const calendar = useMemo(
    () => (selectedCrop ? calendars.find((c) => c.cropName === selectedCrop) ?? null : null),
    [calendars, selectedCrop],
  );
  const stages = useMemo(() => (calendar ? sortStages(calendar.stages) : []), [calendar]);

  if (!enabled) return <ScreenScaffold title={t('content.cropHub.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('content.cropHub.title')}>
      <ScrollView contentContainerStyle={{ paddingBottom: space[6] }} showsVerticalScrollIndicator={false}>
        {/* Quick entries */}
        <View style={styles.quick}>
          <Pressable onPress={() => router.push('/(farmer)/assistant')} accessibilityRole="button" style={styles.tile}><Text style={styles.tileIcon}>🤖</Text><Text style={styles.tileLabel}>{t('content.assistant.title')}</Text></Pressable>
          <Pressable onPress={() => router.push('/(farmer)/voice-search')} accessibilityRole="button" style={styles.tile}><Text style={styles.tileIcon}>🎙️</Text><Text style={styles.tileLabel}>{t('content.voiceSearch.title')}</Text></Pressable>
          <Pressable onPress={() => router.push('/(farmer)/tips/saved')} accessibilityRole="button" style={styles.tile}><Text style={styles.tileIcon}>🔖</Text><Text style={styles.tileLabel}>{t('content.saved.title')}</Text></Pressable>
        </View>

        {/* Editorial crop-agronomy calendar (P1-5) — REAL server content: crop picker + season/duration header +
            ordered growth-stage timeline. NOT personalised (§13): variety/price/moisture/"you are here" omitted. */}
        <Text style={styles.section}>{t('content.cropHub.calendarTitle')}</Text>
        {loading ? <SkeletonCard lines={4} /> : calendars.length === 0 ? (
          <Card style={styles.calendar}>
            <Text style={styles.calIcon}>🌱</Text>
            <Text style={styles.calSoon}>{t('content.cropHub.calendarEmpty')}</Text>
          </Card>
        ) : (
          <Card style={styles.calCard}>
            {/* Crop picker */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {crops.map((c) => {
                const on = c === selectedCrop;
                return (
                  <Pressable key={c} onPress={() => setCrop(c)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]}>
                    <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{c}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {calendar && (
              <>
                <Text style={styles.calHead}>
                  {t(seasonLabelKey(calendar.season))} · {t('content.cropHub.durationDays', { n: durationLabel(calendar) })}
                </Text>
                {calendar.regionName ? <Text style={styles.calRegion}>📍 {calendar.regionName}</Text> : null}
                {/* Growth-stage timeline (ordered by day window) */}
                {stages.map((s, i) => (
                  <View key={`${s.name}-${i}`} style={styles.stageRow}>
                    <View style={styles.stageDot}><Text style={styles.stageNum}>{i + 1}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stageName}>{s.name}</Text>
                      <Text style={styles.stageDays}>{t('content.cropHub.dayRange', { d: stageDayLabel(s) })}</Text>
                      {s.advisory ? <Text style={styles.stageAdvisory}>{s.advisory}</Text> : null}
                    </View>
                  </View>
                ))}
                {calendar.source ? <Text style={styles.calSource}>{t('content.cropHub.source', { s: calendar.source })}</Text> : null}
                <Text style={styles.calNote}>{t('content.cropHub.notPersonalised')}</Text>
                <Pressable onPress={() => router.push('/(farmer)/profile/farm')} accessibilityRole="button" style={styles.calBtn}>
                  <Text style={styles.calBtnTxt}>{t('content.cropHub.addFarm')} →</Text>
                </Pressable>
              </>
            )}
          </Card>
        )}

        {/* Top tips — REAL tips (read-time derived; reads count omitted §13) */}
        <Text style={styles.section}>{t('content.cropHub.topTips')}</Text>
        {loading ? <SkeletonCard lines={5} /> : topTips.length === 0 ? (
          <EmptyState title={t('content.tips.empty.title')} message={t('content.tips.empty.message')} actionLabel={t('common.retry')} onAction={load} />
        ) : (
          <>
            {topTips.map((r) => (
              <Pressable key={r.id} onPress={() => router.push({ pathname: '/(farmer)/tips/[id]', params: { id: r.id } })} accessibilityRole="button">
                <Card style={styles.tipRow}>
                  <Text style={styles.tipGlyph}>{kindGlyph(r.kind)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tipTitle} numberOfLines={2}>{r.title}</Text>
                    <Text style={styles.tipMeta}>🕐 {t('content.readTime', { n: readTimeMinutes(r.body) })}</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Card>
              </Pressable>
            ))}
            <Pressable onPress={() => router.push('/(farmer)/tips')} accessibilityRole="button" style={styles.seeAllRow}>
              <Text style={styles.seeAll}>{t('content.cropHub.seeAll')} →</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  quick: { flexDirection: 'row', gap: space[2], marginBottom: space[3] },
  tile: { flex: 1, minHeight: 72, alignItems: 'center', justifyContent: 'center', backgroundColor: color.primary50, borderRadius: radius.md, paddingVertical: space[2] },
  tileIcon: { fontSize: 24 },
  tileLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink700, marginTop: space[1], textAlign: 'center' },

  calendar: { alignItems: 'center', marginBottom: space[4], paddingVertical: space[4] },
  calIcon: { fontSize: 36 },
  calSoon: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[1], textAlign: 'center' },
  calCard: { marginBottom: space[4], paddingVertical: space[3] },
  chips: { gap: space[2], paddingBottom: space[2] },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { backgroundColor: color.primary600, borderColor: color.primary600 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  chipTxtOn: { color: color.white },
  calHead: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink900, marginTop: space[2] },
  calRegion: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2, marginBottom: space[1] },
  stageRow: { flexDirection: 'row', gap: space[3], marginTop: space[3] },
  stageDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  stageNum: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.primary700 },
  stageName: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  stageDays: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 1 },
  stageAdvisory: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[1], lineHeight: 18 },
  calSource: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[3] },
  calNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[1], lineHeight: 16 },
  calBtn: { marginTop: space[3], minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: space[4], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.primary600 },
  calBtnTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },

  section: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900, marginBottom: space[2] },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[2] },
  tipGlyph: { fontSize: 26, width: 36, textAlign: 'center' },
  tipTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, lineHeight: 20 },
  tipMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  chevron: { fontFamily: font.body, fontSize: font.size.lg, color: color.ink400 },
  seeAllRow: { minHeight: 44, justifyContent: 'center', alignItems: 'center', marginTop: space[1] },
  seeAll: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary700 },
});
