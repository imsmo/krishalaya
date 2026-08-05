// apps/mobile/src/app/(vet)/home.tsx · my practice (PC-50 W10-3). No profile yet → the self-registration
// form (licence no. 2–60, AI-technician toggle, service radius — idempotent, Law 3). Registered → profile
// facts + my price list + the service-upsert form: REAL seeded vocabulary codes as chips (never free-typed
// guesses), price typed in rupees → converted float-free to minor (Law 2), one price per service (idempotent
// upsert server-side).
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { VetProfile, VetService, LookupValue } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, Input, MoneyText, ScreenScaffold, SkeletonCard, Toggle, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { myPractice, registerPractice, upsertService, serviceTypes } from '../../features/vet/vet.api';
import { buildVetRegistration, buildVetService, PRICING_UNITS } from '../../features/vet/vet';

export default function VetPractice() {
  const { t, lang } = useTranslation();
  const [data, setData] = useState<{ vet: VetProfile | null; services: VetService[] } | null | undefined>(undefined);
  const [types, setTypes] = useState<LookupValue[]>([]);
  const [reg, setReg] = useState({ registrationNo: '', isAiTechnician: false, serviceRadiusKm: '' });
  const [svc, setSvc] = useState({ serviceTypeCode: '', priceRupees: '', pricingUnit: 'per_visit', isEmergencyAvailable: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, ty] = await Promise.all([myPractice(), serviceTypes()]);
    setData(p); setTypes(ty);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const doRegister = async () => {
    const draft = buildVetRegistration(reg);
    if (!draft.ok) { setError(t(`vetpro.reg.err.${draft.error}`)); return; }
    setError(null); setBusy(true);
    try { await registerPractice(draft.value); load(); }
    catch { Alert.alert(t('vetpro.reg.title'), t('vetpro.reg.failed')); }
    finally { setBusy(false); }
  };
  const doUpsert = async () => {
    const draft = buildVetService(svc);
    if (!draft.ok) { setError(t(`vetpro.svc.err.${draft.error}`)); return; }
    setError(null); setBusy(true);
    try { await upsertService(draft.value); setSvc((p) => ({ ...p, priceRupees: '' })); load(); }
    catch { Alert.alert(t('vetpro.svc.title'), t('vetpro.svc.failed')); }
    finally { setBusy(false); }
  };

  if (data === undefined) return <ScreenScaffold title={t('vetpro.home.title')}><SkeletonCard lines={6} /></ScreenScaffold>;
  if (data === null) return <ScreenScaffold title={t('vetpro.home.title')}><EmptyState title={t('vetpro.home.loadError')} actionLabel={t('common.retry')} onAction={load} /></ScreenScaffold>;

  const chip = (on: boolean) => [styles.chip, on && styles.chipOn];
  const typeName = (code: string) => types.find((v) => v.code === code)?.name ?? code;

  if (!data.vet) {
    return (
      <ScreenScaffold title={t('vetpro.reg.title')}>
        <ScrollView>
          <Card>
            <Text style={styles.hint}>{t('vetpro.reg.hint')}</Text>
            <Input label={t('vetpro.reg.regNo')} value={reg.registrationNo} onChangeText={(v) => setReg((p) => ({ ...p, registrationNo: v }))} />
            <Toggle label={t('vetpro.reg.aiTech')} value={reg.isAiTechnician} onValueChange={(v: boolean) => setReg((p) => ({ ...p, isAiTechnician: v }))} />
            <Input label={t('vetpro.reg.radius')} value={reg.serviceRadiusKm} keyboardType="number-pad" onChangeText={(v) => setReg((p) => ({ ...p, serviceRadiusKm: v.replace(/\D/g, '') }))} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button title={t('vetpro.reg.submit')} onPress={doRegister} disabled={busy} />
          </Card>
        </ScrollView>
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold title={t('vetpro.home.title')}>
      <ScrollView>
        <Card>
          <Text style={styles.name}>{t('vetpro.home.regNo')} {String(data.vet.registrationNo ?? '')}</Text>
          {data.vet.isAiTechnician ? <Text style={styles.muted}>{t('vetpro.reg.aiTech')}</Text> : null}
        </Card>
        <Text style={styles.section}>{t('vetpro.home.myServices')}</Text>
        {data.services.length === 0 ? <Text style={styles.muted}>{t('vetpro.home.noServices')}</Text> : data.services.map((s) => (
          <Card key={s.id}>
            <View style={styles.between}>
              <Text style={styles.label}>{typeName(String(s.serviceTypeCode ?? s.serviceTypeId))}</Text>
              <MoneyText minor={s.priceMinor} langCode={lang} size="sm" />
            </View>
            <Text style={styles.muted}>{t(`vetpro.unit.${String(s.pricingUnit ?? 'per_visit')}`)}</Text>
          </Card>
        ))}
        <Text style={styles.section}>{t('vetpro.svc.title')}</Text>
        <Card>
          <Text style={styles.label}>{t('vetpro.svc.pick')}</Text>
          <View style={styles.wrap}>
            {types.map((v) => (
              <Pressable key={v.code} style={chip(svc.serviceTypeCode === v.code)} onPress={() => setSvc((p) => ({ ...p, serviceTypeCode: v.code }))}>
                <Text style={styles.chipText}>{v.name ?? v.code}</Text>
              </Pressable>
            ))}
          </View>
          <Input label={t('vetpro.svc.price')} value={svc.priceRupees} keyboardType="decimal-pad" onChangeText={(v) => setSvc((p) => ({ ...p, priceRupees: v }))} />
          <Text style={styles.label}>{t('vetpro.svc.unit')}</Text>
          <View style={styles.wrap}>
            {PRICING_UNITS.map((u) => (
              <Pressable key={u} style={chip(svc.pricingUnit === u)} onPress={() => setSvc((p) => ({ ...p, pricingUnit: u }))}>
                <Text style={styles.chipText}>{t(`vetpro.unit.${u}`)}</Text>
              </Pressable>
            ))}
          </View>
          <Toggle label={t('vetpro.svc.emergency')} value={svc.isEmergencyAvailable} onValueChange={(v: boolean) => setSvc((p) => ({ ...p, isEmergencyAvailable: v }))} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title={t('vetpro.svc.submit')} onPress={doUpsert} disabled={busy || !svc.serviceTypeCode} />
        </Card>
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  name: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  section: { fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  label: { fontSize: font.size.xs, color: color.ink500, marginTop: space[2], marginBottom: space[1] },
  hint: { fontSize: font.size.xs, color: color.ink500 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  error: { color: color.danger, fontSize: font.size.xs, marginTop: space[2] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: radius.pill, borderWidth: 1, borderColor: color.ink100 },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontSize: font.size.xs, color: color.ink800 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space[2] },
});
