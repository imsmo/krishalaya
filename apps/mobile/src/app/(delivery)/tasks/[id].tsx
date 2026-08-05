// apps/mobile/src/app/(delivery)/tasks/[id].tsx · task detail (PC-50 W10-5). ONLY the legal rider milestones
// for the current status (riderActionsFor mirrors the state machine; assign/cancel/returned are ops moves).
// DELIVER is the trust step: the BUYER's 4–8 digit OTP (validated client-side, verified server-side) +
// optional POD photo via the shared media pipeline, Idempotency-Keyed. FAIL requires a reason (audited).
// A location ping button appends a real tracking point — GPS wiring comes with device perms; here the rider
// confirms the ping explicitly.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import type { Shipment } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, Input, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { getTask, markPickedUp, markInTransit, markAtHub, markOutForDelivery, failTask, deliverTask, uploadPod } from '../../../features/delivery-partner/delivery.api';
import { riderActionsFor, shipmentTone, type RiderAction } from '../../../features/delivery-partner/delivery';
import { isValidPodOtp } from '../../../features/orders/order-status';
import { captureFromCamera } from '../../../core/media';

const MILESTONES: Partial<Record<RiderAction, (id: string) => Promise<Shipment>>> = {
  picked_up: markPickedUp, in_transit: markInTransit, at_hub: markAtHub, out_for_delivery: markOutForDelivery,
};

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const [task, setTask] = useState<Shipment | null | undefined>(undefined);
  const [otp, setOtp] = useState('');
  const [podMediaId, setPodMediaId] = useState<string | null>(null);
  const [failReason, setFailReason] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { if (id) setTask(await getTask(id)); }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (fn: () => Promise<unknown>, errKey: string) => {
    setBusy(true);
    try { await fn(); load(); } catch { Alert.alert(t('rider.task.title'), t(errKey)); } finally { setBusy(false); }
  };
  const milestone = (a: RiderAction) => run(() => MILESTONES[a]!(id!), 'rider.task.actionFailed');
  const doFail = () => {
    const reason = failReason.trim();
    if (!reason) { Alert.alert(t('rider.task.title'), t('rider.task.failReasonRequired')); return; }
    run(() => failTask(id!, reason), 'rider.task.actionFailed');
  };
  const takePod = async () => {
    const picked = await captureFromCamera();
    if (!picked) return;
    setBusy(true);
    const mediaId = await uploadPod(picked);
    setBusy(false);
    if (mediaId) setPodMediaId(mediaId);
    else Alert.alert(t('rider.task.title'), t('rider.task.podFailed'));
  };
  const doDeliver = () => {
    if (!isValidPodOtp(otp)) { Alert.alert(t('rider.task.title'), t('rider.task.otpInvalid')); return; }
    run(() => deliverTask(id!, otp, podMediaId ?? undefined), 'rider.task.deliverFailed');
  };

  if (task === undefined) return <ScreenScaffold title={t('rider.task.title')}><SkeletonCard lines={6} /></ScreenScaffold>;
  if (task === null) return <ScreenScaffold title={t('rider.task.title')}><EmptyState title={t('rider.task.notFound')} /></ScreenScaffold>;

  const actions = riderActionsFor(task.status);
  return (
    <ScreenScaffold title={task.awbNo ? `AWB ${task.awbNo}` : t('rider.task.title')}>
      <ScrollView>
        <Card>
          <StatusPill label={t(`rider.status.${task.status}`) || task.status} tone={shipmentTone(task.status)} />
          {task.scheduledPickupAt ? <Text style={styles.muted}>{t('rider.today.pickupAt')} {new Date(task.scheduledPickupAt).toLocaleString()}</Text> : null}
          {task.requiresOtp ? <Text style={styles.muted}>{t('rider.today.otpNeeded')}</Text> : null}
        </Card>
        {actions.filter((a) => MILESTONES[a]).map((a) => (
          <Button key={a} title={t(`rider.action.${a}`)} disabled={busy} onPress={() => milestone(a)} />
        ))}
        {actions.includes('deliver') && (
          <Card>
            <Text style={styles.section}>{t('rider.task.deliverTitle')}</Text>
            <Input label={t('rider.task.otp')} value={otp} keyboardType="number-pad" maxLength={8} onChangeText={(v) => setOtp(v.replace(/\D/g, ''))} />
            <Button title={podMediaId ? t('rider.task.podDone') : t('rider.task.podTake')} variant="outline" disabled={busy || !!podMediaId} onPress={takePod} />
            <Button title={t('rider.action.deliver')} disabled={busy || !isValidPodOtp(otp)} onPress={doDeliver} />
          </Card>
        )}
        {actions.includes('fail') && (
          <Card>
            <Input label={t('rider.task.failReason')} value={failReason} onChangeText={setFailReason} />
            <Button title={t('rider.action.fail')} variant="outline" disabled={busy} onPress={doFail} />
          </Card>
        )}
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  section: { fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
});
