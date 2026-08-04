// apps/mobile/src/app/(farmer)/kyc/aadhaar.tsx · screen 72 (Verify Aadhaar — eKYC start). Thin screen (guide §3):
// the Aadhaar-number entry + "why verify" benefits + a data-safety note, then "Send OTP" → the REAL eKYC start
// (startAadhaarEkyc → session id, idempotent Law 3). The RAW Aadhaar is held ONLY in component state and sent ONLY
// to start(); it is NEVER logged/cached/persisted, and the server returns a MASKED id (§4/DPDP). FLAG_SECURE (KYC
// surface). Behind the `kyc` flag. Degrade-never-die: inline validation + friendly error; a designed "OTP sent"
// confirmation state (the OTP-entry step is screen 73). Client-side Verhoeff check is UX-only — the server + UIDAI
// are the authority (a patched APK can't self-verify).
//
// §13: every label here is fixed UI chrome (headings, the "why verify" benefits, the RBI/₹-threshold policy copy,
// the safety note) — none of it is per-user data, so it lives in i18n, not the DB. The only dynamic value is the
// masked Aadhaar the SERVER echoes back after start() (never fabricated locally).
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, Input, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { startAadhaarEkyc } from '../../../features/kyc/kyc.api';
import { normalizeAadhaar, formatAadhaar, isAadhaarComplete, isValidAadhaar, maskAadhaar } from '../../../features/kyc/aadhaar';

const BENEFITS = ['limits', 'schemes', 'trust', 'loans'] as const;

export default function VerifyAadhaar() {
  useSecureScreen();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('kyc');
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!enabled) return <ScreenScaffold title={t('kycAadhaar.title')}><EmptyState title={t('kyc.unavailable')} /></ScreenScaffold>;

  const complete = isAadhaarComplete(digits);

  const onSend = async () => {
    if (!isValidAadhaar(digits)) { setError(t('kycAadhaar.invalid')); return; }
    setBusy(true); setError(undefined);
    try {
      const masked = maskAadhaar(digits); // derive the mask BEFORE we clear the raw value
      const res = await startAadhaarEkyc(normalizeAadhaar(digits)); // raw sent ONLY here; never logged/persisted
      setDigits(''); // clear the raw number from state as soon as it's handed off (§4)
      // On to the OTP step (screen 73). We forward only the session id + a MASKED reference — never the raw number.
      router.push({ pathname: '/(farmer)/kyc/verify-otp', params: { sessionId: res.id, masked: res.maskedId || masked } });
    } catch (e) {
      setError(e instanceof SdkError && (e.isValidation || e.status === 422) ? t('kycAadhaar.invalid')
        : e instanceof SdkError && e.status === 429 ? t('kycAadhaar.tooMany')
        : t('kycAadhaar.failed'));
    } finally { setBusy(false); }
  };

  const footer = (
    <View style={styles.footer}>
      <Button title={t('kycAadhaar.skip')} variant="ghost" onPress={() => router.back()} />
      <View style={{ flex: 1 }}>
        <Button title={t('kycAadhaar.sendOtp')} onPress={onSend} loading={busy} disabled={!complete || busy} fullWidth />
      </View>
    </View>
  );

  return (
    <ScreenScaffold title={t('kycAadhaar.title')} scroll={false} footer={footer}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space[4] }}>
        <Text style={styles.heading}>{t('kycAadhaar.heading')}</Text>
        <Text style={styles.headingVern}>{t('kycAadhaar.headingVern')}</Text>
        <Text style={styles.subtitle}>{t('kycAadhaar.subtitle')}</Text>

        <View style={styles.field}>
          <Input
            label={t('kycAadhaar.numberLabel')}
            value={formatAadhaar(digits)}
            onChangeText={(v) => { setDigits(normalizeAadhaar(v)); if (error) setError(undefined); }}
            keyboardType="number-pad"
            maxLength={14}
            placeholder="1234 5678 9012"
            error={error}
          />
          <Text style={styles.helper}>{t('kycAadhaar.otpHint')}</Text>
        </View>

        {/* Why verify? */}
        <Text style={styles.section}>{t('kycAadhaar.whyTitle')}</Text>
        <Card>
          {BENEFITS.map((b, i) => (
            <View key={b} style={[styles.benefit, i > 0 && styles.benefitDivider]}>
              <Text style={styles.benefitIcon}>{t(`kycAadhaar.benefit.${b}.icon`)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.benefitTitle}>{t(`kycAadhaar.benefit.${b}.title`)}</Text>
                <Text style={styles.benefitDesc}>{t(`kycAadhaar.benefit.${b}.desc`)}</Text>
              </View>
            </View>
          ))}
        </Card>

        {/* Data-safety note */}
        <View style={styles.safe}>
          <Text style={styles.safeTitle}>{t('kycAadhaar.safeTitle')}</Text>
          <Text style={styles.safeBody}>{t('kycAadhaar.safeBody')}</Text>
        </View>
      </ScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, marginTop: space[2] },
  headingVern: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary700, marginTop: 2 },
  subtitle: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[2], lineHeight: font.size.sm * 1.5 },
  field: { marginTop: space[4] },
  helper: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[5], marginBottom: space[2] },
  benefit: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], paddingVertical: space[3] },
  benefitDivider: { borderTopWidth: 1, borderTopColor: color.ink100 },
  benefitIcon: { fontSize: font.size.xl },
  benefitTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  benefitDesc: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2, lineHeight: font.size.sm * 1.4 },
  safe: { marginTop: space[4], padding: space[3], borderRadius: radius.md, backgroundColor: color.successLight },
  safeTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.successDark },
  safeBody: { fontFamily: font.body, fontSize: font.size.xs, color: color.successDark, marginTop: space[1], lineHeight: font.size.xs * 1.5 },
  footer: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
