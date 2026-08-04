// apps/mobile/src/app/(worker)/insurance.tsx · screen 39 (PMSBY Insurance). Thin screen (guide §3): a faithful
// informational view of the Pradhan Mantri Suraksha Bima Yojana — a fixed GOVERNMENT scheme whose cover (₹2,00,000),
// premium (₹20/yr) and what's-covered terms are PUBLIC PROGRAM FACTS (the same for every worker), rendered as
// static content with money via MoneyText (Law 2, program constants — not per-user values). Behind `worker_app`.
// Degrade-never-die.
//
// DEV-24 (KV-BL-055): the API is now REAL (`apps/api/src/modules/insurance`, DEV-22/23, flag `insurance` — a
// separate, server-side-only switch, see `insurance.api.ts`'s own header note). "Your policy" fetches the
// caller's OWN real PMSBY policy (if any) and renders its real status/validity/policy-number — never the
// design's seed data (SBI-PMSBY-7842156 / Vikas Kumar was never real and is not rendered). Nominee display is
// still an honest gap: `insurance_policies` carries no nominee column (DEV-22's own flagged schema gap,
// `KV-BL-036`, still unbuilt) — the nominee section stays the pre-existing honest "not on this schema yet" note.
// Download-policy-PDF has no endpoint anywhere in the module — stays an honest coming-soon, not invented.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { findPmsbyProduct, myPmsbyPolicy, type InsurancePolicyView } from '../../features/insurance/insurance.api';
// [QA-FIX 2026-07-28, DEV-24 QA]: these three PMSBY statutory constants were being re-declared locally here,
// duplicating the SAME values already defined once in features/labour/pmsby-enroll.ts (screen 145's own
// source-of-truth for the enrolment flow). Two independent literal copies of a "public scheme fact" is exactly
// the drift risk Law 3/Law 11 warn about — one file could get updated on a future PMSBY premium/cover revision
// (this has happened before: the premium moved ₹12→₹20 in 2022) while the other silently goes stale. Importing
// the single existing source instead; no behavior change (same literal values).
import { PMSBY_COVER_MINOR as COVER_MINOR, PMSBY_PARTIAL_MINOR as PARTIAL_MINOR, PMSBY_PREMIUM_MINOR as PREMIUM_MINOR } from '../../features/labour/pmsby-enroll';

