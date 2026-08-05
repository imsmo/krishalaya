// apps/mobile/src/app/(pashupalak)/home.tsx · Pashupalak home (PC-50 W10-1): my herd at a glance (REAL counts
// from the caller's registry — never invented), in-flight vet bookings, and the honest note that the health
// log is coming (livestock health records have NO endpoints yet — PC-54 `livestock-health-records`).
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { Animal, VetBooking } from '@krishalaya/sdk-js';
import { Card, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { myAnimals, myBookings } from '../../features/livestock/livestock.api';
import { bookingTone } from '../../features/livestock/livestock';

export default function PashupalakHome() {
  const { t } = useTranslation();
  const router = useRouter();
  const [animals, setAnimals] = useState<Animal[] | null>(null);
  const [bookings, setBookings] = useState<VetBooking[] | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([myAnimals(), myBookings()]);
    setAnimals(a); setBookings(b);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const active = animals?.filter((a) => a.status === 'active').length ?? 0;
  const inFlight = bookings?.filter((b) => !['completed', 'cancelled', 'no_show'].includes(b.status)) ?? [];

  return (
    <ScreenScaffold title={t('pashu.home.title')}>
      <ScrollView>
        {animals === null ? <SkeletonCard lines={4} /> : (
          <Pressable onPress={() => router.push('/(pashupalak)/animals')}>
            <Card>
              <Text style={styles.big}>{active}</Text>
              <Text style={styles.label}>{t('pashu.home.activeAnimals')}</Text>
            </Card>
          </Pressable>
        )}
        <View style={styles.row}>
          <Pressable style={styles.grow} onPress={() => router.push('/(pashupalak)/animals/add')}>
            <Card><Text style={styles.action}>{t('pashu.home.addAnimal')}</Text></Card>
          </Pressable>
          <Pressable style={styles.grow} onPress={() => router.push('/(pashupalak)/vets')}>
            <Card><Text style={styles.action}>{t('pashu.home.bookVet')}</Text></Card>
          </Pressable>
        </View>
        <Text style={styles.section}>{t('pashu.home.inFlight')}</Text>
        {bookings === null ? <SkeletonCard lines={3} /> : inFlight.length === 0 ? (
          <Text style={styles.muted}>{t('pashu.home.noBookings')}</Text>
        ) : inFlight.slice(0, 5).map((b) => (
          <Pressable key={b.id} onPress={() => router.push(`/(pashupalak)/bookings/${b.id}`)}>
            <Card>
              <View style={styles.between}>
                <Text style={styles.label}>{t(`pashu.status.${b.status}`)}</Text>
                <StatusPill label={t(`pashu.status.${b.status}`)} tone={bookingTone(b.status)} />
              </View>
            </Card>
          </Pressable>
        ))}
        <Text style={styles.muted}>{t('pashu.home.healthComing')}</Text>
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  big: { fontSize: 40, fontWeight: font.weight.bold, color: color.ink800 },
  label: { fontSize: font.size.md, color: color.ink800 },
  action: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary600 },
  section: { fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[3] },
  row: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
  grow: { flex: 1 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
