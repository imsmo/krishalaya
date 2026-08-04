// apps/mobile/src/app/(ambassador)/withdraw.tsx · screen 168 (Withdraw Commission). Thin screen (guide §3):
// the ambassador withdraws their credited commission (their REAL wallet balance — that is the money the payout
// actually moves) to a tokenised bank destination via a REAL, idempotent requestWithdrawal. The SERVER is the
// authority on balance/KYC/limits/fees; the app never moves money (Law 11). FLAG_SECURE while shown. Behind
// `ambassador_training` AND `wallet`. Money is bigint paise (Law 2). Degrade-never-die.
//
// §13 (NOT faked): "Available to withdraw" is the REAL wallet balance. The bank card shows only the fields the
// tokenised BankAccount actually carries (holder / masked last-4 / IFSC) — there is NO bankName field, so the
// mockup's "State Bank of India" is NOT fabricated (we show the IFSC instead). The "+₹1,350 pending (settles in
// 7d)" sub-line is DROPPED — there is no pending-settlement amount/date contract on the wallet. The quick-amount
// chips (₹1,000 / ₹2,500) are fixed UI convenience presets (chrome), and "All" uses the real balance. The
// Summary's "Bank charge FREE / You receive = amount" reflects the platform's zero-fee payout promise; the server
// is authoritative on the final credit (there is no client-side fee-preview contract), stated in the note.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import type { BankAccount } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { Button, Input, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useSecureScreen } from '../../core/security/screen-guard';
import { rupeesToPaiseMinor } from '../../core/payments/money';
import { withdrawable } from '../../features/wallet/txn';
import { walletBalance, listBankAccounts, requestWithdrawal } from '../../features/wallet/wallet.api';

// Fixed quick-amount presets in whole rupees (UI convenience, not per-user data — like add-money's chips).
const PRESET_RUPEES = [1000, 2500];

