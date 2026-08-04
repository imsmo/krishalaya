// apps/mobile/src/app/(auth)/phone.tsx · screen 03a. Enter the mobile number. We normalize to E.164 client-side
// (the API requires it), then request an OTP and move to verify. The request is enumeration-safe by API contract,
// so we ALWAYS advance to verify regardless of whether the number is registered — we never reveal account
// existence. A hard network error keeps us here with a friendly message (degrade-never-die).
import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { Button, Input, ScreenScaffold, space, color, font } from '@krishalaya/ui-native';
import { Text } from 'react-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { normalizeIndianPhone, requestOtp } from '../../core/auth/otp.flow';
import { newId } from '../../core/util/ids';

export default function PhoneScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const onContinue = async () => {
    const phone = normalizeIndianPhone(raw);
    if (!phone) { setError(t('otp.error.invalid')); return; }
    setError(undefined); setBusy(true);
    try {
      await requestOtp(phone, newId());
      router.push({ pathname: '/(auth)/verify', params: { phone } });
    } catch (e) {
      // Surface the real cause to the Metro terminal so we can diagnose (status/code/message); UI stays friendly.
      console.error('[phone] requestOtp failed:', JSON.stringify({ message: (e as any)?.message, code: (e as any)?.code, status: (e as any)?.status }), e);
      setError(t('common.error.generic'));
    } finally { setBusy(false); }
  };

  return (
    <ScreenScaffold
      title={t('otp.phoneTitle')}
      subtitle={t('otp.phoneHint')}
      footer={<Button title={t('otp.sendCode')} onPress={onContinue} loading={busy} />}
    >
      <Input
        label={t('otp.phoneLabel')}
        value={raw}
        onChangeText={setRaw}
        keyboardType="phone-pad"
        placeholder="+91 98765 43210"
        maxLength={16}
        autoFocus
        error={error}
      />
      <Text style={{ fontFamily: font.body, fontSize: font.size.sm, color: color.ink400, marginTop: space[2] }}>
        🔒 {t('otp.safety')}
      </Text>
    </ScreenScaffold>
  );
}
