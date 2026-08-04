// apps/mobile/src/app/(farmer)/hire/workers.tsx · screens 42/43 (Find Workers + filter). Thin screen (guide §3):
// the PII-minimised worker pool with filter chips, a Browse-by-Task grid (real skill catalogue), a sort toggle, and
// rich worker cards. When opened with an `assignBookingId` param, tapping a worker carries it through so the
// employer can assign them to that open booking. Behind `labour_hire`. Keyset; degrade-never-die.
//
// §13 — REAL: region (lookups), 18+ status, wage expectation (money via MoneyText), and the task catalogue.
// CONSENT-GATED (P0-2): the worker's NAME / rating / completed-jobs are shown ONLY for workers who opted in
// (discoverable=true) — otherwise the card is anonymised (worker id + glyph), never a fabricated name.
// HONESTLY degraded: the DISTANCE ("2.4 km" — no geo on the read) → omitted; the "Within 5 km" / "Available today"
// filter chips (no geo/availability) → replaced by real rating/verified chips; the card carries no skill set so
// per-worker skill chips are omitted (skill filtering is server-side).
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import type { WorkerCard, LabourLookups } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { browseWorkers, labourLookups } from '../../../features/labour/hire.api';
import { filterWorkers, sortWorkers, type WorkerSort } from '../../../features/labour/hire-browse';
import { regionName } from '../../../features/labour/worker-profile';
import { skillEmoji } from '../../../features/labour/worker-skills';

export default function BrowseWorkers() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ assignBookingId?: string; minRating?: string; verified?: string; skillId?: string }>();
  const { assignBookingId } = params;
  const enabled = useFlag('labour_hire');
  const [items, setItems] = useState<WorkerCard[]>([]);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [highRating, setHighRating] = useState(!!params.minRating);
  const [verified, setVerified] = useState(params.verified === '1');
  const [skillId, setSkillId] = useState<string | null>(params.skillId || null);
  const [sort, setSort] = useState<WorkerSort>('rating');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, lk] = await Promise.all([browseWorkers({ ageVerified: verified || undefined }), labourLookups()]);
    setItems(r.items); setLookups(lk); setLoading(false);
  }, [verified]);
  useFocusEffect(useCallback(() => { if (enabled) load(); }, [enabled, load]));

  const shown = useMemo(
    () => sortWorkers(filterWorkers(items, { minRating: highRating ? 4.5 : undefined, verified, skillId }), sort),
    [items, highRating, verified, skillId, sort],
  );

  if (!enabled) return <ScreenScaffold title={t('hire.workers.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('hire.workers.title')} scroll={false}>
      {/* Filter chips */}
      <View style={styles.chipsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label={t('hire.browse.filter.all')} active={!highRating && !verified && !skillId} onPress={() => { setHighRating(false); setVerified(false); setSkillId(null); }} />
          <Chip label={t('hire.browse.filter.rating')} active={highRating} onPress={() => setHighRating((v) => !v)} />
          <Chip label={t('hire.browse.filter.verified')} active={verified} onPress={() => setVerified((v) => !v)} />
          <Chip label={t('hire.browse.moreFilters')} active={false} onPress={() => router.push('/(farmer)/hire/filter')} />
        </ScrollView>
      </View>

      {loading ? (
        <View style={{ gap: space[3], marginTop: space[3] }}><SkeletonCard lines={2} /><SkeletonCard lines={4} /></View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(w) => w.id}
          style={{ marginTop: space[2] }}
          ListHeaderComponent={
            <View style={{ gap: space[3] }}>
              {/* Browse by task */}
              {lookups?.skills.length ? (
                <View>
                  <Text style={styles.section}>{t('hire.browse.byTask')}</Text>
                  <View style={styles.taskGrid}>
                    {lookups.skills.map((s) => {
                      const active = skillId === s.id;
                      return (
                        <Pressable key={s.id} onPress={() => setSkillId((cur) => (cur === s.id ? null : s.id))} style={[styles.task, active && styles.taskOn]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                          <Text style={{ fontSize: 22 }}>{skillEmoji(s)}</Text>
                          <Text style={[styles.taskTxt, active && styles.taskTxtOn]} numberOfLines={1}>{s.name}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {/* Results header + sort */}
              <View style={styles.resultRow}>
                <Text style={styles.resultCount}>{t('hire.browse.found', { count: shown.length })}</Text>
                <Pressable onPress={() => setSort((s) => (s === 'rating' ? 'jobs' : 'rating'))} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.sortTxt}>{t('hire.browse.sort')}: {t(`hire.browse.sortBy.${sort}`)} ↓</Text>
                </Pressable>
              </View>
            </View>
          }
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          ListEmptyComponent={<EmptyState title={t('hire.workers.empty.title')} message={t('hire.workers.empty.message')} actionLabel={t('common.retry')} onAction={load} />}
          renderItem={({ item }) => {
            const region = regionName(lookups?.regions ?? [], item.villageRegionId);
            // Consent-gated name: real name only for opted-in workers; otherwise an anonymised handle.
            const name = item.discoverable && item.displayName ? item.displayName : t('hire.worker.anon', { id: item.id.slice(0, 6).toUpperCase() });
            return (
              <Pressable onPress={() => router.push({ pathname: '/(farmer)/hire/worker/[id]', params: { id: item.id, ...(assignBookingId ? { assignBookingId } : {}) } })} accessibilityRole="button" style={styles.card}>
                <View style={styles.avatar}><Text style={{ fontSize: 18 }}>👤</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name} numberOfLines={1}>{name}</Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {[region, item.bookingsCompleted != null ? t('hire.browse.jobsCount', { n: item.bookingsCompleted }) : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={styles.rightCol}>
                  {item.minWageExpectationMinor ? (
                    <>
                      <MoneyText minor={item.minWageExpectationMinor} currencyCode="INR" langCode={lang} size="md" tone="positive" />
                      <Text style={styles.perDay}>{t('hire.browse.perDay')}</Text>
                    </>
                  ) : null}
                  {item.ratingAvg != null ? <Text style={styles.rating}>★ {item.ratingAvg.toFixed(1)}</Text> : null}
                </View>
              </Pressable>
            );
          }}
          contentContainerStyle={{ paddingBottom: space[8], gap: space[3] }}
        />
      )}
    </ScreenScaffold>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <Text style={[styles.chipTxt, active && styles.chipTxtOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chipsWrap: { marginHorizontal: -space[1] },
  chips: { gap: space[2], paddingVertical: space[1], paddingHorizontal: space[1] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  chipTxtOn: { color: color.primary800, fontWeight: font.weight.semibold },
  section: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[3], marginBottom: space[2] },
  taskGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  task: { width: '22.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.ink100, backgroundColor: color.card },
  taskOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  taskTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600 },
  taskTxtOn: { color: color.primary800, fontWeight: font.weight.semibold },
  resultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resultCount: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600 },
  sortTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  card: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.lg, padding: space[3] },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  meta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1], marginTop: space[2] },
  tag: { paddingHorizontal: space[2], paddingVertical: 3, borderRadius: radius.sm, backgroundColor: color.primary50 },
  tagTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.primary700 },
  rightCol: { alignItems: 'flex-end', gap: 2 },
  perDay: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  rating: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.accent600, marginTop: 2 },
});