export default function AmbassadorWithdraw() {
  useSecureScreen();
  const router = useRouter();
  const { t, lang } = useTranslation();
  const enabled = useFlag('ambassador_training') && useFlag('wallet');

  const [balanceMinor, setBalanceMinor] = useState('0');
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [rupees, setRupees] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    const [bal, accts] = await Promise.all([walletBalance(), listBankAccounts()]);
    setBalanceMinor(bal.balanceMinor);
    setAccounts(accts);
    setSelected((prev) => prev ?? accts.find((a) => a.isPrimary)?.id ?? accts[0]?.id ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const minor = useMemo(() => rupeesToPaiseMinor(rupees), [rupees]);
  const check = withdrawable(balanceMinor, minor);
  const canSubmit = !!selected && check.ok && !busy;
  const allRupees = useMemo(() => { try { return (BigInt(balanceMinor) / 100n).toString(); } catch { return '0'; } }, [balanceMinor]);

  if (!enabled) return <ScreenScaffold title={t('ambWithdraw.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const onSubmit = async () => {
    if (!minor || !selected) { setError(t('addMoney.invalidAmount')); return; }
    if (!check.ok) { setError(t(check.reason === 'exceeds' ? 'withdraw.exceeds' : 'addMoney.invalidAmount')); return; }
    setBusy(true); setError(undefined);
    try {
      await requestWithdrawal(minor, selected);
      router.replace({ pathname: '/(ambassador)/commissions', params: { notice: t('withdraw.requested') } });
    } catch (e) {
      const msg = e instanceof SdkError && e.status === 403 ? t('withdraw.notAllowed')
        : e instanceof SdkError && (e.status === 409 || e.status === 422) ? t('withdraw.exceeds')
        : t('withdraw.failed');
      setError(msg);
    } finally { setBusy(false); }
  };

  const submitLabel = minor ? t('ambWithdraw.submit', { amount: formatMoneyMinor(minor, 'INR', lang) }) : t('withdraw.submit');

  return (
    <ScreenScaffold
      title={t('ambWithdraw.title')}
      scroll
      footer={accounts.length ? (
        <View style={styles.ctaRow}>
          <Button title={t('common.cancel')} variant="outline" onPress={() => router.back()} disabled={busy} />
          <View style={{ flex: 1.5 }}><Button title={submitLabel} onPress={onSubmit} loading={busy} disabled={!canSubmit} /></View>
        </View>
      ) : undefined}
    >
      {loading ? <SkeletonCard lines={5} /> : accounts.length === 0 ? (
        <EmptyState title={t('withdraw.noAccount.title')} message={t('withdraw.noAccount.message')} />
      ) : (
        <View style={{ gap: space[4] }}>
          {/* Available balance (real wallet balance) */}
          <Card style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>{t('ambWithdraw.available')}</Text>
            <MoneyText minor={balanceMinor} langCode={lang} size="2xl" tone="positive" />
          </Card>

          {/* Bank destination */}
          <View>
            <Text style={styles.section}>{t('ambWithdraw.withdrawTo')}</Text>
            {accounts.map((a) => {
              const active = selected === a.id;
              return (
                <Pressable key={a.id} onPress={() => setSelected(a.id)} style={[styles.acct, active && styles.acctOn]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    {a.holderName ? <Text style={[styles.acctPrimary, active && styles.acctPrimaryOn]}>{a.holderName}</Text> : null}
                    <Text style={styles.acctLine}>{acctMasked(a)}</Text>
                    {a.ifsc ? <Text style={styles.acctSub}>{t('ambWithdraw.ifsc', { ifsc: a.ifsc })}</Text> : null}
                  </View>
                  {a.isPrimary ? <Text style={styles.primary}>{t('withdraw.primary')}</Text> : null}
                </Pressable>
              );
            })}
          </View>

          {/* Amount + quick chips */}
          <View>
            <Text style={styles.section}>{t('ambWithdraw.amount')}</Text>
            <Input value={rupees} onChangeText={setRupees} keyboardType="number-pad" maxLength={7} placeholder="₹0" error={error} accessibilityLabel={t('ambWithdraw.amount')} />
            <View style={styles.chipRow}>
              {PRESET_RUPEES.map((r) => (
                <Pressable key={r} onPress={() => setRupees(String(r))} accessibilityRole="button" style={styles.chip}>
                  <Text style={styles.chipText}>{formatMoneyMinor(String(r * 100), 'INR', lang)}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setRupees(allRupees)} accessibilityRole="button" style={[styles.chip, styles.chipAll]}>
                <Text style={styles.chipAllText}>{t('ambWithdraw.chipAll', { amount: formatMoneyMinor(balanceMinor, 'INR', lang) })}</Text>
              </Pressable>
            </View>
          </View>

          {/* Summary */}
          <Card style={{ gap: space[2] }}>
            <Text style={styles.summaryTitle}>{t('ambWithdraw.summary')}</Text>
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>{t('ambWithdraw.withdrawing')}</Text>
              <MoneyText minor={minor ?? '0'} langCode={lang} size="md" />
            </View>
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>{t('ambWithdraw.bankCharge')}</Text>
              <Text style={styles.free}>{t('ambWithdraw.free')}</Text>
            </View>
            <View style={[styles.sumRow, styles.sumTotal]}>
              <Text style={styles.sumTotalLabel}>{t('ambWithdraw.youReceive')}</Text>
              <MoneyText minor={minor ?? '0'} langCode={lang} size="lg" tone="positive" />
            </View>
          </Card>

          <Text style={styles.note}>{t('ambWithdraw.receiveNote')}</Text>
        </View>
      )}
    </ScreenScaffold>
  );
}

// Masked account/UPI destination — never the full number (DPDP; only tokenised last-4).
function acctMasked(a: BankAccount): string {
  if (a.accountKind === 'upi') return a.upiId ?? 'UPI';
  return a.accountLast4 ? `XXXX XXXX ${a.accountLast4}` : 'Bank account';
}

const styles = StyleSheet.create({
  balanceCard: { alignItems: 'center', gap: space[1], paddingVertical: space[5] },
  balanceLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink600, marginBottom: space[2] },
  acct: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space[4], borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card, marginBottom: space[2], minHeight: 56, gap: space[3] },
  acctOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  acctPrimary: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  acctPrimaryOn: { color: color.primary800 },
  acctLine: { fontFamily: font.mono ?? font.body, fontSize: font.size.sm, color: color.ink700, letterSpacing: 1 },
  acctSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  primary: { fontFamily: font.body, fontSize: font.size.xs, color: color.primary700 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.pill, borderWidth: 1, borderColor: color.ink200, backgroundColor: color.card, minHeight: 40, justifyContent: 'center' },
  chipText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700 },
  chipAll: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipAllText: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary800 },
  summaryTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  sumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sumLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  free: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.success },
  sumTotal: { borderTopWidth: 1, borderTopColor: color.ink100, paddingTop: space[2], marginTop: space[1] },
  sumTotalLabel: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, textAlign: 'center' },
  ctaRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
