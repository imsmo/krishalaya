// apps/mobile/src/app/(pashupalak)/vets/index.tsx · the vet directory (PC-50 W10-1). REAL registered vets
// (cached reference read). Tap → profile + services + book. Carries an optional ?animalId= deep-link from an
// animal's detail so the booking is pre-linked to that animal.
import React, { useCallback, useState } from 'react';
import { Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import type { VetProfile } from '@krishalaya/sdk-js';
import { Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { listVets } from '../../../features/livestock/livestock.api';

export default function VetDirectory() {
  const { t } = useTranslation();
  const router = useRouter();
  const { animalId } = useLocalSearchParams<{ animalId?: string }>();
  const [vets, setVets] = useState<VetProfile[] | null>(null);
  useFocusEffect(useCallback(() => { listVets().then(setVets); }, []));

  return (
    <ScreenScaffold title={t('pashu.vets.title')}>
      {vets === null ? <SkeletonCard lines={6} /> : vets.length === 0 ? (
        <EmptyState title={t('pashu.vets.empty')} message={t('pashu.vets.emptyHint')} />
      ) : (
        <FlatList
          data={vets}
          keyExtractor={(v) => v.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/(pashupalak)/vets/${item.id}${animalId ? `?animalId=${animalId}` : ''}`)}>
              <Card>
                <Text style={styles.name}>{String(item.displayName ?? t('pashu.vets.unnamed'))}</Text>
                {item.registrationNo ? <Text style={styles.muted}>{t('pashu.vets.regNo')} {String(item.registrationNo)}</Text> : null}
                {item.isAiTechnician ? <Text style={styles.muted}>{t('pashu.vets.aiTech')}</Text> : null}
              </Card>
            </Pressable>
          )}
        />
      )}
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  name: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
});
