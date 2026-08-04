// apps/mobile/src/app/(farmer)/hire/filter.tsx · screen 43 (Filter Workers). Thin screen (guide §3): a filter
// sheet over the worker pool — task chips, the applyable preference toggles, and a live "Show N workers" count that
// carries the chosen filters back to the Find-Workers list (screen 42). Behind `labour_hire`. Degrade-never-die.
//
// §13 — REAL & applied: task (skill) filter, minimum-rating (4★) and verified-18+ (all client-side over the pool the
// server returned; the live count uses the same pure filterWorkers as screen 42). HONESTLY degraded — the pool read
// has NO geo, availability, insurance or employer-history fields, so the design's DISTANCE slider, WAGE-RANGE
// slider, AVAILABILITY (Today/Tomorrow/This week/Pick date), "Above state minimum", "PMSBY insurance active" and
// "Has worked with me before" are shown as coming-soon rows (no fabricated filtering), never wired to fake data.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import type { WorkerProfile, LabourLookups } from '@krishalaya/sdk-js';
import { Button, Card, Toggle, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { browseWorkers, labourLookups } from '../../../features/labour/hire.api';
import { filterWorkers } from '../../../features/labour/hire-browse';
import { skillEmoji } from '../../../features/labour/worker-skills';

const AVAIL = ['today', 'tomorrow', 'week', 'pick'] as const;

export default function FilterWorkers() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('labour_hire');
  const [items, setItems] = useState<WorkerProfile[]>([]);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [skillId, setSkillId] = useState<string | null>(null);
  const [min4, setMin4] = useState(false);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, lk] = await Promise.all([browseWorkers({}), labourLookups()]);
    setItems(r.items); setLookups(lk); setLoading(false);
  }, []);
  React.useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const count = useMemo(() => filterWorkers(items, { minRating: min4 ? 4 : undefined, verified, skillId }).length, [items, min4, verified, skillId]);
  const reset = () => { setSkillId(null); setMin4(false); setVerified(false); };

  if (!enabled) return <ScreenScaffold title={t('hire.filterScreen.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const apply = () => router.replace({ pathname: '/(farmer)/hire/workers', params: { minRating: min4 ? '4' : '', verified: verified ? '1' : '', skillId: skillId ?? '' } });

  return (
    <ScreenScaffold
      title={t('hire.filterScreen.title')} scroll={false}
      footer={
        <View style={styles.actions}>
          <Button title={t('common.cancel')} variant="outline" onPress={() => router.back()} />
          <View style={{ flex: 1 }}><Button title={t('hire.filterScreen.show', { count })} onPress={apply} fullWidth /></View>
        </View>
      }
    >
      {loading ? <SkeletonCard lines={10} /> : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[3] }}>
          <View style={styles.resetRow}>
            <Text style={styles.section}>{t('hire.filterScreen.taskType')}</Text>
            <Pressable onPress={reset} hitSlop={8}><Text style={styles.reset}>{t('hire.filterScreen.reset')}</Text></Pressable>
          </View>
          <View style={styles.taskGrid}>
            {(lookups?.skills ?? []).map((s) => {
              const active = skillId === s.id;
              return (
                <Pressable key={s.id} onPress={() => setSkillId((c) => (c === s.id ? null : s.id))} style={[styles.taskChip, active && styles.taskChipOn]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                  <Text style={styles.taskEmoji}>{skillEmoji(s)}</Text>
                  <Text style={[styles.taskTxt, active && styles.taskTxtOn]}>{s.name}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* §13 — no geo / wage-range / availability filtering on the pool read yet */}
          <Card><Text style={styles.h3}>{t('hire.filterScreen.distance')}</Text><Text style={styles.note}>{t('hire.filterScreen.comingSoon')}</Text></Card>
          <Card><Text style={styles.h3}>{t('hire.filterScreen.wageRange')}</Text><Text style={styles.note}>{t('hire.filterScreen.comingSoon')}</Text></Card>
          <Card>
            <Text style={styles.h3}>{t('hire.filterScreen.availability')}</Text>
            <View style={styles.availRow}>
              {AVAIL.map((a) => <View key={a} style={styles.availChip}><Text style={styles.availTxt}>{t(`hire.filterScreen.avail.${a}`)}</Text></View>)}
            </View>
            <Text style={styles.note}>{t('hire.filterScreen.comingSoon')}</Text>
          </Card>

          {/* Other preferences — applyable toggles + §13 coming-soon toggles */}
          <Card>
            <Text style={styles.h3}>{t('hire.filterScreen.otherPrefs')}</Text>
            <Toggle label={t('hire.filterScreen.min4')} value={min4} onValueChange={setMin4} />
            <Toggle label={t('hire.filterScreen.verifiedOnly')} value={verified} onValueChange={setVerified} />
            <Toggle label={t('hire.filterScreen.pmsby')} value={false} onValueChange={() => {}} disabled hint={t('hire.filterScreen.comingSoon')} />
            <Toggle label={t('hire.filterScreen.workedBefore')} value={false} onValueChange={() => {}} disabled hint={t('hire.filterScreen.comingSoon')} />
          </Card>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  resetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[2] },
  section: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  reset: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  taskGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  taskChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  taskChipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  taskEmoji: { fontSize: 16 },
  taskTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  taskTxtOn: { color: color.primary800, fontWeight: font.weight.semibold },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  availRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[2] },
  availChip: { paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.pill, backgroundColor: color.earth100 },
  availTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
});
