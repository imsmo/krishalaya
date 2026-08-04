// apps/mobile/src/app/(farmer)/hire/bookings.tsx · screen 50 (My Worker Bookings — employer). Thin screen (guide
// §3): the farmer's own labour bookings with Active / Completed / Cancelled tabs + counts and rich cards (worker,
// task, date, wage, status + respond countdown), each opening the booking detail. Behind `labour_hire`.
// Degrade-never-die.
//
// §13 — REAL: booking no, status, task (skill via lookups), start date, wage (MoneyText), the assigned worker
// (bookingAssignments), and the respond-by countdown (respondWindow). HONESTLY degraded (no field on the booking
// read → NEVER faked): the worker's NAME → anon; the day's HOURS ("8 hours"), the start TIME ("7:00 AM") and the
// in-progress PROGRESS ("2 of 4 hrs · 50%") aren't on the read → omitted / a generic "in progress" line.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { LabourBooking, LabourLookups } from '@krishalaya/sdk-js';
import { Button, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { myBookingsWithWorkers, labourLookups } from '../../../features/labour/hire.api';
import { bookingStatusTone } from '../../../features/labour/booking-flow';
import { BOOKING_TABS, type BookingTab, bookingTab, bookingTabCounts } from '../../../features/labour/farmer-bookings';
import { skillLabel, taskEmoji } from '../../../features/labour/worker-home';
import { respondWindow } from '../../../features/labour/offer';

type Pair = { booking: LabourBooking; workerId: string | null };

export default function MyBookings() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('labour_hire');
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [tab, setTab] = useState<BookingTab>('active');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [p, lk] = await Promise.all([myBookingsWithWorkers(), labourLookups()]);
    setPairs(p); setLookups(lk); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  const counts = useMemo(() => bookingTabCounts(pairs.map((p) => p.booking)), [pairs]);
  const shown = useMemo(() => pairs.filter((p) => bookingTab(p.booking.status) === tab), [pairs, tab]);

  if (!enabled) return <ScreenScaffold title={t('hireBookings.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('hireBookings.title')} scroll={false} footer={<Button title={t('hire.browseWorkers')} onPress={() => router.push('/(farmer)/hire/workers')} />}>
      {/* Tabs */}
      <View style={styles.tabs}>
        {BOOKING_TABS.map((key) => {
          const active = tab === key;
          return (
            <Pressable key={key} onPress={() => setTab(key)} style={[styles.tab, active && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <Text style={[styles.tabText, active && styles.tabTextOn]}>{t(`hireBookings.tab.${key}`)}</Text>
              <Text style={[styles.tabCount, active && styles.tabCountOn]}>{counts[key]}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={{ gap: space[3], marginTop: space[3] }}><SkeletonCard lines={4} /><SkeletonCard lines={4} /></View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(p) => p.booking.id}
          style={{ marginTop: space[2] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          ListEmptyComponent={<EmptyState title={t('hireBookings.empty.title')} message={t('hireBookings.empty.message')} actionLabel={t('hire.browseWorkers')} onAction={() => router.push('/(farmer)/hire/workers')} />}
          renderItem={({ item }) => <BookingCard pair={item} lookups={lookups} lang={lang} t={t} onOpen={() => router.push({ pathname: '/(farmer)/hire/booking/[id]', params: { id: item.booking.id } })} />}
          contentContainerStyle={{ paddingBottom: space[8] }}
        />
      )}
    </ScreenScaffold>
  );
}

function BookingCard({ pair, lookups, lang, t, onOpen }: { pair: Pair; lookups: LabourLookups | null; lang: string; t: (k: string, v?: Record<string, unknown>) => string; onOpen: () => void }) {
  const { booking, workerId } = pair;
  const skill = skillLabel(booking, lookups);
  const win = booking.status === 'pending' || booking.status === 'open' ? respondWindow(booking.respondBy) : null;
  const actionKey = booking.status === 'in_progress' ? 'live' : (booking.status === 'confirmed' || booking.status === 'accepted') ? 'track' : 'view';
  const statusLine = win && !win.expired
    ? `${t('hireBookings.waiting')} · ${t('jobOffer.countdown', { h: win.hoursLeft, m: win.minutesLeft })}`
    : booking.status === 'in_progress' ? t('hireBookings.inProgressLine')
    : (booking.status === 'confirmed' || booking.status === 'accepted') ? t('hireBookings.confirmedLine')
    : t(`worker.bookingStatus.${booking.status}`);
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.no}>{t('worker.jobNo', { id: booking.bookingNo })}</Text>
        <StatusPill label={t(`worker.bookingStatus.${booking.status}`)} tone={bookingStatusTone(booking.status)} />
      </View>
      <View style={styles.workerRow}>
        <View style={styles.avatar}><Text style={{ fontSize: 16 }}>👤</Text></View>
        <Text style={styles.worker}>{workerId ? t('bookWorker.workerAnon', { id: workerId.slice(0, 6).toUpperCase() }) : t('bookTask.aWorker')}</Text>
      </View>
      <Text style={styles.task} numberOfLines={1}>{taskEmoji(skill)} {skill ?? t('worker.home.genericTask')}</Text>
      <Text style={styles.date} numberOfLines={1}>{safeDate(booking.startDate, lang)}</Text>
      <View style={styles.footerRow}>
        <View style={{ flex: 1 }}>
          <MoneyText minor={booking.wageOfferedMinor} currencyCode={booking.currencyCode} langCode={lang} size="lg" tone="positive" />
          <Text style={styles.statusLine} numberOfLines={1}>{statusLine}</Text>
        </View>
        <Pressable onPress={onOpen} style={styles.action} accessibilityRole="button"><Text style={styles.actionTxt}>{t(`hireBookings.action.${actionKey}`)}</Text></Pressable>
      </View>
    </View>
  );
}

function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return iso; } }

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: space[2] },
  tab: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, paddingVertical: space[2], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  tabOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  tabText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  tabTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
  tabCount: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink400 },
  tabCountOn: { color: color.primary700 },
  card: { backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.lg, padding: space[3] },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  no: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink700 },
  workerRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[2] },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  worker: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  task: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, marginTop: space[2] },
  date: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], marginTop: space[3] },
  statusLine: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  action: { paddingHorizontal: space[4], paddingVertical: space[2], borderRadius: radius.pill, backgroundColor: color.primary600 },
  actionTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.white },
});
