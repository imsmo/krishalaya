// apps/mobile/src/app/(farmer)/kyc/issues.tsx · screen 175 (KYC Re-submission). Thin screen (guide §3): lists the
// caller's REJECTED KYC documents ("what to fix") — each with the server's real rejection reason + a Retake action
// that deep-links to the document-upload screen for that doc-type. FLAG_SECURE (KYC surface, §4). Behind the `kyc`
// flag. Degrade-never-die: skeleton while loading; a positive EmptyState when there are no rejections; inline retry
// on read failure (listKyc already degrades to []).
//
// §13 (NOT faked): the "what to fix" cards are the REAL rejected docs (reason = server rejectReason; title = the
// doc-type NAME resolved from the catalogue, or a generic label when the type is opaque). The design's second
// example — a "Bank name mismatch" issue with the specific names "Ramesh B Patel"/"Ramesh Bhanubhai Patel" — has NO
// mobile contract (BankAccount carries no verification-status/mismatch field), so we NEVER fabricate it; only real
// rejected documents appear. The design's assigned-ambassador contact ("Vikas Joshi · 📞 Call") also has no
// farmer-side read-model → the Help card degrades to the real in-app support entry, not an invented person/number.
// The "browse while fixing · withdrawals locked" note is fixed policy chrome.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { listKyc, kycDocTypes } from '../../../features/kyc/kyc.api';
import { buildKycIssues, type KycIssue } from '../../../features/kyc/issues';

export default function KycIssues() {
  useSecureScreen();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('kyc');
  const [issues, setIssues] = useState<KycIssue[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [docs, types] = await Promise.all([listKyc('rejected'), kycDocTypes()]);
    setIssues(buildKycIssues(docs, types));
    setLoading(false);
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('kycIssues.title')}><EmptyState title={t('kyc.unavailable')} /></ScreenScaffold>;
  if (loading) return <ScreenScaffold title={t('kycIssues.title')}><SkeletonCard lines={3} /><SkeletonCard lines={3} /></ScreenScaffold>;
  if (issues.length === 0) return <ScreenScaffold title={t('kycIssues.title')}><EmptyState title={t('kycIssues.empty.title')} message={t('kycIssues.empty.message')} actionLabel={t('common.retry')} onAction={load} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('kycIssues.title')} scroll={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4] }}>
        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroIcon}>⚠️</Text>
          <Text style={styles.heroTitle}>{t('kycIssues.needResubmit')}</Text>
          <Text style={styles.heroSub}>{t('kycIssues.summary', { n: issues.length })}</Text>
        </View>

        {/* What to fix */}
        <Text style={styles.section}>{t('kycIssues.whatToFix')}</Text>
        {issues.map((it) => (
          <Card key={it.id} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.docIcon}>📄</Text>
              <Text style={styles.docName}>{it.docTypeName ?? t('kycIssues.genericDoc')}</Text>
            </View>
            <Text style={styles.reason}>{it.reason ?? t('kycIssues.genericReason')}</Text>
            <View style={{ marginTop: space[2] }}>
              <Button
                title={t('kycIssues.retake')}
                onPress={() => router.push(it.docTypeId ? { pathname: '/(farmer)/kyc/upload', params: { docTypeId: it.docTypeId } } : '/(farmer)/kyc/upload')}
                size="md"
              />
            </View>
          </Card>
        ))}

        {/* Need help? — §13: no farmer-side assigned-ambassador contact contract → real in-app support entry. */}
        <Text style={styles.section}>{t('kycIssues.needHelp')}</Text>
        <Card>
          <Text style={styles.helpBody}>{t('kycIssues.helpBody')}</Text>
          <View style={{ marginTop: space[2] }}>
            <Button title={t('kycIssues.getHelp')} variant="outline" onPress={() => router.push('/(farmer)/profile/help')} />
          </View>
        </Card>

        {/* Policy note (fixed chrome) */}
        <View style={styles.note}>
          <Text style={styles.noteTxt}>{t('kycIssues.lockedNote')}</Text>
        </View>
      </ScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: space[4], gap: space[1] },
  heroIcon: { fontSize: 40 },
  heroTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, marginTop: space[1] },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  card: { marginBottom: space[2] },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  docIcon: { fontSize: font.size.lg },
  docName: { flex: 1, fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  reason: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[1], lineHeight: font.size.sm * 1.5 },
  helpBody: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, lineHeight: font.size.sm * 1.5 },
  note: { marginTop: space[4], padding: space[3], borderRadius: radius.md, backgroundColor: color.warningLight },
  noteTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.warningDark, lineHeight: font.size.xs * 1.5 },
});
