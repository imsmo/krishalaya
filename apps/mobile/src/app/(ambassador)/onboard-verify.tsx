// apps/mobile/src/app/(ambassador)/onboard-verify.tsx · screen 90 (Verify Details — step 3 of 4). Thin screen
// (guide §3): the ambassador reviews the farmer's identity, notes the details they can ask for, and confirms.
// Behind `ambassador_app`. FLAG_SECURE (identity-verify + phone). Degrade-never-die.
//
// §13 (NOT faked): there is NO ambassador-assisted Aadhaar/eKYC that returns the farmer's identity (name / masked
// Aadhaar / address / DOB / "UIDAI confirmed") to the ambassador's device — identity is verified during the
// FARMER's own self-service eKYC after they claim the referral code (P-01/P-03; admin user-create is back-office,
// Law 11). So the "From Aadhaar (auto-filled)" rows render as "—" with a note that they fill after the farmer's
// eKYC, never a fabricated "Anil Kumar Vasava / XXXX XXXX 4521 / Plot 47…". The Ask-farmer fields the ambassador
// CAN note are captured on-device and confirmed at the farmer's own signup (no assisted-write endpoint yet).
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Input, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useSecureScreen } from '../../core/security/screen-guard';
import { normalizeIndianPhone } from '../../core/auth/otp.helpers';

const AADHAAR_FIELDS = ['fullName', 'aadhaar', 'address', 'dob'] as const;
const LANGS = ['gu', 'hi', 'en'] as const;

export default function OnboardVerify() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('ambassador_app');
  useSecureScreen();
  const [mobile, setMobile] = useState('');
  const [crops, setCrops] = useState('');
  const [acres, setAcres] = useState('');
  const [language, setLanguage] = useState<string>(lang);

  if (!enabled) return <ScreenScaffold title={t('amb.onboard.verifyTitle')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const canContinue = !!normalizeIndianPhone(mobile) && crops.trim().length > 0;

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('common.back')} variant="outline" onPress={() => router.back()} />
      <View style={{ flex: 1 }}>
        <Button title={t('amb.onboard.verify.continue')} onPress={() => router.push('/(ambassador)/onboard-complete')} disabled={!canContinue} fullWidth />
      </View>
    </View>
  );

  return (
    <ScreenScaffold title={t('amb.onboard.verifyTitle')} scroll footer={footer}>
      <Text style={styles.step}>{t('amb.onboard.verify.step3')}</Text>
      <Text style={styles.section}>{t('amb.onboard.verify.verifyWith')}</Text>

      {/* Identity — §13: verified during the farmer's own eKYC; no fabricated identity here */}
      <Card style={styles.idCard}>
        <Text style={styles.idTitle}>{t('amb.onboard.verify.aadhaarHeading')}</Text>
        <Text style={styles.idNote}>{t('amb.onboard.verify.aadhaarNote')}</Text>
      </Card>

      {/* From Aadhaar (auto-filled after farmer eKYC) */}
      <Text style={styles.section}>{t('amb.onboard.verify.autoFillTitle')}</Text>
      <Card>
        {AADHAAR_FIELDS.map((f, i) => (
          <View key={f} style={[styles.fieldRow, i > 0 && styles.divide]}>
            <Text style={styles.fieldLabel}>{t(`amb.onboard.verify.field.${f}`)}</Text>
            <Text style={styles.fieldValue}>{t('common.dash')}</Text>
          </View>
        ))}
        <Text style={styles.autoNote}>{t('amb.onboard.verify.autoFillNote')}</Text>
      </Card>

      {/* Ask farmer */}
      <Text style={styles.section}>{t('amb.onboard.verify.askFarmer')}</Text>
      <Card>
        <Input label={t('amb.onboard.verify.mobile')} value={mobile} onChangeText={setMobile} placeholder={t('amb.onboard.verify.mobilePh')} keyboardType="phone-pad" maxLength={14} />
        <View style={{ marginTop: space[3] }}>
          <Input label={t('amb.onboard.verify.primaryCrops')} value={crops} onChangeText={setCrops} placeholder={t('amb.onboard.verify.cropsPh')} maxLength={120} />
        </View>
        <View style={{ marginTop: space[3] }}>
          <Input label={t('amb.onboard.verify.farmSize')} value={acres} onChangeText={setAcres} placeholder={t('amb.onboard.verify.farmSizePh')} keyboardType="decimal-pad" maxLength={6} />
        </View>
        <Text style={styles.fieldLabel2}>{t('amb.onboard.verify.language')}</Text>
        <View style={styles.langRow}>
          {LANGS.map((l) => {
            const on = language === l;
            return (
              <Pressable key={l} onPress={() => setLanguage(l)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[styles.langChip, on && styles.langChipOn]}>
                <Text style={[styles.langTxt, on && styles.langTxtOn]}>{t(`amb.onboard.verify.lang.${l}`)}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <View style={styles.readAloud}>
        <Text style={styles.readAloudTxt}>🔊 {t('amb.onboard.verify.readAloud')}</Text>
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  step: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.primary700, letterSpacing: 0.5, marginBottom: space[2] },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[3], marginBottom: space[2] },
  idCard: { backgroundColor: color.successLight },
  idTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.successDark },
  idNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, marginTop: space[1], lineHeight: font.size.xs * 1.5 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[2], gap: space[3] },
  divide: { borderTopWidth: 1, borderTopColor: color.ink100 },
  fieldLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  fieldValue: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink400 },
  autoNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[2], lineHeight: font.size.xs * 1.5 },
  fieldLabel2: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700, marginTop: space[3], marginBottom: space[2] },
  langRow: { flexDirection: 'row', gap: space[2] },
  langChip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  langChipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  langTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  langTxtOn: { color: color.primary700 },
  readAloud: { backgroundColor: color.warningLight, borderRadius: radius.md, padding: space[3], marginTop: space[3] },
  readAloudTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink700, lineHeight: font.size.xs * 1.5 },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
