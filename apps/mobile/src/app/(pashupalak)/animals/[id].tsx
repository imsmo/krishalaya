// apps/mobile/src/app/(pashupalak)/animals/[id].tsx · animal detail (PC-50 W10-1; HEALTH FILE added PC-55 B5).
// Two tabs on one screen — registry FACTS and the lifetime HEALTH FILE. Deliberately no new route: a shed is not
// the place to lose your position in a navigation stack, and both views work off the animal already in memory.
//
// THE HEALTH FILE REPLACES THE OLD COMING-NOTE. Until PC-54 W54-4 there were no endpoints and this screen said so
// rather than drawing a log it could not keep. Now that they exist:
//   • WHAT IS DUE NEXT comes first, and OVERDUE is unmissable — a missed vaccination is what changes a farmer's day,
//     not a row buried in a chronology;
//   • the batch number is asked for on vaccinations and dewormings WITH the reason (a recall cannot be traced
//     without it), but never forced — the vial may genuinely be gone, and a fabricated batch is worse than none;
//   • a next-due date in the past is refused: a reminder dated yesterday is not a reminder;
//   • the event vocabulary is the SERVER's seeded list, so the picker offers exactly what the API will accept.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Pressable, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import type { Animal } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { getAnimal, retireAnimal, listHealthEvents, recordHealthEvent } from '../../../features/livestock/livestock.api';
import { animalTone, RETIRE_REASONS } from '../../../features/livestock/livestock';
import {
  HEALTH_EVENT_TYPES, batchNoExpected, buildHealthEvent, dueState, nextDue, nextDueExpected, overdueCount,
  type HealthEventRow, type HealthEventType,
} from '../../../features/livestock/health';

const today = () => new Date().toISOString().slice(0, 10);

