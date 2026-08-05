// apps/mobile/src/app/(mcc)/counter.tsx · collection entry (PC-50 W10-7; canon 237). Member picked from the
// REAL box=mcc roster (code filter is display-only), weighment + FAT/SNF within the proven counter bounds,
// seeded adulteration flags. The slip is Idempotency-Keyed and the SERVER prices it from the rate card —
// the priced result is echoed back so the farmer sees the same number the cooperative recorded.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { DairyMcc, DairyMembership, DairyCollection } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, Input, MoneyText, ScreenScaffold, SkeletonCard, Toggle, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useAuth } from '../../core/auth/auth.store';
import { myMcc, mccMembers, recordSlip } from '../../features/mcc-operator/mcc.api';
import { buildSlipDraft, filterMembers, SHIFTS, ADULTERATION_FLAGS } from '../../features/mcc-operator/mcc';
import { toIsoDate } from '../../features/dairy/dairy';

export default function Counter() {
  const { t, lang } = useTranslation();
  const { state } = useAuth();
  const [mcc, setMcc] = useState<DairyMcc | null | undefined>(undefined);
  const [members, setMembers] = useState<DairyMembership[]>([]);
  const [q, setQ] = useState('');
  const [membershipId, setMembershipId] = useState('');
  const [form, setForm] = useState({ shift: 'morning', weightKg: '', fatPct: '', snfPct: '', waterFlag: false, adulteration: [] as string[] });
  const [lastSlip, setLastSlip] = useState<DairyCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const userId = state.profile?.id;
    if (!userId) { setMcc(null); return; }
    const centre = await myMcc(userId);
    setMcc(centre);
    if (centre) setMembers(await mccMembers(centre.id));
  }, [state.profile?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    const draft = buildSlipDraft({ membershipId, collectedOn: toIsoDate(new Date()), ...form });
    if (!draft.ok) { setError(t(`mcc.slip.err.${draft.error}`)); return; }
    setError(null); setBusy(true);
    try {
      const slip = await recordSlip(draft.value);
      setLastSlip(slip);
      setForm((p) => ({ ...p, weightKg: '', fatPct: '', snfPct: '', waterFlag: false, adulteration: [] }));
    } catch { Alert.alert(t('mcc.slip.title'), t('mcc.slip.failed')); }
    finally { setBusy(false); }
  };
  const toggleFlag = (f: string) => setForm((p) => ({ ...p, adulteration: p.adulteration.includes(f) ? p.adulteration.filter((x) => x !== f) : [...p.adulteration, f] }));

  if (mcc === undefined) return <ScreenScaffold title={t('mcc.slip.title')}><SkeletonCard lines={6} /></ScreenScaffold>;
  if (mcc === null) return <ScreenScaffold title={t('mcc.slip.title')}><EmptyState title={t('mcc.noCentre')} message={t('mcc.noCentreHint')} /></ScreenScaffold>;

  const chip = (on: boolean) => [styles.chip, on && styles.chipOn];
  const visible = filterMembers(members, q);

  return (
    <ScreenScaffold title={mcc.defaultName}>
      <ScrollView>
        {lastSlip && (
          <Card>
            <View style={styles.between}>
              <Text style={styles.ok}>{t('mcc.slip.recorded')}</Text>
              <MoneyText minor={lastSlip.amountMinor} langCode={lang} />
            </View>
            <Text style={styles.muted}>{t('mcc.slip.serverPriced')}</Text>
          </Card>
        )}
        <Card>
          <Input label={t('mcc.slip.findMember')} value={q} onChangeText={setQ} />
          <View style={styles.wrap}>
            {visible.slice(0, 12).map((m) => (
              <Pressable key={m.id} style={chip(membershipId === m.id)} onPress={() => setMembershipId(m.id)}>
                <Text style={styles.chipText}>{m.memberCode}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>{t('mcc.slip.shift')}</Text>
          <View style={styles.wrap}>
            {SHIFTS.map((s) => (
              <Pressable key={s} style={chip(form.shift === s)} onPress={() => setForm((p) => ({ ...p, shift: s }))}>
                <Text style={styles.chipText}>{t(`dairyapp.shift.${s}`)}</Text>
              </Pressable>
            ))}
          </View>
          <Input label={t('mcc.slip.weight')} value={form.weightKg} keyboardType="decimal-pad" onChangeText={(v) => setForm((p) => ({ ...p, weightKg: v }))} />
          <Input label={t('mcc.slip.fat')} value={form.fatPct} keyboardType="decimal-pad" onChangeText={(v) => setForm((p) => ({ ...p, fatPct: v }))} />
          <Input label={t('mcc.slip.snf')} value={form.snfPct} keyboardType="decimal-pad" onChangeText={(v) => setForm((p) => ({ ...p, snfPct: v }))} />
          <Toggle label={t('mcc.slip.water')} value={form.waterFlag} onValueChange={(v: boolean) => setForm((p) => ({ ...p, waterFlag: v }))} />
          <Text style={styles.label}>{t('mcc.slip.adulteration')}</Text>
          <View style={styles.wrap}>
            {ADULTERATION_FLAGS.map((f) => (
              <Pressable key={f} style={chip(form.adulteration.includes(f))} onPress={() => toggleFlag(f)}>
                <Text style={styles.chipText}>{t(`mcc.flag.${f}`)}</Text>
              </Pressable>
            ))}
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.muted}>{t('mcc.slip.priceNote')}</Text>
          <Button title={t('mcc.slip.submit')} onPress={submit} disabled={busy || !membershipId} />
        </Card>
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  label: { fontSize: font.size.xs, color: color.ink500, marginTop: space[2], marginBottom: space[1] },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[2] },
  ok: { fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  error: { color: color.danger, fontSize: font.size.xs, marginTop: space[2] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: radius.pill, borderWidth: 1, borderColor: color.ink100 },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontSize: font.size.xs, color: color.ink800 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
