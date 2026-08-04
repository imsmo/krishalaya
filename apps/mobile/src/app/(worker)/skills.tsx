// apps/mobile/src/app/(worker)/skills.tsx · screen 37 (My Skills). Thin screen (guide §3): the labour skill
// catalogue (labourLookups) grouped by tier into categories, each skill a toggle reflecting the worker's
// self-declared skillIds; Save persists via updateWorker({ skillIds }). Pure worker-skills helpers do the
// grouping/badging. Behind `worker_app`. Degrade-never-die.
//
// §13 — REAL: the skill catalogue (server master data), each skill's active state (worker.skillIds), the tier-
// derived badge (skilled / requires-certification, from the real tier/hazardous fields), and the Save mutation.
// HONESTLY degraded (no field in the catalogue → NEVER faked): per-skill job COUNTS + ⭐ratings ("42 jobs · ⭐4.9"
// is design seed) are omitted; "Available in Phase 2" rows aren't fabricated (only catalogued skills show); and
// "+ Add a new skill" is an informational note — the catalogue is fixed master data, workers pick from it.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Switch } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { WorkerProfile, LabourLookups } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { getMyWorker, labourLookups, updateWorker } from '../../features/labour/labour.api';
import { groupByCategory, toggleSkill, skillEmoji, skillBadge, skillsDirty } from '../../features/labour/worker-skills';

export default function WorkerSkills() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_app');
  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [w, lk] = await Promise.all([getMyWorker(), labourLookups()]);
    setWorker(w); setLookups(lk); setSelected(new Set(w?.skillIds ?? [])); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  const groups = useMemo(() => groupByCategory(lookups?.skills ?? [], selected), [lookups, selected]);
  const dirty = worker ? skillsDirty(worker.skillIds ?? [], selected) : false;

  if (!enabled) return <ScreenScaffold title={t('worker.skills.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const save = async () => {
    setBusy(true);
    try { await updateWorker({ skillIds: [...selected] }); await load(); }
    catch { Alert.alert(t('worker.skills.saveFailed'), t('common.error.generic')); }
    finally { setBusy(false); }
  };

  return (
    <ScreenScaffold
      title={t('worker.skills.title')} scroll={false}
      footer={worker ? <Button title={t('worker.skills.save')} onPress={save} loading={busy} disabled={busy || !dirty} fullWidth /> : undefined}
    >
      {loading ? <SkeletonCard lines={10} /> : !worker ? (
        <Card>
          <Text style={styles.h}>{t('worker.onboard.title')}</Text>
          <Text style={styles.note}>{t('worker.onboard.body')}</Text>
          <View style={{ marginTop: space[4] }}><Button title={t('worker.onboard.register')} onPress={() => router.push('/(worker)/profile')} /></View>
        </Card>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[3] }}>
          <Text style={styles.intro}>{t('worker.skills.intro')}</Text>
          <Button title={t('workerAddSkill.cta')} variant="outline" onPress={() => router.push('/(worker)/profile/skills-add')} />

          {groups.map((g) => (
            <Card key={g.key}>
              <View style={styles.groupHead}>
                <Text style={styles.groupTitle}>{t(`worker.skills.cat.${g.key}`)}</Text>
                <Text style={styles.groupCount}>{t('worker.skills.activeCount', { n: g.activeCount })}</Text>
              </View>
              {g.items.map(({ skill, active }) => {
                const badge = skillBadge(skill);
                return (
                  <View key={skill.id} style={styles.skillRow}>
                    <Text style={styles.skillEmoji}>{skillEmoji(skill)}</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.skillName}>{skill.name}</Text>
                      <Text style={styles.skillMeta} numberOfLines={1}>
                        {active ? t('worker.skills.on') : t('worker.skills.notActive')}
                        {badge ? ` · ${t(`worker.skills.badge.${badge}`)}` : ''}
                      </Text>
                    </View>
                    <Switch value={active} onValueChange={() => setSelected((p) => toggleSkill(p, skill.id))} accessibilityLabel={skill.name} trackColor={{ false: color.ink200, true: color.primary300 }} thumbColor={active ? color.primary600 : color.ink50} ios_backgroundColor={color.ink200} />
                  </View>
                );
              })}
            </Card>
          ))}

          {/* Skilled-worker badge promo (program info) */}
          <View style={styles.promo}>
            <Text style={styles.promoIcon}>🏅</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.promoTitle}>{t('worker.skills.badgePromo.title')}</Text>
              <Text style={styles.promoBody}>{t('worker.skills.badgePromo.body')}</Text>
            </View>
          </View>

          {/* §13: catalogue is fixed master data — workers pick, they don't add */}
          <Text style={styles.addNote}>{t('worker.skills.addNote')}</Text>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  h: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  intro: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, lineHeight: font.size.sm * 1.5 },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[2] },
  groupTitle: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  groupCount: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.primary700 },
  skillRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.ink100 },
  skillEmoji: { fontSize: 24 },
  skillName: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  skillMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  promo: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', backgroundColor: color.accent50, borderRadius: radius.lg, padding: space[4] },
  promoIcon: { fontSize: 30 },
  promoTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800, marginBottom: 4 },
  promoBody: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, lineHeight: font.size.xs * 1.5 },
  addNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center' },
  note: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600 },
});
