// apps/mobile/src/app/(equipment)/fleet/[id].tsx · machine manage (PC-50 W10-6; canon screens 309/496).
// Status toggle (active/maintenance/retired — retire = canon 496) + the price list: real rate lines
// (per_hour/per_acre/…), new rates rupees→minor by string math (Law 2), one active line per basis
// (server-side upsert).
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import type { EquipmentAsset, EquipmentRate } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, Input, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, Toggle, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { myFleet, setAssetStatus, assetRates, setRate } from '../../../features/equipment/equipment.api';
import { assetTone, buildRateDraft, RATE_BASES, ASSET_STATUSES } from '../../../features/equipment/equipment';

export default function ManageAsset() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const [asset, setAsset] = useState<EquipmentAsset | null | undefined>(undefined);
  const [rates, setRates] = useState<EquipmentRate[]>([]);
  const [form, setForm] = useState({ rateBasis: 'per_hour', rateRupees: '', includesOperator: true, includesFuel: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [fleet, r] = await Promise.all([myFleet(), assetRates(id)]);
    setAsset(fleet.find((a) => a.id === id) ?? null);
    setRates(r);
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const changeStatus = (status: string) => {
    Alert.alert(t('equip.manage.title'), t(`equip.manage.confirm.${status}`), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), onPress: async () => {
        setBusy(true);
        try { await setAssetStatus(id!, status); load(); } catch { Alert.alert(t('equip.manage.title'), t('equip.manage.failed')); } finally { setBusy(false); }
      } },
    ]);
  };
  const saveRate = async () => {
    const draft = buildRateDraft(form);
    if (!draft.ok) { setError(t(`equip.rate.err.${draft.error}`)); return; }
    setError(null); setBusy(true);
    try { await setRate(id!, draft.value); setForm((p) => ({ ...p, rateRupees: '' })); load(); }
    catch { Alert.alert(t('equip.manage.title'), t('equip.rate.failed')); }
    finally { setBusy(false); }
  };

  if (asset === undefined) return <ScreenScaffold title={t('equip.manage.title')}><SkeletonCard lines={6} /></ScreenScaffold>;
  if (asset === null) return <ScreenScaffold title={t('equip.manage.title')}><EmptyState title={t('equip.manage.notFound')} /></ScreenScaffold>;

  const chip = (on: boolean) => [styles.chip, on && styles.chipOn];
  return (
    <ScreenScaffold title={asset.defaultName}>
      <ScrollView>
        <Card>
          <StatusPill label={t(`equip.asset.${asset.status ?? 'active'}`)} tone={assetTone(asset.status)} />
          <Text style={styles.label}>{t('equip.manage.setStatus')}</Text>
          <View style={styles.wrap}>
            {ASSET_STATUSES.filter((s) => s !== asset.status).map((s) => (
              <Pressable key={s} style={styles.chip} onPress={() => changeStatus(s)}>
                <Text style={styles.chipText}>{t(`equip.asset.${s}`)}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
        <Text style={styles.section}>{t('equip.rate.list')}</Text>
        {rates.length === 0 ? <Text style={styles.muted}>{t('equip.rate.none')}</Text> : rates.map((r) => (
          <Card key={r.id}>
            <View style={styles.between}>
              <Text style={styles.label}>{t(`equip.basis.${String(r.rateBasis ?? r.unitCode)}`) || r.unitCode}</Text>
              <MoneyText minor={r.rateMinor} langCode={lang} size="sm" />
            </View>
          </Card>
        ))}
        <Text style={styles.section}>{t('equip.rate.set')}</Text>
        <Card>
          <View style={styles.wrap}>
            {RATE_BASES.map((b) => (
              <Pressable key={b} style={chip(form.rateBasis === b)} onPress={() => setForm((p) => ({ ...p, rateBasis: b }))}>
                <Text style={styles.chipText}>{t(`equip.basis.${b}`)}</Text>
              </Pressable>
            ))}
          </View>
          <Input label={t('equip.rate.price')} value={form.rateRupees} keyboardType="decimal-pad" onChangeText={(v) => setForm((p) => ({ ...p, rateRupees: v }))} />
          <Toggle label={t('equip.rate.operator')} value={form.includesOperator} onValueChange={(v: boolean) => setForm((p) => ({ ...p, includesOperator: v }))} />
          <Toggle label={t('equip.rate.fuel')} value={form.includesFuel} onValueChange={(v: boolean) => setForm((p) => ({ ...p, includesFuel: v }))} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title={t('equip.rate.save')} onPress={saveRate} disabled={busy} />
        </Card>
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  section: { fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  label: { fontSize: font.size.xs, color: color.ink500, marginTop: space[2], marginBottom: space[1] },
  muted: { fontSize: font.size.xs, color: color.ink500 },
  error: { color: color.danger, fontSize: font.size.xs, marginTop: space[2] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: radius.pill, borderWidth: 1, borderColor: color.ink100 },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontSize: font.size.xs, color: color.ink800 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
