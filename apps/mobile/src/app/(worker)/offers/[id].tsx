// apps/mobile/src/app/(worker)/offers/[id].tsx · screen 27 (New Job Offer — worker view). Thin screen (guide §3):
// the assignment (wage + status) + its booking for context, with a live respond-window countdown, then accept/
// decline. The SERVER enforces the window (a late accept → 409 "expired") and the 18+ gate (accept hidden unless
// canAcceptWork). Behind `worker_app`. Money via MoneyText (Law 2). Degrade-never-die.
//
// §13 (no contract → rendered honestly, never faked): the employer's NAME + rating/bookings/tenure aren't exposed
// to the worker (privacy) → an anonymised employer + note, never "Ramesh Patel · ⭐4.9"; a specific START-TIME-of-
// day, the DURATION (dailyHours isn't echoed on the booking read), the acreage, the FARM LOCATION/distance and
// free-text SPECIAL INSTRUCTIONS have no fields on the booking read → each is omitted/noted, never invented. What's
// REAL: the respond-by countdown, the task skill (via lookups), the work date, the wage, and how far it sits above
// the statutory minimum (wageOffered − minWage, both snapshotted on the booking).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { LabourAssignment, LabourBooking, WorkerProfile, LabourLookups } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getOffer, getJob, getMyWorker, respondOffer, labourLookups } from '../../../features/labour/labour.api';
import { assignmentActions, canAcceptWork } from '../../../features/labour/labour-status';
import { respondWindow, wageAboveMinMinor, workersNeeded } from '../../../features/labour/offer';

