// apps/mobile/src/app/(farmer)/orders/pod.tsx · screen for PROOF-OF-DELIVERY capture (PRD DoD). Thin screen
// (guide §3): find the order's shipment → enter the buyer's OTP (issued server-side to the buyer) + optionally
// attach a delivery photo (core/media: compress + presigned upload) → recordPod delivers the shipment. The OTP is
// verified SERVER-SIDE (we send the raw code; the server hashes + compares) — the client is never trusted.
// FLAG_SECURE while shown (the OTP is sensitive). Behind `orders_fulfilment`. Degrade-never-die throughout.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Shipment } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Input, EmptyState, ScreenScaffold, SkeletonCard, AddMediaTile, UploadTile, color, font, space, type UploadStatus } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { getOrderShipment, recordPod } from '../../../features/orders/orders.api';
import { isValidPodOtp } from '../../../features/orders/order-status';
import { captureFromCamera, pickFromGallery, uploadPickedImage, type PickedImage } from '../../../core/media';

export default function ProofOfDelivery() {
  useSecureScreen();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('orders_fulfilment');

  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [otp, setOtp] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; status: UploadStatus; progress: number; mediaId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    // KV MF-06 hardening: same guard-before-setLoading(false) fix as orders/track.tsx — a missing orderId
    // must still clear the loading flag so the screen never gets stuck on SkeletonCard forever.
    if (!orderId) { setLoading(false); return; }
    setLoading(true);
    setShipment(await getOrderShipment(orderId));
    setLoading(false);
  }, [orderId]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('pod.title')}><EmptyState title={t('orders.unavailable')} /></ScreenScaffold>;

  const addPhoto = async (pick: () => Promise<PickedImage | null>) => {
    const picked = await pick();
    if (!picked) return;
    setPhoto({ uri: picked.uri, status: 'uploading', progress: 0 });
    try {
      const res = await uploadPickedImage(picked, { onProgress: (f) => setPhoto((p) => (p ? { ...p, progress: f } : p)) });
      setPhoto((p) => (p ? { ...p, status: res.queued ? 'queued' : 'done', mediaId: res.mediaId ?? undefined } : p));
    } catch { setPhoto((p) => (p ? { ...p, status: 'failed' } : p)); }
  };
  const pickSource = () => Alert.alert(t('createListing.photoSource'), undefined, [
    { text: t('createListing.camera'), onPress: () => addPhoto(captureFromCamera) },
    { text: t('createListing.gallery'), onPress: () => addPhoto(pickFromGallery) },
    { text: t('common.cancel'), style: 'cancel' },
  ]);

  const canSubmit = !!shipment && isValidPodOtp(otp) && photo?.status !== 'uploading' && !busy;
  const onSubmit = async () => {
    if (!shipment || !isValidPodOtp(otp)) { setError(t('pod.invalidOtp')); return; }
    setBusy(true); setError(undefined);
    try {
      await recordPod(shipment.id, otp, photo?.mediaId);
      router.replace({ pathname: '/(farmer)/orders/[id]', params: { id: shipment.orderId, notice: t('pod.delivered') } });
    } catch (e) {
      setError(e instanceof SdkError && (e.isValidation || e.status === 422) ? t('pod.wrongOtp')
        : e instanceof SdkError && e.isForbidden ? t('orders.action.forbidden') : t('pod.failed'));
    } finally { setBusy(false); }
  };

  return (
    <ScreenScaffold
      title={t('pod.title')}
      footer={shipment ? <Button title={t('pod.submit')} onPress={onSubmit} loading={busy} disabled={!canSubmit} /> : undefined}
    >
      {loading ? <SkeletonCard lines={3} /> : !shipment ? (
        <EmptyState title={t('pod.noShipment.title')} message={t('pod.noShipment.message')} />
      ) : (
        <>
          <Text style={styles.help}>{t('pod.help')}</Text>
          <Input label={t('pod.otpLabel')} value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={8} autoFocus error={error} />
          <Text style={styles.section}>{t('pod.photo')}</Text>
          <View style={{ flexDirection: 'row' }}>
            {photo ? (
              <UploadTile uri={photo.uri} status={photo.status} progress={photo.progress}
                queuedLabel={t('common.offline')} retryLabel={t('common.retry')} removeLabel={t('common.cancel')}
                onRemove={() => setPhoto(null)} onRetry={() => setPhoto(null)} />
            ) : <AddMediaTile label={t('pod.addPhoto')} onPress={pickSource} />}
          </View>
        </>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  help: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600, marginBottom: space[3] },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink600, marginTop: space[4], marginBottom: space[2] },
});
