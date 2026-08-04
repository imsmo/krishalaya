// apps/mobile/src/app/(farmer)/hire/book.tsx · screen 26 (Book a Worker — date, hours & wage). Thin screen
// (guide §3): collects the REAL booking fields — task taxonomy (now populated from the real labour lookups),
// work date, day-length (dailyHours), wage (₹→paise via BigInt, Law 2) and farm GPS (core/location) — validates
// via the PURE buildBookingDraft, POSTs an idempotent createBooking (the server snapshots the statutory wage floor
// and REJECTS a sub-floor offer — 422), and, when opened for a specific worker, ASSIGNS them (idempotent; the
// server re-checks ownership/18+/headcount). Behind `labour_hire`. Degrade-never-die.
//
// §13 (no contract → rendered honestly, never faked): a specific START-TIME-of-day and free-text SPECIAL
// INSTRUCTIONS aren't fields on createBooking → the time-of-day is omitted and instructions are noted as shared via
// chat after accept; the exact statutory MIN-WAGE figure has no client read (the server enforces the floor) → we
// show a generic compliance note, not a fabricated "₹350/day"; and there's no labour booking-fee PREVIEW → the
// summary notes the platform fee is applied at settlement rather than inventing "₹10 / ₹410".
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { type LabourLookups } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, MoneyText, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getCurrentFix } from '../../../core/location';
import { buildBookingDraft, type BookingDraftField } from '../../../features/labour/booking-flow';
import { withDailyHours, BOOKING_HOURS } from '../../../features/labour/book-worker';
import { rupeesToWageMinor } from '../../../features/labour/labour-status';
import { labourLookups } from '../../../features/labour/hire.api';
import { formatMoneyMinor } from '@krishalaya/i18n';

const SKILL_LEVELS = ['unskilled', 'semi_skilled', 'skilled', 'highly_skilled'] as const;

