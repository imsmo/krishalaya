// apps/mobile/src/app/(farmer)/hire/book/confirm.tsx · screen 63 (Book · Step 5 of 5 — Confirm & Pay). Thin screen
// (guide §3): the terminal wizard step. It shows the assembled draft (carried as a JSON param), a payment-method
// choice, the honest cost breakdown, and the terms — then POSTs the REAL idempotent createBooking + assignWorker on
// "Confirm Booking". The SERVER snapshots the statutory wage floor and re-checks ownership/18+ (422 sub-floor /
// 403 not-allowed → precise message). FLAG_SECURE (money on screen, §4). Behind `labour_hire`. Money bigint paise
// via MoneyText (Law 2). Degrade-never-die.
//
// §13 — REAL: task (skill via lookups), date, duration, daily wage (paise), the worker's rating + completed jobs +
// 18+ verified badge, and the wallet available balance + sufficiency (bigint). HONESTLY degraded (NEVER faked): the
// worker's NAME → anon; exact START TIME → "confirmed after accept"; reverse-geocoded LOCATION → "my farm (GPS set)";
// the PLATFORM FEE + fee-inclusive TOTAL (₹10/₹410 in the mock) → no labour fee-preview contract, so we show the
// wage the worker receives + "fee applied at settlement", PMSBY as FREE, and never a fabricated grand total. The
// PAYMENT METHOD (wallet vs UPI-on-completion) is carried locally + flagged — createBooking has no paymentMethod
// field yet, and labour wages settle at completion via payWages/escrow regardless.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SdkError, type CreateBookingInput, type WorkerProfile, type LabourLookups } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, Toggle, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../../../core/i18n/useTranslation';
import { useFlag } from '../../../../core/flags/useFlag';
import { useSecureScreen } from '../../../../core/security/screen-guard';
import { createBooking, assignWorker, getWorker, labourLookups } from '../../../../features/labour/hire.api';
import { walletBalance } from '../../../../features/wallet/wallet.api';
import { PAYMENT_METHODS, type PaymentMethod, walletSufficient, confirmFeeLines, committedWageMinor, canConfirm } from '../../../../features/labour/book-confirm';

