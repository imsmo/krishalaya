// apps/mobile/src/app/(ambassador)/help-listing.tsx · screen 162 (Help with Listing). Thin screen (guide §3): a
// step-by-step COACHING guide the ambassador follows WITH the farmer on the FARMER's own phone/login — the app
// never posts a listing as someone else (Law 4/11). Behind `ambassador_app`. Degrade-never-die.
//
// §13 (NOT faked): the referral contract is PII-minimised — the ambassador has NO farmer name / village / join
// date / phone — so the header is generic ("Help a farmer's first listing"), never "Anil Kumar · Borsad · joined
// 2 days ago", and there is no Call button (no phone contract). The 5 steps are a FIXED guidance checklist, not a
// live server-backed draft, so no fabricated per-step ticks ("✓ Wheat · 3 quintal"). There is no exposed
// commission-plan amount (no "₹25") and no per-crop mandi band on this screen (no crop/mandi context yet), so the
// fair-price section is coaching text pointing the farmer to today's mandi rate — never a fabricated "₹2,880".
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';

const STEPS = ['crop', 'photos', 'price', 'grade', 'publish'] as const;
const FOCUS: (typeof STEPS)[number] = 'price';

export default function HelpListing() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('ambassador_app');
  if (!enabled) return <ScreenScaffold title={t('amb.help.listingTitle')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('amb.help.listingTitle')} scroll footer={<Button title={t('amb.onboard.done')} onPress={() => router.back()} />}>
      <View style={{ gap: space[3] }}>
        {/* Intro — generic, §13: no fabricated farmer identity, no Call */}
        <Card style={styles.intro}>
          <Text style={styles.heading}>{t('amb.help.listing.heading')}</Text>
          <Text style={styles.note}>{t('amb.help.onBehalfNote')}</Text>
        </Card>

        {/* Incentive — §13: no fabricated ₹ amount */}
        <View style={styles.incentive}>
          <Text style={styles.incIcon}>💰</Text>
          <Text style={styles.incTxt}>{t('amb.help.listing.incentive')}</Text>
        </View>

        {/* Guided 5-step flow */}
        <Text style={styles.section}>{t('amb.help.listing.stepsTitle')}</Text>
        <Card style={{ gap: space[1] }}>
          {STEPS.map((s, i) => {
            const focus = s === FOCUS;
            return (
              <View key={s} style={[styles.stepRow, i > 0 && styles.divide]}>
                <View style={[styles.stepNo, focus && styles.stepNoFocus]}><Text style={[styles.stepNoTxt, focus && styles.stepNoTxtFocus]}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <View style={styles.stepTitleRow}>
                    <Text style={styles.stepTitle}>{t(`amb.help.listing.step.${s}.title`)}</Text>
                    {focus ? <Text style={styles.here}>{t('amb.help.listing.here')}</Text> : null}
                  </View>
                  <Text style={styles.stepDesc}>{t(`amb.help.listing.step.${s}.desc`)}</Text>
                </View>
              </View>
            );
          })}
        </Card>

        {/* Fair-price coaching (the focus step) */}
        <Text style={styles.section}>{t('amb.help.listing.fairTitle')}</Text>
        <Card style={styles.fairCard}>
          <Text style={styles.fairBody}>{t('amb.help.listing.fairBody')}</Text>
          <Text style={styles.scriptLabel}>{t('amb.help.listing.scriptLabel')}</Text>
          <Text style={styles.script}>{t('amb.help.listing.script')}</Text>
        </Card>
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  intro: { backgroundColor: color.primary50 },
  heading: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900 },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[2], lineHeight: font.size.sm * 1.5 },
  incentive: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: color.accent, borderRadius: radius.lg, padding: space[3] },
  incIcon: { fontSize: 24 },
  incTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink900, lineHeight: font.size.sm * 1.5 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[2] },
  stepRow: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', paddingVertical: space[2] },
  divide: { borderTopWidth: 1, borderTopColor: color.ink100 },
  stepNo: { width: 28, height: 28, borderRadius: 14, backgroundColor: color.ink100, alignItems: 'center', justifyContent: 'center' },
  stepNoFocus: { backgroundColor: color.primary600 },
  stepNoTxt: { fontFamily: font.display, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink600 },
  stepNoTxtFocus: { color: color.card },
  stepTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  stepTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink900 },
  here: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.primary700 },
  stepDesc: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, marginTop: 2, lineHeight: font.size.xs * 1.5 },
  fairCard: { backgroundColor: color.warningLight, gap: space[2] },
  fairBody: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, lineHeight: font.size.sm * 1.5 },
  scriptLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink500, marginTop: space[1] },
  script: { fontFamily: font.body, fontSize: font.size.sm, fontStyle: 'italic', color: color.ink800, lineHeight: font.size.sm * 1.6 },
});
