// apps/mobile/src/app/(worker)/work-history.tsx · screen 138 (My Work History — worker). Thin screen (guide §3):
// lifetime stats + a keyset-paged list of the worker's attendance days (labour.workHistory). Behind `worker_app`.
// Money is bigint paise via MoneyText (Law 2). Degrade-never-die.
//
// §13 — REAL: lifetime JOBS (worker.bookingsCompleted), ⭐RATING + count (reviews summary), lifetime EARNINGS
// (wallet earnings-insights total), and the work-day list (attendance: date, hours, status, paid). HONESTLY
// degraded (NEVER faked — no attendance-contract field): each day's TASK/crop, FARMER name, per-day WAGE ₹, star
// RATING and REVIEW QUOTE ("Excellent worker" is design seed) → a neutral day card (date · hours · status), never a
// fabricated name/amount/quote; the ON-TIME% and REPEAT-FARMERS stats and the 5★/crop FILTER counts have no
// read-model → shown as "—" / offered only as the honestly-computable All + This-year filters.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { WorkerProfile, LabourAttendance } from '@krishalaya/sdk-js';
import { Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius, type PillTone } from '@krishalaya/ui-native';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { getMyWorker, workerRating, workHistory } from '../../features/labour/labour.api';
import { walletEarnings } from '../../features/wallet/wallet.api';
import { attendanceTotalHours, attendanceStatusKey, matchesHistoryFilter, thisYearCount, HISTORY_FILTERS, type HistoryFilter, type HistoryStatus } from '../../features/labour/work-history';

const STATUS_TONE: Record<HistoryStatus, PillTone> = { paid: 'success', confirmed: 'success', clocked_out: 'info', clocked_in: 'warning', pending: 'neutral' };

export default function WorkHistory() {
  const { t, lang } = useTranslation();
  const enabled = useFlag('worker_app');
  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [rating, setRating] = useState<{ averageStars: number; count: number } | null>(null);
  const [lifetimeMinor, setLifetimeMinor] = useState<string | null>(null);
  const [days, setDays] = useState<LabourAttendance[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(false);

  const load = useCallback(async () => {
    const w = await getMyWorker();
    const [page, r, earn] = await Promise.all([workHistory(), w ? workerRating(w.userId) : Promise.resolve(null), walletEarnings()]);
    setWorker(w); setRating(r); setLifetimeMinor(earn.totalMinor ?? null);
    setDays(page.items); setCursor(page.nextCursor); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);
  const loadMore = useCallback(async () => {
    if (!cursor || more) return;
    setMore(true);
    try { const page = await workHistory(cursor); setDays((cur) => [...cur, ...page.items]); setCursor(page.nextCursor); }
    finally { setMore(false); }
  }, [cursor, more]);

  const shown = useMemo(() => days.filter((d) => matchesHistoryFilter(d, filter)), [days, filter]);
  const counts = useMemo(() => ({ all: days.length, this_year: thisYearCount(days) }), [days]);

  if (!enabled) return <ScreenScaffold title={t('workerHistory.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('workerHistory.title')} scroll={false}>
      {loading ? (
        <View style={{ gap: space[3] }}><SkeletonCard lines={4} /><SkeletonCard lines={3} /><SkeletonCard lines={3} /></View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(d) => d.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
          onEndReachedThreshold={0.5}
          onEndReached={loadMore}
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          ListHeaderComponent={
            <View style={{ gap: space[3], marginBottom: space[2] }}>
              {/* Lifetime summary */}
              <Card>
                <Text style={styles.lifetimeLabel}>{t('workerHistory.lifetime')}</Text>
                <View style={styles.lifetimeRow}>
                  <Text style={styles.lifetimeJobs}>{t('workerHistory.jobsCount', { n: worker?.bookingsCompleted ?? 0 })}</Text>
                  {lifetimeMinor ? <Text style={styles.lifetimeMoney}> · {formatMoneyMinor(lifetimeMinor, 'INR', lang)}</Text> : null}
                </View>
                <View style={styles.stats}>
                  <Stat value={rating?.averageStars != null ? `⭐ ${rating.averageStars.toFixed(1)}` : '—'} label={t('workerHistory.rating')} />
                  <Stat value="—" label={t('workerHistory.onTime')} />
                  <Stat value="—" label={t('workerHistory.repeat')} />
                </View>
              </Card>

              {/* Filters — only the honestly-computable ones (5★/crop counts need a read-model we don't have) */}
              <View style={styles.chips}>
                {HISTORY_FILTERS.map((f) => {
                  const on = filter === f;
                  return (
                    <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                      <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{t(`workerHistory.filter.${f}`)} · {counts[f]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          }
          renderItem={({ item }) => <DayCard att={item} lang={lang} t={t} />}
          ListEmptyComponent={<EmptyState title={t('workerHistory.empty.title')} message={t('workerHistory.empty.message')} />}
          contentContainerStyle={{ paddingBottom: space[8] }}
          ListFooterComponent={more ? <View style={{ paddingVertical: space[3] }}><SkeletonCard lines={2} /></View> : null}
        />
      )}
    </ScreenScaffold>
  );
}

function DayCard({ att, lang, t }: { att: LabourAttendance; lang: string; t: (k: string, v?: Record<string, unknown>) => string }) {
  const hours = attendanceTotalHours(att);
  const status = attendanceStatusKey(att);
  const meta = [safeDate(att.workDate, lang), hours != null ? t('workerHistory.hrs', { n: hours }) : null].filter(Boolean).join(' · ');
  return (
    <View style={styles.card}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.dayTitle} numberOfLines={1}>🌾 {t('workerHistory.jobOn', { date: safeDate(att.workDate, lang) })}</Text>
        <Text style={styles.dayMeta} numberOfLines={1}>{meta}</Text>
      </View>
      <StatusPill label={t(`workerHistory.status.${status}`)} tone={STATUS_TONE[status]} />
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}
function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return iso; } }

const styles = StyleSheet.create({
  lifetimeLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  lifetimeRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 2 },
  lifetimeJobs: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900 },
  lifetimeMoney: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.primary700 },
  stats: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  stat: { flex: 1, alignItems: 'center', backgroundColor: color.ink50, borderRadius: radius.md, paddingVertical: space[2] },
  statValue: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  statLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { paddingHorizontal: space[3], minHeight: 40, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  chipTxtOn: { color: color.primary800, fontWeight: font.weight.semibold },
  card: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.lg, padding: space[3] },
  dayTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  dayMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
});
