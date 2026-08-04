// apps/mobile/src/app/(worker)/earnings.tsx · screen 35 (My Earnings — worker). Thin screen (guide §3): the
// caller's OWN wallet credit insights (GET /wallet/earnings, aggregated FLOAT-FREE server-side — bigint-minor +
// per-month counts, Law 2) via the PURE features/wallet/earnings helpers, plus the worker's rating and recent
// paid jobs. Period toggle, a monthly hero + MoM %, a stats row, a trailing-7-month bar chart, and recent payments.
// Behind `worker_app`. FLAG_SECURE (money on screen, §4). Degrade-never-die: a failed read → a friendly ₹0 view.
//
// §13 — REAL: the month total + MoM %, jobs-done count, the trailing bar chart + average, the ⭐rating (reviews
// summary), and each recent payment's amount/task/date. HONESTLY degraded (no field/aggregate → NEVER faked): the
// HOURS-worked total (no hours aggregate endpoint yet) → "—"; and on each payment row the employer NAME + the
// per-job HOURS ("Ramesh Patel · 8 hrs" is design seed) → an anonymised employer, no hours line.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import type { WalletInsights, LabourLookups } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useSecureScreen } from '../../core/security';
import { walletEarnings } from '../../features/wallet/wallet.api';
import { currentMonth, momDelta, totalSales, periodTotal, barChart, trailingAverageMinor, type EarningsPeriod } from '../../features/wallet/earnings';
import { getMyWorker, workerRating, myScheduledJobs, labourLookups } from '../../features/labour/labour.api';
import { filterByTab, type ScheduledJob } from '../../features/labour/worker-schedule';
import { skillLabel } from '../../features/labour/worker-home';

const PERIODS: EarningsPeriod[] = ['week', 'month', 'year', 'lifetime'];
const EMPTY: WalletInsights = { fromIso: '', toIso: '', currencyCode: 'INR', totalMinor: '0', byMonth: [], byType: [] };

