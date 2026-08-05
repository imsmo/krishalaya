// apps/mobile/src/app/(pashupalak)/bookings/[id].tsx · booking detail (PC-50 W10-1). Shows ONLY the legal
// farmer action for the current status (Law 5: cancel pre-service; confirm-complete after service — which
// settles the server-snapshotted fee, idempotent Law 3). Terminal states show no buttons.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import type { VetBooking } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { getBooking, cancelBooking, completeBooking } from '../../../features/livestock/livestock.api';
import { bookingTone, canCancelBooking, canCompleteBooking } from '../../../features/livestock/livestock';

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const [booking, setBooking] = useState<VetBooking | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { if (id) setBooking(await getBooking(id)); }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = (fn: (id: string) => Promise<VetBooking>, confirmKey: string) => {
    Alert.alert(t('pashu.booking.title'), t(confirmKey), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), onPress: async () => {
        setBusy(true);
        try { await fn(id!); load(); } catch { Alert.alert(t('pashu.booking.title'), t('pashu.booking.actionFailed')); } finally { setBusy(false); }
      } },
    ]);
  };

  if (booking === undefined) return <ScreenScaffold title={t('pashu.booking.title')}><SkeletonCard lines={6} /></ScreenScaffold>;
  if (booking === null) return <ScreenScaffold title={t('pashu.booking.title')}><EmptyState title={t('pashu.booking.notFound')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('pashu.booking.title')}>
      <ScrollView>
        <Card>
          <View style={styles.between}>
            <StatusPill label={t(`pashu.status.${booking.status}`) || booking.status} tone={bookingTone(booking.status)} />
            <MoneyText minor={booking.feeMinor} langCode={lang} />
          </View>
          <Text style={styles.muted}>{t(`pashu.urgency.${booking.urgency}`)} · {t(`pashu.mode.${booking.mode}`)}</Text>
          {booking.scheduledAt ? <Text style={styles.muted}>{t('pashu.booking.scheduled')} {new Date(booking.scheduledAt).toLocaleString()}</Text> : null}
          <Text style={styles.muted}>{t('pashu.booking.feeNote')}</Text>
        </Card>
        {canCancelBooking(booking.status) && <Button title={t('pashu.booking.cancel')} variant="outline" disabled={busy} onPress={() => act(cancelBooking, 'pashu.booking.cancelConfirm')} />}
        {canCompleteBooking(booking.status) && <Button title={t('pashu.booking.complete')} disabled={busy} onPress={() => act(completeBooking, 'pashu.booking.completeConfirm')} />}
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
