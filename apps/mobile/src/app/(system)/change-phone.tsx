// apps/mobile/src/app/(system)/change-phone.tsx · screen 176 (Change Phone) — rebuilt to the Phase-1 design
// (screens/176-change-phone.html): a "Current" row, the new-number input (+91 prefix), a Reason chooser, an
// "Important" warning card (OTP to both numbers · Aadhaar re-verification · 24-hour cool-down · bank unchanged),
// a "No access to old number?" help note, and Cancel / Send-OTP-to-Both actions. Step 2 collects the OTP the
// server sends to the NEW number and confirms. Thin screen (guide §3). FLAG_SECURE (OTP/phone on screen, §4).
// Behind `system_screens`. Degrade-never-die. The server owns the OTP + re-validates; we validate 10-digit for UX.
//
// §13 (NOT faked): (1) the "Current" number the design shows (+91 …12340) is NOT available to the app — the session
// keeps the user id only, never the phone (§4 data-minimization), and UserProfile carries no phone. So we show an
// honest "your signed-in number (hidden)" line, never a fabricated number. (2) The design's help names a specific
// tenant office ("Anand FPO"); the app has no tenant-office directory, so we give the generic real instruction
// (nearest tenant office + which documents) without inventing an office name. (3) The change-phone endpoints are
// ASSUMED (not live) → an honest "unavailable" message on failure. The Reason is captured and sent (assumed field).
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Input, OtpInput, SegmentedControl, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useSecureScreen } from '../../core/security';
import { startPhoneChange, confirmPhoneChange } from '../../features/system/system.api';
import { CHANGE_PHONE_REASONS, reasonLabelKey, isValidNewMobile, normalizeNewMobile, type ChangePhoneReason } from '../../features/system/change-phone';

const WARNINGS = ['otpBoth', 'aadhaar', 'cooldown', 'bankSame'] as const;

export default function ChangePhone() {
  useSecureScreen(); // OTP + phone on screen — block screenshots/recording (§4)
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('system_screens');
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState<ChangePhoneReason>('lost');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'enter' | 'verify'>('enter');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!enabled) return <ScreenScaffold title={t('changePhone.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const start = async () => {
    if (!isValidNewMobile(phone)) { setError(t('changePhone.phoneInvalid')); return; }
    setBusy(true); setError(undefined);
    const r = await startPhoneChange(`+91${normalizeNewMobile(phone)}`, reason);
    if (r.ok) setStep('verify'); else setError(t('changePhone.unavailable'));
    setBusy(false);
  };
  const confirm = async () => {
    setBusy(true); setError(undefined);
    const r = await confirmPhoneChange(`+91${normalizeNewMobile(phone)}`, code);
    if (r.ok) router.back(); else setError(t('changePhone.codeInvalid'));
    setBusy(false);
  };

  if (step === 'verify') {
    return (
      <ScreenScaffold title={t('changePhone.title')} scroll>
        <Card>
          <Text style={styles.body}>{t('changePhone.enterOtp', { phone: `+91 ${normalizeNewMobile(phone)}` })}</Text>
          <OtpInput value={code} onChange={setCode} length={6} />
          {error ? <Text style={styles.err}>{error}</Text> : null}
          <View style={{ marginTop: space[3] }}><Button title={t('changePhone.confirm')} loading={busy} disabled={code.length < 6} onPress={confirm} /></View>
        </Card>
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold
      title={t('changePhone.title')}
      scroll
      footer={
        <View style={styles.footer}>
          <View style={{ flex: 1 }}><Button title={t('common.cancel')} variant="outline" onPress={() => router.back()} /></View>
          <View style={{ flex: 2 }}><Button title={t('changePhone.sendOtp')} loading={busy} onPress={start} /></View>
        </View>
      }
    >
      {/* Current (signed-in) number — hidden for privacy; the app never stores the phone (§4/§13) */}
      <Text style={styles.label}>{t('changePhone.current')}</Text>
      <Card><Text style={styles.currentNote}>{t('changePhone.currentHidden')}</Text></Card>

      {/* New number */}
      <Text style={styles.label}>{t('changePhone.newPhone')} <Text style={styles.req}>*</Text></Text>
      <View style={styles.phoneRow}>
        <View style={styles.cc}><Text style={styles.ccText}>+91</Text></View>
        <View style={{ flex: 1 }}>
          <Input value={phone} onChangeText={(v) => { setPhone(v); if (error) setError(undefined); }}
            keyboardType="phone-pad" maxLength={10} placeholder={t('changePhone.newPhonePlaceholder')} error={error} />
        </View>
      </View>

      {/* Reason */}
      <Text style={styles.label}>{t('changePhone.reasonLabel')}</Text>
      <SegmentedControl
        layout="stack"
        accessibilityLabel={t('changePhone.reasonLabel')}
        options={CHANGE_PHONE_REASONS.map((r) => ({ value: r, label: t(reasonLabelKey(r)) }))}
        value={reason}
        onChange={(v) => setReason(v as ChangePhoneReason)}
      />

      {/* Important warnings */}
      <View style={styles.warn}>
        <Text style={styles.warnTitle}>{t('changePhone.importantTitle')}</Text>
        {WARNINGS.map((w) => <Text key={w} style={styles.warnItem}>{`•  ${t(`changePhone.warn.${w}`)}`}</Text>)}
      </View>

      {/* No access to old number? */}
      <Text style={styles.label}>{t('changePhone.noAccessTitle')}</Text>
      <Card><Text style={styles.helpBody}>{t('changePhone.noAccessBody')}</Text></Card>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700, marginTop: space[4], marginBottom: space[2] },
  req: { color: color.danger },
  body: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700, marginBottom: space[3] },
  currentNote: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500 },
  phoneRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  cc: { minHeight: 48, paddingHorizontal: space[3], justifyContent: 'center', borderRadius: radius.md, backgroundColor: color.earth100 },
  ccText: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink700 },
  warn: { marginTop: space[4], padding: space[4], borderRadius: radius.md, backgroundColor: color.warningLight },
  warnTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.warningDark, marginBottom: space[2] },
  warnItem: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, lineHeight: 22 },
  helpBody: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, lineHeight: 22 },
  footer: { flexDirection: 'row', gap: space[3] },
  err: { fontFamily: font.body, fontSize: font.size.sm, color: color.danger, marginTop: space[2] },
});
