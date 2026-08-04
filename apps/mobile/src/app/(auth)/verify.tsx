// apps/mobile/src/app/(auth)/verify.tsx · screen 03 (Verify Phone) — rebuilt to match the Phase-1 design
// (Krishalaya_Design_System/screens/03-otp.html): a back button, a gradient shield icon-circle, "Verify Your
// Number", the bilingual sub with the entered number in bold, six OTP boxes, a "Didn't receive code? Resend in
// m:ss" line (disabled during the cooldown), an info-tinted safety note with a shield icon, and a full-width
// "Verify & Continue" CTA. All AUTH LOGIC is unchanged: verifyOtp → signIn (tokens → secure store) → role;
// enumeration-safe; wrong/expired code clears the field + friendly message; repeated failures surface the API
// throttle message (§4). FLAG_SECURE on (OTP on screen). Copy via i18n (hi/en/gu); tokens-only; ≥48px targets.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, OtpInput, Icon, color, font, space, radius, shadow } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { verifyOtp, requestOtp, resendSecondsRemaining } from '../../core/auth/otp.flow';
import { newId } from '../../core/util/ids';
import { useAuth } from '../../core/auth/auth.store';
import { useSecureScreen } from '../../core/security';

/** Seconds → "m:ss" for the resend countdown (matches the design's "0:24"). Pure. */
function mmss(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function VerifyScreen() {
  useSecureScreen(); // OTP on screen — block screenshots/recording (§4)
  const router = useRouter();
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const { phone } = useLocalSearchParams<{ phone: string }>();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState(Date.now());
  const [remaining, setRemaining] = useState(resendSecondsRemaining(Date.now(), Date.now()));

  useEffect(() => {
    const id = setInterval(() => setRemaining(resendSecondsRemaining(sentAt, Date.now())), 1000);
    return () => clearInterval(id);
  }, [sentAt]);

  const onVerify = async (value: string) => {
    if (!phone || value.length !== 6 || busy) return;
    setBusy(true); setError(undefined);
    try {
      const tokens = await verifyOtp(phone, value, newId());
      await signIn(tokens);
      router.replace('/(auth)/role');
    } catch (e) {
      // Log the real cause to the Metro terminal (status/code/message) so failures are diagnosable; UI stays friendly.
      console.error('[verify] verifyOtp failed:', JSON.stringify({ message: (e as any)?.message, code: (e as any)?.code, status: (e as any)?.status }), e);
      const ecode = e instanceof SdkError ? e.code : '';
      setError(/too many|rate|throttle/i.test(ecode) ? t('otp.error.tooMany') : t('otp.error.invalid'));
      setCode('');
    } finally { setBusy(false); }
  };

  const onResend = async () => {
    if (remaining > 0 || !phone) return;
    try { await requestOtp(phone, newId()); setSentAt(Date.now()); setRemaining(resendSecondsRemaining(Date.now(), Date.now(), 30)); } catch { /* enumeration-safe: ignore */ }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Back */}
      <View style={styles.backRow}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={styles.backBtn}>
          <Icon name="arrow-left" size={20} color={color.ink700} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Icon + title + sub */}
        <View style={styles.iconCircle} accessibilityElementsHidden importantForAccessibility="no">
          <Icon name="shield" size={40} color={color.accent300} weight={2.2} />
        </View>
        <Text style={styles.title}>{t('otp.verifyTitle')}</Text>
        <Text style={styles.sub}>{t('otp.verifyHint')}</Text>
        <Text style={styles.phone}>{phone ?? ''}</Text>

        {/* OTP boxes */}
        <View style={styles.boxes}>
          <OtpInput value={code} onChange={setCode} onComplete={onVerify} autoFocus error={!!error} />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Resend */}
        <Text style={styles.resendRow}>
          {t('otp.didntReceive')}{' '}
          {remaining > 0
            ? <Text style={styles.resendDisabled}>{t('otp.resendIn', { time: mmss(remaining) })}</Text>
            : <Text style={styles.resendActive} onPress={onResend} accessibilityRole="button">{t('otp.resend')}</Text>}
        </Text>

        {/* Safety note */}
        <View style={styles.help}>
          <Icon name="shield" size={20} color={color.info} />
          <Text style={styles.helpText}>{t('otp.safety')}</Text>
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Button title={t('otp.verifyCta')} size="lg" onPress={() => onVerify(code)} loading={busy} disabled={code.length !== 6} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  backRow: { paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[1] },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },

  scroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: space[6], paddingTop: space[4] },
  iconCircle: { width: 80, height: 80, borderRadius: radius.xl, backgroundColor: color.primary600, alignItems: 'center', justifyContent: 'center', ...shadow.floating },
  title: { fontFamily: font.display, fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: color.ink800, textAlign: 'center', letterSpacing: -0.3, marginTop: space[5] },
  sub: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500, textAlign: 'center', marginTop: space[2] },
  phone: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, textAlign: 'center', marginTop: 2 },

  boxes: { marginTop: space[8], alignSelf: 'stretch' },
  error: { fontFamily: font.body, fontSize: font.size.md, color: color.dangerDark, textAlign: 'center', marginTop: space[3] },
  resendRow: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, textAlign: 'center', marginTop: space[3] },
  resendDisabled: { color: color.ink400, fontWeight: font.weight.semibold },
  resendActive: { color: color.primary700, fontWeight: font.weight.semibold },

  help: { flexDirection: 'row', alignItems: 'center', gap: space[3], alignSelf: 'stretch', marginTop: space[6], padding: space[4], backgroundColor: color.infoLight, borderRadius: radius.md },
  helpText: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.infoDark, lineHeight: 20 },

  actions: { paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[4] },
});
