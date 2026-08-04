// apps/mobile/src/app/(worker)/jobs/[id].tsx · screen 31 (Job Detail — worker view). Thin screen (guide §3): an
// open booking's wage (with how far above the statutory floor), task, date, work type, worker count, plus a
// Decline (back) / Apply footer. "Apply" self-applies to the booking (labour.applyToJob → an interest-pool
// 'applied' assignment; the employer still assigns) — idempotent (Law 3), and gated on the worker being 18+
// (navigation-only; the SERVER is the authority). Money via MoneyText (Law 2). Behind `worker_app`. Degrade-never-die.
//
// §13 — REAL: wage (wageOfferedMinor), above-min (wageOffered − minWage), state minimum (minWageMinor), task
// (skill via lookups), work type (demandType via lookups), start date, workers needed. HONESTLY degraded (no field
// on the booking read → NEVER faked): the free-text job DESCRIPTION, the START TIME + HOURS ("7 AM · 8 hours"), the
// exact LOCATION/DISTANCE ("Anand · 2.4 km · Plot 247" — shared only on accept), the amenities list (Water/Lunch/
// Chai/Tools/Transport/Insurance), the payment terms copy, and — for worker privacy — the employer's NAME + ⭐rating
// + tenure + "View profile" ("Ramesh Patel ✓ · ⭐4.9 · 42 bookings" is design seed) → an anonymised employer + note.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { LabourBooking, LabourLookups, WorkerProfile } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getJob, labourLookups, getMyWorker } from '../../../features/labour/labour.api';
import { canAcceptWork } from '../../../features/labour/labour-status';
import { wageAboveMinMinor } from '../../../features/labour/offer';
import { skillLabel, workTypeLabel, taskEmoji } from '../../../features/labour/worker-home';

