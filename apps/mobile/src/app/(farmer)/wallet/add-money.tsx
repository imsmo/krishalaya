// apps/mobile/src/app/(farmer)/wallet/add-money.tsx · screen 20 (Add Money) — rebuilt to the Phase-1 design
// (Krishalaya_Design_System/screens/20-add-money.html): a big centred amount entry (₹ + value) with Min/Max,
// a quick-amount chip row, a "Pay Using" section (UPI apps + Card / Netbanking) and a "Proceed to Pay · ₹X" CTA.
// Thin screen (guide §3); money is bigint paise (Law 2 — rupees → paise via rupeesToPaiseMinor, never a float);
// FLAG_SECURE while shown (§4); behind the `payments_addmoney` flag (kill-switch); degrade-never-die (Law 12).
//
// REAL flow: addMoney(paise) creates a server payment intent then opens the Razorpay checkout and reconciles via
// the server webhook (the source of truth — we never mark the wallet credited client-side). HONEST "Pay Using"
// (§13): the actual method is chosen + confirmed inside the SECURE gateway sheet; the in-app selection is a
// preference hint shown for design parity (we pass no fake method to a PSP), with a note that confirmation happens
// in the next step. No amount or balance is hardcoded.
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button, EmptyState, Icon, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { rupeesToPaiseMinor } from '../../../core/payments/money';
import { addMoney } from '../../../features/payments/payments.api';
import { QUICK_ADD_RUPEES, ADD_MIN_RUPEES, ADD_MAX_RUPEES, groupDigits } from '../../../features/wallet/amount-entry';

// UPI app chips. Brand names (GPay/PhonePe/Paytm) are proper nouns; "Other UPI" is localized — all via i18n keys.
const UPI_APPS = [
  { id: 'gpay', labelKey: 'addMoney.upi.gpay', glyph: 'G', tint: '#34a853' },
  { id: 'phonepe', labelKey: 'addMoney.upi.phonepe', glyph: 'P', tint: '#5f259f' },
  { id: 'paytm', labelKey: 'addMoney.upi.paytm', glyph: 'P', tint: '#0070ba' },
  { id: 'other', labelKey: 'addMoney.upi.other', glyph: '+', tint: color.ink700 },
] as const;

