// apps/mobile/src/app/(pashupalak)/bookings/index.tsx · my vet bookings (PC-50 W10-1). box=farmer (the payer's
// own bookings). Status straight from the server's state machine; fee is the server-snapshotted minor string.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { VetBooking } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { myBookings } from '../../../features/livestock/livestock.api';
import { bookingTone } from '../../../features/livestock/livestock';

export default function BookingList() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState<VetBooking[] | null>(null);
  useFocusEffect(useCallback(() => { myBookings().then(setItems); }, []));

  return (
    <ScreenScaffold title={t('pashu.bookings.title')}>
      {items === null ? <SkeletonCard lines={6} /> : items.length === 0 ? (
        <EmptyState title={t('pashu.bookings.empty')} actionLabel={t('pashu.home.bookVet')} onAction={() => router.push('/(pashupalak)/vets')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/(pashupalak)/bookings/${item.id}`)}>
              <Card>
                <View style={styles.between}>
                  <StatusPill label={t(`pashu.status.${item.status}`) || item.status} tone={bookingTone(item.status)} />
                  <MoneyText minor={item.feeMinor} langCode={lang} size="sm" />
                </View>
                <Text style={styles.muted}>{t(`pashu.urgency.${item.urgency}`)} · {t(`pashu.mode.${item.mode}`)}</Text>
              </Card>
            </Pressable>
          )}
        />
      )}
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