export default function BookWorker() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const wp = useLocalSearchParams<{ workerId?: string; taskSkillId?: string; startDate?: string; hours?: string; farmLat?: string; farmLng?: string; landmark?: string }>();
  const { workerId } = wp;
  const enabled = useFlag('labour_hire');

  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [demandTypeCode, setDemand] = useState('');
  const [taskSkillId, setSkill] = useState(wp.taskSkillId ?? '');
  const [regionId, setRegion] = useState('');
  const [skillLevel, setSkillLevel] = useState('skilled');
  const [startDate, setStart] = useState(wp.startDate ?? '');
  const [hours, setHours] = useState<number>(wp.hours ? Number(wp.hours) : 8);
  const [wageRupees, setWage] = useState('');
  // GPS coords are set at the Work-Location step (screen 62) and carried in as params; prefill so the wage step
  // doesn't force a re-capture (the farmer can still re-set with "use my location").
  const [farm, setFarm] = useState<{ lat: number; lng: number } | null>(() => {
    const lat = Number(wp.farmLat), lng = Number(wp.farmLng);
    return Number.isFinite(lat) && Number.isFinite(lng) && (wp.farmLat ?? '') !== '' && (wp.farmLng ?? '') !== '' ? { lat, lng } : null;
  });
  const [errors, setErrors] = useState<BookingDraftField[]>([]);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => { if (enabled) labourLookups().then(setLookups); }, [enabled]);

  const useMyLocation = useCallback(async () => {
    setLocating(true);
    try {
      const r = await getCurrentFix();
      if (r.ok && r.fix) setFarm({ lat: r.fix.lat, lng: r.fix.lng });
      else Alert.alert(t('hire.book.location'), t(`worker.clockIn.gps.${r.reason ?? 'error'}`));
    } finally { setLocating(false); }
  }, [t]);

  if (!enabled) return <ScreenScaffold title={t('bookWorker.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const skillName = lookups?.skills.find((s) => s.id === taskSkillId)?.name ?? null;
  const wageMinor = rupeesToWageMinor(wageRupees);

  // Step 3 of 4: validate + carry the booking draft to the final review step (which submits it). Worker-targeted
  // booking is single-day: end = start, one worker.
  const proceed = () => {
    const draft = buildBookingDraft({ demandTypeCode, taskSkillId, regionId, skillLevel, workersNeeded: '1', startDate, endDate: startDate, wageKind: 'per_day', wageRupees, womenOnly: false, farmLat: farm?.lat ?? null, farmLng: farm?.lng ?? null });
    setErrors(draft.errors);
    if (!draft.ok || !draft.input) return;
    router.push({ pathname: '/(farmer)/hire/book/review', params: { inputJson: JSON.stringify(withDailyHours(draft.input, hours)), ...(workerId ? { workerId } : {}) } });
  };

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('common.back')} variant="outline" onPress={() => router.back()} />
      <View style={{ flex: 1 }}><Button title={t('bookWorker.review')} onPress={proceed} loading={busy} fullWidth /></View>
    </View>
  );

  const err = (f: BookingDraftField) => errors.includes(f) ? t(`hire.book.err.${f}`) : undefined;

  return (
    <ScreenScaffold title={workerId ? t('bookWorker.titleWorker', { id: workerId.slice(0, 6).toUpperCase() }) : t('bookWorker.title')} scroll={false} footer={footer}>
      {/* Step 3 of 4 progress */}
      <View style={styles.progress}>
        <View style={styles.bar}><View style={[styles.seg, styles.done]} /><View style={[styles.seg, styles.done]} /><View style={[styles.seg, styles.active]} /><View style={[styles.seg, styles.pending]} /></View>
        <View style={styles.progressRow}><Text style={styles.step}>{t('bookWorker.step')}</Text><Text style={styles.stepLabel}>{t('bookWorker.stepName')}</Text></View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4] }}>
        <Text style={styles.h2}>{t('bookWorker.when')}</Text>
        <Text style={styles.vern}>{t('bookWorker.whenVern')}</Text>

        {/* Task taxonomy — real lookups */}
        <Text style={styles.label}>{t('bookWorker.task')}</Text>
        <ChipRow items={(lookups?.workTypes ?? []).map((w) => ({ v: w.code, label: w.name }))} value={demandTypeCode} onPick={setDemand} />
        <ChipRow items={(lookups?.skills ?? []).map((s) => ({ v: s.id, label: s.name }))} value={taskSkillId} onPick={setSkill} />
        <ChipRow items={(lookups?.regions ?? []).map((r) => ({ v: r.id, label: r.name }))} value={regionId} onPick={setRegion} />
        <ChipRow items={SKILL_LEVELS.map((s) => ({ v: s, label: t(`hire.skillLevel.${s}`) }))} value={skillLevel} onPick={setSkillLevel} />
        {err('taxonomy') ? <Text style={styles.errText}>{err('taxonomy')}</Text> : null}

        <Input label={t('bookWorker.workDate')} value={startDate} onChangeText={setStart} placeholder="2026-08-18" maxLength={10} error={err('dates')} />

        <Text style={styles.label}>{t('bookWorker.hours')}</Text>
        <ChipRow items={BOOKING_HOURS.map((h) => ({ v: String(h), label: t('bookWorker.hoursOpt', { n: h }) }))} value={String(hours)} onPick={(v) => setHours(Number(v))} />

        <Input label={t('bookWorker.wage')} value={wageRupees} onChangeText={setWage} keyboardType="number-pad" maxLength={9} error={err('wage')} />
        <View style={styles.minwage}><Text style={styles.minwageText}>{t('bookWorker.minWageNote')}</Text></View>

        <Text style={styles.h2}>{t('bookWorker.locationNotes')}</Text>
        <Card style={styles.locCard}>
          <Text style={styles.locText}>{farm ? t('hire.book.located', { lat: farm.lat.toFixed(4), lng: farm.lng.toFixed(4) }) : t('hire.book.noLocation')}</Text>
          <Text style={styles.helper}>{t('bookWorker.gpsNote')}</Text>
          <View style={{ marginTop: space[2] }}><Button title={t('hire.book.useLocation')} variant="outline" loading={locating} onPress={useMyLocation} /></View>
          {errors.includes('location') ? <Text style={styles.errText}>{t('hire.book.err.location')}</Text> : null}
        </Card>
        <Card style={{ marginTop: space[2] }}><Text style={styles.note}>{t('bookWorker.instructionsNote')}</Text></Card>

        {/* Booking summary — real fields */}
        <Text style={styles.h3}>{t('bookWorker.summary')}</Text>
        <Card>
          {workerId ? <Row label={t('bookWorker.sum.worker')} value={t('bookWorker.workerAnon', { id: workerId.slice(0, 6).toUpperCase() })} /> : null}
          <Row label={t('bookWorker.sum.task')} value={skillName ?? '—'} />
          <Row label={t('bookWorker.sum.date')} value={startDate || '—'} />
          <Row label={t('bookWorker.sum.hours')} value={t('bookWorker.hoursOpt', { n: hours })} />
          <View style={styles.sumRow}>
            <Text style={styles.rowL}>{t('bookWorker.sum.wage')}</Text>
            {wageMinor ? <MoneyText minor={wageMinor} langCode={lang} size="md" /> : <Text style={styles.rowV}>—</Text>}
          </View>
          <Text style={styles.note}>{t('bookWorker.feeNote')}</Text>
        </Card>
      </ScrollView>
    </ScreenScaffold>
  );
}

function ChipRow({ items, value, onPick }: { items: { v: string; label: string }[]; value: string; onPick: (v: string) => void }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.chips}>
      {items.map((it) => {
        const active = value === it.v;
        return (
          <Pressable key={it.v} onPress={() => onPick(it.v)} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: active }}>
            <Text style={[styles.chipTxt, active && styles.chipTxtOn]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.sumRow}><Text style={styles.rowL}>{label}</Text><Text style={styles.rowV} numberOfLines={1}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  progress: { paddingBottom: space[3], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  bar: { flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 4, borderRadius: 2 },
  done: { backgroundColor: color.success },
  active: { backgroundColor: color.primary600 },
  pending: { backgroundColor: color.earth200 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] },
  step: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.primary700 },
  stepLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  h2: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4] },
  vern: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700, marginTop: 2, marginBottom: space[2] },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  label: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[3], marginBottom: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { paddingHorizontal: space[3], minHeight: 40, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  chipTxtOn: { color: color.primary800, fontWeight: font.weight.semibold },
  minwage: { marginTop: space[2], padding: space[3], borderRadius: radius.md, backgroundColor: color.successLight },
  minwageText: { fontFamily: font.body, fontSize: font.size.xs, color: color.successDark, lineHeight: font.size.xs * 1.5 },
  locCard: { marginTop: space[2] },
  locText: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700 },
  helper: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[2], lineHeight: font.size.xs * 1.5 },
  sumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], paddingVertical: 6 },
  rowL: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  rowV: { flexShrink: 1, textAlign: 'right', fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  errText: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[2] },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
