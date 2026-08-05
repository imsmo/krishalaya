// apps/mobile/src/app/(store)/licence.tsx · compliance status (PC-50 W10-4). The REAL business-KYC record
// (self-read; PII arrives MASKED from the server and is shown masked — §4). 'expired' is a real server
// status → the renewal call-to-action is honest. Automated licence-expiry reminders have no backend →
// coming-note (PC-54 `store-licence-reminders`), never a fabricated countdown.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { BusinessKycStatus } from '@krishalaya/sdk-js';
import { Card, EmptyState, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { businessKyc } from '../../features/store-owner/store.api';

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = { verified: 'success', pending: 'warning', rejected: 'danger', expired: 'danger', none: 'neutral' };

export default function LicenceStatus() {
  const { t } = useTranslation();
  const [kyc, setKyc] = useState<BusinessKycStatus | null | undefined>(undefined);
  useFocusEffect(useCallback(() => { businessKyc().then(setKyc); }, []));

  if (kyc === undefined) return <ScreenScaffold title={t('store.lic.title')}><SkeletonCard lines={5} /></ScreenScaffold>;
  if (kyc === null) return <ScreenScaffold title={t('store.lic.title')}><EmptyState title={t('store.lic.loadError')} /></ScreenScaffold>;

  const fact = (label: string, value?: string | null) => value ? (
    <View style={styles.between}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>
  ) : null;

  return (
    <ScreenScaffold title={t('store.lic.title')}>
      <ScrollView>
        <Card>
          <StatusPill label={t(`store.lic.status.${kyc.status}`)} tone={TONE[kyc.status] ?? 'neutral'} />
          {fact(t('store.lic.legalName'), kyc.legalName)}
          {fact(t('store.lic.gstin'), kyc.gstinMasked)}
          {fact(t('store.lic.pan'), kyc.panMasked)}
        </Card>
        {kyc.status === 'none' && <Text style={styles.muted}>{t('store.lic.noneHint')}</Text>}
        {(kyc.status === 'expired' || kyc.status === 'rejected') && <Text style={styles.muted}>{t('store.lic.renewHint')}</Text>}
        <Text style={styles.muted}>{t('store.lic.remindersComing')}</Text>
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  label: { fontSize: font.size.xs, color: color.ink500 },
  value: { fontSize: font.size.sm, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[2] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space[2] },
});
