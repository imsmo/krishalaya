// apps/mobile/src/app/(worker)/pmsby-enroll.tsx · screen 145 (PMSBY Enrollment — worker). Thin screen (guide §3):
// the PMSBY scheme facts (₹2L cover / ₹20 premium — public constants), the worker's REAL eligibility (18+ from the
// age-verified profile, a linked bank account, a verified Aadhaar KYC), and a nominee form. Behind `worker_app`.
// FLAG_SECURE (collects a nominee + optional Aadhaar). Money via MoneyText (Law 2). Degrade-never-die.
//
// DEV-24 (KV-BL-055): "Enroll" now drives the REAL flow against DEV-22/23's insurance module: product select
// (the single PMSBY product, resolved server-side via `findPmsbyProduct()` — no picker UI needed, matching this
// screen's own single-product design) → consent (the new "I confirm..." checkbox below; the platform's other
// enrolment flows equivalently gate on an explicit consent step per canon 283-285) → `proposePmsbyPolicy()`
// (creates the policy row, `status='proposed'`) → `payPmsbyPremium()` (Law 6: a REAL, online, direct premium
// payment — the SAME Razorpay-checkout-or-sandbox-then-poll loop `features/payments/payments.api.ts`'s
// `addMoney` already uses; it either succeeds or fails visibly in this one call, NEVER queued offline).
// §13 — the nominee NAME/RELATIONSHIP/AADHAAR fields are still captured on-screen but have NO backing column
// anywhere in `insurance_policies` (DEV-22's own flagged schema gap, `KV-BL-036` "PMSBY nominee edit... new
// `policy_nominees`... depends on E5 insurance module existing at all" — still unbuilt; confirmed by grep,
// 0 hits for `policy_nominees` in `db/migrations`). This batch does NOT invent that table or silently drop the
// field the canon calls for — the form still captures it (useful for a future migration + this screen needing
// zero rework) but it is NOT sent to `POST /v1/insurance/policies` (whose `.strict()` DTO has no nominee field)
// and a note discloses this honestly, matching the pre-existing convention this screen already used.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import type { WorkerProfile, BankAccount, KycDocument, KycDocType } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useSecureScreen } from '../../core/security/screen-guard';
import { getMyWorker } from '../../features/labour/labour.api';
import { myDocuments, kycDocTypes } from '../../features/kyc/kyc.api';
import { myBankAccounts } from '../../features/profile/profile.api';
import { bankLabel } from '../../features/profile/profile';
import { bankAccount } from '../../features/labour/worker-documents';
import {
  NOMINEE_RELATIONSHIPS, PMSBY_COVER_MINOR, PMSBY_PARTIAL_MINOR, PMSBY_PREMIUM_MINOR,
  normalizeAadhaar, canEnroll, pmsbyEligibility, pmsbyCoverageWindow, type NomineeRelationship,
} from '../../features/labour/pmsby-enroll';
import { findPmsbyProduct, proposePmsbyPolicy, payPmsbyPremium } from '../../features/insurance/insurance.api';

