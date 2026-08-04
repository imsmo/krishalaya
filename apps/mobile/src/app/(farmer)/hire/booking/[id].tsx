// apps/mobile/src/app/(farmer)/hire/booking/[id].tsx · screen 51 (Job In Progress — employer booking detail) +
// 48/49 lifecycle. Thin screen (guide §3): the booking + its assignment tally + the employer lifecycle actions
// the SERVER authorizes (assign→workers, start, complete, pay, cancel) — a 403/409/422 surfaces a precise message,
// never worked around. Pay settles wages SERVER-SIDE (Law 11). Behind `labour_hire`. Money via MoneyText (Law 2,
// bigint paise). Degrade-never-die.
//
// §13 — REAL: booking no, status, task (skill via lookups), start date, workers-needed, wage (MoneyText), the
// assigned worker (from assignments) + the accepted/pending/declined tally, and the 3-stage progress stepper
// (Scheduled→In progress→Done) derived from the SERVER status. HONESTLY degraded (NEVER faked — no employer
// attendance/read contract yet): the worker's NAME → anonymised avatar+ref; live PROGRESS % / clock-in / expected
// finish / "GPS confirmed" → a note that it appears once the worker clocks in; PROGRESS PHOTOS → coming-soon; the
// platform FEE line + escrow TOTAL (₹10/₹400 in the mock) → not itemised on the booking read, so we show the real
// wage + an honest escrow explanation instead of inventing a fee; task ACRES, day HOURS, farm ADDRESS → omitted.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { LabourBooking, LabourAssignment, LabourLookups } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../../core/i18n/useTranslation';
import { useFlag } from '../../../../core/flags/useFlag';
import { getBooking, bookingAssignments, labourLookups, startBooking, completeBooking, cancelBooking, payWages } from '../../../../features/labour/hire.api';
import { bookingLifecycleActions, bookingStatusTone, tallyAssignments, type EmployerAction } from '../../../../features/labour/booking-flow';
import { bookingProgressStage, progressStepIndex, assignedWorkerId, workerAvatarInitials, PROGRESS_STEPS } from '../../../../features/labour/booking-progress';
import { skillLabel, taskEmoji } from '../../../../features/labour/worker-home';

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('labour_hire');
  const [booking, setBooking] = useState<LabourBooking | null>(null);
  const [assignments, setAssignments] = useState<LabourAssignment[]>([]);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<EmployerAction | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [b, a, lk] = await Promise.all([getBooking(id), bookingAssignments(id), labourLookups()]);
    setBooking(b); setAssignments(a); setLookups(lk); setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('hireBookingDetail.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const run = async (action: EmployerAction, fn: () => Promise<unknown>) => {
    setBusy(action);
    try { await fn(); await load(); }
    catch (e) {
      const msg = e instanceof SdkError && e.isForbidden ? t('hire.action.notAllowed')
        : e instanceof SdkError && (e.status === 409 || e.status === 422) ? t('hire.action.illegal')
        : t('common.error.generic');
      Alert.alert(t('hire.action.failed'), msg);
    } finally { setBusy(null); }
  };

  const onAction = (action: EmployerAction) => {
    if (!id || !booking) return;
    switch (action) {
      case 'assign': router.push({ pathname: '/(farmer)/hire/workers', params: { assignBookingId: id } }); break;
      case 'start': run('start', () => startBooking(id)); break;
      case 'complete': Alert.alert(t('hire.action.complete'), t('hire.action.completeConfirm'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('hire.action.complete'), onPress: () => run('complete', () => completeBooking(id)) }]); break;
      case 'pay': Alert.alert(t('hire.action.pay'), t('hire.action.payConfirm'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('hire.action.pay'), onPress: () => run('pay', () => payWages(id)) }]); break;
      case 'cancel': Alert.alert(t('hire.action.cancel'), t('hire.action.cancelConfirm'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('hire.action.cancel'), style: 'destructive', onPress: () => run('cancel', () => cancelBooking(id)) }]); break;
    }
  };

  const tally = booking ? tallyAssignments(assignments) : null;
  const actions = booking ? bookingLifecycleActions(booking.status) : [];
  const workerId = assignedWorkerId(assignments);
  const initials = workerAvatarInitials(workerId);
  const workerRef = workerId ? t('bookWorker.workerAnon', { id: workerId.slice(0, 6).toUpperCase() }) : t('bookTask.aWorker');
  const skill = booking ? skillLabel(booking, lookups) : null;
  const stage = booking ? bookingProgressStage(booking.status) : 'scheduled';
  const stepIdx = booking ? progressStepIndex(booking.status) : -1;

  return (
    <ScreenScaffold title={booking ? t('worker.jobNo', { id: booking.bookingNo }) : t('hireBookingDetail.title')} scroll={false}>
      {loading ? (
        <View style={{ gap: space[3] }}><SkeletonCard lines={4} /><SkeletonCard lines={5} /><SkeletonCard lines={4} /></View>
      ) : !booking ? (
        <EmptyState title={t('hire.worker.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[8], gap: space[3] }}>
          {/* Status + hero line */}
          <Card>
            <View style={styles.head}>
              <StatusPill label={t(`worker.bookingStatus.${booking.status}`)} tone={bookingStatusTone(booking.status)} />
              <Text style={styles.no}>{t('worker.jobNo', { id: booking.bookingNo })}</Text>
            </View>
            <Text style={styles.hero}>{t(`hireBookingDetail.hero.${stage}`, { worker: workerRef })}</Text>
          </Card>

          {/* Work progress — a stepper from the SERVER status; a live %/clock needs the worker's clock-in (§13). */}
          <Card>
            <Text style={styles.section}>{t('hireBookingDetail.progress')}</Text>
            <View style={styles.stepper}>
              {PROGRESS_STEPS.map((s, i) => {
                const on = stepIdx >= 0 && i <= stepIdx;
                return (
                  <View key={s} style={styles.stepCol}>
                    <View style={[styles.dot, on && styles.dotOn]}>{on ? <Text style={styles.dotTick}>✓</Text> : null}</View>
                    <Text style={[styles.stepLbl, on && styles.stepLblOn]} numberOfLines={1}>{t(`hireBookingDetail.step.${s}`)}</Text>
                  </View>
                );
              })}
            </View>
            <Text style={styles.note}>{t('hireBookingDetail.progressNote')}</Text>
          </Card>

          {/* Worker */}
          <Card>
            <View style={styles.workerRow}>
              <View style={styles.avatar}><Text style={styles.avatarTxt}>{initials ?? '👤'}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.worker}>{workerRef}</Text>
                <Text style={styles.note}>{t('hireBookingDetail.workerLocationNote')}</Text>
              </View>
            </View>
          </Card>

          {/* Job details */}
          <Card>
            <Text style={styles.section}>{t('hireBookingDetail.jobDetails')}</Text>
            <Row k={t('hireBookingDetail.task')} v={`${taskEmoji(skill)} ${skill ?? t('worker.home.genericTask')}`} />
            <Row k={t('hireBookingDetail.duration')} v={t(`worker.wageKind.${booking.wageKind}`)} />
            <Row k={t('hireBookingDetail.started')} v={safeDate(booking.startDate, lang)} />
            <Row k={t('worker.workers')} v={String(booking.workersNeeded)} />
            <View style={styles.row}>
              <Text style={styles.k}>{t('hireBookingDetail.wage')}</Text>
              <MoneyText minor={booking.wageOfferedMinor} currencyCode={booking.currencyCode} langCode={lang} size="md" />
            </View>
          </Card>

          {/* Assignment tally (real) */}
          {tally ? (
            <Card>
              <Text style={styles.section}>{t('hire.tally.title')}</Text>
              <Row k={t('hire.tally.accepted')} v={String(tally.accepted)} />
              <Row k={t('hire.tally.pending')} v={String(tally.pending)} />
              <Row k={t('hire.tally.rejected')} v={String(tally.rejected)} />
            </Card>
          ) : null}

          {/* Progress photos — no contract yet → honest coming-soon, never a fake gallery. */}
          <Card>
            <Text style={styles.section}>{t('hireBookingDetail.photos')}</Text>
            <Text style={styles.note}>{t('hireBookingDetail.photosNote')}</Text>
          </Card>

          {/* Payment — real wage + honest escrow explanation (fee/total are applied SERVER-SIDE at settlement). */}
          <Card>
            <Text style={styles.section}>{t('hireBookingDetail.payment')}</Text>
            <View style={styles.row}>
              <Text style={styles.k}>{t('hireBookingDetail.totalWage')}</Text>
              <MoneyText minor={booking.wageOfferedMinor} currencyCode={booking.currencyCode} langCode={lang} size="md" tone="positive" />
            </View>
            <Text style={styles.escrow}>{t('hireBookingDetail.escrowNote')}</Text>
          </Card>

          {/* Lifecycle actions (real, server-authorized) */}
          <View style={styles.actions}>
            {actions.map((a) => (
              <Button key={a} title={t(`hire.action.${a}`)} variant={a === 'cancel' ? 'outline' : 'primary'} loading={busy === a} disabled={busy !== null} onPress={() => onAction(a)} />
            ))}
            {actions.length === 0 ? <Text style={styles.note}>{t('hire.action.terminal')}</Text> : null}
            <Button title={t('hireBookingDetail.reportIssue')} variant="ghost" onPress={() => router.push('/(farmer)/profile/complaint')} />
          </View>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <View style={styles.row}><Text style={styles.k}>{k}</Text><Text style={styles.v} numberOfLines={1}>{v}</Text></View>;
}

function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return iso; } }

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[2] },
  no: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink700 },
  hero: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink700, marginBottom: space[2] },
  stepper: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: space[2] },
  stepCol: { alignItems: 'center', flex: 1, gap: 6 },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: color.ink200, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card },
  dotOn: { borderColor: color.primary600, backgroundColor: color.primary600 },
  dotTick: { color: color.white, fontSize: 14, fontWeight: '700' },
  stepLbl: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center' },
  stepLblOn: { color: color.primary800, fontWeight: font.weight.semibold },
  workerRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.earth600 ?? color.ink700 },
  worker: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.ink100, gap: space[3] },
  k: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500, flexShrink: 0 },
  v: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, flexShrink: 1, textAlign: 'right' },
  escrow: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[2] },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400 },
  actions: { gap: space[3], marginTop: space[1] },
});
