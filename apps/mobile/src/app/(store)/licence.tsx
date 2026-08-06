// apps/mobile/src/app/(store)/licence.tsx · compliance status (PC-50 W10-4; EXPIRING FEED added PC-55 B6).
// The REAL business-KYC record (self-read; PII arrives MASKED from the server and is shown masked — §4).
// 'expired' is a real server status → the renewal call-to-action is honest.
//
// PC-55 B6: the old note said automated licence-expiry reminders had no backend. W54-14 shipped them, so the note
// had become false and is now the feed itself — the caller's OWN documents with a real `validUntil`, counted down
// from that date. Everything on this list is arithmetic on a server-held date; nothing is a guess, which is exactly
// what the earlier note was protecting against. An ALREADY-EXPIRED document is called expired rather than shown as
// "0 days left", because a shopkeeper needs to know they are trading on a lapsed licence today.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { BusinessKycStatus } from '@krishalaya/sdk-js';
import { Card, EmptyState, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { businessKyc, expiringDocuments } from '../../features/store-owner/store.api';
import { expiryState, sortByExpiry, EXPIRY_WINDOW_DAYS } from '../../features/store-owner/licence';

const today = () => new Date().toISOString().slice(0, 10);

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = { verified: 'success', pending: 'warning', rejected: 'danger', expired: 'danger', none: 'neutral' };

type DocRow = { id: string; status: string; docTypeId?: string; validUntil?: string | null; docNoMasked?: string | null };

export default function LicenceStatus() {
  const { t } = useTranslation();
  const [kyc, setKyc] = useState<BusinessKycStatus | null | undefined>(undefined);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const load = useCallback(async () => {
    const [k, d] = await Promise.all([businessKyc(), expiringDocuments(EXPIRY_WINDOW_DAYS)]);
    setKyc(k); setDocs(sortByExpiry(d as DocRow[]));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

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

        <Text style={styles.section}>{t('store.exp.title', { days: String(EXPIRY_WINDOW_DAYS) })}</Text>
        {docs.length === 0 ? <Text style={styles.muted}>{t('store.exp.empty', { days: String(EXPIRY_WINDOW_DAYS) })}</Text> : docs.map((d) => {
          const e = expiryState(d.validUntil, today());
          return (
            <Card key={d.id}>
              <View style={styles.between}>
                <Text style={styles.value}>{d.docNoMasked ?? t('store.exp.document')}</Text>
                <StatusPill label={t(`store.exp.state.${e.state}`)} tone={e.state === 'expired' ? 'danger' : e.state === 'soon' ? 'warning' : 'neutral'} />
              </View>
              {d.validUntil ? <Text style={styles.muted}>{t('store.exp.validUntil')}: {String(d.validUntil)}</Text> : null}
              {e.state === 'expired' ? <Text style={styles.muted}>{t('store.exp.expiredHelp', { days: String(Math.abs(e.days)) })}</Text> : null}
              {e.state === 'soon' ? <Text style={styles.muted}>{t('store.exp.soonHelp', { days: String(e.days) })}</Text> : null}
            </Card>
          );
        })}
        <Text style={styles.muted}>{t('store.exp.note')}</Text>
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  label: { fontSize: font.size.xs, color: color.ink500 },
  value: { fontSize: font.size.sm, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[2] },
  section: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, marginTop: space[4] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space[2] },
});
