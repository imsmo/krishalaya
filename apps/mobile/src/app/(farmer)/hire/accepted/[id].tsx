// apps/mobile/src/app/(farmer)/hire/accepted/[id].tsx · screen 48 (Booking Accepted — farmer). Thin screen (guide
// §3): the celebratory status shown when a worker accepts the employer's booking (a notification deep-link target).
// Reads the booking + its assignments; confirms the accepted one, the date, and the wage, then explains the
// clock-in → dual-confirm → payout flow. Behind `labour_hire`. Degrade-never-die.
//
// §13 — REAL: the work date (booking.startDate), the wage (wageOfferedMinor, MoneyText), "N from now" (formatRelative),
// and the accepted assignment. HONESTLY degraded (no field → NEVER faked): the worker's NAME → anon; a worker QUOTE
// ("Will reach on time") — there's no acceptance-message field → omitted; the exact ARRIVAL TIME isn't a booking
// field → "start time confirmed before work day"; and wage is described as "paid on completion" (the payout is at
// dual-confirm) rather than asserting an escrow hold the contract doesn't expose.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { LabourBooking, LabourAssignment } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate, formatRelative } from '@krishalaya/i18n';
import { useTranslation } from '../../../../core/i18n/useTranslation';
import { useFlag } from '../../../../core/flags/useFlag';
import { getBooking, bookingAssignments } from '../../../../features/labour/hire.api';

export default function BookingAccepted() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('labour_hire');
  const [booking, setBooking] = useState<LabourBooking | null>(null);
  const [assignments, setAssignments] = useState<LabourAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    const [b, a] = await Promise.all([getBooking(id), bookingAssignments(id)]);
    setBooking(b); setAssignments(a); setFailed(!b); setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('hireAccepted.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const accepted = assignments.find((a) => a.status === 'accepted') ?? assignments[0] ?? null;
  const worker = accepted ? t('bookWorker.workerAnon', { id: accepted.workerId.slice(0, 6).toUpperCase() }) : t('bookTask.aWorker');
  const ccy = booking?.currencyCode ?? 'INR';

  const steps = ['before', 'onDay', 'after'] as const;

  return (
    <ScreenScaffold title={t('hireAccepted.title')}>
      {loading ? <SkeletonCard lines={10} /> : !booking || failed ? (
        <EmptyState title={t('hireAccepted.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[3] }}>
          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.badge}><Text style={styles.badgeTxt}>✓ {t('hireAccepted.accepted')}</Text></View>
            <Text style={styles.h1}>{t('hireAccepted.heading', { name: worker })}</Text>
            <Text style={styles.arrive}>{t('hireAccepted.arriveOn', { date: safeDate(booking.startDate, lang) })}</Text>
            <Text style={styles.note}>{t('hireAccepted.timeNote')}</Text>
          </View>

          {/* Worker */}
          <Card>
            <View style={styles.workerRow}>
              <View style={styles.avatar}><Text style={{ fontSize: 18 }}>👤</Text></View>
              <Text style={styles.workerName}>{worker}</Text>
            </View>
          </Card>

          {/* Date + escrow */}
          <Card>
            <View style={styles.dateRow}>
              <Text style={{ fontSize: 22 }}>📅</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.dateMain}>{safeDate(booking.startDate, lang)}</Text>
                <Text style={styles.dateSub}>{safeRel(booking.startDate, lang)}</Text>
              </View>
            </View>
            <View style={styles.escrowRow}>
              <Text style={styles.escrowLabel}>{t('hireAccepted.payable')}</Text>
              <MoneyText minor={booking.wageOfferedMinor} currencyCode={ccy} langCode={lang} size="md" tone="positive" />
            </View>
            <Text style={styles.note}>{t('hireAccepted.escrowNote')}</Text>
          </Card>

          {/* What happens next */}
          <Card>
            <Text style={styles.h3}>{t('hireAccepted.nextTitle')}</Text>
            {steps.map((s, i) => (
              <View key={s} style={styles.step}>
                <View style={styles.stepNum}><Text style={styles.stepNumTxt}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>{t(`hireAccepted.step.${s}.title`)}</Text>
                  <Text style={styles.stepBody}>{t(`hireAccepted.step.${s}.body`)}</Text>
                </View>
              </View>
            ))}
          </Card>

          <View style={{ gap: space[3] }}>
            <Button title={t('hireAccepted.viewDetails')} onPress={() => router.replace({ pathname: '/(farmer)/hire/booking/[id]', params: { id: booking.id } })} />
            <Button title={t('hireAccepted.home')} variant="outline" onPress={() => router.replace('/(farmer)/home')} />
          </View>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return iso; } }
function safeRel(iso: string, langCode: string): string { try { return formatRelative(iso, langCode); } catch { return ''; } }

const styles = StyleSheet.create({
  hero: { alignItems: 'center', padding: space[4], borderRadius: radius.lg, backgroundColor: color.successLight },
  badge: { paddingHorizontal: space[3], paddingVertical: 4, borderRadius: radius.pill, backgroundColor: color.successDark },
  badgeTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.white, letterSpacing: 0.5 },
  h1: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, marginTop: space[3], textAlign: 'center' },
  arrive: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700, marginTop: space[2], textAlign: 'center' },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[2], lineHeight: font.size.xs * 1.5 },
  workerRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  workerName: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  dateMain: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  dateSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  escrowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[3], paddingTop: space[3], borderTopWidth: 1, borderTopColor: color.ink100 },
  escrowLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  step: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', paddingVertical: space[2] },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: color.primary600, alignItems: 'center', justifyContent: 'center' },
  stepNumTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.white },
  stepTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  stepBody: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, marginTop: 2, lineHeight: font.size.xs * 1.5 },
});
