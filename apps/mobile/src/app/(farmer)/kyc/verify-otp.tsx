// apps/mobile/src/app/(farmer)/kyc/verify-otp.tsx · screen 73 (Verify Aadhaar OTP). Thin screen (guide §3): enter
// the 6-digit OTP the UIDAI provider sent to the Aadhaar-linked mobile, then verify the eKYC session
// (verifyAadhaarEkyc → tokenised server-side, idempotent Law 3). Reached from screen 72 with the sessionId + a
// MASKED Aadhaar reference (never the raw number). FLAG_SECURE (OTP + KYC surface, §4). Behind the `kyc` flag.
// Degrade-never-die: wrong/expired code clears the field + friendly message; 429 surfaces the server throttle.
//
// §13 (NOT faked): the design shows the masked MOBILE "+91 ●●●●● ●5432", but the eKYC start result carries only a
// masked AADHAAR id — the linked phone is not in any mobile contract. So we NEVER fabricate phone digits: we show
// the real masked Aadhaar reference + honest "sent to your Aadhaar-linked mobile" copy. RESEND has no dedicated
// eKYC endpoint and we deliberately did NOT retain the raw Aadhaar (§4), so once the timer elapses "Resend" routes
// back to the Aadhaar step to restart — never a fake re-send. The 10-minute validity + UIDAI note are fixed chrome.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, OtpInput, EmptyState, Icon, color, font, space, radius, shadow } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security';
import { verifyAadhaarEkyc } from '../../../features/kyc/kyc.api';
import { resendSecondsRemaining } from '../../../core/auth/otp.helpers';

/** Seconds → "m:ss" for the resend countdown. Pure. */
function mmss(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function VerifyAadhaarOtp() {
  useSecureScreen();
  const router = useRouter();
  const { t } = useTranslation();
  const enabled = useFlag('kyc');
  const { sessionId, masked } = useLocalSearchParams<{ sessionId?: string; masked?: string }>();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [sentAt] = useState(Date.now());
  const [remaining, setRemaining] = useState(resendSecondsRemaining(Date.now(), Date.now()));

  useEffect(() => {
    const id = setInterval(() => setRemaining(resendSecondsRemaining(sentAt, Date.now())), 1000);
    return () => clearInterval(id);
  }, [sentAt]);

  if (!enabled) return <SafeAreaView style={styles.safe}><View style={styles.body}><EmptyState title={t('kyc.unavailable')} /></View></SafeAreaView>;
  // Guard: without a session there's nothing to verify — send the user back to start honestly (no fake flow).
  if (!sessionId) return <SafeAreaView style={styles.safe}><View style={styles.body}><EmptyState title={t('kycOtp.noSession')} actionLabel={t('kycOtp.restart')} onAction={() => router.replace('/(farmer)/kyc/aadhaar')} /></View></SafeAreaView>;

  const onVerify = async (value: string) => {
    if (value.length !== 6 || busy) return;
    setBusy(true); setError(undefined);
    try {
      await verifyAadhaarEkyc(sessionId, value);
      router.replace('/(farmer)/kyc');
    } catch (e) {
      const status = e instanceof SdkError ? e.status : 0;
      setError(status === 410 || status === 422 ? t('kycOtp.expired') : status === 429 ? t('kycOtp.tooMany') : t('kycOtp.invalid'));
      setCode('');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.backRow}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={styles.backBtn}>
          <Icon name="arrow-left" size={20} color={color.ink700} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.iconCircle} accessibilityElementsHidden importantForAccessibility="no"><Text style={styles.iconGlyph}>📱</Text></View>
        <Text style={styles.title}>{t('kycOtp.title')}</Text>
        <Text style={styles.sub}>{t('kycOtp.sub')}</Text>
        {/* §13: masked AADHAAR reference (real), not a fabricated phone number. */}
        <Text style={styles.masked}>{masked ? t('kycOtp.linkedTo', { masked }) : t('kycOtp.linkedGeneric')}</Text>

        <View style={styles.boxes}>
          <OtpInput value={code} onChange={setCode} onComplete={onVerify} autoFocus error={!!error} />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Resend — once the timer elapses, restart from the Aadhaar step (we never retained the raw number). */}
        <Text style={styles.resendRow}>
          {t('kycOtp.didntReceive')}{' '}
          {remaining > 0
            ? <Text style={styles.resendDisabled}>{t('kycOtp.resendIn', { time: mmss(remaining) })}</Text>
            : <Text style={styles.resendActive} onPress={() => router.replace('/(farmer)/kyc/aadhaar')} accessibilityRole="button">{t('kycOtp.resend')}</Text>}
        </Text>

        <Text style={styles.validity}>{t('kycOtp.validity')}</Text>

        <View style={styles.help}>
          <Icon name="shield" size={20} color={color.info} />
          <Text style={styles.helpText}>{t('kycOtp.uidaiNote')}</Text>
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Button title={t('kycOtp.verifyCta')} size="lg" onPress={() => onVerify(code)} loading={busy} disabled={code.length !== 6} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  body: { flex: 1, padding: space[5] },
  backRow: { paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[1] },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },
  scroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: space[6], paddingTop: space[4] },
  iconCircle: { width: 80, height: 80, borderRadius: radius.xl, backgroundColor: color.primary600, alignItems: 'center', justifyContent: 'center', ...shadow.floating },
  iconGlyph: { fontSize: 40 },
  title: { fontFamily: font.display, fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: color.ink800, textAlign: 'center', letterSpacing: -0.3, marginTop: space[5] },
  sub: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500, textAlign: 'center', marginTop: space[2] },
  masked: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, textAlign: 'center', marginTop: 2 },
  boxes: { marginTop: space[8], alignSelf: 'stretch' },
  error: { fontFamily: font.body, fontSize: font.size.md, color: color.dangerDark, textAlign: 'center', marginTop: space[3] },
  resendRow: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, textAlign: 'center', marginTop: space[3] },
  resendDisabled: { color: color.ink400, fontWeight: font.weight.semibold },
  resendActive: { color: color.primary700, fontWeight: font.weight.semibold },
  validity: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, textAlign: 'center', marginTop: space[3] },
  help: { flexDirection: 'row', alignItems: 'center', gap: space[3], alignSelf: 'stretch', marginTop: space[5], padding: space[4], backgroundColor: color.infoLight, borderRadius: radius.md },
  helpText: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.infoDark, lineHeight: 20 },
  actions: { paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[4] },
});
