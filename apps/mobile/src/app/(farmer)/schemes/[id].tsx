// apps/mobile/src/app/(farmer)/schemes/[id].tsx · screen 105 "Scheme Detail". Thin screen (guide §3): the scheme's
// header (resolved authority + level), benefits + required-doc count + processing fee (bigint paise via MoneyText,
// Law 2), an EXPLAINABLE eligibility check (server-evaluated → eligible + reasons), a generic "How it works"
// process, and Ask-AI / Apply CTAs. "Apply" carries the scheme + required docs to the apply screen.
// Behind `schemes_govt`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • The benefit HEADLINE ("₹6,000 / year · 3 installments") lives in the opaque `benefitSummary` JSON → we render
//    only its primitive entries defensively (renderSummary), never an invented figure; the processing fee is real.
//  • "Who can apply" / "Excluded" attribute rows come from the opaque `eligibilityRules` JSON → replaced by the
//    REAL explainable eligibility check (eligible + server reasons), not fabricated rule rows.
//  • The doc-checklist names + verification ticks ("Aadhaar ✓", "SBI ••••2247") need doc-type names + KYC/bank
//    cross-refs not on this contract → we show the REAL required-doc COUNT and route to the apply screen to upload.
//  • "Official info" (launched-by / start-year / recipients / website) has no contract → a coming-soon note, never
//    invented stats.
//  • The "How it works" steps are the UNIVERSAL DBT flow (static i18n) — no scheme-specific day-counts/doc-names.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Scheme, SchemeAuthority, EligibilityResult } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getScheme, listAuthorities, checkEligibility } from '../../../features/schemes/schemes.api';
import { buildEligibilityInput, eligibilitySummary } from '../../../features/schemes/schemes';

const GENDERS = ['male', 'female', 'other'] as const;
const STEPS = ['fill', 'upload', 'verify', 'approve', 'credit'] as const;

