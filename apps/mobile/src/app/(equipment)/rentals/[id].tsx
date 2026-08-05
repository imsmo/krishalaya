// apps/mobile/src/app/(equipment)/rentals/[id].tsx · rental detail (PC-50 W10-6). ONLY the legal owner
// actions (ownerActionsFor mirrors the state machine): QUOTE the advance (rupees→minor, float-free) on
// requested; START on confirmed with the RENTER's OTP (presence proof — their consent, their wallet);
// COMPLETE with actual usage; SETTLE idempotently (money moves server-side); cancel pre-start.
// The renter's CONFIRM never appears here — it belongs to their device.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import type { EquipmentRental } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, Input, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { getRental, quoteRental, startRental, completeRental, settleRental, cancelRental } from '../../../features/equipment/equipment.api';
import { ownerActionsFor, rentalTone } from '../../../features/equipment/equipment';
import { rupeesToMinor } from '../../../features/vet/vet';

export default function RentalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const [rental, setRental] = useState<EquipmentRental | null | undefined>(undefined);
  const [advance, setAdvance] = useState('');
  const [otp, setOtp] = useState('');
  const [actualQty, setActualQty] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { if (id) setRental(await getRental(id)); }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); load(); } catch { Alert.alert(t('equip.detail.title'), t('equip.detail.actionFailed')); } finally { setBusy(false); }
  };
  const doQuote = () => {
    const minor = rupeesToMinor(advance);
    if (!minor) { Alert.alert(t('equip.detail.title'), t('equip.detail.advanceInvalid')); return; }
    run(() => quoteRental(id!, minor));
  };
  const doStart = () => {
    if (!/^\d{4,8}$/.test(otp)) { Alert.alert(t('equip.detail.title'), t('equip.detail.otpInvalid')); return; }
    run(() => startRental(id!, otp));
  };
  const doComplete = () => {
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(actualQty.trim()) || Number(actualQty) <= 0) { Alert.alert(t('equip.detail.title'), t('equip.detail.qtyInvalid')); return; }
    run(() => completeRental(id!, actualQty.trim()));
  };
  const doSettle = () => {
    Alert.alert(t('equip.detail.title'), t('equip.detail.settleConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), onPress: () => run(() => settleRental(id!)) },
    ]);
  };
  const doCancel = () => {
    Alert.alert(t('equip.detail.title'), t('equip.detail.cancelConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), onPress: () => run(() => cancelRental(id!)) },
    ]);
  };

  if (rental === undefined) return <ScreenScaffold title={t('equip.detail.title')}><SkeletonCard lines={6} /></ScreenScaffold>;
  if (rental === null) return <ScreenScaffold title={t('equip.detail.title')}><EmptyState title={t('equip.detail.notFound')} /></ScreenScaffold>;

  const actions = ownerActionsFor(rental.status);
  return (
    <ScreenScaffold title={rental.assetName ?? t('equip.detail.title')}>
      <ScrollView>
        <Card>
          <View style={styles.between}>
            <StatusPill label={t(`equip.status.${rental.status}`) || rental.status} tone={rentalTone(rental.status)} />
            {rental.totalMinor ? <MoneyText minor={rental.totalMinor} langCode={lang} /> : null}
          </View>
          <Text style={styles.muted}>{rental.quantity} {rental.unitCode}</Text>
          {rental.advanceMinor ? <View style={styles.between}><Text style={styles.muted}>{t('equip.detail.advance')}</Text><MoneyText minor={rental.advanceMinor} langCode={lang} size="sm" /></View> : null}
          {rental.scheduledAt ? <Text style={styles.muted}>{t('equip.detail.scheduled')} {new Date(rental.scheduledAt).toLocaleString()}</Text> : null}
        </Card>
        {actions.includes('quote') && (
          <Card>
            <Input label={t('equip.detail.advanceLabel')} value={advance} keyboardType="decimal-pad" onChangeText={setAdvance} />
            <Button title={t('equip.action.quote')} disabled={busy} onPress={doQuote} />
          </Card>
        )}
        {rental.status === 'quoted' && <Text style={styles.muted}>{t('equip.detail.awaitingRenter')}</Text>}
        {actions.includes('start') && (
          <Card>
            <Text style={styles.muted}>{t('equip.detail.otpHint')}</Text>
            <Input label={t('equip.detail.otpLabel')} value={otp} keyboardType="number-pad" maxLength={8} onChangeText={(v) => setOtp(v.replace(/\D/g, ''))} />
            <Button title={t('equip.action.start')} disabled={busy} onPress={doStart} />
          </Card>
        )}
        {actions.includes('complete') && (
          <Card>
            <Input label={t('equip.detail.actualQty', { unit: rental.unitCode })} value={actualQty} keyboardType="decimal-pad" onChangeText={setActualQty} />
            <Button title={t('equip.action.complete')} disabled={busy} onPress={doComplete} />
          </Card>
        )}
        {actions.includes('settle') && <Button title={t('equip.action.settle')} disabled={busy} onPress={doSettle} />}
        {actions.includes('cancel') && <Button title={t('equip.action.cancel')} variant="outline" disabled={busy} onPress={doCancel} />}
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
