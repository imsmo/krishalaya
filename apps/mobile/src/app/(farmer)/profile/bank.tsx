// apps/mobile/src/app/(farmer)/profile/bank.tsx · screen 121 "Bank Accounts". Thin screen (guide §3): the caller's
// payout destinations split into Bank accounts + UPI IDs (MASKED — last-4 / IFSC / VPA, never a raw number), a real
// "Add UPI ID" form, and a security footer. FLAG_SECURE while shown. Behind `farmer_profile`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • Bank BRAND NAME ("State Bank of India") isn't on the BankAccount contract → we show the real IFSC + its
//    deterministic 4-letter bank CODE (bankCodeFromIfsc), never an invented brand name.
//  • "Make default" needs a set-primary mutation that isn't exposed to mobile → the DEFAULT pill reflects the real
//    isPrimary flag, but we don't render a fake make-default action.
//  • UPI "VERIFIED" badge + "Linked to SBI ••••2247" — there is NO verification-status / upi↔bank-link field on
//    BankAccount → omitted, never fabricated.
//  • Full bank-account ADD needs the server-side vault-tokenise step (P1-16, not on this screen) → UPI add only.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { BankAccount } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { myBankAccounts, addUpiAccount } from '../../../features/profile/profile.api';
import { bankLabel, bankCodeFromIfsc, isValidVpa } from '../../../features/profile/profile';

export default function BankAccounts() {
  useSecureScreen();
  const { t } = useTranslation();
  const enabled = useFlag('farmer_profile');
  const [items, setItems] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [upiId, setUpiId] = useState('');
  const [holderName, setHolderName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => { setItems(await myBankAccounts()); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('profile.bankAccounts')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const add = async () => {
    if (!isValidVpa(upiId)) { setError(t('profile.bank.upiInvalid')); return; }
    setSaving(true); setError(undefined);
    try { await addUpiAccount({ upiId: upiId.trim(), holderName: holderName.trim() || undefined, isPrimary: items.length === 0 }); setUpiId(''); setHolderName(''); await load(); }
    catch { Alert.alert(t('profile.bankAccounts'), t('profile.bank.failed')); }
    finally { setSaving(false); }
  };

  const banks = items.filter((a) => a.accountKind === 'bank');
  const upis = items.filter((a) => a.accountKind === 'upi');

  return (
    <ScreenScaffold title={t('profile.bankAccounts')}>
      {loading ? <SkeletonCard lines={6} /> : (
        <>
          {items.length === 0 ? <EmptyState title={t('profile.bank.empty.title')} message={t('profile.bank.empty.message')} /> : null}

          {/* Bank accounts */}
          {banks.length ? <Text style={styles.section}>{t('profile.bank.banksTitle')}</Text> : null}
          {banks.map((item) => (
            <Card key={item.id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.bankCode}>{bankCodeFromIfsc(item.ifsc) ?? t('profile.bank.kind.bank')}</Text>
                {item.isPrimary ? <StatusPill label={t('profile.bank.default')} tone="success" /> : null}
              </View>
              <Text style={styles.acctNo}>{item.accountLast4 ? `XXXX XXXX ${item.accountLast4}` : bankLabel(item)}</Text>
              {item.holderName ? <Text style={styles.meta}>{item.holderName}</Text> : null}
              {item.ifsc ? <Text style={styles.meta}>{t('profile.bank.ifsc')} {item.ifsc}</Text> : null}
            </Card>
          ))}

          {/* UPI IDs */}
          {upis.length ? <Text style={styles.section}>{t('profile.bank.upiTitle')}</Text> : null}
          {upis.map((item) => (
            <Card key={item.id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.vpa}>{item.upiId ?? bankLabel(item)}</Text>
                {item.isPrimary ? <StatusPill label={t('profile.bank.default')} tone="success" /> : null}
              </View>
              {item.holderName ? <Text style={styles.meta}>{item.holderName}</Text> : null}
            </Card>
          ))}

          {/* Add UPI */}
          <Card style={styles.form}>
            <Text style={styles.h}>{t('profile.bank.addUpi')}</Text>
            <Input label={t('profile.bank.upiId')} value={upiId} onChangeText={setUpiId} autoCapitalize="none" keyboardType="email-address" maxLength={100} error={error} placeholder="name@bank" />
            <Input label={t('profile.bank.holder')} value={holderName} onChangeText={setHolderName} maxLength={200} />
            <View style={{ marginTop: space[2] }}><Button title={t('profile.bank.add')} loading={saving} onPress={add} /></View>
            <Text style={styles.note}>{t('profile.bank.bankNote')}</Text>
          </Card>

          {/* Security footer */}
          <View style={styles.security}>
            <Text style={styles.securityIcon}>🔒</Text>
            <Text style={styles.securityTxt}>{t('profile.bank.securityNote')}</Text>
          </View>
        </>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[4], marginBottom: space[2] },
  card: { marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bankCode: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900 },
  acctNo: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700, marginTop: space[1], letterSpacing: 1 },
  vpa: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  meta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[1] },
  form: { marginTop: space[4] },
  h: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, marginBottom: space[2] },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400, marginTop: space[3] },
  security: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], marginTop: space[4], paddingHorizontal: space[1] },
  securityIcon: { fontSize: 16 },
  securityTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, lineHeight: 18 },
});
