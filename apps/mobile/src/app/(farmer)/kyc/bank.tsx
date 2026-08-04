// apps/mobile/src/app/(farmer)/kyc/bank.tsx · screen 74 (Add Bank Account — penny-drop). Thin screen (guide §3):
// collect holder name + account number (+ confirm) + IFSC + account type, then "Verify Account" → the REAL
// server-side tokenise (addBankAccountFull → gateway penny-drop, idempotent Law 3). The RAW account number is held
// ONLY in component state and sent ONCE; the server persists ONLY a vault ref + last-4 (§4/DPDP — never
// stored/logged). FLAG_SECURE (bank surface). Behind the `kyc` flag. Degrade-never-die: inline field validation +
// friendly server error. A "Verify via UPI" alternative routes to the UPI destination flow.
//
// §13 (NOT faked): the design resolves a valid IFSC to "State Bank of India, Anand Branch", but there's NO
// IFSC→bank/branch NAME lookup contract on mobile — only the deterministic 4-letter bank CODE is derivable
// (bankCodeFromIfsc). So on a valid IFSC we confirm the real bank code + "valid IFSC", never a fabricated brand +
// branch name. The Savings/Current choice is a real user input sent to tokenise; all labels/notes are fixed chrome.
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, Input, SegmentedControl, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { addBankAccountFull } from '../../../features/profile/profile.api';
import { normalizeIfsc, normalizeAccountNumber, isValidIfsc, validateBankForm, type AccountType } from '../../../features/kyc/bank-setup';
import { bankCodeFromIfsc } from '../../../features/profile/profile';

export default function AddBankAccount() {
  useSecureScreen();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('kyc');

  const [holderName, setHolderName] = useState('');
  const [account, setAccount] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('savings');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!enabled) return <ScreenScaffold title={t('kycBank.title')}><EmptyState title={t('kyc.unavailable')} /></ScreenScaffold>;

  const ifscValid = isValidIfsc(ifsc);
  const bankCode = bankCodeFromIfsc(ifsc);

  const onVerify = async () => {
    const v = validateBankForm({ holderName, accountNumber: account, confirmAccountNumber: confirm, ifsc, accountType });
    if (!v.ok) {
      setError(t(v.reason === 'name' ? 'kycBank.err.name' : v.reason === 'account' ? 'kycBank.err.account' : v.reason === 'mismatch' ? 'kycBank.err.mismatch' : 'kycBank.err.ifsc'));
      return;
    }
    setBusy(true); setError(undefined);
    try {
      await addBankAccountFull({ ...v.input, isPrimary: true }); // raw account sent ONCE; server tokenises + penny-drops
      setAccount(''); setConfirm(''); // clear the raw number from state on hand-off (§4)
      router.replace('/(farmer)/kyc');
    } catch (e) {
      setError(e instanceof SdkError && (e.isValidation || e.status === 422) ? t('kycBank.err.rejected')
        : e instanceof SdkError && e.status === 429 ? t('kycBank.err.tooMany') : t('kycBank.err.failed'));
    } finally { setBusy(false); }
  };

  const footer = (
    <View style={styles.footer}>
      <Button title={t('kycBank.skip')} variant="ghost" onPress={() => router.back()} />
      <View style={{ flex: 1 }}><Button title={t('kycBank.verify')} onPress={onVerify} loading={busy} fullWidth /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('kycBank.title')} scroll={false} footer={footer}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space[4] }}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Text style={styles.heroGlyph}>🏦</Text></View>
          <Text style={styles.heading}>{t('kycBank.heading')}</Text>
          <Text style={styles.subtitle}>{t('kycBank.subtitle')}</Text>
        </View>

        <Text style={styles.section}>{t('kycBank.formTitle')}</Text>
        <Card>
          <Input label={t('kycBank.holderLabel')} value={holderName} onChangeText={(v) => { setHolderName(v); if (error) setError(undefined); }} maxLength={200} />
          <Text style={styles.hint}>{t('kycBank.holderHint')}</Text>

          <View style={styles.gap} />
          <Input label={t('kycBank.accountLabel')} value={account} onChangeText={(v) => { setAccount(normalizeAccountNumber(v)); if (error) setError(undefined); }} keyboardType="number-pad" maxLength={18} />

          <View style={styles.gap} />
          <Input label={t('kycBank.confirmLabel')} value={confirm} onChangeText={(v) => { setConfirm(normalizeAccountNumber(v)); if (error) setError(undefined); }} keyboardType="number-pad" maxLength={18} />

          <View style={styles.gap} />
          <Input label={t('kycBank.ifscLabel')} value={ifsc} onChangeText={(v) => { setIfsc(normalizeIfsc(v)); if (error) setError(undefined); }} autoCapitalize="characters" maxLength={11} placeholder="SBIN0001247" />
          {/* §13: real bank CODE from the IFSC, not a fabricated brand + branch name. */}
          {ifscValid && bankCode ? <Text style={styles.ifscOk}>{t('kycBank.ifscOk', { code: bankCode })}</Text> : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </Card>

        <Text style={styles.section}>{t('kycBank.typeTitle')}</Text>
        <SegmentedControl
          options={[{ value: 'savings', label: t('kycBank.type.savings') }, { value: 'current', label: t('kycBank.type.current') }]}
          value={accountType}
          onChange={(v) => setAccountType(v as AccountType)}
          accessibilityLabel={t('kycBank.typeTitle')}
        />

        {/* OR — verify via UPI (routes to the UPI destination flow) */}
        <View style={styles.orRow}><View style={styles.orLine} /><Text style={styles.orText}>{t('kycBank.or')}</Text><View style={styles.orLine} /></View>
        <Card>
          <Text style={styles.upiTitle}>{t('kycBank.upiTitle')}</Text>
          <Text style={styles.upiDesc}>{t('kycBank.upiDesc')}</Text>
          <View style={{ marginTop: space[2] }}>
            <Button title={t('kycBank.upiCta')} variant="outline" onPress={() => router.push('/(farmer)/profile/bank')} />
          </View>
        </Card>

        {/* Penny-drop note */}
        <View style={styles.safe}>
          <Text style={styles.safeIcon}>🔒</Text>
          <Text style={styles.safeBody}><Text style={styles.safeBold}>{t('kycBank.pennyTitle')} </Text>{t('kycBank.pennyBody')}</Text>
        </View>
      </ScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: space[4], gap: space[1] },
  heroIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  heroGlyph: { fontSize: 30 },
  heading: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, marginTop: space[2] },
  subtitle: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, textAlign: 'center', paddingHorizontal: space[4] },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  hint: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  gap: { height: space[3] },
  ifscOk: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.successDark, marginTop: space[1] },
  error: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[2] },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginVertical: space[4] },
  orLine: { flex: 1, height: 1, backgroundColor: color.ink200 },
  orText: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink400 },
  upiTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  upiDesc: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[1], lineHeight: font.size.sm * 1.4 },
  safe: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], marginTop: space[4], padding: space[3], borderRadius: radius.md, backgroundColor: color.successLight },
  safeIcon: { fontSize: 16 },
  safeBody: { flex: 1, fontFamily: font.body, fontSize: font.size.xs, color: color.successDark, lineHeight: font.size.xs * 1.5 },
  safeBold: { fontWeight: font.weight.bold },
  footer: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
