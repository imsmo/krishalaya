// apps/mobile/src/app/(farmer)/hire/book/when.tsx · screen 45 (Book · Step 2 — date & time). Thin screen (guide
// §3): pick the work DATE on a month calendar (reusing the tested availability-calendar helpers), a start time, and
// a duration, then continue to wage. Carries the wizard selections forward as params. Behind `labour_hire`.
// Degrade-never-die.
//
// §13 — REAL & carried forward: the work DATE (startDate) and DURATION (dailyHours) are real createBooking fields.
// HONESTLY degraded (no field/endpoint → NEVER faked): the worker's NAME → anon; the calendar "Busy" state needs the
// worker's own booking calendar which isn't exposed to the employer (privacy) → no day is fabricated as busy; and
// the exact START TIME isn't a createBooking field, so it's collected for UX but coordinated with the worker after
// accept (not persisted) — matching the booking form's §13 note.
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { formatDate } from '@krishalaya/i18n';
import { Button, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../../core/i18n/useTranslation';
import { useFlag } from '../../../../core/flags/useFlag';
import { monthMatrix, isoOf } from '../../../../features/labour/availability-calendar';
import { BOOKING_HOURS } from '../../../../features/labour/book-worker';

const DOW = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const SLOTS: Array<{ h: number; label: string; recommended?: boolean }> = [
  { h: 6, label: 'early' }, { h: 7, label: 'morning', recommended: true }, { h: 8, label: 'morning' },
  { h: 9, label: 'lateMorning' }, { h: 14, label: 'afternoon' }, { h: 15, label: 'afternoon' },
];
const DURATION_LABEL: Record<number, string> = { 4: 'half', 6: 'threeQuarter', 8: 'full' };

export default function BookWhen() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ workerId?: string; taskSkillId?: string }>();
  const enabled = useFlag('labour_hire');
  const now = useMemo(() => new Date(), []);
  const todayIso = now.toISOString().slice(0, 10);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month0, setMonth0] = useState(now.getUTCMonth());
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<number>(7);
  const [hours, setHours] = useState<number>(8);

  const matrix = useMemo(() => monthMatrix(year, month0), [year, month0]);

  if (!enabled) return <ScreenScaffold title={t('bookWhen.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const shiftMonth = (d: number) => { const nd = new Date(Date.UTC(year, month0 + d, 1)); setYear(nd.getUTCFullYear()); setMonth0(nd.getUTCMonth()); };
  const next = () => router.push({
    pathname: '/(farmer)/hire/book/where',
    params: { ...(params.workerId ? { workerId: params.workerId } : {}), ...(params.taskSkillId ? { taskSkillId: params.taskSkillId } : {}), ...(date ? { startDate: date } : {}), hours: String(hours) },
  });

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('common.back')} variant="outline" onPress={() => router.back()} />
      <View style={{ flex: 1 }}><Button title={t('bookWhen.next')} onPress={next} disabled={!date} fullWidth /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('bookTask.bookName', { name: params.workerId ? t('bookWorker.workerAnon', { id: params.workerId.slice(0, 6).toUpperCase() }) : t('bookTask.aWorker') })} scroll={false} footer={footer}>
      <View style={styles.progress}>
        <View style={styles.bar}><View style={[styles.seg, styles.done]} /><View style={[styles.seg, styles.active]} /><View style={[styles.seg, styles.pending]} /><View style={[styles.seg, styles.pending]} /></View>
        <Text style={styles.step}>{t('bookWhen.step')}</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[3] }}>
        <View>
          <Text style={styles.h2}>{t('bookWhen.heading')}</Text>
          <Text style={styles.vern}>{t('bookWhen.headingVern')}</Text>
        </View>

        {/* Month nav */}
        <View style={styles.monthNav}>
          <Pressable onPress={() => shiftMonth(-1)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('worker.avail.prevMonth')}><Text style={styles.nav}>‹</Text></Pressable>
          <Text style={styles.monthLabel}>{monthLabel(year, month0, lang)}</Text>
          <Pressable onPress={() => shiftMonth(1)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('worker.avail.nextMonth')}><Text style={styles.nav}>›</Text></Pressable>
        </View>
        <View style={styles.week}>{DOW.map((d, i) => <Text key={i} style={styles.dow}>{t(`worker.avail.dow.${d}`)}</Text>)}</View>
        {matrix.map((wk, wi) => (
          <View key={wi} style={styles.week}>
            {wk.map((cell, ci) => {
              if (!cell) return <View key={ci} style={styles.cell} />;
              const past = cell.iso < todayIso;
              const selected = date === cell.iso;
              return (
                <Pressable key={ci} onPress={() => setDate(cell.iso)} disabled={past} style={[styles.cell, styles.day, selected && styles.daySel, past && styles.dayPast]} accessibilityRole="button" accessibilityState={{ selected, disabled: past }}>
                  <Text style={[styles.dayTxt, selected && styles.dayTxtSel, past && styles.dayTxtPast]}>{cell.day}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
        <View style={styles.legend}>
          <Legend dot={color.card} border label={t('bookWhen.available')} />
          <Legend dot={color.ink200} label={t('bookWhen.busy')} />
          <Legend dot={color.primary600} label={t('bookWhen.selected')} />
        </View>

        {/* Start time */}
        <Text style={styles.h3}>{t('bookWhen.startTime')}</Text>
        <View style={styles.grid}>
          {SLOTS.map((s, i) => {
            const active = slot === s.h;
            return (
              <Pressable key={i} onPress={() => setSlot(s.h)} style={[styles.slot, active && styles.slotOn]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <Text style={[styles.slotTime, active && styles.slotTimeOn]}>{slotTime(s.h, lang)}</Text>
                <Text style={[styles.slotLabel, s.recommended && styles.slotRec]}>{s.recommended ? t('bookWhen.recommended') : t(`bookWhen.slot.${s.label}`)}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.note}>{t('bookWhen.startTimeNote')}</Text>

        {/* Duration */}
        <Text style={styles.h3}>{t('bookWhen.duration')}</Text>
        <View style={styles.durRow}>
          {BOOKING_HOURS.map((h) => {
            const active = hours === h;
            return (
              <Pressable key={h} onPress={() => setHours(h)} style={[styles.dur, active && styles.durOn]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <Text style={[styles.durH, active && styles.durHOn]}>{t('bookWhen.hrs', { n: h })}</Text>
                <Text style={styles.durLabel}>{t(`bookWhen.dur.${DURATION_LABEL[h]}`)}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </ScreenScaffold>
  );
}

function Legend({ dot, label, border }: { dot: string; label: string; border?: boolean }) {
  return <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: dot }, border ? { borderWidth: 1, borderColor: color.ink200 } : null]} /><Text style={styles.legendLbl}>{label}</Text></View>;
}
function monthLabel(year: number, month0: number, lang: string): string { try { return formatDate(`${year}-${String(month0 + 1).padStart(2, '0')}-01T00:00:00Z`, lang, { month: 'long', year: 'numeric' }); } catch { return `${year}`; } }
function slotTime(h: number, lang: string): string { try { return formatDate(`2026-01-01T${String(h).padStart(2, '0')}:00:00`, lang, { hour: 'numeric', minute: '2-digit' }); } catch { return `${h}:00`; } }

const styles = StyleSheet.create({
  progress: { paddingBottom: space[3], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  bar: { flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 4, borderRadius: 2 },
  done: { backgroundColor: color.success },
  active: { backgroundColor: color.primary600 },
  pending: { backgroundColor: color.earth200 },
  step: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.primary700, marginTop: space[2] },
  h2: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[3] },
  vern: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700, marginTop: 2 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nav: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.primary700, paddingHorizontal: space[3] },
  monthLabel: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  week: { flexDirection: 'row', justifyContent: 'space-between' },
  dow: { flex: 1, textAlign: 'center', fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink400 },
  cell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', margin: 2 },
  day: { borderRadius: radius.sm, backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100 },
  daySel: { backgroundColor: color.primary600, borderColor: color.primary600 },
  dayPast: { backgroundColor: 'transparent', borderColor: 'transparent' },
  dayTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  dayTxtSel: { color: color.white },
  dayTxtPast: { color: color.ink300 },
  legend: { flexDirection: 'row', gap: space[4] },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 3 },
  legendLbl: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  slot: { width: '31%', flexGrow: 1, alignItems: 'center', paddingVertical: space[2], borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  slotOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  slotTime: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  slotTimeOn: { color: color.primary800 },
  slotLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  slotRec: { color: color.successDark, fontWeight: font.weight.semibold },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  durRow: { flexDirection: 'row', gap: space[2] },
  dur: { flex: 1, alignItems: 'center', paddingVertical: space[3], borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  durOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  durH: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  durHOn: { color: color.primary800 },
  durLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