export default function AddMoney() {
  useSecureScreen();
  const router = useRouter();
  const { t, lang } = useTranslation();
  const enabled = useFlag('payments_addmoney');
  const [rupees, setRupees] = useState('');
  const [method, setMethod] = useState<string>('gpay'); // UX preference only; gateway confirms the real method
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!enabled) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.appbar}><Pressable onPress={() => router.back()} hitSlop={8} style={styles.back} accessibilityLabel={t('common.back')} accessibilityRole="button"><Icon name="arrow-left" size={20} color={color.ink700} /></Pressable><Text style={styles.appbarTitle}>{t('addMoney.title')}</Text><View style={styles.back} /></View>
        <View style={styles.body}><EmptyState title={t('addMoney.unavailable')} /></View>
      </SafeAreaView>
    );
  }

  const minor = rupeesToPaiseMinor(rupees);
  const onPay = async () => {
    if (!minor) { setError(t('addMoney.invalidAmount')); return; }
    setError(undefined); setBusy(true);
    try {
      const res = await addMoney(minor);
      const msgKey = res.outcome === 'success' ? 'addMoney.success' : res.outcome === 'failed' ? 'addMoney.failed' : 'addMoney.pending';
      router.replace({ pathname: '/(farmer)/wallet', params: { notice: t(msgKey) } });
    } catch { setError(t('addMoney.unavailable')); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.appbar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back} accessibilityLabel={t('common.back')} accessibilityRole="button"><Icon name="arrow-left" size={20} color={color.ink700} /></Pressable>
        <Text style={styles.appbarTitle}>{t('addMoney.title')}</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Amount entry */}
        <View style={styles.amountBox}>
          <Text style={styles.amountLabel}>{t('addMoney.enterAmount')}</Text>
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
              accessibilityLabel={t('addMoney.enterAmount')}
            />
          </View>
          <Text style={styles.minMax}>{t('addMoney.minMax', { min: groupDigits(String(ADD_MIN_RUPEES), lang), max: groupDigits(String(ADD_MAX_RUPEES), lang) })}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        {/* Quick chips */}
        <View style={styles.chips}>
          {QUICK_ADD_RUPEES.map((r) => {
            const active = rupees === String(r);
            return (
              <Pressable key={r} onPress={() => setRupees(String(r))} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button">
                <Text style={[styles.chipTxt, active && styles.chipTxtOn]}>₹{groupDigits(String(r), lang)}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Pay Using */}
        <Text style={styles.section}>{t('addMoney.payUsing')}</Text>
        <View style={styles.payRow}>
          {UPI_APPS.map((a) => {
            const active = method === a.id;
            const label = t(a.labelKey);
            return (
              <Pressable key={a.id} onPress={() => setMethod(a.id)} style={[styles.payApp, active && styles.payAppOn]} accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={label}>
                <View style={[styles.payIcon, { backgroundColor: a.tint }]}><Text style={styles.payIconTxt}>{a.glyph}</Text></View>
                <Text style={styles.payAppLabel}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.methods}>
          <MethodRow id="card" glyph="💳" title={t('addMoney.method.card')} sub={t('addMoney.method.cardSub')} active={method === 'card'} onPress={() => setMethod('card')} />
          <MethodRow id="netbanking" glyph="🏦" title={t('addMoney.method.netbanking')} sub={t('addMoney.method.netbankingSub')} active={method === 'netbanking'} onPress={() => setMethod('netbanking')} />
        </View>
        <Text style={styles.gatewayNote}>{t('addMoney.gatewayNote')}</Text>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={minor ? t('addMoney.payCta', { amount: `₹${groupDigits(rupees, lang)}` }) : t('addMoney.pay')}
          size="lg"
          onPress={onPay}
          loading={busy}
          disabled={!minor}
        />
      </View>
    </SafeAreaView>
  );
}

function MethodRow({ glyph, title, sub, active, onPress }: { id: string; glyph: string; title: string; sub: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.method, active && styles.methodOn]} accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={title}>
      <View style={styles.methodIcon}><Text style={styles.methodGlyph}>{glyph}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.methodTitle}>{title}</Text>
        <Text style={styles.methodSub}>{sub}</Text>
      </View>
      <View style={[styles.radio, active && styles.radioOn]}>{active ? <View style={styles.radioDot} /> : null}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[2] },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },
  appbarTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  body: { flex: 1, padding: space[5] },
  scroll: { paddingBottom: space[6] },

  amountBox: { alignItems: 'center', paddingVertical: space[6], paddingHorizontal: space[5] },
  amountLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  amountRow: { flexDirection: 'row', alignItems: 'center', marginTop: space[2] },
  rupee: { fontFamily: font.display, fontSize: font.size['3xl'], fontWeight: font.weight.bold, color: color.ink400, marginRight: 4 },
  amountInput: { fontFamily: font.display, fontSize: 44, fontWeight: font.weight.bold, color: color.primary700, minWidth: 120, textAlign: 'left', padding: 0 },
  minMax: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[3] },
  error: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[2] },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], justifyContent: 'center', paddingHorizontal: space[5] },
  chip: { paddingVertical: space[2], paddingHorizontal: space[4], backgroundColor: color.card, borderWidth: 1.5, borderColor: color.earth200, borderRadius: radius.pill },
  chipOn: { backgroundColor: color.primary50, borderColor: color.primary600 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  chipTxtOn: { color: color.primary700 },

  section: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, paddingHorizontal: space[5], marginTop: space[5], marginBottom: space[3] },
  payRow: { flexDirection: 'row', gap: space[2], paddingHorizontal: space[5] },
  payApp: { flex: 1, backgroundColor: color.card, borderWidth: 1.5, borderColor: color.earth200, borderRadius: radius.md, paddingVertical: space[3], alignItems: 'center' },
  payAppOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  payIcon: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: space[1] },
  payIconTxt: { fontFamily: font.display, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.white },
  payAppLabel: { fontFamily: font.body, fontSize: 11, fontWeight: font.weight.semibold, color: color.ink700 },

  methods: { gap: space[2], paddingHorizontal: space[5], marginTop: space[4] },
  method: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], backgroundColor: color.card, borderWidth: 1.5, borderColor: color.earth200, borderRadius: radius.md },
  methodOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  methodIcon: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: color.earth100 },
  methodGlyph: { fontSize: 20 },
  methodTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  methodSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 1 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: color.earth400, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: color.primary600 },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.primary600 },

  gatewayNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, paddingHorizontal: space[5], marginTop: space[3], lineHeight: 18 },

  footer: { paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[4], borderTopWidth: 1, borderTopColor: color.ink100, backgroundColor: color.card },
});
