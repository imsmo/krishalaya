// apps/mobile/src/app/(farmer)/kyc/index.tsx · screens 109/175 (verification status). Thin screen: lists the
// caller's KYC documents + statuses (features/kyc). FLAG_SECURE while shown (KYC screen). Behind the `kyc` flag.
// Degrade-never-die: empty/failed → friendly state. (Document SUBMIT is deferred until the API exposes a
// doc-type lookup — see features/kyc/kyc.api; this release ships status visibility, the highest-value piece.)
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { KycDocument, KycStatus } from '@krishalaya/sdk-js';
import { Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, type PillTone } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { listKyc } from '../../../features/kyc/kyc.api';

const TONE: Record<KycStatus, PillTone> = { pending: 'warning', verified: 'success', rejected: 'danger', expired: 'neutral' };

export default function KycStatus() {
  useSecureScreen();
  const { t } = useTranslation();
  const enabled = useFlag('kyc');
  const [items, setItems] = useState<KycDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => { setItems(await listKyc()); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('kyc.title')}><EmptyState title={t('kyc.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('kyc.title')} scroll={false}>
      {loading ? <View style={{ gap: space[3] }}><SkeletonCard lines={2} /><SkeletonCard lines={2} /></View> : (
        <FlatList
          data={items}
          keyExtractor={(d) => d.id}
          ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
          ListEmptyComponent={<EmptyState title={t('kyc.empty.title')} message={t('kyc.empty.message')} />}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.row}>
                <Text style={styles.id}>{item.docNoMasked ?? item.id.slice(0, 8)}</Text>
                <StatusPill label={t(`kyc.status.${item.status}`)} tone={TONE[item.status] ?? 'neutral'} />
              </View>
              {item.status === 'rejected' && item.rejectReason ? <Text style={styles.reason}>{item.rejectReason}</Text> : null}
            </Card>
          )}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  id: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  reason: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[2] },
});
