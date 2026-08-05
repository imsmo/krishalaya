// apps/mobile/src/app/(pashupalak)/animals/add.tsx · register an animal (PC-50 W10-1). Species/breed from the
// REAL lookups (cached reference data), INAPH Pashu Aadhaar validated client-side (server re-validates),
// empty optionals OMITTED (the DTO is zod .strict()). Registration is Idempotency-Keyed (Law 3).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import type { AnimalSpecies, AnimalBreed } from '@krishalaya/sdk-js';
import { Button, Card, Input, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { listSpecies, listBreeds, registerAnimal } from '../../../features/livestock/livestock.api';
import { buildAnimalDraft, SEXES } from '../../../features/livestock/livestock';

export default function AddAnimal() {
  const { t } = useTranslation();
  const router = useRouter();
  const [species, setSpecies] = useState<AnimalSpecies[]>([]);
  const [breeds, setBreeds] = useState<AnimalBreed[]>([]);
  const [speciesId, setSpeciesId] = useState('');
  const [breedId, setBreedId] = useState('');
  const [form, setForm] = useState({ name: '', pashuAadhaar: '', sex: '', parity: '', currentYieldLpd: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { listSpecies().then(setSpecies); }, []);
  const pickSpecies = useCallback(async (id: string) => { setSpeciesId(id); setBreedId(''); setBreeds(await listBreeds(id)); }, []);

  const submit = async () => {
    const draft = buildAnimalDraft({ speciesId, breedId, ...form });
    if (!draft.ok) { setError(t(`pashu.add.err.${draft.error}`)); return; }
    setError(null); setBusy(true);
    try {
      await registerAnimal(draft.value);
      router.replace('/(pashupalak)/animals');
    } catch {
      Alert.alert(t('pashu.add.title'), t('pashu.add.failed'));
    } finally { setBusy(false); }
  };

  const chip = (selected: boolean) => [styles.chip, selected && styles.chipOn];
  const name = (x: { defaultName?: string; name?: string; code?: string; id: string }) => x.defaultName || x.name || x.code || x.id.slice(0, 8);

  return (
    <ScreenScaffold title={t('pashu.add.title')}>
      <ScrollView>
        <Card>
          <Text style={styles.label}>{t('pashu.add.species')}</Text>
          <View style={styles.wrap}>
            {species.map((s) => (
              <Pressable key={s.id} style={chip(speciesId === s.id)} onPress={() => pickSpecies(s.id)}><Text style={styles.chipText}>{name(s)}</Text></Pressable>
            ))}
          </View>
          {breeds.length > 0 && (<>
            <Text style={styles.label}>{t('pashu.add.breed')}</Text>
            <View style={styles.wrap}>
              {breeds.map((b) => (
                <Pressable key={b.id} style={chip(breedId === b.id)} onPress={() => setBreedId(breedId === b.id ? '' : b.id)}><Text style={styles.chipText}>{name(b)}</Text></Pressable>
              ))}
            </View>
          </>)}
          <Input label={t('pashu.add.name')} value={form.name} onChangeText={(v) => setForm((p) => ({ ...p, name: v }))} />
          <Input label={t('pashu.add.aadhaar')} value={form.pashuAadhaar} keyboardType="number-pad" maxLength={12} onChangeText={(v) => setForm((p) => ({ ...p, pashuAadhaar: v.replace(/\D/g, '') }))} />
          <Text style={styles.label}>{t('pashu.add.sex')}</Text>
          <View style={styles.wrap}>
            {SEXES.map((s) => (
              <Pressable key={s} style={chip(form.sex === s)} onPress={() => setForm((p) => ({ ...p, sex: p.sex === s ? '' : s }))}><Text style={styles.chipText}>{t(`pashu.add.sex.${s}`)}</Text></Pressable>
            ))}
          </View>
          <Input label={t('pashu.add.parity')} value={form.parity} keyboardType="number-pad" onChangeText={(v) => setForm((p) => ({ ...p, parity: v.replace(/\D/g, '') }))} />
          <Input label={t('pashu.add.yield')} value={form.currentYieldLpd} keyboardType="decimal-pad" onChangeText={(v) => setForm((p) => ({ ...p, currentYieldLpd: v }))} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title={t('pashu.add.submit')} onPress={submit} disabled={busy || !speciesId} />
        </Card>
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  label: { fontSize: font.size.xs, color: color.ink500, marginTop: space[3], marginBottom: space[1] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: radius.pill, borderWidth: 1, borderColor: color.ink100 },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontSize: font.size.xs, color: color.ink800 },
  error: { color: color.danger, fontSize: font.size.xs, marginTop: space[2] },
});