export default function SchemeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('schemes_govt');
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [authority, setAuthority] = useState<SchemeAuthority | null>(null);
  const [loading, setLoading] = useState(true);
  const [acres, setAcres] = useState('');
  const [gender, setGender] = useState<string | null>(null);
  const [age, setAge] = useState('');
  const [result, setResult] = useState<EligibilityResult | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    setLoading(true);
    const [s, auths] = await Promise.all([getScheme(id), listAuthorities()]);
    setScheme(s);
    setAuthority(s ? (auths as SchemeAuthority[]).find((a) => a.id === s.authorityId) ?? null : null);
    setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('schemes.detailTitle')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const check = async () => {
    if (!id) return;
    setChecking(true);
    const input = buildEligibilityInput({ landholdingAcres: acres, gender: gender ?? undefined, age });
    setResult(await checkEligibility(id, input));
    setChecking(false);
  };
  const summary = eligibilitySummary(result);
  const levelKey = (authority?.level ?? '').toLowerCase();
  const levelLabel = ['central', 'state', 'district'].includes(levelKey) ? t(`schemes.detail.level.${levelKey}`) : null;

  return (
    <ScreenScaffold title={scheme?.name ?? t('schemes.detailTitle')}>
      {loading ? <SkeletonCard lines={6} /> : !scheme ? (
        <EmptyState title={t('schemes.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: space[6] }} showsVerticalScrollIndicator={false}>
          {/* Hero: authority + name */}
          <View style={styles.hero}>
            <Text style={styles.authority}>{[authority?.name, levelLabel].filter(Boolean).join(' · ') || t('schemes.centralScheme')}</Text>
            <Text style={styles.name}>{scheme.name}</Text>
          </View>

          <Card>
            <Text style={styles.h}>{t('schemes.benefits')}</Text>
            {renderSummary(scheme.benefitSummary).map(([k, v]) => (
              <View key={k} style={styles.kv}><Text style={styles.k}>{k}</Text><Text style={styles.v}>{v}</Text></View>
            ))}
            <View style={styles.kv}><Text style={styles.k}>{t('schemes.processingFee')}</Text>
              {BigInt(scheme.processingFeeMinor || '0') > 0n ? <MoneyText minor={scheme.processingFeeMinor} langCode={lang} size="md" /> : <Text style={styles.free}>{t('schemes.free')}</Text>}
            </View>
            <View style={styles.kv}><Text style={styles.k}>{t('schemes.docsRequired')}</Text><Text style={styles.v}>{scheme.requiredDocTypeIds.length}</Text></View>
            <Text style={styles.note}>{t('schemes.detail.needNote')}</Text>
          </Card>

          {/* Explainable eligibility check (real) */}
          <Card style={styles.section}>
            <Text style={styles.h}>{t('schemes.eligibility.title')}</Text>
            <Text style={styles.note}>{t('schemes.eligibility.note')}</Text>
            <Input label={t('schemes.eligibility.landholding')} value={acres} onChangeText={setAcres} keyboardType="decimal-pad" maxLength={7} />
            <View style={styles.chips}>
              {GENDERS.map((g) => {
                const on = gender === g;
                return <Pressable key={g} onPress={() => setGender(on ? null : g)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}><Text style={[styles.chipText, on && styles.chipTextOn]}>{t(`schemes.gender.${g}`)}</Text></Pressable>;
              })}
            </View>
            <Input label={t('schemes.eligibility.age')} value={age} onChangeText={setAge} keyboardType="number-pad" maxLength={3} />
            <View style={{ marginTop: space[2] }}><Button title={t('schemes.eligibility.check')} loading={checking} onPress={check} variant="outline" /></View>
            {result ? (
              <View style={styles.result}>
                <StatusPill label={t(summary.eligible ? 'schemes.eligibility.eligible' : 'schemes.eligibility.notEligible')} tone={summary.eligible ? 'success' : 'warning'} />
                {result.reasons.map((r, i) => <Text key={i} style={styles.reason}>• {r}</Text>)}
              </View>
            ) : null}
          </Card>

          {/* How it works — universal DBT flow (static) */}
          <Card style={styles.section}>
            <Text style={styles.h}>{t('schemes.detail.howItWorks')}</Text>
            {STEPS.map((s, i) => (
              <View key={s} style={styles.step}>
                <Text style={styles.stepNo}>{i + 1}</Text>
                <Text style={styles.stepTxt}>{t(`schemes.detail.step.${s}`)}</Text>
              </View>
            ))}
          </Card>

          {/* Official info — §13: not in contract */}
          <Card style={styles.section}>
            <Text style={styles.h}>{t('schemes.detail.officialInfo')}</Text>
            <Text style={styles.note}>{t('schemes.detail.officialInfoSoon')}</Text>
          </Card>

          <View style={styles.cta}>
            <View style={{ flex: 1 }}><Button title={t('schemes.detail.askAi')} variant="outline" onPress={() => router.push('/(farmer)/assistant')} /></View>
            <View style={{ flex: 1 }}><Button title={t('schemes.detail.applyNow')} onPress={() => router.push({ pathname: '/(farmer)/schemes/apply', params: { id: scheme.id, docs: scheme.requiredDocTypeIds.join(',') } })} /></View>
          </View>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

/** Defensively render the opaque benefitSummary: only primitive string/number entries (never invent data). */
function renderSummary(summary: Record<string, unknown>): Array<[string, string]> {
  if (!summary || typeof summary !== 'object') return [];
  return Object.entries(summary).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v)] as [string, string]).slice(0, 12);
}

const styles = StyleSheet.create({
  hero: { marginBottom: space[3] },
  authority: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginBottom: 2 },
  name: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900 },
  h: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink900, marginBottom: space[2] },
  section: { marginTop: space[3] },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[2] },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[1] },
  k: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500, flex: 1 },
  v: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  free: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.success },
  chips: { flexDirection: 'row', gap: space[2], marginVertical: space[2] },
  chip: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600 },
  chipText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  chipTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
  result: { marginTop: space[3], gap: space[1] },
  reason: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], paddingVertical: space[2] },
  stepNo: { width: 24, height: 24, borderRadius: 12, textAlign: 'center', lineHeight: 24, backgroundColor: color.primary50, color: color.primary700, fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, overflow: 'hidden' },
  stepTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, lineHeight: 20 },
  cta: { flexDirection: 'row', gap: space[3], marginTop: space[4] },
});
