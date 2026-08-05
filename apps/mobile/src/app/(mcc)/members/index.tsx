// apps/mobile/src/app/(mcc)/members/index.tsx · member roster (PC-50 W10-7; canon 239 entry). box=mcc,
// code filter display-only. Tap → the farmer's ledger.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { DairyMcc, DairyMembership } from '@krishalaya/sdk-js';
import { Card, EmptyState, Input, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useAuth } from '../../../core/auth/auth.store';
import { myMcc, mccMembers } from '../../../features/mcc-operator/mcc.api';
import { filterMembers } from '../../../features/mcc-operator/mcc';

export default function MemberRoster() {
  const { t } = useTranslation();
  const router = useRouter();
  const { state } = useAuth();
  const [q, setQ] = useState('');
  const [mcc, setMcc] = useState<DairyMcc | null | undefined>(undefined);
  const [members, setMembers] = useState<DairyMembership[]>([]);

  const load = useCallback(async () => {
    const userId = state.profile?.id;
    if (!userId) { setMcc(null); return; }
    const centre = await myMcc(userId);
    setMcc(centre);
    if (centre) setMembers(await mccMembers(centre.id));
  }, [state.profile?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (mcc === undefined) return <ScreenScaffold title={t('mcc.members.title')}><SkeletonCard lines={6} /></ScreenScaffold>;
  if (mcc === null) return <ScreenScaffold title={t('mcc.members.title')}><EmptyState title={t('mcc.noCentre')} message={t('mcc.noCentreHint')} /></ScreenScaffold>;

  const visible = filterMembers(members, q);
  return (
    <ScreenScaffold title={t('mcc.members.title')}>
      <Input label={t('mcc.slip.findMember')} value={q} onChangeText={setQ} />
      {visible.length === 0 ? (
        <EmptyState title={t('mcc.members.empty')} message={t('mcc.members.emptyHint')} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/(mcc)/members/${item.id}`)}>
              <Card>
                <View style={styles.between}>
                  <Text style={styles.code}>{item.memberCode}</Text>
                  <StatusPill label={item.isActive ? t('mcc.members.active') : t('mcc.members.inactive')} tone={item.isActive ? 'success' : 'neutral'} />
                </View>
                <Text style={styles.muted}>{t(`dairyapp.cycle.${item.paymentCycle}`) || item.paymentCycle}</Text>
              </Card>
            </Pressable>
          )}
        />
      )}
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  code: { fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
