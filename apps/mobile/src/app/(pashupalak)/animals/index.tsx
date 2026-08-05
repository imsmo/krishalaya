// apps/mobile/src/app/(pashupalak)/animals/index.tsx · my herd (PC-50 W10-1). The caller's OWN registry
// (box=mine — the server enforces ownership). Degrade-never-die; retired/sold animals stay visible with an
// honest status pill (a herd register is a record, not a feed).
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { Animal } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { myAnimals } from '../../../features/livestock/livestock.api';
import { animalTone } from '../../../features/livestock/livestock';

export default function AnimalList() {
  const { t } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState<Animal[] | null>(null);
  const load = useCallback(async () => { setItems(await myAnimals()); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScreenScaffold title={t('pashu.herd.title')}>
      {items === null ? <SkeletonCard lines={6} /> : items.length === 0 ? (
        <EmptyState title={t('pashu.herd.empty')} message={t('pashu.herd.emptyHint')} actionLabel={t('pashu.home.addAnimal')} onAction={() => router.push('/(pashupalak)/animals/add')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(a) => a.id}
          ListHeaderComponent={<Button title={t('pashu.home.addAnimal')} onPress={() => router.push('/(pashupalak)/animals/add')} />}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/(pashupalak)/animals/${item.id}`)}>
              <Card>
                <View style={styles.between}>
                  <Text style={styles.name}>{item.name || t('pashu.herd.unnamed')}</Text>
                  <StatusPill label={t(`pashu.animal.${item.status}`) || item.status} tone={animalTone(item.status)} />
                </View>
                {item.pashuAadhaar ? <Text style={styles.muted}>{t('pashu.herd.aadhaar')} ••••{item.pashuAadhaar.slice(-4)}</Text> : null}
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
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