export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_app');
  const [job, setJob] = useState<LabourBooking | null>(null);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    const [b, lk, w] = await Promise.all([getJob(id), labourLookups(), getMyWorker()]);
    setJob(b); setLookups(lk); setWorker(w); setFailed(!b); setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('worker.jobDetail.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  // "Apply" opens the confirm-and-apply screen (140), which performs the real idempotent applyToBooking.
  const goApply = () => { if (id) router.push({ pathname: '/(worker)/jobs/apply/[id]', params: { id } }); };

  const ageOk = canAcceptWork(worker);
  const skill = job ? skillLabel(job, lookups) : null;
  const wtype = job ? workTypeLabel(job, lookups) : null;
  const aboveMin = job ? wageAboveMinMinor(job.wageOfferedMinor, job.minWageMinor) : null;
  const ccy = job?.currencyCode ?? 'INR';

  const footer = job && job.status === 'open' ? (
    ageOk ? (
      <View style={styles.actions}>
        <Button title={t('worker.jobDetail.decline')} variant="outline" disabled={busy} onPress={() => router.back()} />
        <View style={{ flex: 1 }}><Button title={t('worker.jobDetail.apply', { amount: formatMoneyMinor(job.wageOfferedMinor, ccy, lang) })} loading={busy} disabled={busy} onPress={apply} fullWidth /></View>
      </View>
    ) : undefined
  ) : undefined;

  return (
    <ScreenScaffold title={t('worker.jobDetail.title')} footer={footer}>
      {loading ? <SkeletonCard lines={8} /> : !job || failed ? (
        <EmptyState title={t('worker.jobUnavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <>
          {/* Hero */}
          <View style={styles.hero}>
            <Text style={styles.recommend}>{t('worker.jobDetail.recommended')}</Text>
            <View style={styles.heroTop}>
              <View style={styles.heroIcon}><Text style={{ fontSize: 26 }}>{taskEmoji(skill)}</Text></View>
              <Text style={styles.heroTitle}>{t('worker.jobDetail.jobTitle', { task: skill ?? t('worker.home.genericTask') })}</Text>
            </View>
            <Text style={styles.heroMeta}>📅 {safeDate(job.startDate, lang)}</Text>

            <View style={styles.wageBox}>
              <Text style={styles.wageLabel}>{t('worker.jobDetail.wageOffered')}</Text>
              <View style={styles.wageRow}>
                <MoneyText minor={job.wageOfferedMinor} currencyCode={ccy} langCode={lang} size="2xl" tone="positive" />
                <Text style={styles.wageKind}>{t(`worker.wageKind.${job.wageKind}`)}</Text>
              </View>
              {aboveMin ? <Text style={styles.aboveMin}>{t('worker.jobDetail.aboveMin', { amount: formatMoneyMinor(aboveMin, ccy, lang) })}</Text> : null}
              <Text style={styles.stateMin}>{t('worker.jobDetail.stateMin', { amount: formatMoneyMinor(job.minWageMinor, ccy, lang) })}</Text>
            </View>
          </View>

          {/* About — §13 no description field */}
          <Card>
            <Text style={styles.h3}>{t('worker.jobDetail.about')}</Text>
            <Text style={styles.note}>{t('worker.jobDetail.aboutNote')}</Text>
          </Card>

          {/* Farmer — §13 anon (employer PII not exposed to worker) */}
          <Card>
            <Text style={styles.h3}>{t('worker.jobDetail.farmer')}</Text>
            <Text style={styles.employer}>{t('worker.home.employerAnon', { id: job.employerUserId.slice(0, 6).toUpperCase() })}</Text>
            <Text style={styles.note}>{t('worker.jobDetail.farmerNote')}</Text>
          </Card>

          {/* What's provided — §13 no amenities field */}
          <Card>
            <Text style={styles.h3}>{t('worker.jobDetail.provided')}</Text>
            <Text style={styles.note}>{t('worker.jobDetail.providedNote')}</Text>
          </Card>

          {/* Job details */}
          <Card>
            <Text style={styles.h3}>{t('worker.jobDetail.details')}</Text>
            <Row label={t('worker.jobDetail.date')} value={safeDate(job.startDate, lang)} />
            <Row label={t('worker.jobDetail.workType')} value={wtype ?? '—'} />
            <Row label={t('worker.jobDetail.workersNeeded')} value={t('worker.jobDetail.workerCount', { count: job.workersNeeded })} />
            {job.womenOnly ? <Row label={t('worker.womenOnly')} value="✓" /> : null}
            <Row label={t('worker.jobDetail.startTime')} value={t('worker.jobDetail.onAccept')} />
            <Row label={t('worker.jobDetail.duration')} value={t('worker.jobDetail.onAccept')} />
            <Row label={t('worker.jobDetail.payment')} value={t('worker.jobDetail.paymentNote')} />
          </Card>

          {/* Location — §13 shared on accept */}
          <Card>
            <Text style={styles.h3}>{t('worker.jobDetail.location')}</Text>
            <Text style={styles.note}>{t('worker.jobDetail.locationNote')}</Text>
          </Card>

          {job.status === 'open' && !ageOk ? <Text style={styles.gate}>{t('worker.verifyToAccept')}</Text> : null}
        </>
      )}
    </ScreenScaffold>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.rowL}>{label}</Text><Text style={styles.rowV} numberOfLines={2}>{value}</Text></View>;
}
function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } }

const styles = StyleSheet.create({
  hero: { padding: space[4], borderRadius: radius.lg, backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, marginBottom: space[3] },
  recommend: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.primary700, letterSpacing: 0.5, textTransform: 'uppercase' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[2] },
  heroIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { flex: 1, fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800 },
  heroMeta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[3] },
  wageBox: { marginTop: space[3], paddingTop: space[3], borderTopWidth: 1, borderTopColor: color.ink100 },
  wageLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink500, textTransform: 'uppercase', letterSpacing: 0.5 },
  wageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2], marginTop: space[1] },
  wageKind: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginBottom: 4 },
  aboveMin: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.successDark, marginTop: space[2] },
  stateMin: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  employer: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1], lineHeight: font.size.xs * 1.5 },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3], paddingVertical: 8, borderTopWidth: 1, borderTopColor: color.ink100 },
  rowL: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  rowV: { flexShrink: 1, textAlign: 'right', fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  gate: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[3], textAlign: 'center' },
  actions: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
