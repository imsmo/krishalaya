// apps/mobile/src/app/(worker)/availability.tsx · screen 36 (Set Availability). Thin screen (guide §3): a
// Monday-first month calendar the worker paints with available / blocked days, plus quick actions and legend
// counts (pure availability-calendar helpers). Behind `worker_app`. Degrade-never-die.
//
// §13 — the BOOKED days are REAL (derived from the worker's confirmed bookings via labour.myScheduledJobs) and are
// immutable here ("Bookings can't be removed here"). The AVAILABLE selection is LOCAL only: the labour contract has
// no availability calendar endpoint yet, so there's no read to seed it and "Save" does NOT fake a persisted write —
// it flags that syncing is coming soon. Nothing is fabricated; when the endpoint lands, wiring load/save is a drop-in.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { formatDate } from '@krishalaya/i18n';
import { Button, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { myScheduledJobs } from '../../features/labour/labour.api';
import { filterByTab } from '../../features/labour/worker-schedule';
import { monthMatrix, dayState, counts, toggleDay, applyQuickAction, type QuickAction } from '../../features/labour/availability-calendar';

type Mode = 'available' | 'block';
const DOW: readonly string[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const QUICK: readonly QuickAction[] = ['weekdays', 'skipSundays', 'next7', 'clear'];

export default function Availability() {
  const { t, lang } = useTranslation();
  const enabled = useFlag('worker_app');
  const now = useMemo(() => new Date(), []);
  const todayIso = now.toISOString().slice(0, 10);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month0, setMonth0] = useState(now.getUTCMonth());
  const [mode, setMode] = useState<Mode>('available');
  const [booked, setBooked] = useState<Set<string>>(new Set());
  const [available, setAvailable] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const jobs = await myScheduledJobs();
    const set = new Set<string>();
    for (const j of filterByTab(jobs, 'upcoming')) if (j.booking?.startDate) set.add(j.booking.startDate.slice(0, 10));
    setBooked(set); setLoading(false);
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const matrix = useMemo(() => monthMatrix(year, month0), [year, month0]);
  const tally = useMemo(() => counts(year, month0, booked, available), [year, month0, booked, available]);

  if (!enabled) return <ScreenScaffold title={t('worker.avail.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const shiftMonth = (delta: number) => { const d = new Date(Date.UTC(year, month0 + delta, 1)); setYear(d.getUTCFullYear()); setMonth0(d.getUTCMonth()); };
  const onDay = (iso: string) => {
    const st = dayState(iso, booked, available, todayIso);
    if (st === 'booked' || st === 'past') return; // immutable / not offerable
    if (mode === 'available') setAvailable((prev) => toggleDay(prev, iso));
    else setAvailable((prev) => { const n = new Set(prev); n.delete(iso); return n; });
  };
  const quick = (a: QuickAction) => setAvailable((prev) => a === 'clear' ? new Set() : new Set([...prev, ...applyQuickAction(a, year, month0, booked, todayIso, now.getTime())]));

  return (
    <ScreenScaffold
      title={t('worker.avail.title')} scroll={false}
      footer={<Button title={t('worker.avail.save')} onPress={() => Alert.alert(t('worker.avail.save'), t('worker.avail.saveSoon'))} fullWidth />}
    >
      {loading ? <SkeletonCard lines={10} /> : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[3] }}>
          <Text style={styles.intro}>{t('worker.avail.intro')}</Text>

          {/* Mode toggle */}
          <View style={styles.modes}>
            <Pressable onPress={() => setMode('available')} style={[styles.mode, mode === 'available' && styles.modeAvailOn]} accessibilityRole="button" accessibilityState={{ selected: mode === 'available' }}>
              <Text style={[styles.modeTxt, mode === 'available' && styles.modeTxtOn]}>✓ {t('worker.avail.markAvailable')}</Text>
            </Pressable>
            <Pressable onPress={() => setMode('block')} style={[styles.mode, mode === 'block' && styles.modeBlockOn]} accessibilityRole="button" accessibilityState={{ selected: mode === 'block' }}>
              <Text style={[styles.modeTxt, mode === 'block' && styles.modeTxtOn]}>✕ {t('worker.avail.blockDate')}</Text>
            </Pressable>
          </View>

          {/* Month nav */}
          <View style={styles.monthNav}>
            <Pressable onPress={() => shiftMonth(-1)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('worker.avail.prevMonth')}><Text style={styles.nav}>‹</Text></Pressable>
            <Text style={styles.monthLabel}>{monthLabel(year, month0, lang)}</Text>
            <Pressable onPress={() => shiftMonth(1)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('worker.avail.nextMonth')}><Text style={styles.nav}>›</Text></Pressable>
          </View>

          {/* Weekday header */}
          <View style={styles.week}>
            {DOW.map((d, i) => <Text key={i} style={styles.dow}>{t(`worker.avail.dow.${d}`)}</Text>)}
          </View>

          {/* Grid */}
          {matrix.map((wk, wi) => (
            <View key={wi} style={styles.week}>
              {wk.map((cell, ci) => {
                if (!cell) return <View key={ci} style={styles.cell} />;
                const st = dayState(cell.iso, booked, available, todayIso);
                return (
                  <Pressable key={ci} onPress={() => onDay(cell.iso)} disabled={st === 'booked' || st === 'past'} style={[styles.cell, styles.day, st === 'available' && styles.dayAvail, st === 'booked' && styles.dayBooked, st === 'past' && styles.dayPast]} accessibilityRole="button" accessibilityState={{ disabled: st === 'booked' || st === 'past' }}>
                    <Text style={[styles.dayTxt, (st === 'available' || st === 'booked') && styles.dayTxtOn, st === 'past' && styles.dayTxtPast]}>{cell.day}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}

          {/* Legend counts */}
          <View style={styles.legend}>
            <Legend n={tally.available} label={t('worker.avail.available')} dot={color.primary500} />
            <Legend n={tally.booked} label={t('worker.avail.booked')} dot={color.infoDark} />
            <Legend n={tally.off} label={t('worker.avail.off')} dot={color.ink200} />
          </View>

          {/* Quick actions */}
          <Text style={styles.quickHead}>{t('worker.avail.quickActions')}</Text>
          <View style={styles.quickRow}>
            {QUICK.map((a) => (
              <Pressable key={a} onPress={() => quick(a)} style={styles.quickBtn} accessibilityRole="button">
                <Text style={styles.quickTxt}>{t(`worker.avail.quick.${a}`)}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function Legend({ n, label, dot }: { n: number; label: string; dot: string }) {
  return (
    <View style={styles.legendItem}>
      <Text style={styles.legendNum}>{n}</Text>
      <View style={styles.legendRow}><View style={[styles.legendDot, { backgroundColor: dot }]} /><Text style={styles.legendLbl}>{label}</Text></View>
    </View>
  );
}
function monthLabel(year: number, month0: number, lang: string): string { try { return formatDate(`${year}-${String(month0 + 1).padStart(2, '0')}-01T00:00:00Z`, lang, { month: 'long', year: 'numeric' }); } catch { return `${year}-${month0 + 1}`; } }

const styles = StyleSheet.create({
  intro: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, lineHeight: font.size.sm * 1.5 },
  modes: { flexDirection: 'row', gap: space[2] },
  mode: { flex: 1, alignItems: 'center', paddingVertical: space[2], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  modeAvailOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  modeBlockOn: { borderColor: color.danger, backgroundColor: color.dangerLight },
  modeTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600 },
  modeTxtOn: { color: color.ink900 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nav: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.primary700, paddingHorizontal: space[3] },
  monthLabel: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  week: { flexDirection: 'row', justifyContent: 'space-between' },
  dow: { flex: 1, textAlign: 'center', fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink400 },
  cell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', margin: 2 },
  day: { borderRadius: radius.sm, backgroundColor: color.earth100 },
  dayAvail: { backgroundColor: color.primary500 },
  dayBooked: { backgroundColor: color.infoDark },
  dayPast: { backgroundColor: 'transparent' },
  dayTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  dayTxtOn: { color: color.white },
  dayTxtPast: { color: color.ink300 },
  legend: { flexDirection: 'row', gap: space[3] },
  legendItem: { flex: 1, backgroundColor: color.card, borderRadius: radius.lg, padding: space[3], alignItems: 'center', gap: 2 },
  legendNum: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLbl: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  quickHead: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  quickBtn: { paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.primary300, backgroundColor: color.card },
  quickTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
});
