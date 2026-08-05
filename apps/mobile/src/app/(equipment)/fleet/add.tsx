// apps/mobile/src/app/(equipment)/fleet/add.tsx · register a machine (PC-50 W10-6; canon screen 308).
// Category from the REAL taxonomy; year/HP/engine-hours zod-mirrored; Idempotency-Keyed (Law 3).
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import type { CategoryNode } from '@krishalaya/sdk-js';
import { Button, Card, Input, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { equipmentCategories, registerAsset } from '../../../features/equipment/equipment.api';
import { buildAssetDraft } from '../../../features/equipment/equipment';

export default function AddAsset() {
  const { t } = useTranslation();
  const router = useRouter();
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [form, setForm] = useState({ regNo: '', yearOfMfg: '', engineHours: '', hpRating: '', serviceRadiusKm: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { equipmentCategories().then(setCategories); }, []);

  const submit = async () => {
    const draft = buildAssetDraft({ categoryId, ...form });
    if (!draft.ok) { setError(t(`equip.add.err.${draft.error}`)); return; }
    setError(null); setBusy(true);
    try { await registerAsset(draft.value); router.replace('/(equipment)/fleet'); }
    catch { Alert.alert(t('equip.add.title'), t('equip.add.failed')); }
    finally { setBusy(false); }
  };
  const set = (k: keyof typeof form) => (v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <ScreenScaffold title={t('equip.add.title')}>
      <ScrollView>
        <Card>
          <Text style={styles.label}>{t('equip.add.category')}</Text>
          <View style={styles.wrap}>
            {categories.map((c) => (
              <Pressable key={c.id} style={[styles.chip, categoryId === c.id && styles.chipOn]} onPress={() => setCategoryId(c.id)}>
                <Text style={styles.chipText}>{c.defaultName}</Text>
              </Pressable>
            ))}
          </View>
          <Input label={t('equip.add.regNo')} value={form.regNo} onChangeText={set('regNo')} />
          <Input label={t('equip.add.year')} value={form.yearOfMfg} keyboardType="number-pad" maxLength={4} onChangeText={set('yearOfMfg')} />
          <Input label={t('equip.add.hp')} value={form.hpRating} keyboardType="number-pad" onChangeText={set('hpRating')} />
          <Input label={t('equip.add.hours')} value={form.engineHours} keyboardType="decimal-pad" onChangeText={set('engineHours')} />
          <Input label={t('equip.add.radius')} value={form.serviceRadiusKm} keyboardType="number-pad" onChangeText={set('serviceRadiusKm')} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title={t('equip.add.submit')} onPress={submit} disabled={busy || !categoryId} />
        </Card>
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  label: { fontSize: font.size.xs, color: color.ink500, marginTop: space[2], marginBottom: space[1] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: radius.pill, borderWidth: 1, borderColor: color.ink100 },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontSize: font.size.xs, color: color.ink800 },
  error: { color: color.danger, fontSize: font.size.xs, marginTop: space[2] },
});
