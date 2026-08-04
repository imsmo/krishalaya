// apps/mobile/src/app/(worker)/home.tsx · screen 29 (Worker Home). Thin screen (guide §3): the caller's worker
// dashboard — a bilingual greeting, a "this period" earnings hero (View Earnings / Get Paid), two summary tiles
// (pending offers · confirmed bookings), the "Jobs near you" open-marketplace list, and Today's tip. If the caller
// has no worker profile yet → an onboarding CTA. All data via features/labour + features/wallet + features/content;
// money via formatMoneyMinor/MoneyText (Law 2, bigint minor). Behind `worker_app`. Degrade-never-die (Law 12).
//
// §13 — what's REAL vs honestly degraded:
//  • greeting name = the caller's own profile.displayName; the "N new jobs" subtitle = the count of OPEN nearby
//    bookings the marketplace returns.
//  • earnings hero = the caller's OWN wallet credit insights (GET /wallet/earnings, aggregated FLOAT-FREE server-
//    side). The server exposes MONTHLY buckets, not weekly, so the card is labelled "this month" + "vs last month"
//    (never a fabricated weekly "₹2,800 · ↑24% vs last week").
//  • tiles: pending-offer + confirmed-booking COUNTS are real; the design's "N Tomorrow" date-filter isn't
//    computable without an N+1 booking-date fetch, so the confirmed tile is labelled "confirmed bookings" (§13).
//  • job cards: task (via lookups), wage (wageOfferedMinor) are real. The employer NAME (only employerUserId is
//    exposed → anon), the day's HOURS (dailyHours isn't on the booking read) and the DISTANCE (no geo on the read)
//    have no field → each is omitted/noted, never invented ("Ramesh Patel · Anand · 2.4 km" is design seed data).
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import type { WorkerProfile, LabourBooking, LabourAssignment, LabourLookups, LearningResource } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useAuth } from '../../core/auth/auth.store';
import { useFlag } from '../../core/flags/useFlag';
import { getMyWorker, browseJobs, myOffers, myJobs, labourLookups } from '../../features/labour/labour.api';
import { walletEarnings } from '../../features/wallet/wallet.api';
import { listTips } from '../../features/content/content.api';
import { periodTotal, momDelta } from '../../features/wallet/earnings';
import { initials, pendingOfferCount, confirmedCount, taskEmoji, skillLabel } from '../../features/labour/worker-home';

