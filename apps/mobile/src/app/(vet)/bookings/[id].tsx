// apps/mobile/src/app/(vet)/bookings/[id].tsx · case detail (PC-50 W10-3). Shows ONLY the legal vet actions
// for the current status (vetActionsFor mirrors the state machine; `completed` is the FARMER's confirm-and-
// pay and is NEVER offered here). Prescribed → honest note that the farmer confirms & pays. Prescription
// CONTENT (drug lines, dosage) has NO backend → coming-note (PC-54 `vet-prescriptions`), never a fake pad.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import type { VetBooking } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { getVetBooking, progressBooking } from '../../../features/vet/vet.api';
import { vetActionsFor, type VetAction } from '../../../features/vet/vet';
import { bookingTone } from '../../../features/livestock/livestock';

export default function VetCase() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const [booking, setBooking] = useState<VetBooking | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { if (id) setBooking(await getVetBooking(id)); }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = (action: VetAction) => {
    Alert.alert(t('vetpro.case.title'), t(`vetpro.action.${action}.confirm`), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), onPress: async () => {
        setBusy(true);
        try { await progressBooking(id!, action); load(); } catch { Alert.alert(t('vetpro.case.title'), t('vetpro.case.actionFailed')); } finally { setBusy(false); }
      } },
    ]);
  };

  if (booking === undefined) return <ScreenScaffold title={t('vetpro.case.title')}><SkeletonCard lines={6} /></ScreenScaffold>;
  if (booking === null) return <ScreenScaffold title={t('vetpro.case.title')}><EmptyState title={t('vetpro.case.notFound')} /></ScreenScaffold>;

  const actions = vetActionsFor(booking.status);
  return (
    <ScreenScaffold title={t('vetpro.case.title')}>
      <ScrollView>
        <Card>
          <View style={styles.between}>
            <StatusPill label={t(`pashu.status.${booking.status}`) || booking.status} tone={bookingTone(booking.status)} />
            <MoneyText minor={booking.feeMinor} langCode={lang} />
          </View>
          <Text style={styles.muted}>{t(`pashu.urgency.${booking.urgency}`)} · {t(`pashu.mode.${booking.mode}`)}</Text>
          {booking.scheduledAt ? <Text style={styles.muted}>{t('pashu.booking.scheduled')} {new Date(booking.scheduledAt).toLocaleString()}</Text> : null}
        </Card>
        {actions.map((a) => <Button key={a} title={t(`vetpro.action.${a}`)} disabled={busy} onPress={() => act(a)} />)}
        {booking.status === 'prescribed' && <Text style={styles.muted}>{t('vetpro.case.awaitingFarmer')}</Text>}
        {(booking.status === 'in_consult' || booking.status === 'prescribed') && <Text style={styles.muted}>{t('vetpro.case.rxComing')}</Text>}
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