export default function PmsbyEnroll() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_app');
  useSecureScreen();
  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [docTypes, setDocTypes] = useState<KycDocType[]>([]);
  const [kyc, setKyc] = useState<KycDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState('');
  const [rel, setRel] = useState<NomineeRelationship | null>(null);
  const [aadhaar, setAadhaar] = useState('');
  const [consent, setConsent] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    try {
      const [w, b, dt, k] = await Promise.all([getMyWorker(), myBankAccounts(), kycDocTypes(), myDocuments()]);
      setWorker(w); setBanks(b ?? []); setDocTypes(dt ?? []); setKyc(k ?? []); setFailed(!w);
    } catch { setFailed(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('pmsbyEnroll.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const elig = pmsbyEligibility(worker, banks, docTypes, kyc);
  const bank = bankAccount(banks);
  const debitBank = bank ? bankLabel(bank) : null;

  /** REAL enrolment (Law 6: online, direct, never queued). product select (the single PMSBY product) →
   * propose (policy row, 'proposed') → initiate + drive the premium payment. Throws surface as a friendly
   * alert — this is a mutation, not a silent failure. On success, returns to Insurance (39) which re-fetches
   * the caller's own policy from the server (never assumes success from this screen's own state). */
  const enroll = async () => {
    if (!canEnroll(name, rel, aadhaar) || !consent || enrolling) return;
    setEnrolling(true);
    try {
      const product = await findPmsbyProduct();
      if (!product) { Alert.alert(t('pmsbyEnroll.title'), t('pmsbyEnroll.unavailable')); return; }
      const { validFrom, validUntil } = pmsbyCoverageWindow();
      const { policies } = await proposePmsbyPolicy({ productId: product.id, sumInsuredMinor: PMSBY_COVER_MINOR, validFrom, validUntil });
      const policyId = policies[0]?.id;
      if (!policyId) { Alert.alert(t('pmsbyEnroll.title'), t('pmsbyEnroll.enrollFailed')); return; }
      const payment = await payPmsbyPremium(policyId, worker ? { name: undefined, contact: undefined } : undefined);
      if (payment.outcome === 'success') {
        router.replace({ pathname: '/(worker)/insurance', params: { notice: t('pmsbyEnroll.enrolledNotice') } });
      } else if (payment.outcome === 'pending') {
        Alert.alert(t('pmsbyEnroll.title'), t('pmsbyEnroll.paymentPending'));
        router.replace('/(worker)/insurance');
      } else {
        Alert.alert(t('pmsbyEnroll.title'), t('pmsbyEnroll.paymentFailed'));
      }
    } catch {
      Alert.alert(t('pmsbyEnroll.title'), t('pmsbyEnroll.enrollFailed'));
    } finally {
      setEnrolling(false);
    }
  };

  const benefits: Array<{ key: string; icon: string; minor: string }> = [
    { key: 'death', icon: '💰', minor: PMSBY_COVER_MINOR },
    { key: 'total', icon: '🦽', minor: PMSBY_COVER_MINOR },
    { key: 'partial', icon: '🦾', minor: PMSBY_PARTIAL_MINOR },
  ];

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('pmsbyEnroll.later')} variant="outline" onPress={() => router.back()} disabled={enrolling} />
      <View style={{ flex: 1 }}>
        <Button
          title={enrolling ? t('pmsbyEnroll.enrolling') : t('pmsbyEnroll.enrollCta', { amount: formatMoneyMinor(PMSBY_PREMIUM_MINOR, 'INR', lang) })}
          onPress={enroll}
          loading={enrolling}
          disabled={!canEnroll(name, rel, aadhaar) || !consent || !elig.qualifies || enrolling}
          fullWidth
        />
      </View>
    </View>
  );

  return (
    <ScreenScaffold title={t('pmsbyEnroll.title')} scroll={false} footer={footer}>
      {loading ? <SkeletonCard lines={10} /> : failed ? (
        <EmptyState title={t('common.error.generic')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[3] }}>
          {/* Hero — scheme facts */}
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>{t('pmsbyEnroll.pmsby')}</Text>
            <Text style={styles.heroSub}>{t('pmsbyEnroll.pmsbyFull')}</Text>
            <MoneyText minor={PMSBY_COVER_MINOR} currencyCode="INR" langCode={lang} size="3xl" style={{ color: color.white }} />
            <Text style={styles.heroCover}>{t('pmsbyEnroll.coverDesc')}</Text>
            <View style={styles.premiumTag}><Text style={styles.premiumTxt}>{t('pmsbyEnroll.premiumTag', { amount: formatMoneyMinor(PMSBY_PREMIUM_MINOR, 'INR', lang) })}</Text></View>
          </View>

          {/* What you get */}
          <Text style={styles.section}>{t('pmsbyEnroll.whatYouGet')}</Text>
          <Card>
            {benefits.map((b, i) => (
              <View key={b.key} style={[styles.benefit, i > 0 && styles.divide]}>
                <Text style={styles.benefitIcon}>{b.icon}</Text>
                <View style={{ flex: 1 }}>
                  <MoneyText minor={b.minor} currencyCode="INR" langCode={lang} size="md" />
                  <Text style={styles.benefitTitle}>{t(`pmsbyEnroll.benefit.${b.key}.title`)}</Text>
                  <Text style={styles.benefitSub}>{t(`pmsbyEnroll.benefit.${b.key}.sub`)}</Text>
                </View>
              </View>
            ))}
          </Card>

          {/* Eligibility — real */}
          <Text style={styles.section}>{t('pmsbyEnroll.eligibility')}</Text>
          <View style={[styles.eligCard, elig.qualifies ? styles.eligOk : styles.eligPending]}>
            <Text style={styles.eligIcon}>{elig.qualifies ? '✓' : '⏳'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.eligTitle}>{elig.qualifies ? t('pmsbyEnroll.qualify') : t('pmsbyEnroll.notYet')}</Text>
              <Text style={styles.eligDetail}>
                {t('pmsbyEnroll.ageRange')} {mark(elig.ageOk)} · {t('pmsbyEnroll.bankAccount')} {mark(elig.bankOk)} · {t('pmsbyEnroll.aadhaarLinked')} {mark(elig.aadhaarOk)}
              </Text>
            </View>
          </View>

          {/* Add nominee */}
          <Text style={styles.section}>{t('pmsbyEnroll.addNominee')}</Text>
          <Card>
            <Input label={t('pmsbyEnroll.nomineeName')} value={name} onChangeText={setName} placeholder={t('pmsbyEnroll.nomineeNamePh')} maxLength={100} />
            <Text style={styles.fieldLabel}>{t('pmsbyEnroll.relationship')}</Text>
            <View style={styles.relRow}>
              {NOMINEE_RELATIONSHIPS.map((r) => {
                const on = rel === r;
                return (
                  <Pressable key={r} onPress={() => setRel(r)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[styles.relChip, on && styles.relChipOn]}>
                    <Text style={[styles.relTxt, on && styles.relTxtOn]}>{t(`pmsbyEnroll.rel.${r}`)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ marginTop: space[3] }}>
              <Input label={t('pmsbyEnroll.nomineeAadhaar')} value={aadhaar} onChangeText={(v) => setAadhaar(normalizeAadhaar(v))} placeholder={t('pmsbyEnroll.aadhaarPh')} keyboardType="number-pad" maxLength={12} />
            </View>
            <Text style={[styles.note, { marginTop: space[2] }]}>{t('pmsbyEnroll.nomineeSchemaNote')}</Text>
          </Card>

          {/* Consent — required before the real propose+pay call fires */}
          <Pressable
            onPress={() => setConsent((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consent }}
            style={styles.consentRow}
          >
            <View style={[styles.checkbox, consent && styles.checkboxOn]}>{consent ? <Text style={styles.checkboxTick}>✓</Text> : null}</View>
            <Text style={styles.consentTxt}>{t('pmsbyEnroll.consent')}</Text>
          </Pressable>

          {/* Auto-debit mandate note */}
          <View style={styles.mandate}>
            <Text style={styles.mandateTxt}>
              {debitBank ? t('pmsbyEnroll.mandateBank', { amount: formatMoneyMinor(PMSBY_PREMIUM_MINOR, 'INR', lang), bank: debitBank }) : t('pmsbyEnroll.mandateGeneric', { amount: formatMoneyMinor(PMSBY_PREMIUM_MINOR, 'INR', lang) })}
            </Text>
          </View>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function mark(ok: boolean): string { return ok ? '✓' : '✗'; }

const styles = StyleSheet.create({
  hero: { padding: space[4], borderRadius: radius.lg, backgroundColor: color.primary700, alignItems: 'center', gap: 4 },
  heroTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.white },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.primary50, marginBottom: space[2], textAlign: 'center' },
  heroCover: { fontFamily: font.body, fontSize: font.size.sm, color: color.primary50, marginTop: 2, textAlign: 'center' },
  premiumTag: { marginTop: space[2], backgroundColor: color.accent, borderRadius: radius.pill, paddingHorizontal: space[3], paddingVertical: 6 },
  premiumTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink900 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[2], marginBottom: space[1] },
  benefit: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', paddingTop: space[2] },
  divide: { borderTopWidth: 1, borderTopColor: color.ink100, marginTop: space[2] },
  benefitIcon: { fontSize: 26, width: 34, textAlign: 'center' },
  benefitTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800, marginTop: 2 },
  benefitSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  eligCard: { flexDirection: 'row', gap: space[3], alignItems: 'center', borderRadius: radius.lg, padding: space[3], borderWidth: 1 },
  eligOk: { backgroundColor: color.successLight, borderColor: color.success },
  eligPending: { backgroundColor: color.warningLight, borderColor: color.warning },
  eligIcon: { fontSize: 24 },
  eligTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  eligDetail: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, marginTop: 2 },
  fieldLabel: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700, marginTop: space[3], marginBottom: space[2] },
  relRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  relChip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  relChipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  relTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  relTxtOn: { color: color.primary700 },
  mandate: { backgroundColor: color.ink50, borderRadius: radius.md, padding: space[3] },
  mandateTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, lineHeight: font.size.xs * 1.5 },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, lineHeight: font.size.xs * 1.5 },
  consentRow: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', paddingHorizontal: space[1] },
  checkbox: { width: 22, height: 22, borderRadius: radius.sm, borderWidth: 1.5, borderColor: color.ink300, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxOn: { borderColor: color.primary600, backgroundColor: color.primary600 },
  checkboxTick: { color: color.white, fontSize: 14, fontWeight: '700' },
  consentTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, lineHeight: font.size.sm * 1.4 },
});
