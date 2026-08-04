// apps/mobile/src/app/(worker)/active-job/[id].tsx · screen 33 (Active Job). Thin screen (guide §3): the accepted
// assignment + its booking + the caller's OPEN attendance row. Lifecycle: not-yet-clocked-in → Clock in (device
// sends only its GPS fix; the ≤100m farm geofence is enforced SERVER-side); clocked-in → a live worked-time
// stopwatch + "Mark job complete" (clock out → the employer dual-confirms + pays); done → awaiting confirmation /
// payment. Idempotent writes (Law 3). Money via MoneyText (Law 2). Behind `worker_active_job`. Degrade-never-die.
//
// §13 — REAL: check-in time + break (attendance), the live worked-time (derived from the server clock-in stamp),
// the agreed wage, task (skill via lookups), and the clock-in/out transitions. HONESTLY degraded (no field on the
// read → NEVER faked): a running EARNING rupee figure (money settles server-side on completion → we show the agreed
// wage, not a client-computed running total), the day's HOURS, the "paid by" copy, and — for worker privacy — the
// farmer's NAME + PHONE ("Ramesh Patel · 📞 +91…") → an anonymised farmer. "Report a problem" has no worker labour-
// dispute endpoint yet → it lists the reason categories + routes the worker to their ambassador, never a dead button.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { LabourAssignment, LabourBooking, LabourAttendance, LabourLookups } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getOffer, getJob, labourLookups, currentAttendance, clockInJob, clockOutJob } from '../../../features/labour/labour.api';
import { skillLabel, taskEmoji } from '../../../features/labour/worker-home';
import { attendancePhase, elapsedWorkedSeconds, formatStopwatch } from '../../../features/labour/active-job';
import { canClockIn } from '../../../features/labour/worker-jobs';
import { getCurrentFix } from '../../../core/location';

