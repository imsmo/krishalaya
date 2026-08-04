// apps/mobile/src/app/(ambassador)/goal-setting.tsx · screen 170 (Set Next Month Goals). Thin screen (guide §3):
// the ambassador plans next month's per-metric goals with steppers seeded from their REAL last-month activity, then
// "Lock In Goals" writes each via the REAL setTarget mutation. The SERVER is the authority: setting a target needs
// `ambassadors.manage`, so if the caller isn't permitted the write returns 403 and the screen degrades with a
// friendly "managed by your coordinator" message (never worked around — §4/Law 11). Behind `ambassador_training`.
//
// §13 (NOT faked): the period ("Plan {nextMonth} Goals"), the "Last month: X" actuals (real feeds — onboardings via
// activated referrals, visits via visit log; sales_facilitated has no achieved feed → "—") and the target values
// are all real. Only the metrics the target contract actually supports get a stepper (onboardings /
// sales_facilitated / visits). DROPPED from the mockup (no contract): the "💡 AI suggestion: … target 18 onboards"
// banner + "AI Auto-set" button (no goal-recommendation endpoint), the per-goal bonus amounts ("₹2,000 if
// completed"), the "Training videos" goal (not a target metric), and the "Focus areas" chips (no field to persist
// them) — invented data is never shown.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import type { AmbassadorProfile, Referral, AmbassadorVisit, AmbassadorTarget, AmbassadorTargetMetric } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { Button, Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { myProfile, myTargets, listReferrals, listVisits, setTarget } from '../../features/ambassador/ambassador.api';
import { monthPeriodOffset, clampGoal, onboardsAchieved, visitsAchieved } from '../../features/ambassador/targets';

// The count metrics we can offer a stepper for (the target contract supports these; earnings is money, not a +/−).
const GOAL_METRICS: AmbassadorTargetMetric[] = ['onboardings', 'sales_facilitated', 'visits'];

export default function GoalSetting() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('ambassador_training');
  const [profile, setProfile] = useState<AmbassadorProfile | null>(null);
  const [lastActual, setLastActual] = useState<Partial<Record<AmbassadorTargetMetric, number | null>>>({});
  const [values, setValues] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const next = useMemo(() => monthPeriodOffset(Date.now(), 1), []);
  const prev = useMemo(() => monthPeriodOffset(Date.now(), -1), []);
  const periodLabel = formatDate(next.startIso, lang, { month: 'short', year: 'numeric' });

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    try {
      const [prof, existing, rf, vs] = await Promise.all([myProfile(), myTargets(), listReferrals(), listVisits()]);
      setProfile(prof);
      const actual: Partial<Record<AmbassadorTargetMetric, number | null>> = {
        onboardings: onboardsAchieved(rf.items, prev.startIso, prev.endIso),
        visits: visitsAchieved(vs.items, prev.startIso, prev.endIso),
        sales_facilitated: null, // no achieved feed (§13)
      };
      setLastActual(actual);
      // Seed each stepper: existing next-month target if already set, else last-month actual, else 0.
      const seed: Record<string, number> = {};
      for (const m of GOAL_METRICS) {
        const ex = (existing as AmbassadorTarget[]).find((x) => x.metric === m && x.periodStart === next.startIso);
        seed[m] = clampGoal(ex ? Number.parseInt(ex.targetValue, 10) || 0 : (actual[m] ?? 0));
      }
      setValues(seed);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, [next.startIso, prev.startIso, prev.endIso]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('amb.goals.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const step = (metric: string, delta: number) => setValues((v) => ({ ...v, [metric]: clampGoal((v[metric] ?? 0) + delta) }));

  const lockIn = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      for (const m of GOAL_METRICS) {
        await setTarget({ ambassadorId: profile.id, metric: m, periodStart: next.startIso, periodEnd: next.endIso, targetValue: String(values[m] ?? 0) });
      }
      router.replace({ pathname: '/(ambassador)/targets', params: { notice: t('amb.goals.saved') } });
    } catch (e) {
      const msg = e instanceof SdkError && e.status === 403 ? t('amb.goals.notAllowed') : t('amb.goals.saveFailed');
      Alert.alert(t('amb.goals.title'), msg);
    } finally { setBusy(false); }
  };

  return (
    <ScreenScaffold
      title={t('amb.goals.title2', { period: periodLabel })}
      scroll
      footer={profile ? <Button title={t('amb.goals.lockIn')} onPress={lockIn} loading={busy} disabled={busy} /> : undefined}
    >
      {loading ? <SkeletonCard lines={6} /> : failed || !profile ? (
        <EmptyState title={t('common.somethingWrong')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <View style={{ gap: space[3] }}>
          <Text style={styles.section}>{t('amb.goals.setTargets')}</Text>
          {GOAL_METRICS.map((m) => {
            const actual = lastActual[m];
            return (
              <Card key={m} style={{ gap: space[2] }}>
                <Text style={styles.metric}>{t(`amb.targets.metric.${m}`)}</Text>
                <Text style={styles.actual}>{t('amb.goals.lastMonth', { n: actual == null ? t('common.dash') : String(actual) })}</Text>
                <View style={styles.stepper}>
                  <Pressable onPress={() => step(m, -1)} accessibilityRole="button" accessibilityLabel={t('amb.goals.decrease')} style={styles.stepBtn}><Text style={styles.stepSym}>−</Text></Pressable>
                  <Text style={styles.stepVal}>{values[m] ?? 0}</Text>
                  <Pressable onPress={() => step(m, +1)} accessibilityRole="button" accessibilityLabel={t('amb.goals.increase')} style={styles.stepBtn}><Text style={styles.stepSym}>+</Text></Pressable>
                </View>
              </Card>
            );
          })}
          <Text style={styles.note}>{t('amb.goals.managedNote')}</Text>
        </View>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  metric: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  actual: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[5], marginTop: space[1] },
  stepBtn: { width: 48, height: 48, borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.primary600, alignItems: 'center', justifyContent: 'center' },
  stepSym: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.primary700 },
  stepVal: { fontFamily: font.display, fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: color.ink800, minWidth: 56, textAlign: 'center' },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, textAlign: 'center', marginTop: space[2] },
});