export default function WorkerEarnings() {
  useSecureScreen();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_app');
  const [view, setView] = useState<WalletInsights>(EMPTY);
  const [ratingAvg, setRatingAvg] = useState<number | null>(null);
  const [paid, setPaid] = useState<ScheduledJob[]>([]);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [period, setPeriod] = useState<EarningsPeriod>('month');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    const worker = await getMyWorker();
    const [ins, jobs, lk, rating] = await Promise.all([
      walletEarnings(), myScheduledJobs(), labourLookups(), worker ? workerRating(worker.userId) : Promise.resolve(null),
    ]);
    setView(ins); setPaid(filterByTab(jobs, 'past')); setLookups(lk);
    setRatingAvg(rating?.averageStars ?? null); setFailed(ins.fromIso === '');
    setLoading(false);
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const period$ = useMemo(() => periodTotal(view.byMonth, period), [view, period]);
  const mom = useMemo(() => momDelta(view.byMonth), [view]);
  const bars = useMemo(() => barChart(view.byMonth, 7), [view]);
  const avgMinor = useMemo(() => trailingAverageMinor(view.byMonth, 7), [view]);
  const cur = currentMonth(view.byMonth);
  const cc = view.currencyCode || 'INR';

  if (!enabled) return <ScreenScaffold title={t('worker.earnings.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('worker.earnings.title')}>
      {loading ? <SkeletonCard lines={12} /> : (
        <>
          {/* Period toggle */}
          <View style={styles.tabs}>
            {PERIODS.map((p) => (
              <Pressable key={p} onPress={() => setPeriod(p)} style={[styles.tab, period === p && styles.tabOn]} accessibilityRole="button" accessibilityState={{ selected: period === p }}>
                <Text style={[styles.tabTxt, period === p && styles.tabTxtOn]}>{t(`worker.earnings.period.${p}`)}</Text>
              </Pressable>
            ))}
          </View>

          {/* Monthly hero */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>{cur ? t('worker.earnings.monthEarnings', { month: monthLong(cur.key, lang) }) : t('worker.earnings.hero.month')}</Text>
            <MoneyText minor={period$.amountMinor} currencyCode={cc} langCode={lang} size="3xl" style={{ color: color.white }} />
            {period === 'month' && mom ? (
              <Text style={styles.heroDelta}>{mom.pct >= 0 ? '↑' : '↓'} {t('worker.earnings.vsLast', { pct: (mom.pct >= 0 ? '+' : '') + mom.pct })}</Text>
            ) : period$.approximate ? <Text style={styles.heroDelta}>{t('worker.earnings.approxNote')}</Text> : null}
          </View>

          {/* Stats */}
          <View style={styles.stats}>
            <Stat value={String(totalSales(view.byMonth))} label={t('worker.earnings.jobsDone')} />
            <Stat value="—" label={t('worker.earnings.hours')} />
            <Stat value={ratingAvg != null ? `⭐ ${ratingAvg.toFixed(1)}` : '—'} label={t('worker.earnings.avgRating')} />
          </View>

          {/* Bar chart */}
          {bars.length ? (
            <Card style={{ marginTop: space[4] }}>
              <View style={styles.chartHead}>
                <Text style={styles.section}>{t('worker.earnings.last7')}</Text>
                <Text style={styles.avg}>{t('worker.earnings.avg', { amount: moneyShort(avgMinor) })}</Text>
              </View>
              <View style={styles.chart}>
                {bars.map((b) => (
                  <View key={b.key} style={styles.barCol}>
                    <View style={styles.barTrack}><View style={[styles.barFill, { height: `${Math.max(b.heightPct, 4)}%` }]} /></View>
                    <Text style={styles.barKey}>{monthShort(b.key, lang)}</Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          {/* Recent payments */}
          <View style={styles.sectionHead}>
            <Text style={styles.section}>{t('worker.earnings.recent')}</Text>
            <Pressable onPress={() => router.push('/(worker)/my-jobs')} hitSlop={8}><Text style={styles.link}>{t('worker.earnings.viewAll')}</Text></Pressable>
          </View>
          {paid.length === 0 ? (
            <EmptyState title={t('worker.earnings.empty.title')} message={t('worker.earnings.empty.message')} />
          ) : paid.slice(0, 5).map((job) => {
            const label = job.booking ? skillLabel(job.booking, lookups) : null;
            const dateIso = job.booking?.startDate ?? job.assignment.acceptedAt ?? null;
            return (
              <View key={job.assignment.id} style={styles.payRow}>
                <View style={styles.dateChip}>
                  <Text style={styles.dateDay}>{dateIso ? safeDate(dateIso, lang, { day: 'numeric' }) : '—'}</Text>
                  <Text style={styles.dateMon}>{dateIso ? safeDate(dateIso, lang, { month: 'short' }) : ''}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.payTitle} numberOfLines={1}>{label ?? t('worker.home.genericTask')}</Text>
                  <Text style={styles.payMeta} numberOfLines={1}>{job.booking ? t('worker.home.employerAnon', { id: job.booking.employerUserId.slice(0, 6).toUpperCase() }) : '—'}</Text>
                </View>
                <MoneyText minor={job.assignment.wageMinor} currencyCode={job.booking?.currencyCode ?? 'INR'} langCode={lang} size="md" tone="positive" />
              </View>
            );
          })}

          {failed ? <View style={{ marginTop: space[3] }}><Button title={t('common.retry')} variant="outline" onPress={load} /></View> : null}
        </>
      )}
    </ScreenScaffold>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return <View style={styles.stat}><Text style={styles.statVal}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}
function monthLong(key: string, lang: string): string { try { return formatDate(`${key}-01T00:00:00Z`, lang, { month: 'long', year: 'numeric' }); } catch { return key; } }
function monthShort(key: string, lang: string): string { try { return formatDate(`${key}-01T00:00:00Z`, lang, { month: 'short' }); } catch { return key; } }
function safeDate(iso: string, langCode: string, opts: Intl.DateTimeFormatOptions): string { try { return formatDate(iso, langCode, opts); } catch { return ''; } }
function moneyShort(minor: string): string { try { const r = Number(BigInt(minor)) / 100; return r >= 1000 ? `₹${Math.round(r / 1000)}k` : `₹${Math.round(r)}`; } catch { return '—'; } }

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: space[2] },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space[2], borderRadius: radius.pill, backgroundColor: color.earth100 },
  tabOn: { backgroundColor: color.primary600 },
  tabTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, fontWeight: font.weight.semibold },
  tabTxtOn: { color: color.white },
  hero: { backgroundColor: color.primary600, borderRadius: radius.lg, padding: space[5], alignItems: 'center', gap: space[1], marginTop: space[4] },
  heroLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.primary100 },
  heroDelta: { fontFamily: font.body, fontSize: font.size.sm, color: color.white, fontWeight: font.weight.semibold, marginTop: space[1] },
  stats: { flexDirection: 'row', gap: space[3], marginTop: space[4] },
  stat: { flex: 1, backgroundColor: color.card, borderRadius: radius.lg, padding: space[3], alignItems: 'center', gap: 2 },
  statVal: { fontFamily: font.display, fontSize: font.size.lg, color: color.ink900, fontWeight: font.weight.bold },
  statLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, textAlign: 'center' },
  chartHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[3] },
  avg: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink500 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 140, gap: space[2] },
  barCol: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end', gap: 4 },
  barTrack: { width: '70%', flex: 1, justifyContent: 'flex-end', backgroundColor: color.page, borderRadius: radius.sm },
  barFill: { width: '100%', backgroundColor: color.primary500, borderRadius: radius.sm },
  barKey: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[4], marginBottom: space[2] },
  section: { fontFamily: font.display, fontSize: font.size.lg, color: color.ink900, fontWeight: font.weight.bold },
  link: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: color.card, borderRadius: radius.lg, padding: space[3], marginBottom: space[2] },
  dateChip: { width: 44, alignItems: 'center', paddingVertical: space[1], borderRadius: radius.sm, backgroundColor: color.earth100 },
  dateDay: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  dateMon: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, textTransform: 'uppercase' },
  payTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  payMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
});
