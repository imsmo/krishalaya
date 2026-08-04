// apps/mobile/src/app/(ambassador)/onboard-complete.tsx · screen 91 (Onboarding Complete). Thin screen (guide §3):
// creates + shows the shareable referral code, the commission note, a summary, and the next step. Behind
// `ambassador_app`. Money via MoneyText (Law 2). Degrade-never-die.
//
// §13 (NOT faked): the ambassador's action produces a REAL referral CODE (generated from a random seed, created
// via the idempotent createReferral, Law 3) — that is the only real datum here. The farmer becomes a registered
// farmer + the commission ACCRUES only after they self-sign-up with the code and complete onboarding SERVER-SIDE
// (Law 11). So there is NO fabricated "Anil Kumar Vasava / Borsad / SBI ••••9281 / 3 min 42 sec" summary and NO
// fabricated "+₹50 credited" (no commission-plan-amount contract is exposed): the commission is framed as pending,
// the summary shows only what's real (the code + the chosen method), and the per-farmer rows appear after signup.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { createReferral } from '../../features/ambassador/ambassador.api';
import { deriveReferralCode, ONBOARD_METHODS } from '../../features/ambassador/referral-flow';
import { newId } from '../../core/util/ids';

export default function OnboardComplete() {
  const params = useLocalSearchParams<{ code?: string; method?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('ambassador_app');
  const [code, setCode] = useState<string | null>(params.code ?? null);
  const [loading, setLoading] = useState(!params.code);
  const [failed, setFailed] = useState(false);

  const create = useCallback(async () => {
    setLoading(true); setFailed(false);
    try {
      const r = await createReferral(deriveReferralCode(newId()));
      setCode(r.code);
    } catch (e) {
      setFailed(true); if (e instanceof SdkError && e.isConflict) { /* retry recreates a new seed */ }
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (enabled && !params.code) create(); }, [enabled, params.code, create]);

  if (!enabled) return <ScreenScaffold title={t('amb.onboard.completeTitle')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const methodKey = ONBOARD_METHODS.find((m) => m.key === params.method)?.key ?? null;

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('amb.onboard.done')} variant="outline" onPress={() => router.replace('/(ambassador)/farmers')} />
      <View style={{ flex: 1 }}><Button title={t('amb.onboard.complete.helpListing')} onPress={() => router.push('/(ambassador)/help-listing')} fullWidth /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('amb.onboard.completeTitle')} scroll={!loading && !failed} footer={!loading && !failed ? footer : undefined}>
      {loading ? <SkeletonCard lines={6} /> : failed ? (
        <EmptyState title={t('amb.onboard.createFailed')} actionLabel={t('common.retry')} onAction={create} />
      ) : (
        <View style={{ gap: space[3] }}>
          {/* Success hero */}
          <View style={styles.hero}>
            <Text style={styles.heroIcon}>✓</Text>
            <Text style={styles.heroTitle}>{t('amb.onboard.complete.heading')}</Text>
            <Text style={styles.heroVern}>{t('amb.onboard.complete.vern')}</Text>
            <Text style={styles.heroBody}>{t('amb.onboard.complete.body')}</Text>
          </View>

          {/* Referral code — the real deliverable */}
          {code ? (
            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>{t('amb.onboard.complete.shareCode')}</Text>
              <Text style={styles.code} accessibilityLabel={t('amb.onboard.codeLabel')}>{code}</Text>
            </View>
          ) : null}

          {/* Commission — §13: pending; accrues server-side after the farmer completes onboarding */}
          <Card style={styles.commissionCard}>
            <Text style={styles.commissionIcon}>💰</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.commissionTitle}>{t('amb.onboard.complete.commissionTitle')}</Text>
              <Text style={styles.commissionBody}>{t('amb.onboard.complete.commissionBody')}</Text>
            </View>
          </Card>

          {/* Summary — only real rows (method + code); farmer details fill after signup (§13) */}
          <Text style={styles.section}>{t('amb.onboard.complete.summary')}</Text>
          <Card>
            <Row label={t('amb.onboard.complete.method')} value={methodKey ? t(`amb.onboard.method.${methodKey}.title`) : t('common.dash')} />
            <Row label={t('amb.onboard.codeLabel')} value={code ?? t('common.dash')} last />
            <Text style={styles.summaryNote}>{t('amb.onboard.complete.summaryNote')}</Text>
          </Card>

          {/* Next */}
          <View style={styles.next}>
            <Text style={styles.nextIcon}>💡</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.nextTitle}>{t('amb.onboard.complete.nextTitle')}</Text>
              <Text style={styles.nextBody}>{t('amb.onboard.complete.nextBody')}</Text>
            </View>
          </View>
        </View>
      )}
    </ScreenScaffold>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.divide]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', padding: space[4], borderRadius: radius.lg, backgroundColor: color.successLight, gap: 2 },
  heroIcon: { fontSize: 40, color: color.successDark },
  heroTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.successDark, textAlign: 'center' },
  heroVern: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.success, textAlign: 'center' },
  heroBody: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, textAlign: 'center', marginTop: space[1] },
  codeBox: { alignItems: 'center', paddingVertical: space[4], backgroundColor: color.primary50, borderRadius: radius.lg },
  codeLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink500, textTransform: 'uppercase', letterSpacing: 0.5 },
  code: { fontFamily: font.display, fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: color.primary800, letterSpacing: 3, marginTop: space[1] },
  commissionCard: { flexDirection: 'row', gap: space[3], alignItems: 'center', backgroundColor: color.accent },
  commissionIcon: { fontSize: 24 },
  commissionTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink900 },
  commissionBody: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink800, marginTop: 2, lineHeight: font.size.xs * 1.5 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[2], gap: space[3] },
  divide: { borderBottomWidth: 1, borderBottomColor: color.ink100 },
  rowLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  rowValue: { flexShrink: 1, textAlign: 'right', fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  summaryNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[2], lineHeight: font.size.xs * 1.5 },
  next: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', backgroundColor: color.warningLight, borderRadius: radius.lg, padding: space[3] },
  nextIcon: { fontSize: 22 },
  nextTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.warningDark },
  nextBody: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, marginTop: 2, lineHeight: font.size.xs * 1.5 },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