export default function OfferDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_app');
  const [offer, setOffer] = useState<LabourAssignment | null>(null);
  const [booking, setBooking] = useState<LabourBooking | null>(null);
  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    const a = await getOffer(id); setOffer(a); setFailed(!a);
    setWorker(await getMyWorker());
    setLookups(await labourLookups());
    if (a) setBooking(await getJob(a.bookingId));
    setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('jobOffer.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const respond = async (decision: 'accept' | 'reject') => {
    if (!id) return;
    setBusy(decision);
    try {
      await respondOffer(id, decision);
      router.replace({ pathname: '/(worker)/offers', params: { notice: t(decision === 'accept' ? 'worker.accepted' : 'worker.declined') } });
    } catch (e) {
      const msg = e instanceof SdkError && e.isConflict ? t('worker.windowExpired') : e instanceof SdkError && e.isForbidden ? t('worker.cannotAccept') : t('common.error.generic');
      Alert.alert(t('worker.respondFailed'), msg);
    } finally { setBusy(null); }
  };

  const actions = offer ? assignmentActions(offer.status) : [];
  const ageOk = canAcceptWork(worker);
  const win = respondWindow(booking?.respondBy);
  const skill = booking?.taskSkillId ? lookups?.skills.find((s) => s.id === booking.taskSkillId)?.name ?? null : null;
  const wageMinor = offer?.wageMinor ?? booking?.wageOfferedMinor ?? '0';
  const aboveMin = booking ? wageAboveMinMinor(booking.wageOfferedMinor, booking.minWageMinor) : null;
  const ccy = booking?.currencyCode ?? 'INR';

  const footer = offer && actions.length ? (
    ageOk ? (
      <View style={styles.actions}>
        <Button title={t('jobOffer.decline')} variant="outline" disabled={busy !== null} onPress={() => router.push({ pathname: '/(worker)/offers/decline/[id]', params: { id: id! } })} />
        <View style={{ flex: 1 }}><Button title={t('jobOffer.accept', { amount: formatMoneyMinor(wageMinor, ccy, lang) })} loading={busy === 'accept'} disabled={busy !== null} onPress={() => respond('accept')} fullWidth /></View>
      </View>
    ) : undefined
  ) : undefined;

  return (
    <ScreenScaffold title={t('jobOffer.title')} footer={footer}>
      {loading ? <SkeletonCard lines={6} /> : !offer || failed ? (
        <EmptyState title={t('worker.offerUnavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <>
          {/* Banner */}
          <View style={styles.banner}>
            <Text style={styles.bannerTag}>{t('jobOffer.newBooking')}</Text>
            <Text style={styles.bannerTitle}>{t('jobOffer.heading')}</Text>
            <Text style={styles.bannerVern}>{t('jobOffer.headingVern')}</Text>
          </View>

          {/* Respond window (real) */}
          {win ? (
            <Card style={styles.windowCard}>
              <Text style={styles.windowLabel}>{t('jobOffer.respondWithin')}</Text>
              <Text style={styles.windowValue}>{win.expired ? t('jobOffer.expired') : t('jobOffer.countdown', { h: win.hoursLeft, m: win.minutesLeft })}</Text>
              {!win.expired && booking?.respondBy ? <Text style={styles.windowSub}>{t('jobOffer.expiresAt', { time: safeTime(booking.respondBy, lang) })}</Text> : null}
            </Card>
          ) : null}

          {/* Employer — §13 anon */}
          <Card>
            <Text style={styles.h3}>{t('jobOffer.employer')}</Text>
            <Text style={styles.employer}>{booking ? t('jobOffer.employerAnon', { id: booking.employerUserId.slice(0, 6).toUpperCase() }) : '—'}</Text>
            <Text style={styles.note}>{t('jobOffer.employerNote')}</Text>
          </Card>

          {/* Task / When / Duration / Wage */}
          <Card>
            <Row label={t('jobOffer.task')} value={skill ?? '—'} />
            <Row label={t('jobOffer.when')} value={booking?.startDate ? safeDate(booking.startDate, lang) : '—'} />
            <Row label={t('jobOffer.duration')} value={t('jobOffer.durationTbd')} />
            {booking ? <Row label={t('jobOffer.workersNeeded')} value={t('jobOffer.workersValue', workersNeeded(booking.workersNeeded))} /> : null}
            <View style={styles.wageRow}>
              <View>
                <MoneyText minor={wageMinor} currencyCode={ccy} langCode={lang} size="2xl" tone="positive" />
                <Text style={styles.wageLbl}>{t('jobOffer.wageLabel')}</Text>
              </View>
            </View>
            <Text style={styles.wageNote}>{aboveMin ? t('jobOffer.aboveMin', { amount: formatMoneyMinor(aboveMin, ccy, lang) }) : t('jobOffer.paidNote')}</Text>
          </Card>

          {/* §13: farm location + special instructions not on the booking read */}
          <Card><Text style={styles.h3}>{t('jobOffer.farmLocation')}</Text><Text style={styles.note}>{t('jobOffer.locationNote')}</Text></Card>
          <Card><Text style={styles.h3}>{t('jobOffer.instructions')}</Text><Text style={styles.note}>{t('jobOffer.instructionsNote')}</Text></Card>

          {!ageOk && actions.length ? <Text style={styles.gate}>{t('worker.verifyToAccept')}</Text> : null}
        </>
      )}
    </ScreenScaffold>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.rowL}>{label}</Text><Text style={styles.rowV} numberOfLines={2}>{value}</Text></View>;
}
function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return ''; } }
function safeTime(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } }

const styles = StyleSheet.create({
  banner: { padding: space[4], borderRadius: radius.lg, backgroundColor: color.primary50, alignItems: 'center', marginBottom: space[3] },
  bannerTag: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.primary700, letterSpacing: 0.5 },
  bannerTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[2], textAlign: 'center' },
  bannerVern: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700, marginTop: 2 },
  windowCard: { alignItems: 'center', marginBottom: space[3] },
  windowLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink500, textTransform: 'uppercase', letterSpacing: 0.5 },
  windowValue: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.warningDark, marginTop: space[1] },
  windowSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  employer: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1], lineHeight: font.size.xs * 1.5 },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3], paddingVertical: 6, borderTopWidth: 1, borderTopColor: color.ink100 },
  rowL: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  rowV: { flexShrink: 1, textAlign: 'right', fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  wageRow: { marginTop: space[3], paddingTop: space[3], borderTopWidth: 1, borderTopColor: color.ink100 },
  wageLbl: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  wageNote: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.successDark, marginTop: space[2] },
  gate: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[3], textAlign: 'center' },
  actions: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