export default function AnimalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const [animal, setAnimal] = useState<Animal | null | undefined>(undefined);
  const [tab, setTab] = useState<'facts' | 'health'>('facts');
  const [events, setEvents] = useState<HealthEventRow[]>([]);
  const [busy, setBusy] = useState(false);

  const [type, setType] = useState<HealthEventType>('vaccination');
  const [batchNo, setBatchNo] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [outcome, setOutcome] = useState('');
  const [nextDueDate, setNextDueDate] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setAnimal(await getAnimal(id));
    setEvents((await listHealthEvents(id)) as HealthEventRow[]);
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const retire = () => {
    Alert.alert(t('pashu.detail.retire'), t('pashu.detail.retireWhy'), [
      ...RETIRE_REASONS.map((r) => ({
        text: t(`pashu.retire.${r}`),
        onPress: async () => { try { await retireAnimal(id!, r); load(); } catch { Alert.alert(t('pashu.detail.retire'), t('pashu.detail.retireFailed')); } },
      })),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  const save = async () => {
    const built = buildHealthEvent({ eventTypeCode: type, batchNo, diagnosis, outcome, nextDueDate }, today());
    if (!built.ok) { Alert.alert(t('health.record.title'), t(`health.error.${built.error}`)); return; }
    setBusy(true);
    try {
      await recordHealthEvent(id!, built.value);
      setBatchNo(''); setDiagnosis(''); setOutcome(''); setNextDueDate('');
      await load();
      Alert.alert(t('health.record.title'), t('health.record.saved'));
    } catch {
      Alert.alert(t('health.record.title'), t('health.error.save'));
    } finally { setBusy(false); }
  };

  if (animal === undefined) return <ScreenScaffold title={t('pashu.detail.title')}><SkeletonCard lines={6} /></ScreenScaffold>;
  if (animal === null) return <ScreenScaffold title={t('pashu.detail.title')}><EmptyState title={t('pashu.detail.notFound')} /></ScreenScaffold>;

  const fact = (label: string, value?: string | number | null) => value != null && value !== '' ? (
    <View style={styles.between}><Text style={styles.factLabel}>{label}</Text><Text style={styles.factValue}>{String(value)}</Text></View>
  ) : null;

  const due = nextDue(events, today());
  const overdue = overdueCount(events, today());
  const typeLabel = (e: HealthEventRow) => t(`health.type.${String(e.eventTypeCode ?? e.eventType ?? '')}`) || String(e.eventTypeCode ?? e.eventType ?? '');

  return (
    <ScreenScaffold title={animal.name || t('pashu.herd.unnamed')}>
      <ScrollView>
        <View style={styles.tabs}>
          {(['facts', 'health'] as const).map((k) => (
            <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} style={[styles.tab, tab === k && styles.tabActive]}>
              <Text style={[styles.tabText, tab === k && styles.tabTextActive]}>
                {t(`pashu.tab.${k}`)}{k === 'health' && overdue > 0 ? ` · ${overdue}` : ''}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'facts' && (<>
          <Card>
            <View style={styles.between}>
              <Text style={styles.name}>{animal.name || t('pashu.herd.unnamed')}</Text>
              <StatusPill label={t(`pashu.animal.${animal.status}`) || animal.status} tone={animalTone(animal.status)} />
            </View>
            {fact(t('pashu.herd.aadhaar'), animal.pashuAadhaar ? `••••${animal.pashuAadhaar.slice(-4)}` : null)}
            {fact(t('pashu.add.sex'), animal.sex ? t(`pashu.add.sex.${animal.sex}`) : null)}
            {fact(t('pashu.detail.dob'), animal.dobEstimated)}
            {fact(t('pashu.add.parity'), animal.parity)}
            {fact(t('pashu.add.yield'), animal.currentYieldLpd)}
            {fact(t('pashu.detail.pregnancy'), animal.pregnancyStatus ? t(`pashu.preg.${animal.pregnancyStatus}`) : null)}
          </Card>
          {animal.status === 'active' && (<>
            <Button title={t('pashu.detail.bookVet')} onPress={() => router.push(`/(pashupalak)/vets?animalId=${animal.id}`)} />
            <Button title={t('pashu.detail.retire')} variant="outline" onPress={retire} />
          </>)}
        </>)}

        {tab === 'health' && (<>
          {due ? (
            <Card>
              <Text style={due.state === 'overdue' ? styles.dueOverdue : styles.dueValue}>{t(`health.due.${due.state}`)} · {due.date}</Text>
              <Text style={styles.muted}>{typeLabel(due.row)}</Text>
              {due.state === 'overdue' ? <Text style={styles.muted}>{t('health.due.overdueHelp')}</Text> : null}
            </Card>
          ) : <Text style={styles.muted}>{t('health.due.none')}</Text>}

          <Text style={styles.section}>{t('health.log.title')}</Text>
          {events.length === 0 ? <Text style={styles.muted}>{t('health.log.empty')}</Text> : events.map((e, i) => (
            <Card key={String(e.id ?? i)}>
              <View style={styles.between}>
                <Text style={styles.factValue}>{typeLabel(e)}</Text>
                <Text style={styles.muted}>{e.createdAt ? String(e.createdAt).slice(0, 10) : ''}</Text>
              </View>
              {e.diagnosis ? <Text style={styles.muted}>{t('health.field.diagnosis')}: {String(e.diagnosis)}</Text> : null}
              {e.outcome ? <Text style={styles.muted}>{t('health.field.outcome')}: {String(e.outcome)}</Text> : null}
              {e.batchNo ? <Text style={styles.muted}>{t('health.field.batchNo')}: {String(e.batchNo)}</Text> : null}
              {e.nextDueDate ? (
                <Text style={dueState(e.nextDueDate, today()) === 'overdue' ? styles.dueOverdue : styles.muted}>
                  {t('health.field.nextDue')}: {String(e.nextDueDate)} · {t(`health.due.${dueState(e.nextDueDate, today())}`)}
                </Text>
              ) : null}
            </Card>
          ))}

          {animal.status === 'active' && (
            <Card>
              <Text style={styles.section}>{t('health.record.title')}</Text>
              <View style={styles.chips}>
                {HEALTH_EVENT_TYPES.map((k) => (
                  <Pressable key={k} onPress={() => setType(k)} accessibilityRole="radio" accessibilityState={{ selected: type === k }} style={[styles.chip, type === k && styles.chipActive]}>
                    <Text style={[styles.chipText, type === k && styles.chipTextActive]}>{t(`health.type.${k}`)}</Text>
                  </Pressable>
                ))}
              </View>

              {batchNoExpected(type) ? (<>
                <Text style={styles.label}>{t('health.field.batchNo')}</Text>
                <TextInput value={batchNo} onChangeText={setBatchNo} style={styles.input} maxLength={80} accessibilityLabel={t('health.field.batchNo')} />
                <Text style={styles.muted}>{t('health.field.batchNoHint')}</Text>
              </>) : null}

              <Text style={styles.label}>{t('health.field.diagnosis')}</Text>
              <TextInput value={diagnosis} onChangeText={setDiagnosis} style={styles.input} multiline maxLength={2000} accessibilityLabel={t('health.field.diagnosis')} />
              <Text style={styles.label}>{t('health.field.outcome')}</Text>
              <TextInput value={outcome} onChangeText={setOutcome} style={styles.input} multiline maxLength={2000} accessibilityLabel={t('health.field.outcome')} />

              {nextDueExpected(type) ? (<>
                <Text style={styles.label}>{t('health.field.nextDue')}</Text>
                <TextInput value={nextDueDate} onChangeText={setNextDueDate} style={styles.input} placeholder="YYYY-MM-DD" accessibilityLabel={t('health.field.nextDue')} />
                <Text style={styles.muted}>{t('health.field.nextDueHint')}</Text>
              </>) : null}

              <Button title={t('health.record.save')} disabled={busy} onPress={save} />
              <Text style={styles.muted}>{t('health.record.note')}</Text>
            </Card>
          )}
        </>)}
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  name: { fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800 },
  factLabel: { fontSize: font.size.xs, color: color.ink500 },
  factValue: { fontSize: font.size.md, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  section: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, marginTop: space[3] },
  label: { fontSize: font.size.xs, color: color.ink500, marginTop: space[2] },
  input: { borderWidth: 1, borderColor: color.ink200, borderRadius: 8, padding: space[2], fontSize: font.size.sm, color: color.ink800, minHeight: 44 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space[1] },
  tabs: { flexDirection: 'row', gap: space[2], marginBottom: space[2] },
  tab: { paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: 999, borderWidth: 1, borderColor: color.ink200, minHeight: 44, justifyContent: 'center' },
  tabActive: { borderColor: color.primary700, backgroundColor: color.ink100 },
  tabText: { fontSize: font.size.sm, color: color.ink500 },
  tabTextActive: { color: color.ink800, fontWeight: font.weight.semibold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  chip: { paddingVertical: space[1], paddingHorizontal: space[2], borderRadius: 999, borderWidth: 1, borderColor: color.ink200, minHeight: 36, justifyContent: 'center' },
  chipActive: { borderColor: color.primary700, backgroundColor: color.ink100 },
  chipText: { fontSize: font.size.xs, color: color.ink500 },
  chipTextActive: { color: color.ink800, fontWeight: font.weight.semibold },
  dueValue: { fontSize: font.size.md, color: color.ink800, fontWeight: font.weight.semibold },
  dueOverdue: { fontSize: font.size.md, color: color.danger, fontWeight: font.weight.bold, marginTop: space[1] },
});
