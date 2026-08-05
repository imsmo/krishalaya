// apps/mobile/src/app/(pashupalak)/vets/[id].tsx · vet profile + BOOK (PC-50 W10-1). Services show the vet's
// REAL server price (bigint minor, Law 2) — the booking payload NEVER carries a fee; the server snapshots
// vet_services.price_minor (Law 11). Booking is Idempotency-Keyed (Law 3). Optional animal pre-link via ?animalId=.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import type { VetProfile, VetService } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, Input, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { getVet, bookVet } from '../../../features/livestock/livestock.api';
import { buildBookingDraft, URGENCIES, MODES } from '../../../features/livestock/livestock';

export default function VetProfileScreen() {
  const { id, animalId } = useLocalSearchParams<{ id: string; animalId?: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const [data, setData] = useState<{ vet: VetProfile | null; services: VetService[] } | undefined>(undefined);
  const [serviceId, setServiceId] = useState('');
  const [urgency, setUrgency] = useState('routine');
  const [mode, setMode] = useState('visit');
  const [symptoms, setSymptoms] = useState('');
  const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => { if (id) getVet(id).then(setData); }, [id]));

  const book = async () => {
    const draft = buildBookingDraft({ vetId: id!, serviceId, animalId, urgency, mode, symptomsText: symptoms });
    if (!draft.ok) { Alert.alert(t('pashu.book.title'), t(`pashu.book.err.${draft.error}`)); return; }
    setBusy(true);
    try {
      const b = await bookVet(draft.value);
      router.replace(`/(pashupalak)/bookings/${b.id}`);
    } catch {
      Alert.alert(t('pashu.book.title'), t('pashu.book.failed'));
    } finally { setBusy(false); }
  };

  if (data === undefined) return <ScreenScaffold title={t('pashu.book.title')}><SkeletonCard lines={6} /></ScreenScaffold>;
  if (!data.vet) return <ScreenScaffold title={t('pashu.book.title')}><EmptyState title={t('pashu.vets.notFound')} /></ScreenScaffold>;

  const chip = (on: boolean) => [styles.chip, on && styles.chipOn];
  return (
    <ScreenScaffold title={String(data.vet.displayName ?? t('pashu.vets.unnamed'))}>
      <ScrollView>
        <Card>
          {data.vet.registrationNo ? <Text style={styles.muted}>{t('pashu.vets.regNo')} {String(data.vet.registrationNo)}</Text> : null}
          <Text style={styles.section}>{t('pashu.book.pickService')}</Text>
          {data.services.length === 0 ? <Text style={styles.muted}>{t('pashu.book.noServices')}</Text> : data.services.map((s) => (
            <Pressable key={s.id} style={chip(serviceId === s.id)} onPress={() => setServiceId(s.id)}>
              <View style={styles.between}>
                <Text style={styles.chipText}>{String(s.serviceTypeCode ?? s.serviceTypeId).slice(0, 24)}</Text>
                <MoneyText minor={s.priceMinor} langCode={lang} size="sm" />
              </View>
            </Pressable>
          ))}
          <Text style={styles.section}>{t('pashu.book.urgency')}</Text>
          <View style={styles.wrap}>{URGENCIES.map((u) => <Pressable key={u} style={chip(urgency === u)} onPress={() => setUrgency(u)}><Text style={styles.chipText}>{t(`pashu.urgency.${u}`)}</Text></Pressable>)}</View>
          <Text style={styles.section}>{t('pashu.book.mode')}</Text>
          <View style={styles.wrap}>{MODES.map((m) => <Pressable key={m} style={chip(mode === m)} onPress={() => setMode(m)}><Text style={styles.chipText}>{t(`pashu.mode.${m}`)}</Text></Pressable>)}</View>
          <Input label={t('pashu.book.symptoms')} value={symptoms} onChangeText={setSymptoms} multiline />
          <Text style={styles.muted}>{t('pashu.book.feeNote')}</Text>
          <Button title={t('pashu.book.submit')} onPress={book} disabled={busy || !serviceId} />
        </Card>
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  section: { fontSize: font.size.xs, color: color.ink500, marginTop: space[3], marginBottom: space[1] },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[2] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.md, borderWidth: 1, borderColor: color.ink100, marginTop: space[1] },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontSize: font.size.xs, color: color.ink800 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
