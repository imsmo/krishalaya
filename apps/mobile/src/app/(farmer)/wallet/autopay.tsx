// apps/mobile/src/app/(farmer)/wallet/autopay.tsx · screen 181 (Auto-Pay Mandates) — rebuilt to the Phase-1 design:
// an intro, a live "Active mandates" list, a "Set up recurring payment" form, and a Limits note. Thin screen
// (guide §3): features/wallet → render. A mandate is a standing instruction; the raw VPA is masked SERVER-side
// (we only show "ab***@psp") and the actual auto-debit COLLECTION is still PSP-gated (registering records the
// instruction, it does not pull money — the server is the authority, Law 11). Money is bigint paise via MoneyText
// (Law 2). FLAG_SECURE (payment instrument on screen, §4). Behind `wallet`. Degrade-never-die (skeleton/empty/retry).
//
// §13 (NOT faked): each mandate row shows REAL fields — the purpose label (from the contract's purpose enum, not a
// fabricated scheme name like "PMSBY Insurance"), the frequency, the masked VPA, the per-mandate CAP (maxAmountMinor,
// "up to ₹X"), the real status, and the mandate's valid-until date. The design's "Next debit: 1 June 2027" is a
// specific next-run date the contract does NOT carry → we show the real "Valid until" instead, never an invented
// debit date; and the "Limits" block (per-transaction ₹2,000 / monthly cap ₹5,000 / used ₹120) has NO per-user
// autopay-limit read-model → we show an honest note (each mandate's own cap is shown above; the bank sets overall
// limits under RBI UPI-AutoPay rules), never fabricated numbers.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import type { AutopayMandate } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, StatusPill, SegmentedControl, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { rupeesToPaiseMinor } from '../../../core/payments/money';
import { isValidVpa } from '../../../features/profile/profile';
import { listAutopayMandates, registerAutopayMandate, cancelAutopayMandate } from '../../../features/wallet/wallet.api';
import { autopayIcon, canCancelMandate, mandateStatusTone } from '../../../features/wallet/autopay';

type Purpose = 'general' | 'membership' | 'loan_emi';

