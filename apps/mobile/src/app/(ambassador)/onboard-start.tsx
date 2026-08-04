// apps/mobile/src/app/(ambassador)/onboard-start.tsx · screen 88 (Onboard a Farmer — step 1 of 4, "Choose method").
// Thin screen (guide §3): pick how the ambassador will onboard the farmer, then Continue. Behind `ambassador_app`.
// Degrade-never-die.
//
// §13 (NOT faked): the REAL, attributable mechanism is a shareable referral CODE the farmer claims on their own
// phone (created + attributed SERVER-SIDE — the code is generated at the final step, screen 91). Assisted Aadhaar-
// scan / manual account-creation have NO ambassador-create endpoint (account creation is self-service OTP; admin
// user-create is back-office, Law 11) → all three methods converge on the referral flow rather than a fabricated
// create-account call. The design's "₹50 commission" per completion has no commission-plan-amount contract exposed
// → shown as a generic incentive line, never a fabricated amount.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { ONBOARD_METHODS, type OnboardMethod } from '../../features/ambassador/referral-flow';

export default function OnboardStart() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('ambassador_app');
  const [method, setMethod] = useState<OnboardMethod>('scan');

  if (!enabled) return <ScreenScaffold title={t('amb.onboard.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('common.back')} variant="outline" onPress={() => router.back()} />
      <View style={{ flex: 1 }}>
        <Button title={t('common.continue')} onPress={() => router.push({ pathname: '/(ambassador)/onboard-complete', params: { method } })} fullWidth />
      </View>
    </View>
  );

  return (
    <ScreenScaffold title={t('amb.onboard.title')} scroll={false} footer={footer}>
      <View style={{ gap: space[3] }}>
        <Text style={styles.step}>{t('amb.onboard.step1')}</Text>
        <View>
          <Text style={styles.h}>{t('amb.onboard.choose.heading')}</Text>
          <Text style={styles.body}>{t('amb.onboard.choose.body')}</Text>
        </View>

        {ONBOARD_METHODS.map((m) => {
          const on = method === m.key;
          return (
            <Pressable key={m.key} onPress={() => setMethod(m.key)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[styles.method, on && styles.methodOn]}>
              <Text style={styles.methodIcon}>{m.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.methodTitle, on && styles.methodTitleOn]}>{t(`amb.onboard.method.${m.key}.title`)}</Text>
                <Text style={styles.methodSub}>{t(`amb.onboard.method.${m.key}.sub`)}</Text>
                <Text style={[styles.methodEta, m.fastest && styles.methodEtaFast]}>{t(`amb.onboard.method.${m.key}.eta`)}</Text>
              </View>
              {on ? <Text style={styles.tick}>✓</Text> : null}
            </Pressable>
          );
        })}

        {/* You earn — §13 no commission-plan-amount contract → generic incentive, not a fabricated ₹50 */}
        <Card style={styles.earnCard}>
          <Text style={styles.earnIcon}>💰</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.earnTitle}>{t('amb.onboard.earn.title')}</Text>
            <Text style={styles.earnBody}>{t('amb.onboard.earn.body')}</Text>
          </View>
        </Card>
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  step: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.primary700, letterSpacing: 0.5 },
  h: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  body: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: 2 },
  method: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], padding: space[3], borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  methodOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  methodIcon: { fontSize: 26, width: 34, textAlign: 'center' },
  methodTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  methodTitleOn: { color: color.primary700 },
  methodSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  methodEta: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink600, marginTop: space[1] },
  methodEtaFast: { color: color.successDark },
  tick: { fontSize: 18, color: color.primary700, fontWeight: '700' },
  earnCard: { flexDirection: 'row', gap: space[3], alignItems: 'center', backgroundColor: color.primary50 },
  earnIcon: { fontSize: 24 },
  earnTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  earnBody: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, marginTop: 2, lineHeight: font.size.xs * 1.5 },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
