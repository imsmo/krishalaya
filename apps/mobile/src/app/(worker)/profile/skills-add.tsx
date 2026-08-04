// apps/mobile/src/app/(worker)/profile/skills-add.tsx · screen 137 (Add a Skill — worker). Thin screen (guide §3):
// pick skills from the REAL labour catalogue (labourLookups), set an experience level, and Save — which replaces
// the worker's whole skillIds set via labour.updateWorker (the real contract). Behind `worker_app`. Degrade-never-die.
//
// §13 — REAL: the skill catalogue (server master data: id + name), each skill's emoji (derived from code/name), the
// worker's current selection (worker.skillIds), and the Save mutation. HONESTLY degraded (NEVER faked — no field):
// the per-skill DAILY-RATE RANGE (₹350-450/day) isn't in the catalogue → omitted; YEARS-OF-EXPERIENCE has no
// worker-profile field → captured + flagged, not persisted; the CERTIFICATES card is fixed Skill-India program info
// (static i18n, like PMSBY), and its "Learn" is informational until a worker-training route exists.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { WorkerProfile, LabourLookups } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getMyWorker, labourLookups, updateWorker } from '../../../features/labour/labour.api';
import { toggleSkill } from '../../../features/labour/worker-skills';
import { flatSkillRows, EXPERIENCE_LEVELS, selectedCount, type ExperienceKey } from '../../../features/labour/skill-picker';

export default function WorkerAddSkill() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_app');
  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [experience, setExperience] = useState<ExperienceKey | ''>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    const [w, lk] = await Promise.all([getMyWorker(), labourLookups()]);
    setWorker(w); setLookups(lk);
    setSelected(new Set(w?.skillIds ?? []));
    if (!lk) setFailed(true);
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) load(); }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('workerAddSkill.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const rows = useMemo(() => flatSkillRows(lookups?.skills ?? [], selected), [lookups, selected]);
  const count = selectedCount(selected);

  const save = async () => {
    setBusy(true);
    try { await updateWorker({ skillIds: Array.from(selected) }); router.back(); }
    catch { Alert.alert(t('workerAddSkill.saveFailed'), t('common.error.generic')); }
    finally { setBusy(false); }
  };

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('common.skip')} variant="outline" disabled={busy} onPress={() => router.back()} />
      <View style={{ flex: 1 }}><Button title={t('workerAddSkill.save', { n: count })} onPress={save} loading={busy} disabled={busy} fullWidth /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('workerAddSkill.title')} scroll={false} footer={footer}>
      {loading ? (
        <View style={{ gap: space[3] }}><SkeletonCard lines={3} /><SkeletonCard lines={6} /></View>
      ) : failed || rows.length === 0 ? (
        <EmptyState title={t('workerAddSkill.empty')} message={t('workerAddSkill.emptyMsg')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[8], gap: space[3] }}>
          <View>
            <Text style={styles.h1}>{t('workerAddSkill.heading')}</Text>
            <Text style={styles.helper}>{t('workerAddSkill.sub')}</Text>
          </View>

          {/* Skill grid (real catalogue; rate range omitted — no contract) */}
          <View style={styles.grid}>
            {rows.map((r) => (
              <Pressable key={r.id} onPress={() => setSelected((cur) => toggleSkill(cur, r.id))} style={[styles.tile, r.selected && styles.tileOn]} accessibilityRole="checkbox" accessibilityState={{ checked: r.selected }}>
                <Text style={styles.tileEmoji}>{r.emoji}</Text>
                <Text style={[styles.tileName, r.selected && styles.tileNameOn]} numberOfLines={2}>{r.name}</Text>
                {r.selected ? <Text style={styles.tileTick}>✓</Text> : null}
              </Pressable>
            ))}
          </View>

          {/* Years of experience — captured, not persisted yet (no contract field) */}
          <Card>
            <Text style={styles.section}>{t('workerAddSkill.experience')}</Text>
            <View style={styles.expRow}>
              {EXPERIENCE_LEVELS.map((lvl) => {
                const on = experience === lvl.key;
                return (
                  <Pressable key={lvl.key} onPress={() => setExperience(lvl.key)} style={[styles.exp, on && styles.expOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                    <Text style={[styles.expYears, on && styles.expOnText]}>{lvl.years}</Text>
                    <Text style={[styles.expName, on && styles.expOnText]}>{t(`workerAddSkill.level.${lvl.key}`)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          {/* Certificates (optional) — fixed Skill India program info (static) */}
          <Card>
            <Text style={styles.section}>{t('workerAddSkill.certs')}</Text>
            <View style={styles.certRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.certTitle}>{t('workerAddSkill.certName')}</Text>
                <Text style={styles.certSub}>{t('workerAddSkill.certMeta')}</Text>
              </View>
              <Pressable onPress={() => Alert.alert(t('workerAddSkill.certName'), t('workerAddSkill.certLearnMsg'))} accessibilityRole="button">
                <Text style={styles.learn}>{t('workerAddSkill.learn')}</Text>
              </Pressable>
            </View>
          </Card>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  h1: { fontFamily: font.display, fontSize: font.size.xl, color: color.ink900 },
  helper: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  tile: { width: '31%', minHeight: 96, borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card, alignItems: 'center', justifyContent: 'center', padding: space[2], gap: 4 },
  tileOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  tileEmoji: { fontSize: 26 },
  tileName: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink700, textAlign: 'center' },
  tileNameOn: { color: color.primary800, fontWeight: font.weight.semibold },
  tileTick: { position: 'absolute', top: 6, right: 8, color: color.primary700, fontWeight: '700' },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink700, marginBottom: space[2] },
  expRow: { flexDirection: 'row', gap: space[2] },
  exp: { flex: 1, borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card, alignItems: 'center', paddingVertical: space[2], gap: 2 },
  expOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  expYears: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  expName: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  expOnText: { color: color.primary800 },
  certRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  certTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  certSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  learn: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
