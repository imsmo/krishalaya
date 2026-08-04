// apps/mobile/src/app/(worker)/payment-received/[id].tsx · screen 34 (Payment Received). Thin confirmation (guide
// §3): reflects the SERVER's truth that the assignment's wage was settled (status `paid`) into the worker's wallet
// — the app never moves money (Law 11). Success hero + receipt rows + Withdraw / Find-next actions. Money via
// MoneyText (Law 2). Behind `worker_active_job`. Degrade-never-die.
//
// §13 — REAL: the credited amount (assignment.wageMinor), the paid state, the job task (skill via lookups) and the
// work date. HONESTLY degraded (no field on the assignment/booking read → NEVER faked): the payout UTR / txn
// reference, the exact "credited just now" timestamp, the day's HOURS, and — for worker privacy — the payer's NAME
// ("Ramesh Patel") → an anonymised employer. When the wage isn't `paid` yet we show a pending state, never a fake
// success. A settled wage is server-authoritative; the worker withdraws from the wallet (money-out is the server's).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { LabourAssignment, LabourBooking, LabourLookups } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getOffer, getJob, labourLookups } from '../../../features/labour/labour.api';
import { isWagePaid } from '../../../features/labour/worker-jobs';
import { skillLabel } from '../../../features/labour/worker-home';

export default function PaymentReceived() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_active_job');
  const [offer, setOffer] = useState<LabourAssignment | null>(null);
  const [booking, setBooking] = useState<LabourBooking | null>(null);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const a = await getOffer(id); setOffer(a);
    if (a) { const [b, lk] = await Promise.all([getJob(a.bookingId), labourLookups()]); setBooking(b); setLookups(lk); }
    setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('worker.payment.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const paid = offer ? isWagePaid(offer.status) : false;
  const skill = booking ? skillLabel(booking, lookups) : null;
  const ccy = booking?.currencyCode ?? 'INR';
  const dateIso = booking?.startDate ?? offer?.acceptedAt ?? null;

  const footer = paid ? (
    <View style={styles.actions}>
      <Button title={t('worker.payment.withdraw')} onPress={() => router.push('/(worker)/withdraw')} fullWidth />
      <Button title={t('worker.payment.findNext')} variant="outline" onPress={() => router.push('/(worker)/jobs')} fullWidth />
    </View>
  ) : undefined;

  return (
    <ScreenScaffold title={t('worker.payment.title')} footer={footer}>
      {loading ? <SkeletonCard lines={6} /> : !offer ? (
        <EmptyState title={t('worker.offerUnavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <>
          {/* Success / pending hero */}
          <View style={[styles.hero, !paid && styles.heroPending]}>
            <View style={[styles.badge, !paid && styles.badgePending]}><Text style={styles.badgeTxt}>{paid ? '✓' : '⏳'}</Text></View>
            <Text style={styles.heroTitle}>{paid ? t('worker.payment.received') : t('worker.payment.pending')}</Text>
            {paid ? <Text style={styles.heroVern}>पैसा मिल गया</Text> : null}
            <View style={{ marginTop: space[3] }}><MoneyText minor={offer.wageMinor} currencyCode={ccy} langCode={lang} size="2xl" tone={paid ? 'positive' : 'default'} /></View>
            <Text style={styles.heroSub}>{paid ? t('worker.payment.credited') : t('worker.payment.pendingSub')}</Text>
          </View>

          {/* Receipt */}
          <Card>
            <Row label={t('worker.payment.job')} value={skill ?? t('worker.home.genericTask')} />
            <Row label={t('worker.payment.from')} value={booking ? t('worker.home.employerAnon', { id: booking.employerUserId.slice(0, 6).toUpperCase() }) : '—'} />
            <Row label={t('worker.payment.date')} value={dateIso ? safeDate(dateIso, lang) : '—'} />
            <Row label={t('worker.payment.hours')} value={t('worker.payment.hoursNote')} />
            <Row label={t('worker.payment.utr')} value={t('worker.payment.utrNote')} />
          </Card>

          {/* Total */}
          <Card>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{t('worker.payment.total')}</Text>
              <MoneyText minor={offer.wageMinor} currencyCode={ccy} langCode={lang} size="lg" tone="positive" />
            </View>
          </Card>
        </>
      )}
    </ScreenScaffold>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.rowL}>{label}</Text><Text style={styles.rowV} numberOfLines={2}>{value}</Text></View>;
}
function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } }

const styles = StyleSheet.create({
  hero: { alignItems: 'center', padding: space[5], borderRadius: radius.lg, backgroundColor: color.successLight, marginBottom: space[3] },
  heroPending: { backgroundColor: color.infoLight },
  badge: { width: 64, height: 64, borderRadius: 32, backgroundColor: color.successDark, alignItems: 'center', justifyContent: 'center' },
  badgePending: { backgroundColor: color.infoDark },
  badgeTxt: { fontSize: 32, color: color.white },
  heroTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, marginTop: space[3] },
  heroVern: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.successDark, marginTop: 2 },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], paddingVertical: 8, borderTopWidth: 1, borderTopColor: color.ink100 },
  rowL: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  rowV: { flexShrink: 1, textAlign: 'right', fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  actions: { gap: space[3] },
});