export default function ActiveJob() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_active_job');
  const [offer, setOffer] = useState<LabourAssignment | null>(null);
  const [booking, setBooking] = useState<LabourBooking | null>(null);
  const [att, setAtt] = useState<LabourAttendance | null>(null);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    const a = await getOffer(id); setOffer(a); setFailed(!a);
    if (a) {
      const [b, at, lk] = await Promise.all([getJob(a.bookingId), currentAttendance(a.id), labourLookups()]);
      setBooking(b); setAtt(at); setLookups(lk);
    }
    setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const phase = attendancePhase(att);
  // Live worked-time stopwatch (display only) while clocked in.
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (phase !== 'working' || !att?.clockInAt) { if (tick.current) clearInterval(tick.current); return; }
    const update = () => setSeconds(elapsedWorkedSeconds(att.clockInAt, att.breakMinutes, Date.now()));
    update();
    tick.current = setInterval(update, 1000);
    return () => { if (tick.current) clearInterval(tick.current); };
  }, [phase, att?.clockInAt, att?.breakMinutes]);

  if (!enabled) return <ScreenScaffold title={t('worker.activeJob.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const clockIn = async () => {
    setBusy(true);
    try {
      const fix = await getCurrentFix();
      if (!fix.ok) { Alert.alert(t('worker.clockIn.title'), t(`worker.clockIn.gps.${fix.reason}`)); return; }
      await clockInJob(id!, { lat: fix.fix.lat, lng: fix.fix.lng });
      await load();
    } catch (e) {
      const msg = e instanceof SdkError && (e.isForbidden || e.isConflict) ? t('worker.clockIn.tooFar') : t('common.error.generic');
      Alert.alert(t('worker.clockIn.blocked'), msg);
    } finally { setBusy(false); }
  };

  const complete = async () => {
    setBusy(true);
    try {
      await clockOutJob(id!, att?.breakMinutes ?? 0);
      await load();
    } catch { Alert.alert(t('worker.activeJob.completeFailed'), t('common.error.generic')); } finally { setBusy(false); }
  };

  const skill = booking ? skillLabel(booking, lookups) : null;
  const ccy = booking?.currencyCode ?? 'INR';
  const wageMinor = offer?.wageMinor ?? booking?.wageOfferedMinor ?? '0';
  const farmerAnon = booking ? t('worker.home.employerAnon', { id: booking.employerUserId.slice(0, 6).toUpperCase() }) : '—';

  const footer = phase === 'working' ? (
    <Button title={t('worker.activeJob.markComplete')} loading={busy} disabled={busy} onPress={complete} fullWidth />
  ) : phase === 'none' && canClockIn(booking?.status) ? (
    <Button title={t('worker.clockIn.action')} loading={busy} disabled={busy} onPress={clockIn} fullWidth />
  ) : undefined;

  return (
    <ScreenScaffold title={t('worker.activeJob.title')} footer={footer}>
      {loading ? <SkeletonCard lines={8} /> : !offer || failed ? (
        <EmptyState title={t('worker.offerUnavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : phase === 'none' ? (
        <Card>
          <View style={styles.iconRow}><View style={styles.icon}><Text style={{ fontSize: 22 }}>{taskEmoji(skill)}</Text></View><Text style={styles.h2}>{skill ?? t('worker.home.genericTask')}</Text></View>
          <Text style={styles.note}>{canClockIn(booking?.status) ? t('worker.clockIn.fence') : t('worker.activeJob.notStarted')}</Text>
        </Card>
      ) : (
        <>
          {/* Status hero */}
          <View style={styles.hero}>
            {phase === 'working' ? <StatusPill label={t('worker.activeJob.inProgress')} tone="success" /> : <StatusPill label={t('worker.activeJob.done')} tone="info" />}
            <View style={styles.iconRow}><View style={styles.icon}><Text style={{ fontSize: 22 }}>{taskEmoji(skill)}</Text></View><Text style={styles.h1}>{skill ?? t('worker.home.genericTask')}</Text></View>
            {att?.clockInAt ? <Text style={styles.checkin}>{t('worker.activeJob.checkedIn', { time: safeTime(att.clockInAt, lang), farm: farmerAnon })}</Text> : null}
          </View>

          {/* Live timer */}
          <Card style={{ alignItems: 'center' }}>
            <Text style={styles.timerLabel}>{t('worker.activeJob.timeWorked')}</Text>
            <Text style={styles.timer}>{phase === 'working' ? formatStopwatch(seconds) : formatStopwatch(elapsedWorkedSeconds(att?.clockInAt, att?.breakMinutes, att?.clockOutAt ? Date.parse(att.clockOutAt) : Date.now()))}</Text>
            <View style={styles.stats}>
              <Stat label={t('worker.activeJob.stat.start')} value={att?.clockInAt ? safeTime(att.clockInAt, lang) : '—'} />
              <Stat label={t('worker.activeJob.stat.break')} value={t('worker.activeJob.minutes', { n: att?.breakMinutes ?? 0 })} />
              <Stat label={t('worker.activeJob.stat.earn')} valueNode={<MoneyText minor={wageMinor} currencyCode={ccy} langCode={lang} size="md" tone="positive" />} />
            </View>
          </Card>

          {/* Job details */}
          <Card>
            <Text style={styles.h3}>{t('worker.jobDetail.details')}</Text>
            <Row label={t('worker.jobDetail.wageOffered')} valueNode={<MoneyText minor={wageMinor} currencyCode={ccy} langCode={lang} size="sm" />} />
            <Row label={t('worker.jobDetail.workType')} value={t(`worker.wageKind.${booking?.wageKind ?? 'per_day'}`)} />
            <Row label={t('worker.activeJob.hours')} value={t('worker.jobDetail.onAccept')} />
            <Row label={t('worker.activeJob.paidBy')} value={t('worker.activeJob.paidByNote')} />
          </Card>

          {/* Farmer — §13 anon */}
          <Card>
            <Text style={styles.h3}>{t('worker.jobDetail.farmer')}</Text>
            <Text style={styles.employer}>{farmerAnon}</Text>
            <Text style={styles.note}>{t('worker.activeJob.farmerNote')}</Text>
          </Card>

          {/* Issues — routes to the Wage-Dispute screen (filed as high-priority support; §13 no labour-dispute endpoint) */}
          <Card>
            <Text style={styles.h3}>{t('worker.activeJob.issues')}</Text>
            <Text style={styles.note}>{t('worker.activeJob.reportNote')}</Text>
            <Button title={t('worker.activeJob.report')} variant="outline" size="sm" onPress={() => router.push({ pathname: '/(worker)/dispute/[id]', params: { id: id! } })} />
          </Card>

          {phase === 'done' ? <Text style={styles.doneNote}>{t('worker.activeJob.awaitingConfirm')}</Text> : null}
        </>
      )}
    </ScreenScaffold>
  );
}

function Stat({ label, value, valueNode }: { label: string; value?: string; valueNode?: React.ReactNode }) {
  return <View style={styles.stat}><Text style={styles.statLabel}>{label}</Text>{valueNode ?? <Text style={styles.statVal}>{value}</Text>}</View>;
}
function Row({ label, value, valueNode }: { label: string; value?: string; valueNode?: React.ReactNode }) {
  return <View style={styles.row}><Text style={styles.rowL}>{label}</Text>{valueNode ?? <Text style={styles.rowV} numberOfLines={2}>{value}</Text>}</View>;
}
function safeTime(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } }

const styles = StyleSheet.create({
  hero: { padding: space[4], borderRadius: radius.lg, backgroundColor: color.primary50, marginBottom: space[3] },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[2] },
  icon: { width: 44, height: 44, borderRadius: 12, backgroundColor: color.card, alignItems: 'center', justifyContent: 'center' },
  h1: { flex: 1, fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800 },
  h2: { flex: 1, fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  checkin: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[3] },
  timerLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink500, textTransform: 'uppercase', letterSpacing: 0.8 },
  timer: { fontFamily: font.display, fontSize: 40, fontWeight: font.weight.bold, color: color.primary700, letterSpacing: 1, marginTop: space[1] },
  stats: { flexDirection: 'row', gap: space[2], marginTop: space[4], width: '100%' },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  statVal: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  employer: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  reportTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.dangerDark },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1], lineHeight: font.size.xs * 1.5 },
  doneNote: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, textAlign: 'center', marginTop: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], paddingVertical: 8, borderTopWidth: 1, borderTopColor: color.ink100 },
  rowL: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  rowV: { flexShrink: 1, textAlign: 'right', fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
});
