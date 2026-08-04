// apps/mobile/src/app/(farmer)/hire/sent.tsx · screen 47 (Booking Sent — status). Thin screen (guide §3): confirms
// the booking was posted + assigned, shows a live respond-by countdown (the worker must accept/decline within the
// server's window), what-happens-next, and a Cancel action. Behind `labour_hire`. Degrade-never-die.
//
// §13 — REAL: the booking number, the respond-by countdown (from booking.respondBy, server-enforced), and Cancel
// (real cancelBooking). HONESTLY degraded (no field/endpoint → NEVER faked): the worker's NAME → anon; "Call worker
// directly" — no employer↔worker masked-call is wired for labour yet → a coming-soon notice, not a fake dialer.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { LabourBooking, LabourAssignment } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getBooking, bookingAssignments, cancelBooking } from '../../../features/labour/hire.api';
import { respondWindow } from '../../../features/labour/offer';

export default function BookingSent() {
  const { bookingNo, id } = useLocalSearchParams<{ bookingNo?: string; id?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('labour_hire');
  const [booking, setBooking] = useState<LabourBooking | null>(null);
  const [assignments, setAssignments] = useState<LabourAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tickNow, setTickNow] = useState(Date.now());

  const load = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    const [b, a] = await Promise.all([getBooking(id), bookingAssignments(id)]);
    setBooking(b); setAssignments(a); setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  // Refresh the countdown each minute.
  useEffect(() => { const h = setInterval(() => setTickNow(Date.now()), 60000); return () => clearInterval(h); }, []);

  const win = useMemo(() => respondWindow(booking?.respondBy, tickNow), [booking?.respondBy, tickNow]);
  const workerId = assignments[0]?.workerId;

  if (!enabled) return <ScreenScaffold title={t('hire.sent.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const cancel = () => {
    if (!id) return;
    Alert.alert(t('hire.sent.cancelTitle'), t('hire.sent.cancelConfirm'), [
      { text: t('common.no'), style: 'cancel' },
      {
        text: t('hire.sent.cancelYes'), style: 'destructive', onPress: async () => {
          setBusy(true);
          try { await cancelBooking(id); router.replace({ pathname: '/(farmer)/hire/bookings', params: { notice: t('hire.sent.cancelled') } }); }
          catch { Alert.alert(t('hire.sent.cancelTitle'), t('common.error.generic')); }
          finally { setBusy(false); }
        },
      },
    ]);
  };

  const worker = workerId ? t('bookWorker.workerAnon', { id: workerId.slice(0, 6).toUpperCase() }) : t('bookTask.aWorker');

  return (
    <ScreenScaffold title={t('hire.sent.title')}>
      {loading ? <SkeletonCard lines={8} /> : (
        <>
          {/* Status hero */}
          <View style={styles.hero}>
            <View style={styles.badge}><Text style={styles.badgeTxt}>{t('hire.sent.waiting')}</Text></View>
            <Text style={styles.h1}>{t('hire.sent.sentTo', { name: worker })}</Text>
            {bookingNo ? <Text style={styles.no}>{t('worker.jobNo', { id: bookingNo })}</Text> : null}
            <Text style={styles.body}>{t('hire.sent.windowNote')}</Text>
            <Text style={styles.body}>{t('hire.sent.notifyNote')}</Text>
          </View>

          {/* Countdown */}
          <Card style={{ alignItems: 'center' }}>
            <Text style={styles.cdLabel}>{t('hire.sent.expectedWithin')}</Text>
            <Text style={styles.cd}>{win ? (win.expired ? t('hire.sent.expired') : t('jobOffer.countdown', { h: win.hoursLeft, m: win.minutesLeft })) : t('hire.sent.noWindow')}</Text>
          </Card>

          {/* What happens next */}
          <Card>
            <Text style={styles.h3}>📱 {t('hire.sent.nextTitle')}</Text>
            <Text style={styles.note}>{t('hire.sent.nextBody')}</Text>
          </Card>

          {/* Actions */}
          <View style={{ marginTop: space[3], gap: space[3] }}>
            {id ? <Button title={t('hire.sent.view')} onPress={() => router.replace({ pathname: '/(farmer)/hire/booking/[id]', params: { id } })} /> : null}
            <Button title={t('hire.sent.call')} variant="outline" onPress={() => Alert.alert(t('hire.sent.call'), t('hire.sent.callSoon'))} />
            <Button title={t('hire.sent.cancel')} variant="danger" loading={busy} disabled={busy} onPress={cancel} />
          </View>
        </>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', padding: space[4], borderRadius: radius.lg, backgroundColor: color.primary50, marginBottom: space[3] },
  badge: { paddingHorizontal: space[3], paddingVertical: 4, borderRadius: radius.pill, backgroundColor: color.warningLight },
  badgeTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.warningDark, letterSpacing: 0.5 },
  h1: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[3], textAlign: 'center' },
  no: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600, marginTop: space[1] },
  body: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[2], textAlign: 'center', lineHeight: font.size.sm * 1.5 },
  cdLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink500, textTransform: 'uppercase', letterSpacing: 0.5 },
  cd: { fontFamily: font.display, fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: color.primary700, marginTop: space[1] },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, lineHeight: font.size.sm * 1.6 },
});