export default function Autopay() {
  useSecureScreen();
  const { t, lang } = useTranslation();
  const enabled = useFlag('wallet');
  const [items, setItems] = useState<AutopayMandate[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [vpa, setVpa] = useState('');
  const [cap, setCap] = useState('');
  const [purpose, setPurpose] = useState<Purpose>('general');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    try { const r = await listAutopayMandates(); setItems(r.items); }
    catch { setFailed(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('wallet.autopayTitle')}><EmptyState title={t('wallet.unavailable')} /></ScreenScaffold>;

  const submit = async () => {
    if (!isValidVpa(vpa)) { setError(t('wallet.autopayInvalid')); return; }
    const maxAmountMinor = rupeesToPaiseMinor(cap); // rupees → paise (Law 2)
    if (!maxAmountMinor) { setError(t('wallet.autopayInvalid')); return; }
    setBusy(true); setError(undefined);
    try {
      await registerAutopayMandate({ vpa: vpa.trim(), purpose, maxAmountMinor, frequency: 'monthly' });
      setVpa(''); setCap(''); setShowForm(false); await load();
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      Alert.alert(t('wallet.autopayTitle'), code === 'MANDATE_ALREADY_EXISTS' ? t('wallet.autopayExists') : t('common.errorGeneric'));
    } finally { setBusy(false); }
  };

  const cancel = (id: string) => {
    Alert.alert(t('wallet.autopayCancelTitle'), t('wallet.autopayCancelMsg'), [
      { text: t('common.no'), style: 'cancel' },
      { text: t('common.yes'), style: 'destructive', onPress: async () => { try { await cancelAutopayMandate(id); await load(); } catch { Alert.alert(t('common.errorGeneric')); } } },
    ]);
  };

  if (loading) return <ScreenScaffold title={t('wallet.autopayTitle')}><SkeletonCard lines={3} /><SkeletonCard lines={4} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('wallet.autopayTitle')} scroll>
      {/* Intro */}
      <View style={styles.intro}>
        <Text style={styles.introTxt}><Text style={styles.introLead}>{t('wallet.autopayIntroLead')} </Text>{t('wallet.autopayIntroBody')}</Text>
      </View>

      {/* Active mandates */}
      <Text style={styles.section}>{t('wallet.autopayActiveTitle')}</Text>
      {failed ? (
        <EmptyState title={t('common.errorGeneric')} actionLabel={t('common.retry')} onAction={load} />
      ) : items.length === 0 ? (
        <EmptyState title={t('wallet.autopayEmpty.title')} message={t('wallet.autopayEmpty.message')} />
      ) : items.map((m) => (
        <Card key={m.id} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.icon}>{autopayIcon(m.purpose)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{t(`wallet.autopayPurpose.${m.purpose}`, { defaultValue: m.purpose })}</Text>
              <Text style={styles.meta}>
                {t(`wallet.autopayFreq.${m.frequency}`, { defaultValue: m.frequency })} · {t('wallet.autopayUpTo')} </Text>
              <MoneyText minor={m.maxAmountMinor} currencyCode={m.currencyCode} langCode={lang} size="sm" style={styles.capAmt} />
            </View>
            <StatusPill label={t(`wallet.autopayStatus.${m.status}`, { defaultValue: m.status })} tone={mandateStatusTone(m.status)} />
          </View>
          <Text style={styles.sub}>{m.vpaMasked}{m.validUntil ? ` · ${t('wallet.autopayValidUntil', { date: safeDate(m.validUntil, lang) })}` : ''}</Text>
          {canCancelMandate(m.status) ? <View style={{ marginTop: space[2] }}><Button title={t('wallet.autopayCancel')} variant="outline" size="md" onPress={() => cancel(m.id)} /></View> : null}
        </Card>
      ))}

      {/* Set up recurring payment */}
      {showForm ? (
        <Card style={styles.form}>
          <Text style={styles.formTitle}>{t('wallet.autopayNew')}</Text>
          <Input label={t('wallet.autopayVpaPlaceholder')} value={vpa} onChangeText={(v) => { setVpa(v); if (error) setError(undefined); }} autoCapitalize="none" keyboardType="email-address" maxLength={100} placeholder="name@bank" error={error} />
          <View style={{ height: space[3] }} />
          <Input label={t('wallet.autopayCapPlaceholder')} value={cap} onChangeText={(v) => { setCap(v.replace(/[^0-9]/g, '')); if (error) setError(undefined); }} keyboardType="number-pad" maxLength={7} />
          <Text style={styles.formLabel}>{t('wallet.autopayPurposeLabel')}</Text>
          <SegmentedControl
            options={[{ value: 'general', label: t('wallet.autopayPurpose.general') }, { value: 'membership', label: t('wallet.autopayPurpose.membership') }, { value: 'loan_emi', label: t('wallet.autopayPurpose.loan_emi') }]}
            value={purpose} onChange={(v) => setPurpose(v as Purpose)} accessibilityLabel={t('wallet.autopayPurposeLabel')}
          />
          <View style={{ marginTop: space[3] }}><Button title={t('wallet.autopayRegister')} loading={busy} onPress={submit} /></View>
          <Text style={styles.note}>{t('wallet.autopayNote')}</Text>
        </Card>
      ) : (
        <View style={{ marginTop: space[3] }}><Button title={t('wallet.autopaySetup')} variant="outline" onPress={() => setShowForm(true)} /></View>
      )}

      {/* Limits — §13: no per-user autopay-limit read-model → honest note, never fabricated numbers. */}
      <Text style={styles.section}>{t('wallet.autopayLimitsTitle')}</Text>
      <Card><Text style={styles.limitsNote}>{t('wallet.autopayLimitsNote')}</Text></Card>
    </ScreenScaffold>
  );
}

function safeDate(iso: string, langCode: string): string {
  try { return formatDate(iso, langCode, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return iso.slice(0, 10); }
}

const styles = StyleSheet.create({
  intro: { padding: space[3], borderRadius: radius.md, backgroundColor: color.primary50, marginTop: space[2] },
  introTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, lineHeight: font.size.sm * 1.5 },
  introLead: { fontWeight: font.weight.bold, color: color.primary700 },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  card: { marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  icon: { fontSize: font.size.xl },
  name: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  meta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2 },
  capAmt: { marginTop: 1 },
  sub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[2] },
  form: { marginTop: space[3] },
  formTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  formLabel: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600, marginTop: space[3], marginBottom: space[2] },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[3] },
  limitsNote: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, lineHeight: font.size.sm * 1.5 },
});
