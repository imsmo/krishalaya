// apps/mobile/src/app/(farmer)/profile/documents.tsx · screen 122 "Documents Wallet". Thin screen (guide §3): a
// wallet hero (REAL on-file count + encrypted note), an Identity section (the caller's KYC documents — MASKED
// doc-no + verification status, never a raw Aadhaar/PAN), and a Banking section (linked payout destinations,
// masked). FLAG_SECURE while shown. Behind `farmer_profile`. Degrade-never-die. Manage deep-links to the KYC flow.
// §13 gaps (no contract → rendered honestly, never faked):
//  • The "8 of 12 documents · 67%" completeness ring needs a REQUIRED-doc-set contract that doesn't exist → we show
//    the real on-file count only; the completeness target/percentage is flagged coming-soon, never a fake 67%.
//  • Doc TYPE names ("Aadhaar Card", "PAN Card", "Profile Photo") are uuids (docTypeId) → a generic "Identity
//    document" label + the real masked number, never an asserted type.
//  • LAND documents (7/12 Utara, 8-A Patrak) and the Kisan Credit Card have no document contract → a coming-soon
//    block, never fabricated rows.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { KycDocument, KycStatus, BankAccount } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius, type PillTone } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { myDocuments, myBankAccounts } from '../../../features/profile/profile.api';
import { bankLabel } from '../../../features/profile/profile';

const TONE: Record<KycStatus, PillTone> = { pending: 'warning', verified: 'success', rejected: 'danger', expired: 'neutral' };

export default function Documents() {
  useSecureScreen();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('farmer_profile');
  const kycEnabled = useFlag('kyc');
  const [docs, setDocs] = useState<KycDocument[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, b] = await Promise.all([myDocuments(), myBankAccounts()]);
    setDocs(d); setBanks(b); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) load(); else setLoading(false); }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('profile.documents')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const onFile = docs.length + banks.length;

  return (
    <ScreenScaffold title={t('profile.documents')}>
      {loading ? <SkeletonCard lines={8} /> : (
        <ScrollView contentContainerStyle={{ paddingBottom: space[6] }} showsVerticalScrollIndicator={false}>
          {/* Wallet hero */}
          <View style={styles.hero}>
            <Text style={styles.heroIcon}>🗂</Text>
            <Text style={styles.heroTitle}>{t('profile.docs.walletTitle')}</Text>
            <Text style={styles.heroSub}>{t('profile.docs.count', { n: onFile })} · {t('profile.docs.encrypted')}</Text>
            <Text style={styles.heroNote}>{t('profile.docs.completenessSoon')}</Text>
          </View>

          {/* Identity (KYC) */}
          <Text style={styles.section}>{t('profile.docs.identityTitle')}</Text>
          {docs.length === 0 ? (
            <Card><Text style={styles.muted}>{t('profile.docs.empty.message')}</Text></Card>
          ) : docs.map((item) => (
            <Card key={item.id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.icon}>🪪</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.docName}>{t('profile.docs.identityDoc')}</Text>
                  <Text style={styles.meta}>{item.docNoMasked ?? item.id.slice(0, 8)}</Text>
                </View>
                <StatusPill label={t(`kyc.status.${item.status}`, { defaultValue: item.status })} tone={TONE[item.status] ?? 'neutral'} />
              </View>
              {item.status === 'rejected' && item.rejectReason ? <Text style={styles.reason}>{item.rejectReason}</Text> : null}
            </Card>
          ))}

          {/* Banking */}
          {banks.length ? <Text style={styles.section}>{t('profile.docs.bankingTitle')}</Text> : null}
          {banks.map((b) => (
            <Card key={b.id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.icon}>🏦</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.docName}>{bankLabel(b)}</Text>
                  {b.holderName ? <Text style={styles.meta}>{b.holderName}</Text> : null}
                </View>
                <StatusPill label={t('profile.bank.default')} tone="success" />
              </View>
            </Card>
          ))}

          {/* Land documents — §13: no land-doc contract */}
          <Text style={styles.section}>{t('profile.docs.landTitle')}</Text>
          <Card><Text style={styles.muted}>{t('profile.docs.landSoon')}</Text></Card>

          {kycEnabled ? <View style={{ marginTop: space[4] }}><Button title={t('profile.docs.manage')} variant="outline" onPress={() => router.push('/(farmer)/kyc')} /></View> : null}
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', backgroundColor: color.primary50, borderRadius: radius.lg, padding: space[4], marginBottom: space[3] },
  heroIcon: { fontSize: 34 },
  heroTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900, marginTop: space[1] },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[1] },
  heroNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[1] },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[4], marginBottom: space[2] },
  card: { marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  icon: { fontSize: 22, width: 28, textAlign: 'center' },
  docName: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  meta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 1 },
  reason: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[2] },
  muted: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
});