export default function BookConfirm() {
  useSecureScreen(); // FLAG_SECURE — wage + wallet balance on screen (§4)
  const { t, lang } = useTranslation();
  const router = useRouter();
  const { inputJson, workerId } = useLocalSearchParams<{ inputJson?: string; workerId?: string }>();
  const enabled = useFlag('labour_hire');

  const input: CreateBookingInput | null = React.useMemo(() => { try { return inputJson ? JSON.parse(inputJson) : null; } catch { return null; } }, [inputJson]);
  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [balanceMinor, setBalanceMinor] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('upi'); // default = pay-on-completion (the honest labour path)
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [lk, w, bal] = await Promise.all([labourLookups(), workerId ? getWorker(workerId) : Promise.resolve(null), walletBalance()]);
    setLookups(lk); setWorker(w); setBalanceMinor(bal.failed ? null : bal.availableMinor); setLoading(false);
  }, [workerId]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('bookConfirm.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const ccy = 'INR';
  const skill = input ? lookups?.skills.find((s) => s.id === input.taskSkillId)?.name ?? null : null;
  const wageMinor = input?.wageOfferedMinor ?? '0';
  const committed = committedWageMinor(wageMinor);
  const feeLines = confirmFeeLines(wageMinor);
  const sufficient = walletSufficient(balanceMinor, committed);
  const workerName = workerId ? t('bookWorker.workerAnon', { id: workerId.slice(0, 6).toUpperCase() }) : t('bookTask.aWorker');
  const initials = workerId ? workerId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() : '👤';

  const confirm = async () => {
    if (!input) return;
    setBusy(true);
    try {
      const b = await createBooking(input);
      if (workerId) { try { await assignWorker(b.id, workerId); } catch { /* booking created; assign retriable from the booking */ } }
      router.replace({ pathname: '/(farmer)/hire/sent', params: { bookingNo: b.bookingNo, id: b.id } });
    } catch (e) {
      const msg = e instanceof SdkError && e.status === 422 ? t('hire.book.belowFloor')
        : e instanceof SdkError && e.isForbidden ? t('hire.assign.notAllowed') : t('hire.book.failed');
      Alert.alert(t('hire.book.error'), msg);
    } finally { setBusy(false); }
  };

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('bookConfirm.edit')} variant="outline" disabled={busy} onPress={() => router.back()} />
      <View style={{ flex: 1 }}><Button title={t('bookConfirm.confirmCta', { amount: formatMoneyMinor(committed, ccy, lang) })} onPress={confirm} loading={busy} disabled={busy || !canConfirm(!!input, agreed, method)} fullWidth /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('bookConfirm.title')} scroll={false} footer={footer}>
      <View style={styles.progress}>
        <View style={styles.bar}>
          <View style={[styles.seg, styles.done]} /><View style={[styles.seg, styles.done]} /><View style={[styles.seg, styles.done]} /><View style={[styles.seg, styles.done]} /><View style={[styles.seg, styles.active]} />
        </View>
        <Text style={styles.step}>{t('bookConfirm.step')}</Text>
      </View>

      {loading ? <SkeletonCard lines={12} /> : !input ? (
        <EmptyState title={t('bookReview.missing')} actionLabel={t('common.back')} onAction={() => router.back()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[3] }}>
          <Text style={styles.h2}>{t('bookConfirm.heading')}</Text>

          {/* Worker */}
          <Card>
            <View style={styles.workerRow}>
              <View style={styles.avatar}><Text style={styles.avatarTxt}>{initials}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.workerName}>{workerName}</Text>
                {worker ? (
                  <Text style={styles.workerMeta}>
                    {[worker.ratingAvg != null ? `⭐ ${worker.ratingAvg.toFixed(1)}` : null, t('bookReview.jobs', { n: worker.bookingsCompleted ?? 0 })].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
              {worker?.ageVerified18 ? <StatusPill label={t('bookConfirm.verified')} tone="success" /> : null}
            </View>
          </Card>

          {/* Summary */}
          <Card>
            <Row label={t('bookReview.task')} value={skill ?? '—'} />
            <Row label={t('bookReview.date')} value={safeDate(input.startDate, lang)} />
            <Row label={t('bookReview.time')} value={t('bookReview.timeOnAccept')} />
            <Row label={t('bookReview.duration')} value={t('bookWhen.hrs', { n: input.dailyHours ?? 8 })} />
            <Row label={t('bookReview.location')} value={t('bookReview.locationSet')} />
            <View style={styles.sumRow}>
              <Text style={styles.rowL}>{t('bookConfirm.wage')}</Text>
              <MoneyText minor={wageMinor} currencyCode={ccy} langCode={lang} size="md" />
            </View>
          </Card>

          {/* Payment method */}
          <Card>
            <Text style={styles.h3}>{t('bookConfirm.paymentMethod')}</Text>
            {PAYMENT_METHODS.map((m) => {
              const on = method === m;
              return (
                <Pressable key={m} onPress={() => setMethod(m)} style={[styles.method, on && styles.methodOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                  <Text style={styles.methodIcon}>{m === 'wallet' ? '💳' : '📱'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.methodTitle}>{t(`bookConfirm.method.${m}.title`)}</Text>
                    {m === 'wallet' ? (
                      <Text style={styles.methodSub}>
                        {balanceMinor != null ? t('bookConfirm.balance', { amount: formatMoneyMinor(balanceMinor, ccy, lang) }) : t('bookReview.balanceUnavailable')}
                        {balanceMinor != null ? ` · ${sufficient ? t('bookConfirm.sufficient') : t('bookConfirm.insufficient')}` : ''}
                      </Text>
                    ) : (
                      <Text style={styles.methodSub}>{t('bookConfirm.method.upi.sub')}</Text>
                    )}
                  </View>
                  <View style={[styles.radio, on && styles.radioOn]}>{on ? <Text style={styles.radioTick}>✓</Text> : null}</View>
                </Pressable>
              );
            })}
          </Card>

          {/* Cost breakdown — real wage + honest fee lines (no fabricated total) */}
          <Card>
            {feeLines.map((l) => (
              <View key={l.key} style={styles.costRow}>
                <Text style={styles.rowL}>{t(`bookConfirm.line.${l.key}`)}</Text>
                {l.kind === 'amount' && l.minor ? <MoneyText minor={l.minor} currencyCode={ccy} langCode={lang} size="sm" />
                  : l.kind === 'free' ? <Text style={styles.free}>{t('bookConfirm.free')}</Text>
                  : <Text style={styles.settle}>{t('bookConfirm.atSettlement')}</Text>}
              </View>
            ))}
            <View style={[styles.costRow, styles.totalRow]}>
              <Text style={styles.totalL}>{t('bookConfirm.committed')}</Text>
              <MoneyText minor={committed} currencyCode={ccy} langCode={lang} size="lg" tone="positive" />
            </View>
            <Text style={styles.note}>{t('bookConfirm.feeNote')}</Text>
          </Card>

          {/* Terms */}
          <Card>
            <Text style={styles.termsTitle}>{t('bookConfirm.termsTitle')}</Text>
            <Text style={styles.terms}>{t('bookConfirm.terms', { amount: formatMoneyMinor(committed, ccy, lang), worker: workerName })}</Text>
            <Pressable onPress={() => router.push('/(farmer)/profile/help')} accessibilityRole="link"><Text style={styles.readTerms}>{t('bookConfirm.readTerms')}</Text></Pressable>
            <Toggle label={t('bookConfirm.agree')} value={agreed} onValueChange={setAgreed} />
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
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.ink100 },
  done: { backgroundColor: color.success },
  active: { backgroundColor: color.primary600 },
  step: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.primary700, marginTop: space[2] },
  h2: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[3] },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  workerRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.earth700 },
  workerName: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  workerMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  sumRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3], paddingVertical: 6, borderTopWidth: 1, borderTopColor: color.ink100 },
  rowL: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  rowV: { flexShrink: 1, textAlign: 'right', fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  method: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card, marginBottom: space[2] },
  methodOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  methodIcon: { fontSize: 22 },
  methodTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  methodSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: color.ink300, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: color.primary600, backgroundColor: color.primary600 },
  radioTick: { color: color.white, fontSize: 13, fontWeight: '700' },
  costRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 },
  totalRow: { borderTopWidth: 1, borderTopColor: color.ink100, marginTop: space[1], paddingTop: space[2] },
  totalL: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  free: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.success },
  settle: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[2], lineHeight: font.size.xs * 1.5 },
  termsTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink700, marginBottom: space[1] },
  terms: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, lineHeight: font.size.xs * 1.6, marginBottom: space[2] },
  readTerms: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700, marginBottom: space[3] },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