export default function WorkerHome() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const { state } = useAuth();
  const enabled = useFlag('worker_app');

  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [jobs, setJobs] = useState<LabourBooking[]>([]);
  const [offers, setOffers] = useState<LabourAssignment[]>([]);
  const [assignments, setAssignments] = useState<LabourAssignment[]>([]);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [tip, setTip] = useState<LearningResource | null>(null);
  const [earnMinor, setEarnMinor] = useState('0');
  const [earnCount, setEarnCount] = useState(0);
  const [earnPct, setEarnPct] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const w = await getMyWorker();
    setWorker(w);
    if (w) {
      const [jp, op, mj, lk, ins, tp] = await Promise.all([
        browseJobs(), myOffers('pending_worker'), myJobs(), labourLookups(), walletEarnings(), listTips(),
      ]);
      setJobs(jp.items); setOffers(op.items); setAssignments(mj.items); setLookups(lk);
      const period = periodTotal(ins.byMonth, 'month');
      setEarnMinor(period.amountMinor); setEarnCount(period.count);
      setEarnPct(momDelta(ins.byMonth)?.pct ?? null);
      setTip(tp.items[0] ?? null);
    }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  const name = state.profile?.displayName ?? t('worker.home.defaultName');

  if (!enabled) return <SafeAreaView style={styles.safe} edges={['top']}><View style={styles.centre}><EmptyState title={t('common.unavailable')} /></View></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Greeting header */}
      <View style={styles.greetRow}>
        <View style={styles.avatar}><Text style={styles.avatarTxt}>{initials(name)}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.greetName} numberOfLines={1}>{t('worker.home.namaste', { name })}</Text>
          <Text style={styles.greetVern} numberOfLines={1}>{t('worker.home.newJobs', { count: jobs.length })}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}>
        {loading ? (
          <View style={{ gap: space[3] }}>
            <SkeletonCard lines={4} />
            <View style={{ flexDirection: 'row', gap: space[3] }}><View style={{ flex: 1 }}><SkeletonCard lines={2} /></View><View style={{ flex: 1 }}><SkeletonCard lines={2} /></View></View>
            <SkeletonCard lines={3} />
          </View>
        ) : !worker ? (
          <Card>
            <Text style={styles.onboardH}>{t('worker.onboard.title')}</Text>
            <Text style={styles.onboardP}>{t('worker.onboard.body')}</Text>
            <View style={{ marginTop: space[4] }}><Button title={t('worker.onboard.register')} onPress={() => router.push('/(worker)/profile')} /></View>
          </Card>
        ) : (
          <>
            {/* Earnings hero */}
            <View style={styles.earnCard}>
              <View style={styles.earnGlow} />
              <Text style={styles.earnLabel}>{t('worker.home.earnings.label')}</Text>
              <Text style={styles.earnAmt}>{formatMoneyMinor(earnMinor, 'INR', lang)}</Text>
              <Text style={styles.earnMeta}>
                {t('worker.home.earnings.jobs', { count: earnCount })}
                {earnPct != null ? ` · ${earnPct >= 0 ? '↑' : '↓'} ${t('worker.home.earnings.delta', { pct: Math.abs(earnPct) })}` : ''}
              </Text>
              <View style={styles.earnActions}>
                <Pressable style={styles.earnBtn} onPress={() => router.push('/(worker)/earnings')} accessibilityRole="button">
                  <Text style={styles.earnBtnTxt}>{t('worker.home.viewEarnings')}</Text>
                </Pressable>
                <Pressable style={styles.earnBtn} onPress={() => router.push('/(worker)/withdraw')} accessibilityRole="button">
                  <Text style={styles.earnBtnTxt}>{t('worker.home.getPaid')} →</Text>
                </Pressable>
              </View>
            </View>

            {/* Quick tiles */}
            <View style={styles.tiles}>
              <Pressable style={styles.tile} onPress={() => router.push('/(worker)/offers')} accessibilityRole="button">
                <View style={[styles.tileIcon, { backgroundColor: color.warningLight }]}><Text style={{ fontSize: 20 }}>⏳</Text></View>
                <Text style={styles.tileVal}>{t('worker.home.pending', { count: pendingOfferCount(offers) })}</Text>
                <Text style={styles.tileSub}>{t('worker.home.pendingSub')}</Text>
              </Pressable>
              <Pressable style={styles.tile} onPress={() => router.push('/(worker)/my-jobs')} accessibilityRole="button">
                <View style={[styles.tileIcon, { backgroundColor: color.successLight }]}><Text style={{ fontSize: 20 }}>📅</Text></View>
                <Text style={styles.tileVal}>{t('worker.home.confirmed', { count: confirmedCount(assignments) })}</Text>
                <Text style={styles.tileSub}>{t('worker.home.confirmedSub')}</Text>
              </Pressable>
            </View>

            {/* Jobs near you */}
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t('worker.home.jobsNearYou')}</Text>
              <Pressable onPress={() => router.push('/(worker)/jobs')} hitSlop={8}><Text style={styles.sectionLink}>{t('worker.home.viewAll')}</Text></Pressable>
            </View>
            {jobs.length === 0 ? (
              <EmptyState title={t('worker.home.noJobs.title')} message={t('worker.home.noJobs.message')} />
            ) : (
              jobs.slice(0, 5).map((b) => {
                const label = skillLabel(b, lookups);
                return (
                  <Pressable key={b.id} style={styles.jobCard} onPress={() => router.push(`/(worker)/jobs/${b.id}`)} accessibilityRole="button" accessibilityLabel={label ?? t('worker.home.genericTask')}>
                    <View style={styles.jobIcon}><Text style={{ fontSize: 22 }}>{taskEmoji(label)}</Text></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.jobTitle} numberOfLines={1}>{label ?? t('worker.home.genericTask')}</Text>
                      <Text style={styles.jobMeta} numberOfLines={1}>{t('worker.home.employerAnon', { id: b.employerUserId.slice(0, 6).toUpperCase() })}</Text>
                      <MoneyText minor={b.wageOfferedMinor} currencyCode={b.currencyCode} langCode={lang} size="sm" tone="positive" />
                    </View>
                  </Pressable>
                );
              })
            )}

            {/* Today's tip */}
            {tip ? (
              <>
                <View style={styles.sectionHead}><Text style={styles.sectionTitle}>{t('worker.home.todaysTip')}</Text></View>
                <View style={styles.tipCard}>
                  <Text style={{ fontSize: 30 }}>💡</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tipTitle} numberOfLines={2}>{tip.title}</Text>
                    {tip.body ? <Text style={styles.tipDesc} numberOfLines={3}>{tip.body}</Text> : null}
                  </View>
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  centre: { flex: 1, justifyContent: 'center' },
  greetRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[5], paddingTop: space[3], paddingBottom: space[3] },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: color.accent500, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.white },
  greetName: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800, letterSpacing: -0.3 },
  greetVern: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700, marginTop: 2 },
  scroll: { paddingHorizontal: space[5], paddingBottom: space[8], gap: space[3] },

  earnCard: { padding: space[4], borderRadius: radius.xl, backgroundColor: color.primary700, overflow: 'hidden' },
  earnGlow: { position: 'absolute', top: -30, right: -30, width: 140, height: 140, borderRadius: 70, backgroundColor: color.accent500, opacity: 0.18 },
  earnLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, letterSpacing: 0.8, textTransform: 'uppercase', color: color.white, opacity: 0.7 },
  earnAmt: { fontFamily: font.display, fontSize: 40, fontWeight: font.weight.bold, letterSpacing: -1, color: color.white, marginTop: 6 },
  earnMeta: { fontFamily: font.body, fontSize: font.size.sm, color: color.white, opacity: 0.9, marginTop: space[2] },
  earnActions: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  earnBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', alignItems: 'center' },
  earnBtnTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.white },

  tiles: { flexDirection: 'row', gap: space[3] },
  tile: { flex: 1, backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.lg, padding: space[4], alignItems: 'center' },
  tileIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: space[2] },
  tileVal: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, textAlign: 'center' },
  tileSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2, textAlign: 'center' },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[2] },
  sectionTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  sectionLink: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },

  jobCard: { flexDirection: 'row', gap: space[3], alignItems: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.lg, padding: space[3] },
  jobIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  jobTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  jobMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2, marginBottom: 4 },

  tipCard: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', backgroundColor: color.infoLight, borderRadius: radius.lg, padding: space[4] },
  tipTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800, marginBottom: 4 },
  tipDesc: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, lineHeight: font.size.xs * 1.5 },

  onboardH: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  onboardP: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600 },
});
