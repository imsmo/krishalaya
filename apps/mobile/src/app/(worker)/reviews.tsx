// apps/mobile/src/app/(worker)/reviews.tsx · screen 40 (My Reviews). Thin screen (guide §3): the worker's
// reputation — the reviews summary (avg ★ + total) and completed-jobs counter (server truth), a star-distribution,
// filter chips, and the PUBLIC reviews list. Behind `worker_app`. Degrade-never-die.
//
// §13 — REAL: average ★ + review count (reviews summary), completed jobs (worker.bookingsCompleted), each review's
// stars/body/tags/date (public reviews), and the star distribution computed from the loaded reviews. HONESTLY
// degraded (no field/endpoint → NEVER faked): the per-star LIFETIME counts (summary has no split → the bars reflect
// the loaded page); the reviewer's NAME ("Ramesh Patel" — public reviews are PII-free) → an anonymised "verified
// farmer"; the per-review JOB label ("Wheat harvesting" — not on the review) → date only; and the "With photos"
// filter (no photo field) → omitted.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { WorkerProfile, ReviewSummary, PublicReview } from '@krishalaya/sdk-js';
import { Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { getMyWorker, workerRating, workerReviews } from '../../features/labour/labour.api';
import { REVIEW_FILTERS, type ReviewFilter, starDistribution, barPct, filterReviews, starString } from '../../features/labour/worker-reviews';

export default function WorkerReviews() {
  const { t, lang } = useTranslation();
  const enabled = useFlag('worker_app');
  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const w = await getMyWorker(); setWorker(w);
    if (w) { const [s, r] = await Promise.all([workerRating(w.userId), workerReviews(w.userId)]); setSummary(s); setReviews(r); }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  const dist = useMemo(() => starDistribution(reviews), [reviews]);
  const shown = useMemo(() => filterReviews(reviews, filter), [reviews, filter]);
  const avg = summary?.averageStars ?? worker?.ratingAvg ?? null;

  if (!enabled) return <ScreenScaffold title={t('worker.reviews.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('worker.reviews.title')} scroll={false}>
      {loading ? <SkeletonCard lines={10} /> : !worker ? (
        <EmptyState title={t('worker.reviews.empty.title')} message={t('worker.reviews.empty.message')} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(r) => r.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
          ListHeaderComponent={
            <View style={{ gap: space[3] }}>
              {/* Rating hero */}
              <View style={styles.hero}>
                <Text style={styles.heroNum}>{avg != null ? avg.toFixed(1) : '—'}</Text>
                <Text style={styles.heroStars}>{avg != null ? starString(avg) : '☆☆☆☆☆'}</Text>
                <Text style={styles.heroSub}>{t('worker.reviews.summary', { reviews: summary?.count ?? 0, jobs: worker.bookingsCompleted ?? 0 })}</Text>
              </View>

              {/* Distribution (from loaded reviews) */}
              {reviews.length > 0 ? (
                <Card>
                  {dist.map((row) => (
                    <View key={row.star} style={styles.distRow}>
                      <Text style={styles.distStar}>{row.star} ★</Text>
                      <View style={styles.distTrack}><View style={[styles.distFill, { width: `${barPct(row.count, dist)}%` }]} /></View>
                      <Text style={styles.distCount}>{row.count}</Text>
                    </View>
                  ))}
                </Card>
              ) : null}

              {/* Filters */}
              <View style={styles.chips}>
                {REVIEW_FILTERS.map((f) => {
                  const active = filter === f;
                  return (
                    <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                      <Text style={[styles.chipTxt, active && styles.chipTxtOn]}>{t(`worker.reviews.filter.${f}`)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          }
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          ListEmptyComponent={<EmptyState title={t('worker.reviews.noneYet.title')} message={t('worker.reviews.noneYet.message')} />}
          contentContainerStyle={{ paddingBottom: space[8], gap: space[3] }}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.rvTop}>
                <View style={styles.rvAvatar}><Text style={{ fontSize: 16 }}>👤</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rvName}>{t('worker.reviews.verifiedFarmer')}</Text>
                  <Text style={styles.rvMeta} numberOfLines={1}>{item.createdAt ? safeDate(item.createdAt, lang) : ''}{item.isVerifiedPurchase ? ` · ${t('worker.reviews.verified')}` : ''}</Text>
                </View>
                <Text style={styles.rvStars}>{starString(item.stars)}</Text>
              </View>
              {item.body ? <Text style={styles.rvBody}>{item.body}</Text> : null}
              {item.tags.length ? (
                <View style={styles.tagRow}>
                  {item.tags.map((tg) => <View key={tg} style={styles.tag}><Text style={styles.tagTxt}>{tg}</Text></View>)}
                </View>
              ) : null}
            </Card>
          )}
        />
      )}
    </ScreenScaffold>
  );
}

function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { day: 'numeric', month: 'short' }); } catch { return ''; } }

const styles = StyleSheet.create({
  hero: { alignItems: 'center', padding: space[4], borderRadius: radius.lg, backgroundColor: color.primary50 },
  heroNum: { fontFamily: font.display, fontSize: 44, fontWeight: font.weight.bold, color: color.primary700, letterSpacing: -1 },
  heroStars: { fontSize: font.size.lg, color: color.accent500, letterSpacing: 2, marginTop: 2 },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[2] },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: 4 },
  distStar: { width: 34, fontFamily: font.body, fontSize: font.size.xs, color: color.ink600 },
  distTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: color.earth100, overflow: 'hidden' },
  distFill: { height: '100%', backgroundColor: color.accent500, borderRadius: 4 },
  distCount: { width: 36, textAlign: 'right', fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  chipTxtOn: { color: color.primary800, fontWeight: font.weight.semibold },
  rvTop: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  rvAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  rvName: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  rvMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  rvStars: { fontSize: font.size.sm, color: color.accent500, letterSpacing: 1 },
  rvBody: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, lineHeight: font.size.sm * 1.5, marginTop: space[2] },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[3] },
  tag: { paddingHorizontal: space[2], paddingVertical: 4, borderRadius: radius.sm, backgroundColor: color.primary50 },
  tagTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.primary700 },
});
