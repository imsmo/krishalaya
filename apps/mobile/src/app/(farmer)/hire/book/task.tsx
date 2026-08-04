// apps/mobile/src/app/(farmer)/hire/book/task.tsx · screen 44 (Book · Step 1 — task). Thin screen (guide §3): the
// first step of the hire wizard for a specific worker — pick the task, then continue to date & time (the existing
// booking form collects the remaining steps). Task options are the worker's OWN declared skills (or the full skill
// catalogue when the pool read omits them — §13, bookableSkills), plus an "Other / Custom" option. Behind
// `labour_hire`. Degrade-never-die.
//
// §13 — REAL: the task list (worker skills / catalogue via lookups). HONESTLY degraded (no field → NEVER faked): the
// worker's NAME ("Sunita Kumari" — the pool is PII-minimised) → an anonymised worker; per-task SUB-TASK descriptions
// ("Cutting · Threshing · Bundling") aren't in the catalogue → omitted. The "workers needed" tip is generic advice.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import type { WorkerProfile, LabourLookups } from '@krishalaya/sdk-js';
import { Button, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../../core/i18n/useTranslation';
import { useFlag } from '../../../../core/flags/useFlag';
import { getWorker, labourLookups } from '../../../../features/labour/hire.api';
import { bookableSkills } from '../../../../features/labour/hire-browse';
import { skillEmoji } from '../../../../features/labour/worker-skills';

export default function BookTask() {
  const { t } = useTranslation();
  const router = useRouter();
  const { workerId } = useLocalSearchParams<{ workerId?: string }>();
  const enabled = useFlag('labour_hire');
  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [w, lk] = await Promise.all([workerId ? getWorker(workerId) : Promise.resolve(null), labourLookups()]);
    setWorker(w); setLookups(lk); setLoading(false);
  }, [workerId]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('bookTask.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const tasks = bookableSkills(worker?.skillIds, lookups);
  const workerLabel = workerId ? t('bookWorker.workerAnon', { id: workerId.slice(0, 6).toUpperCase() }) : t('bookTask.aWorker');

  const next = () => router.push({
    pathname: '/(farmer)/hire/book/when',
    params: { ...(workerId ? { workerId } : {}), ...(selected && selected !== 'custom' ? { taskSkillId: selected } : {}) },
  });

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('common.back')} variant="outline" onPress={() => router.back()} />
      <View style={{ flex: 1 }}><Button title={t('bookTask.next')} onPress={next} disabled={!selected} fullWidth /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('bookTask.bookName', { name: workerLabel })} scroll={false} footer={footer}>
      {/* Step 1 of 4 progress */}
      <View style={styles.progress}>
        <View style={styles.bar}><View style={[styles.seg, styles.active]} /><View style={[styles.seg, styles.pending]} /><View style={[styles.seg, styles.pending]} /><View style={[styles.seg, styles.pending]} /></View>
        <Text style={styles.step}>{t('bookTask.step')}</Text>
      </View>

      {loading ? <SkeletonCard lines={8} /> : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[2] }}>
          <Text style={styles.h2}>{t('bookTask.heading')}</Text>
          <Text style={styles.vern}>{t('bookTask.headingVern')}</Text>
          <Text style={styles.sub}>{t('bookTask.subtitle')}</Text>

          {tasks.map((s) => {
            const active = selected === s.id;
            return (
              <Pressable key={s.id} onPress={() => setSelected(s.id)} style={[styles.task, active && styles.taskOn]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <Text style={styles.taskEmoji}>{skillEmoji(s)}</Text>
                <Text style={[styles.taskName, active && styles.taskNameOn]}>{s.name}</Text>
              </Pressable>
            );
          })}
          {/* Other / custom */}
          <Pressable onPress={() => setSelected('custom')} style={[styles.task, selected === 'custom' && styles.taskOn]} accessibilityRole="radio" accessibilityState={{ selected: selected === 'custom' }}>
            <Text style={styles.taskEmoji}>✨</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.taskName, selected === 'custom' && styles.taskNameOn]}>{t('bookTask.custom')}</Text>
              <Text style={styles.taskSub}>{t('bookTask.customSub')}</Text>
            </View>
          </Pressable>

          {/* Tip */}
          <View style={styles.tip}>
            <Text style={styles.tipIcon}>ℹ</Text>
            <Text style={styles.tipTxt}>{t('bookTask.tip')}</Text>
          </View>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  progress: { paddingBottom: space[3], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  bar: { flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 4, borderRadius: 2 },
  active: { backgroundColor: color.primary600 },
  pending: { backgroundColor: color.earth200 },
  step: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.primary700, marginTop: space[2] },
  h2: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[3] },
  vern: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700, marginTop: 2 },
  sub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[2], marginBottom: space[2] },
  task: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  taskOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  taskEmoji: { fontSize: 24, width: 32, textAlign: 'center' },
  taskName: { flex: 1, fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  taskNameOn: { color: color.primary800 },
  taskSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  tip: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start', backgroundColor: color.infoLight, borderRadius: radius.lg, padding: space[3], marginTop: space[2] },
  tipIcon: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.infoDark },
  tipTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, lineHeight: font.size.xs * 1.5 },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
