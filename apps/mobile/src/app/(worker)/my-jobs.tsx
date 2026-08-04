// apps/mobile/src/app/(worker)/my-jobs.tsx · screen 32 (My Schedule). Thin screen (guide §3): the worker's own
// assignments — Upcoming / Past / Cancelled tabs with live counts, the Upcoming tab grouped into Today / Tomorrow /
// This week / Later (pure worker-schedule helpers), and enriched cards. An in-progress job surfaces a "View active
// job" action into the active-job screen. Money via MoneyText (Law 2). Behind `worker_app`. Degrade-never-die.
//
// §13 — REAL on each card: wage (assignment.wageMinor), task (skill via lookups), start date, workers/women/above-
// min badges, and in-progress state. HONESTLY degraded (no field on the assignment/booking read → never faked): the
// start TIME + HOURS ("7:00 AM · 8 hours"), the exact LOCATION/DISTANCE ("Anand 2.4 km"), and — for worker privacy —
// the employer NAME ("Ramesh Patel") → an anonymised employer. Cards are joined client-side (labour.myScheduledJobs),
// bounded to the loaded assignments page — there's no combined schedule read-model yet.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { LabourLookups } from '@krishalaya/sdk-js';
import { EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { myScheduledJobs, labourLookups } from '../../features/labour/labour.api';
import { SCHEDULE_TABS, type ScheduleTab, type ScheduledJob, filterByTab, tabCounts, groupUpcoming, isActiveNow } from '../../features/labour/worker-schedule';
import { skillLabel, taskEmoji } from '../../features/labour/worker-home';
import { jobTags } from '../../features/labour/browse-jobs';

type Row = { type: 'section'; key: string; title: string } | { type: 'job'; job: ScheduledJob };

export default function MyJobs() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_app');
  const [items, setItems] = useState<ScheduledJob[]>([]);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [tab, setTab] = useState<ScheduleTab>('upcoming');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [jobs, lk] = await Promise.all([myScheduledJobs(), labourLookups()]);
    setItems(jobs); setLookups(lk); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  const counts = useMemo(() => tabCounts(items), [items]);
  const rows: Row[] = useMemo(() => {
    if (tab === 'upcoming') {
      return groupUpcoming(items).flatMap((s) => [
        { type: 'section' as const, key: s.key, title: t(`worker.schedule.day.${s.key}`) },
        ...s.items.map((job) => ({ type: 'job' as const, job })),
      ]);
    }
    return filterByTab(items, tab).map((job) => ({ type: 'job' as const, job }));
  }, [items, tab, t]);

  if (!enabled) return <ScreenScaffold title={t('worker.schedule.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('worker.schedule.title')} scroll={false}>
      {/* Tabs */}
      <View style={styles.tabs}>
        {SCHEDULE_TABS.map((key) => {
          const active = tab === key;
          return (
            <Pressable key={key} onPress={() => setTab(key)} style={[styles.tab, active && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <Text style={[styles.tabText, active && styles.tabTextOn]}>{t(`worker.schedule.tab.${key}`)}</Text>
              <Text style={[styles.tabCount, active && styles.tabCountOn]}>({counts[key]})</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={{ gap: space[3], marginTop: space[3] }}><SkeletonCard lines={4} /><SkeletonCard lines={4} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r, i) => (r.type === 'section' ? `s-${r.key}` : `j-${r.job.assignment.id}`) + i}
          style={{ marginTop: space[2] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
          ListEmptyComponent={<EmptyState title={t('worker.schedule.empty.title')} message={t('worker.schedule.empty.message')} actionLabel={t('common.retry')} onAction={load} />}
          renderItem={({ item }) => item.type === 'section' ? (
            <Text style={styles.section}>{item.title}</Text>
          ) : (
            <JobCard job={item.job} lookups={lookups} lang={lang} t={t} onActive={(id) => router.push({ pathname: '/(worker)/active-job/[id]', params: { id } })} />
          )}
          contentContainerStyle={{ paddingBottom: space[8] }}
        />
      )}
    </ScreenScaffold>
  );
}

function JobCard({ job, lookups, lang, t, onActive }: { job: ScheduledJob; lookups: LabourLookups | null; lang: string; t: (k: string, v?: Record<string, unknown>) => string; onActive: (id: string) => void }) {
  const { assignment, booking } = job;
  const label = booking ? skillLabel(booking, lookups) : null;
  const active = isActiveNow(job);
  const tags = booking ? jobTags(booking) : [];
  return (
    <View style={[styles.card, active && styles.cardActive]}>
      <View style={styles.cardTop}>
        <View style={styles.icon}><Text style={{ fontSize: 20 }}>{taskEmoji(label)}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>{label ?? t('worker.home.genericTask')}</Text>
          <Text style={styles.meta} numberOfLines={1}>{t('worker.home.employerAnon', { id: booking ? booking.employerUserId.slice(0, 6).toUpperCase() : '—' })}</Text>
          {booking ? <Text style={styles.meta} numberOfLines={1}>📅 {safeDate(booking.startDate, lang)}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {active ? <StatusPill label={t('worker.schedule.inProgress')} tone="success" /> : null}
          <MoneyText minor={assignment.wageMinor} currencyCode={booking?.currencyCode ?? 'INR'} langCode={lang} size="lg" tone="positive" />
        </View>
      </View>
      {tags.length ? (
        <View style={styles.tagRow}>
          {tags.map((tg) => <View key={tg} style={styles.tag}><Text style={styles.tagTxt}>{tg === 'group' && booking ? t('worker.browse.tag.group', { n: booking.workersNeeded }) : t(`worker.browse.tag.${tg}`)}</Text></View>)}
        </View>
      ) : null}
      {active ? (
        <Pressable onPress={() => onActive(assignment.id)} style={styles.activeLink} accessibilityRole="button">
          <Text style={styles.activeLinkTxt}>{t('worker.schedule.viewActive')} →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return ''; } }

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: space[2] },
  tab: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, paddingVertical: space[2], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  tabOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  tabText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  tabTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
  tabCount: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  tabCountOn: { color: color.primary700 },
  section: { fontFamily: font.display, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink500, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  card: { backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.lg, padding: space[3], marginBottom: space[2] },
  cardActive: { borderColor: color.primary600, backgroundColor: color.primary50 },
  cardTop: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  icon: { width: 44, height: 44, borderRadius: 12, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  meta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[3] },
  tag: { paddingHorizontal: space[2], paddingVertical: 4, borderRadius: radius.sm, backgroundColor: color.successLight },
  tagTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.successDark },
  activeLink: { marginTop: space[3], paddingTop: space[3], borderTopWidth: 1, borderTopColor: color.primary100 },
  activeLinkTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.primary700 },
});
