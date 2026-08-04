// apps/mobile/src/app/(farmer)/wallet/withdraw.tsx · screen 70 (Withdraw Money) — rebuilt to the Phase-1 design
// (Krishalaya_Design_System/screens/70-wallet-withdraw.html): a green Available-Balance hero, a big amount entry
// with quick chips (incl. a "Max ₹X"), an instant-transfer info banner, a "Transfer to" bank/UPI destination card
// (+ switch destination), and a "Withdraw ₹X →" CTA. Thin screen (guide §3); money is bigint paise (Law 2);
// FLAG_SECURE while shown (§4); behind the `wallet` flag; degrade-never-die (Law 12).
//
// REAL flow: requestWithdrawal(paise, bankAccountId) is an idempotent payout (Law 3). The SERVER is the authority
// on balance / KYC / daily-limits — a 403/409/422 is surfaced as a precise, friendly message (classified pure via
// features/wallet/txn.withdrawErrorKind); the client-side `withdrawable` check is UX-only. A 403 (S3's KYC gate —
// kyc_status must be 'verified') additionally shows an actionable "Complete verification" CTA straight to
// (farmer)/kyc, not just inline text. Balance + destinations are live (walletBalance / listBankAccounts).
// HONEST GAPS (§13, never faked): the design's "withdrawal limit · N transactions left" needs a per-user limit
// read-model the API doesn't expose → shown as a generic "limits apply" note, not a fabricated count. Adding a NEW
// payout destination (vault tokenisation) is the P-03 gap → the "+ Different account" switches among destinations
// already on file (R2-07: worded as a calm "contact support" note, not a broken-sounding "coming soon").
//
// R2-01 (founder screenshot review): AVAILABLE BALANCE used to render MoneyText(balanceMinor) unconditionally —
// walletBalance() degrades to '0' + a `failed` flag on a genuine read failure, and this screen was silently
// dropping the flag, so a failed read looked exactly like a real ₹0 balance (no retry, no indication anything was
// wrong). Now `failed` is tracked and the hero shows a retry affordance instead, and withdrawal is blocked while
// the real balance is unknown (never let the farmer submit against a balance the server couldn't confirm).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SdkError, type BankAccount } from '@krishalaya/sdk-js';
import { Button, EmptyState, SkeletonCard, MoneyText, Icon, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { rupeesToPaiseMinor } from '../../../core/payments/money';
import { withdrawable, withdrawErrorKind } from '../../../features/wallet/txn';
import { withdrawChipRupees, groupDigits } from '../../../features/wallet/amount-entry';
import { walletBalance, listBankAccounts, requestWithdrawal } from '../../../features/wallet/wallet.api';

export default function Withdraw() {
  useSecureScreen();
  const router = useRouter();
  const { t, lang } = useTranslation();
  const enabled = useFlag('wallet');

  const [balanceMinor, setBalanceMinor] = useState('0');
  const [currency, setCurrency] = useState('INR');
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [rupees, setRupees] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [kycRequired, setKycRequired] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [bal, accts] = await Promise.all([walletBalance(), listBankAccounts()]);
    setBalanceMinor(bal.availableMinor); setCurrency(bal.currencyCode); setAccounts(accts); setFailed(bal.failed);
    setSelected((prev) => prev ?? accts.find((a) => a.isPrimary)?.id ?? accts[0]?.id ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const minor = rupeesToPaiseMinor(rupees);
  const check = withdrawable(balanceMinor, minor);
  const chips = withdrawChipRupees(balanceMinor);

  const onSubmit = async () => {
    if (!minor || !selected) { setError(t('addMoney.invalidAmount')); setKycRequired(false); return; }
    if (!check.ok) { setError(t(check.reason === 'exceeds' ? 'withdraw.exceeds' : 'addMoney.invalidAmount')); setKycRequired(false); return; }
    setBusy(true); setError(undefined); setKycRequired(false);
    try {
      await requestWithdrawal(minor, selected);
      router.replace({ pathname: '/(farmer)/wallet', params: { notice: t('withdraw.requested') } });
    } catch (e) {
      // The SERVER is the authority on WHY a payout was refused (Law 11) — 403 is the KYC gate (S3), surfaced
      // here as an actionable prompt (not just inline text) so the farmer can go straight to eKYC.
      const kind = withdrawErrorKind(e instanceof SdkError ? e.status : undefined);
      setKycRequired(kind === 'kyc');
      setError(t(kind === 'kyc' ? 'withdraw.notAllowed' : kind === 'exceeds' ? 'withdraw.exceeds' : 'withdraw.failed'));
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.appbar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back} accessibilityLabel={t('common.back')} accessibilityRole="button"><Icon name="arrow-left" size={20} color={color.ink700} /></Pressable>
        <Text style={styles.appbarTitle}>{t('withdraw.title')}</Text>
        <View style={styles.back} />
      </View>

      {!enabled ? (
        <View style={styles.body}><EmptyState title={t('wallet.unavailable')} /></View>
      ) : loading ? (
        <View style={styles.body}><SkeletonCard lines={2} /><View style={{ height: space[3] }} /><SkeletonCard lines={3} /></View>
      ) : accounts.length === 0 ? (
        <View style={styles.body}><EmptyState title={t('withdraw.noAccount.title')} message={t('withdraw.noAccount.message')} actionLabel={t('common.back')} onAction={() => router.back()} /></View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Balance hero — R2-01: a FAILED read must never look like a confident (possibly wrong) ₹0.00; show
                a distinct retry affordance instead, and never a bare "—" either. */}
            <View style={styles.hero}>
              <Text style={styles.heroLabel}>{t('wallet.available')}</Text>
              {failed ? (
                <Pressable onPress={load} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.heroError}>{t('wallet.retryLoad')}</Text>
                </Pressable>
              ) : (
                <MoneyText minor={balanceMinor} currencyCode={currency} langCode={lang} size="3xl" style={styles.heroValue} />
              )}
              <Text style={styles.heroMeta}>{t('withdraw.limitsNote')}</Text>
            </View>

            {/* Amount entry */}
            <View style={styles.amountWrap}>
              <Text style={styles.amountLabel}>{t('withdraw.howMuch')}</Text>
              <View style={styles.amountRow}>
                <Text style={styles.rupee}>₹</Text>
                <TextInput
                  style={styles.amountInput}
                  value={rupees}
                  onChangeText={(v) => setRupees(v.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  autoFocus
                  maxLength={7}
                  placeholder="0"
                  placeholderTextColor={color.ink300}
                  accessibilityLabel={t('withdraw.howMuch')}
                />
              </View>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              {kycRequired ? (
                <Pressable onPress={() => router.push('/(farmer)/kyc')} hitSlop={8} style={styles.kycCta} accessibilityRole="button">
                  <Text style={styles.kycCtaTxt}>{t('withdraw.completeKyc')} →</Text>
                </Pressable>
              ) : null}
            </View>

            {/* Quick chips (incl. Max) */}
            <View style={styles.chips}>
              {chips.map((c) => {
                const active = rupees === String(c.rupees);
                const label = c.isMax ? t('withdraw.maxChip', { amount: groupDigits(String(c.rupees), lang) }) : `₹${groupDigits(String(c.rupees), lang)}`;
                return (
                  <Pressable key={c.rupees} onPress={() => setRupees(String(c.rupees))} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button">
                    <Text style={[styles.chipTxt, active && styles.chipTxtOn]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Instant-transfer info */}
            <View style={styles.info}>
              <Icon name="shield" size={16} color={color.infoDark} />
              <Text style={styles.infoTxt}>{t('withdraw.instant')}</Text>
            </View>

            {/* Transfer to */}
            <Text style={styles.section}>{t('withdraw.transferTo')}</Text>
            {accounts.map((a) => {
              const active = selected === a.id;
              return (
                <Pressable key={a.id} onPress={() => setSelected(a.id)} style={[styles.bankCard, active && styles.bankCardOn]} accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={acctName(a, t)}>
                  <View style={styles.bankIcon}><Text style={styles.bankIconTxt}>{acctBadge(a)}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bankName}>{acctName(a, t)}</Text>
                    <Text style={styles.bankAcct}>{acctMasked(a)}</Text>
                  </View>
                  {a.isPrimary ? <View style={styles.primaryBadge}><Text style={styles.primaryTxt}>{t('withdraw.primary')}</Text></View> : null}
                </Pressable>
              );
            })}
            {/* Adding a NEW destination is the P-03 vault gap — switching among existing ones only (R2-07: a
                calm "contact support" note, not a broken-sounding "coming soon"). */}
            <Text style={styles.diffNote}>{t('withdraw.switchNote')}</Text>
          </ScrollView>

          <View style={styles.footer}>
            <Button
              title={minor && check.ok ? t('withdraw.submitCta', { amount: `₹${groupDigits(rupees, lang)}` }) : t('withdraw.submit')}
              size="lg"
              onPress={onSubmit}
              loading={busy}
              disabled={!selected || !check.ok || busy || failed}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function acctName(a: BankAccount, t: (k: string) => string): string {
  if (a.accountKind === 'upi') return t('withdraw.upiAccount');
  return a.holderName && a.holderName.trim().length > 0 ? a.holderName : t('withdraw.bankAccount');
}
/** Masked, PII-safe sub-line: never a full account number. */
function acctMasked(a: BankAccount): string {
  if (a.accountKind === 'upi') return a.upiId ?? 'UPI';
  const tail = a.accountLast4 ? `•••• ${a.accountLast4}` : '••••';
  return a.ifsc ? `A/c ${tail} · ${a.ifsc}` : `A/c ${tail}`;
}
function acctBadge(a: BankAccount): string {
  if (a.accountKind === 'upi') return '@';
  const ifsc = a.ifsc ?? '';
  return ifsc ? ifsc.slice(0, 3) : 'BNK';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[2] },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },
  appbarTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  body: { flex: 1, padding: space[5] },
  scroll: { paddingBottom: space[6] },

  hero: { backgroundColor: color.primary700, paddingVertical: space[4], paddingHorizontal: space[5], alignItems: 'center' },
  heroLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.white, opacity: 0.8, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: font.weight.semibold },
  heroValue: { color: color.white, marginTop: 6 },
  heroError: { fontFamily: font.body, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.accent300, marginTop: 6, textDecorationLine: 'underline' },
  heroMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.white, opacity: 0.8, marginTop: 6, textAlign: 'center' },

  amountWrap: { alignItems: 'center', paddingVertical: space[6], paddingHorizontal: space[5] },
  amountLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: space[2] },
  amountRow: { flexDirection: 'row', alignItems: 'center' },
  rupee: { fontFamily: font.display, fontSize: font.size['3xl'], fontWeight: font.weight.bold, color: color.ink400, marginRight: 4 },
  amountInput: { fontFamily: font.display, fontSize: 44, fontWeight: font.weight.bold, color: color.ink800, minWidth: 120, textAlign: 'left', padding: 0 },
  error: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[2] },
  kycCta: { marginTop: space[2] },
  kycCtaTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.primary700 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], justifyContent: 'center', paddingHorizontal: space[5] },
  chip: { paddingVertical: space[2], paddingHorizontal: space[4], backgroundColor: color.card, borderWidth: 1.5, borderColor: color.earth200, borderRadius: radius.pill },
  chipOn: { backgroundColor: color.primary50, borderColor: color.primary600 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  chipTxtOn: { color: color.primary700 },

  info: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], marginHorizontal: space[5], marginTop: space[4], padding: space[3], backgroundColor: color.infoLight, borderWidth: 1, borderColor: color.info, borderRadius: radius.md },
  infoTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.xs, color: color.infoDark, lineHeight: 18 },

  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: space[5], marginTop: space[4], marginBottom: space[2] },
  bankCard: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginHorizontal: space[5], marginBottom: space[2], padding: space[3], backgroundColor: color.card, borderWidth: 1.5, borderColor: color.earth200, borderRadius: radius.lg },
  bankCardOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  bankIcon: { width: 44, height: 44, borderRadius: 10, backgroundColor: color.success, alignItems: 'center', justifyContent: 'center' },
  bankIconTxt: { fontFamily: font.display, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.white },
  bankName: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  bankAcct: { fontFamily: font.body, fontSize: 11, color: color.ink500, marginTop: 2 },
  primaryBadge: { backgroundColor: color.successLight, borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 8 },
  primaryTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.successDark },
  diffNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center', marginTop: space[2], paddingHorizontal: space[5] },

  footer: { paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[4], borderTopWidth: 1, borderTopColor: color.ink100, backgroundColor: color.card },
});
