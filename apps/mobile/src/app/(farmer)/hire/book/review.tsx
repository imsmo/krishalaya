// apps/mobile/src/app/(farmer)/hire/book/review.tsx · screen 46 (Book · Step 4 — final review + send). Thin screen
// (guide §3): shows the assembled booking draft (carried from the wage step as a JSON param), then POSTs the REAL
// idempotent createBooking + assignWorker on "Send Booking". The SERVER snapshots the statutory wage floor and
// re-checks ownership/18+ (422 sub-floor / 403 not-allowed → precise message). Behind `labour_hire`. Degrade-never-die.
//
// §13 — REAL: the task (skill via lookups), date, duration, the daily wage (bigint paise, MoneyText), the worker's
// rating + completed jobs, and the wallet balance. HONESTLY degraded (no field/endpoint → NEVER faked): the worker's
// NAME → anon; DISTANCE → omitted; exact START TIME → "confirmed after accept"; the reverse-geocoded LOCATION
// ("Anand, Plot 247") → "my farm (GPS set)"; and — critically — the design's fee BREAKDOWN (platform fee 2.5% ₹10 /
// insurance ₹2 / "You Pay ₹412") has NO labour fee-preview contract, so we show the wage the worker receives + a
// note that platform fee & insurance are applied at settlement, never a fabricated total.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { type CreateBookingInput, type WorkerProfile, type LabourLookups } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, Toggle, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../../../core/i18n/useTranslation';
import { useFlag } from '../../../../core/flags/useFlag';
import { getWorker, labourLookups } from '../../../../features/labour/hire.api';
import { walletBalance } from '../../../../features/wallet/wallet.api';

export default function BookReview() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const { inputJson, workerId } = useLocalSearchParams<{ inputJson?: string; workerId?: string }>();
  const enabled = useFlag('labour_hire');

  const input: CreateBookingInput | null = React.useMemo(() => { try { return inputJson ? JSON.parse(inputJson) : null; } catch { return null; } }, [inputJson]);
  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [balanceMinor, setBalanceMinor] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [lk, w, bal] = await Promise.all([labourLookups(), workerId ? getWorker(workerId) : Promise.resolve(null), walletBalance()]);
    setLookups(lk); setWorker(w); setBalanceMinor(bal.failed ? null : bal.availableMinor); setLoading(false);
  }, [workerId]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('bookReview.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const ccy = 'INR';
  const skill = input ? lookups?.skills.find((s) => s.id === input.taskSkillId)?.name ?? null : null;
  const wageMinor = input?.wageOfferedMinor ?? '0';

  // Step 4 → step 5: the booking is NOT created here; the farmer confirms payment on screen 63, which submits.
  const proceed = () => {
    if (!input) return;
    router.push({ pathname: '/(farmer)/hire/book/confirm', params: { inputJson: inputJson ?? '', ...(workerId ? { workerId } : {}) } });
  };

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('common.back')} variant="outline" onPress={() => router.back()} />
      <View style={{ flex: 1 }}><Button title={t('bookReview.continue')} onPress={proceed} disabled={!agreed || !input} fullWidth /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('bookReview.title')} scroll={false} footer={footer}>
      <View style={styles.progress}>
        <View style={styles.bar}><View style={[styles.seg, styles.done]} /><View style={[styles.seg, styles.done]} /><View style={[styles.seg, styles.done]} /><View style={[styles.seg, styles.active]} /></View>
        <Text style={styles.step}>{t('bookReview.step')}</Text>
      </View>

      {loading ? <SkeletonCard lines={10} /> : !input ? (
        <EmptyState title={t('bookReview.missing')} actionLabel={t('common.back')} onAction={() => router.back()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[3] }}>
          <View>
            <Text style={styles.h2}>{t('bookReview.almost')}</Text>
            <Text style={styles.sub}>{t('bookReview.reviewSub')}</Text>
          </View>

          {/* Worker */}
          <Card>
            <View style={styles.workerRow}>
              <View style={styles.avatar}><Text style={{ fontSize: 18 }}>👤</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.workerName}>{workerId ? t('bookWorker.workerAnon', { id: workerId.slice(0, 6).toUpperCase() }) : t('bookTask.aWorker')}</Text>
                {worker ? <Text style={styles.workerMeta}>{[worker.ratingAvg != null ? `⭐ ${worker.ratingAvg.toFixed(1)}` : null, t('bookReview.jobs', { n: worker.bookingsCompleted ?? 0 })].filter(Boolean).join(' · ')}</Text> : null}
              </View>
            </View>
          </Card>

          {/* Summary */}
          <Card>
            <Row label={t('bookReview.task')} value={skill ?? '—'} />
            <Row label={t('bookReview.date')} value={safeDate(input.startDate, lang)} />
            <Row label={t('bookReview.time')} value={t('bookReview.timeOnAccept')} />
            <Row label={t('bookReview.duration')} value={t('bookWhen.hrs', { n: input.dailyHours ?? 8 })} />
            <Row label={t('bookReview.location')} value={t('bookReview.locationSet')} />
          </Card>

          {/* Cost — §13 no fee preview */}
          <Card>
            <Text style={styles.h3}>{t('bookReview.cost')}</Text>
            <View style={styles.costRow}>
              <Text style={styles.rowL}>{t('bookReview.dailyWage')}</Text>
              <MoneyText minor={wageMinor} currencyCode={ccy} langCode={lang} size="md" />
            </View>
            <Text style={styles.note}>{t('bookReview.feeNote')}</Text>
          </Card>

          {/* Pay from wallet */}
          <Card>
            <View style={styles.payRow}>
              <Text style={{ fontSize: 22 }}>💳</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.payTitle}>{t('bookReview.payWallet')}</Text>
                {balanceMinor != null ? <Text style={styles.payBal}>{t('bookReview.balance', { amount: formatMoneyMinor(balanceMinor, ccy, lang) })}</Text> : <Text style={styles.payBal}>{t('bookReview.balanceUnavailable')}</Text>}
              </View>
            </View>
          </Card>

          {/* Terms */}
          <Card>
            <Text style={styles.termsTitle}>{t('bookReview.termsTitle')}</Text>
            <Text style={styles.terms}>{t('bookReview.terms', { amount: formatMoneyMinor(wageMinor, ccy, lang) })}</Text>
            <Toggle label={t('bookReview.agree')} value={agreed} onValueChange={setAgreed} />
          </Card>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.sumRow}><Text style={styles.rowL}>{label}</Text><Text style={styles.rowV} numberOfLines={2}>{value}</Text></View>;
}
function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch { return iso; } }

const styles = StyleSheet.create({
  progress: { paddingBottom: space[3], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  bar: { flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 4, borderRadius: 2 },
  done: { backgroundColor: color.success },
  active: { backgroundColor: color.primary600 },
  step: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.primary700, marginTop: space[2] },
  h2: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[3] },
  sub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: 2 },
  workerRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  workerName: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  workerMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  sumRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3], paddingVertical: 6, borderTopWidth: 1, borderTopColor: color.ink100 },
  costRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  rowL: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  rowV: { flexShrink: 1, textAlign: 'right', fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[2], lineHeight: font.size.xs * 1.5 },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  payTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  payBal: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  termsTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink700, marginBottom: space[1] },
  terms: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, lineHeight: font.size.xs * 1.6, marginBottom: space[2] },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