export default function WorkerInsurance() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_app');
  const [policy, setPolicy] = useState<InsurancePolicyView | null>(null);
  const [loadingPolicy, setLoadingPolicy] = useState(true);

  const loadPolicy = useCallback(async () => {
    setLoadingPolicy(true);
    try {
      const product = await findPmsbyProduct();
      setPolicy(product ? await myPmsbyPolicy(product.id) : null);
    } finally {
      setLoadingPolicy(false);
    }
  }, []);
  useEffect(() => { if (enabled) loadPolicy(); }, [enabled, loadPolicy]);

  if (!enabled) return <ScreenScaffold title={t('worker.insurance.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const covered: Array<{ key: string; minor?: string }> = [
    { key: 'death', minor: COVER_MINOR },
    { key: 'totalDisability', minor: COVER_MINOR },
    { key: 'partialDisability', minor: PARTIAL_MINOR },
    { key: 'bothAccidents' },
    { key: 'roundClock' },
  ];

  return (
    <ScreenScaffold
      title={t('worker.insurance.title')} scroll={false}
      footer={
        <View style={styles.actions}>
          <Button title={t('worker.insurance.download')} variant="outline" onPress={() => Alert.alert(t('worker.insurance.title'), t('worker.insurance.comingSoon'))} />
          <View style={{ flex: 1 }}>
            <Button
              title={t('worker.insurance.fileClaim')}
              onPress={() => router.push('/(worker)/claim')}
              disabled={policy?.status !== 'active'}
              fullWidth
            />
          </View>
        </View>
      }
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[3] }}>
        {/* Hero — program facts */}
        <View style={styles.hero}>
          <View style={styles.badge}><Text style={styles.badgeTxt}>{t('worker.insurance.govtBacked')}</Text></View>
          <Text style={styles.heroTitle}>{t('worker.insurance.pmsby')}</Text>
          <Text style={styles.heroSub}>{t('worker.insurance.pmsbyFull')}</Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>{t('worker.insurance.totalCover')}</Text>
              <MoneyText minor={COVER_MINOR} currencyCode="INR" langCode={lang} size="xl" style={{ color: color.white }} />
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>{t('worker.insurance.premium')}</Text>
              <Text style={styles.heroPremium}>{t('worker.insurance.premiumOnly', { amount: formatMoneyMinor(PREMIUM_MINOR, 'INR', lang) })}</Text>
            </View>
          </View>
        </View>

        {/* Enroll CTA → PMSBY enrollment (145). Hidden once an active/proposed policy already exists. */}
        {!policy || policy.status === 'cancelled' || policy.status === 'expired' ? (
          <Button title={t('worker.insurance.enroll')} onPress={() => router.push('/(worker)/pmsby-enroll')} fullWidth />
        ) : null}

        {/* What's covered — program facts */}
        <Card>
          <Text style={styles.h3}>{t('worker.insurance.whatsCovered')}</Text>
          {covered.map((c) => (
            <View key={c.key} style={styles.coverRow}>
              <Text style={styles.tick}>✓</Text>
              <Text style={styles.coverText}>
                {t(`worker.insurance.cover.${c.key}`)}{c.minor ? ` — ${formatMoneyMinor(c.minor, 'INR', lang)}` : ''}
              </Text>
            </View>
          ))}
        </Card>

        {/* Your policy — DEV-24: the caller's OWN real policy, once enrolled. */}
        <Card>
          <Text style={styles.h3}>{t('worker.insurance.yourPolicy')}</Text>
          {loadingPolicy ? (
            <SkeletonCard lines={3} />
          ) : policy ? (
            <View style={{ gap: 4 }}>
              <View style={styles.coverRow}>
                <Text style={styles.tick}>•</Text>
                <Text style={styles.coverText}>{t('worker.insurance.status')}: {t(`worker.insurance.policyStatus.${policy.status}`)}</Text>
              </View>
              {policy.policyNo ? (
                <View style={styles.coverRow}>
                  <Text style={styles.tick}>•</Text>
                  <Text style={styles.coverText}>{t('worker.insurance.policyNumber')}: {policy.policyNo}</Text>
                </View>
              ) : null}
              <View style={styles.coverRow}>
                <Text style={styles.tick}>•</Text>
                <Text style={styles.coverText}>{t('worker.insurance.validity')}: {policy.validFrom} — {policy.validUntil}</Text>
              </View>
              {policy.status === 'proposed' ? (
                <Text style={[styles.note, { marginTop: space[2] }]}>{t('worker.insurance.awaitingPayment')}</Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.note}>{t('worker.insurance.policyNote')}</Text>
          )}
        </Card>

        {/* Nominee — §13 */}
        <Card>
          <Text style={styles.h3}>{t('worker.insurance.nominee')}</Text>
          <Text style={styles.note}>{t('worker.insurance.nomineeNote')}</Text>
        </Card>

        {/* How to claim — program info */}
        <Card>
          <Text style={styles.h3}>{t('worker.insurance.howToClaim')}</Text>
          <Text style={styles.claimBody}>{t('worker.insurance.claimBody')}</Text>
        </Card>
      </ScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  hero: { backgroundColor: color.primary700, borderRadius: radius.lg, padding: space[5], alignItems: 'center' },
  badge: { paddingHorizontal: space[3], paddingVertical: 4, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.18)' },
  badgeTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.white, letterSpacing: 0.5 },
  heroTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.white, marginTop: space[3] },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.primary100, marginTop: 2, textAlign: 'center' },
  heroStats: { flexDirection: 'row', gap: space[3], marginTop: space[4], width: '100%' },
  heroStat: { flex: 1, alignItems: 'center', gap: 2 },
  heroStatLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.primary100, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroPremium: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.accent300 },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  coverRow: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start', paddingVertical: 6 },
  tick: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.successDark },
  coverText: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, lineHeight: font.size.sm * 1.4 },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, lineHeight: font.size.sm * 1.5 },
  claimBody: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, lineHeight: font.size.sm * 1.6 },
});
