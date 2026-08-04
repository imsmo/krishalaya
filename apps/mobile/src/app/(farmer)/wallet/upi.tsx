// apps/mobile/src/app/(farmer)/wallet/upi.tsx · screen 180 (UPI IDs). Thin screen (guide §3): lists the caller's
// linked UPI payout destinations and adds a new one (real: myBankAccounts filtered to UPI + addUpiAccount,
// idempotent Law 3). FLAG_SECURE (payout surface, §4). Behind `farmer_profile`. Degrade-never-die: skeleton /
// designed empty / inline add-error.
//
// §13 (NOT faked): each row shows the REAL VPA, its handle tag (derived from the VPA itself), and the DEFAULT pill
// from the real isPrimary flag. The design's "VERIFIED" badge is now backed by a REAL field — the wallet
// saved-instruments read (P0-4) exposes a `verified` flag (penny_verified_at on the account) — so we render it
// only when the server reports it, never fabricated. The linked-bank line ("SBI ••••2247") still has NO field for a
// UPI destination → we keep omitting it. The ₹1 penny-verify note is fixed policy chrome; the SERVER verifies (Law 11).
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { BankAccount } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { myBankAccounts, addUpiAccount } from '../../../features/profile/profile.api';
import { walletInstruments } from '../../../features/wallet/wallet.api';
import { isValidVpa } from '../../../features/profile/profile';
import { upiHandleTag, applyUpiHandle, COMMON_UPI_HANDLES } from '../../../features/profile/upi';

export default function UpiIds() {
  useSecureScreen();
  const { t } = useTranslation();
  const enabled = useFlag('farmer_profile');
  const [items, setItems] = useState<BankAccount[]>([]);
  const [verifiedById, setVerifiedById] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [vpa, setVpa] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    // Bank accounts drive the list; the wallet instruments read (P0-4) supplies the REAL `verified` flag per account.
    const [accts, instruments] = await Promise.all([myBankAccounts(), walletInstruments()]);
    setItems(accts);
    setVerifiedById(Object.fromEntries(instruments.accounts.map((a) => [a.id, a.verified])));
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } else setLoading(false); }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('upiIds.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const upis = items.filter((a) => a.accountKind === 'upi');

  const add = async () => {
    if (!isValidVpa(vpa)) { setError(t('upiIds.invalid')); return; }
    setSaving(true); setError(undefined);
    try { await addUpiAccount({ upiId: vpa.trim(), isPrimary: upis.length === 0 }); setVpa(''); await load(); }
    catch { Alert.alert(t('upiIds.title'), t('upiIds.failed')); }
    finally { setSaving(false); }
  };

  return (
    <ScreenScaffold title={t('upiIds.title')} footer={<Button title={t('upiIds.verifyAdd')} loading={saving} onPress={add} disabled={saving} />}>
      {loading ? <SkeletonCard lines={6} /> : (
        <>
          <Text style={styles.section}>{t('upiIds.linkedTitle')}</Text>
          {upis.length === 0 ? (
            <EmptyState title={t('upiIds.empty.title')} message={t('upiIds.empty.message')} />
          ) : upis.map((item) => (
            <Card key={item.id} style={styles.card}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.vpa}>{item.upiId ?? '—'}</Text>
                  {/* §13: handle tag (from the VPA) + Default (real). No VERIFIED / linked-bank — not in the contract. */}
                  <View style={styles.tags}>
                    {upiHandleTag(item.upiId) ? <Text style={styles.handle}>{upiHandleTag(item.upiId)}</Text> : null}
                    {item.holderName ? <Text style={styles.holder}>{item.holderName}</Text> : null}
                    {/* §13: VERIFIED only when the server's saved-instruments read reports it (real penny-verify). */}
                    {verifiedById[item.id] ? <StatusPill label={t('upiIds.verified')} tone="success" /> : null}
                  </View>
                </View>
                {item.isPrimary ? <StatusPill label={t('upiIds.default')} tone="success" /> : null}
              </View>
            </Card>
          ))}

          {/* Add new UPI */}
          <Text style={styles.section}>{t('upiIds.addTitle')}</Text>
          <Card>
            <Input label={t('upiIds.upiLabel')} value={vpa} onChangeText={(v) => { setVpa(v); if (error) setError(undefined); }} autoCapitalize="none" keyboardType="email-address" maxLength={100} placeholder="name@bank" error={error} />
            <Text style={styles.commonTitle}>{t('upiIds.commonHandles')}</Text>
            <View style={styles.chips}>
              {COMMON_UPI_HANDLES.map((h) => (
                <Pressable key={h} onPress={() => { setVpa((cur) => applyUpiHandle(cur, h)); if (error) setError(undefined); }} style={styles.chip} accessibilityRole="button" accessibilityLabel={h}>
                  <Text style={styles.chipTxt}>{h}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.note}>{t('upiIds.pennyNote')}</Text>
          </Card>
        </>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  card: { marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  vpa: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: 2, flexWrap: 'wrap' },
  handle: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.primary700 },
  holder: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  commonTitle: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.semibold, marginTop: space[3], marginBottom: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { paddingVertical: space[1], paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.earth200, backgroundColor: color.card, minHeight: 36, justifyContent: 'center' },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[3], lineHeight: font.size.xs * 1.5 },
});
