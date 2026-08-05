// apps/mobile/src/app/(pashupalak)/animals/[id].tsx · animal detail (PC-50 W10-1). REAL registry facts only;
// retire (sold/deceased/lost) with confirm; "book a vet for this animal" deep-link. The health LOG section is
// an honest coming-note — livestock health records have NO endpoints (PC-54 `livestock-health-records`).
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import type { Animal } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { getAnimal, retireAnimal } from '../../../features/livestock/livestock.api';
import { animalTone, RETIRE_REASONS } from '../../../features/livestock/livestock';

export default function AnimalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const [animal, setAnimal] = useState<Animal | null | undefined>(undefined);
  const load = useCallback(async () => { if (id) setAnimal(await getAnimal(id)); }, [id]);
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

  if (animal === undefined) return <ScreenScaffold title={t('pashu.detail.title')}><SkeletonCard lines={6} /></ScreenScaffold>;
  if (animal === null) return <ScreenScaffold title={t('pashu.detail.title')}><EmptyState title={t('pashu.detail.notFound')} /></ScreenScaffold>;

  const fact = (label: string, value?: string | number | null) => value != null && value !== '' ? (
    <View style={styles.between}><Text style={styles.factLabel}>{label}</Text><Text style={styles.factValue}>{String(value)}</Text></View>
  ) : null;

  return (
    <ScreenScaffold title={animal.name || t('pashu.herd.unnamed')}>
      <ScrollView>
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
        <Text style={styles.muted}>{t('pashu.detail.healthComing')}</Text>
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  name: { fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800 },
  factLabel: { fontSize: font.size.xs, color: color.ink500 },
  factValue: { fontSize: font.size.md, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[4] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space[1] },
});
