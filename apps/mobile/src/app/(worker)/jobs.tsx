// apps/mobile/src/app/(worker)/jobs.tsx · screen 30 (Find Jobs). Thin screen (guide §3): the open-booking
// marketplace via features/labour.browseJobs (box=open, keyset), with client-side quick-filter chips + a sort
// toggle (pure browse-jobs helpers), rich job cards, and a tap → job detail. Money via MoneyText (Law 2). Behind
// `worker_app`. Degrade-never-die: loading skeleton, designed empty, inline retry.
//
// §13 — REAL on each card: task (skill via lookups), wage (wageOfferedMinor), start date, and the badges we can
// prove (group / women-only / above-min-wage). HONESTLY degraded (no field on the booking read → never faked):
// the employer NAME + ⭐rating ("Ramesh Patel · ⭐4.9 (42)" is design seed → anon "Employer #ABC"), the
// LOCATION + DISTANCE ("📍 Anand · 2.4 km"), the day's HOURS ("8 hr full day"), and amenity tags (Water/Lunch
// provided, Skilled work). The design's ≤5 km and Water-provided filter chips are likewise omitted — there's no
// geo/amenity field to filter on yet.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, ScrollView, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { LabourBooking, LabourLookups } from '@krishalaya/sdk-js';
import { EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { browseJobs, labourLookups } from '../../features/labour/labour.api';
import { JOB_FILTERS, type JobSort, filterJobs, sortJobs, jobTags, presentSkillIds } from '../../features/labour/browse-jobs';
import { taskEmoji, skillLabel } from '../../features/labour/worker-home';

export default function Jobs() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_app');
  const [items, setItems] = useState<LabourBooking[]>([]);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [sort, setSort] = useState<JobSort>('soonest');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const [jp, lk] = await Promise.all([browseJobs(), labourLookups()]);
    setItems(jp.items); setLookups(lk); setFailed(jp.items.length === 0 && lk === null); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  const skillIds = useMemo(() => presentSkillIds(items), [items]);
  const shown = useMemo(() => sortJobs(filterJobs(items, filter), sort), [items, filter, sort]);

  if (!enabled) return <ScreenScaffold title={t('worker.browse.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const chip = (key: string, label: string) => {
    const active = filter === key;
    return (
      <Pressable key={key} onPress={() => setFilter(key)} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: active }}>
        <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <ScreenScaffold title={t('worker.browse.title')} scroll={false}>
      {/* Filter chips */}
      <View style={styles.chipsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {JOB_FILTERS.map((f) => chip(f, t(`worker.browse.filter.${f}`)))}
          {skillIds.map((id) => { const label = skillLabel({ taskSkillId: id }, lookups); return label ? chip(`skill:${id}`, label) : null; })}
        </ScrollView>
      </View>

      {/* Results header + sort */}
      <View style={styles.resultRow}>
        <Text style={styles.resultCount}>{t('worker.browse.found', { count: shown.length })}</Text>
        <Pressable onPress={() => setSort((s) => (s === 'soonest' ? 'wage' : 'soonest'))} hitSlop={8} accessibilityRole="button">
          <Text style={styles.sortText}>{t('worker.browse.sort')}: {t(`worker.browse.sortBy.${sort}`)} ↓</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={{ gap: space[3], marginTop: space[2] }}><SkeletonCard lines={4} /><SkeletonCard lines={4} /></View>
      ) : failed ? (
        <EmptyState title={t('common.somethingWrong')} message={t('common.retryHint')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(b) => b.id}
          style={{ marginTop: space[2] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
          ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
          ListEmptyComponent={<EmptyState title={t('worker.jobs.empty.title')} message={t('worker.jobs.empty.message')} />}
          renderItem={({ item }) => {
            const label = skillLabel(item, lookups);
            const tags = jobTags(item);
            return (
              <Pressable style={styles.jobCard} onPress={() => router.push({ pathname: '/(worker)/jobs/[id]', params: { id: item.id } })} accessibilityRole="button" accessibilityLabel={label ?? t('worker.home.genericTask')}>
                <View style={styles.jobTop}>
                  <View style={styles.jobIcon}><Text style={{ fontSize: 22 }}>{taskEmoji(label)}</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.jobTitle} numberOfLines={1}>{label ?? t('worker.home.genericTask')} · {t(`worker.wageKind.${item.wageKind}`)}</Text>
                    <Text style={styles.jobMeta} numberOfLines={1}>{t('worker.home.employerAnon', { id: item.employerUserId.slice(0, 6).toUpperCase() })}</Text>
                    <Text style={styles.jobMeta} numberOfLines={1}>📅 {safeDate(item.startDate, lang)}</Text>
                  </View>
                  <MoneyText minor={item.wageOfferedMinor} currencyCode={item.currencyCode} langCode={lang} size="lg" tone="positive" />
                </View>
                {tags.length ? (
                  <View style={styles.tagRow}>
                    {tags.map((tg) => (
                      <View key={tg} style={styles.tag}><Text style={styles.tagTxt}>{tg === 'group' ? t('worker.browse.tag.group', { n: item.workersNeeded }) : t(`worker.browse.tag.${tg}`)}</Text></View>
                    ))}
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </ScreenScaffold>
  );
}

function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return ''; } }

const styles = StyleSheet.create({
  chipsWrap: { marginHorizontal: -space[1] },
  chips: { gap: space[2], paddingVertical: space[1], paddingHorizontal: space[1] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  chipTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
  resultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[3] },
  resultCount: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600 },
  sortText: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  jobCard: { backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.lg, padding: space[3] },
  jobTop: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  jobIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  jobTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  jobMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[3] },
  tag: { paddingHorizontal: space[2], paddingVertical: 4, borderRadius: radius.sm, backgroundColor: color.successLight },
  tagTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.successDark },
});
