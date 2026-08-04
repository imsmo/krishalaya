// apps/mobile/src/app/(farmer)/kyc/selfie.tsx · screen 173 (Verify with Selfie — KYC liveness, step 3 of 3). Thin
// screen (guide §3): the capture-guidance UI (face-circle + checklist + privacy note), then "Take Selfie" →
// captureFromCamera → upload (core/media, idempotent) → submit as a KYC DOCUMENT (submitKyc, Law 3). FLAG_SECURE
// (KYC + camera surface, §4). Behind the `kyc` flag. Degrade-never-die: skeleton while the doc-type catalogue
// loads; capture cancel/denied is a no-op; upload/submit failure → friendly inline error.
//
// §13 (NOT faked): the design promises "we'll match this with your Aadhaar photo · 5 seconds" — a liveness +
// FACE-MATCH provider capability. There is NO mobile liveness/face-match contract; the app must NEVER assert a
// match (Law 11 — the server/provider is the authority). So we capture + upload the selfie as a KYC document and
// let the server verify; we never show a fake "match ✓". The selfie is filed under a seeded selfie/photo doc-type
// (selfieDocType) — if the catalogue has none, we honestly degrade (disabled capture + note), never file it under a
// wrong type. All guidance/checklist/privacy copy is fixed chrome. "Not stored permanently" is the server's policy.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import type { KycDocType } from '@krishalaya/sdk-js';
import { Button, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { captureFromCamera, uploadPickedImage } from '../../../core/media';
import { kycDocTypes, submitKyc } from '../../../features/kyc/kyc.api';
import { selfieDocType } from '../../../features/kyc/selfie';

const TIPS = ['lighting', 'noCover', 'lookAt', 'smile'] as const;

export default function VerifySelfie() {
  useSecureScreen();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('kyc');
  const [docType, setDocType] = useState<KycDocType | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    setDocType(selfieDocType(await kycDocTypes()));
    setLoading(false);
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('kycSelfie.title')}><EmptyState title={t('kyc.unavailable')} /></ScreenScaffold>;

  const onCapture = async () => {
    if (!docType) return;
    setError(undefined);
    const picked = await captureFromCamera();
    if (!picked) return; // cancelled / permission denied — no-op (JIT prompt already shown)
    setBusy(true);
    try {
      const up = await uploadPickedImage(picked);
      if (!up.mediaId) { setError(t('kycSelfie.queued')); return; } // offline-queued — can't submit until it uploads
      await submitKyc({ docTypeId: docType.id, mediaId: up.mediaId }); // server runs liveness + face-match (Law 11)
      router.replace('/(farmer)/kyc');
    } catch {
      setError(t('kycSelfie.failed'));
    } finally { setBusy(false); }
  };

  if (loading) return <ScreenScaffold title={t('kycSelfie.title')}><SkeletonCard lines={3} /><SkeletonCard lines={5} /></ScreenScaffold>;

  // §13: no selfie doc-type in the catalogue → honest degrade (never file under a wrong type).
  const canCapture = !!docType;
  const footer = (
    <Button title={t('kycSelfie.take')} onPress={onCapture} loading={busy} disabled={!canCapture} accessibilityLabel={t('kycSelfie.take')} />
  );

  return (
    <ScreenScaffold title={t('kycSelfie.title')} scroll={false} footer={footer}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4] }}>
        <View style={styles.head}>
          <Text style={styles.step}>{t('kycSelfie.step')}</Text>
          <Text style={styles.heading}>{t('kycSelfie.heading')}</Text>
        </View>

        {/* Live-selfie framing guide */}
        <View style={styles.circleWrap}>
          <View style={styles.circle}><Text style={styles.circleGlyph}>🤳</Text></View>
          <View style={styles.livePill}><Text style={styles.livePillTxt}>{t('kycSelfie.livePill')}</Text></View>
          <Text style={styles.centerHint}>{t('kycSelfie.centerFace')}</Text>
        </View>

        <Text style={styles.take}>{t('kycSelfie.takeTitle')}</Text>
        <Text style={styles.takeSub}>{t('kycSelfie.takeSub')}</Text>

        {/* Checklist */}
        <View style={styles.tips}>
          {TIPS.map((k) => (
            <View key={k} style={styles.tipRow}>
              <Text style={styles.tipCheck}>✓</Text>
              <Text style={styles.tipTxt}>{t(`kycSelfie.tip.${k}`)}</Text>
            </View>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!canCapture ? <Text style={styles.note}>{t('kycSelfie.unavailableSoon')}</Text> : null}

        {/* Privacy note */}
        <View style={styles.safe}>
          <Text style={styles.safeIcon}>🔒</Text>
          <Text style={styles.safeTxt}>{t('kycSelfie.privacy')}</Text>
        </View>
      </ScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: space[2] },
  step: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.primary700, textTransform: 'uppercase', letterSpacing: 0.5 },
  heading: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, marginTop: 2 },
  circleWrap: { alignItems: 'center', marginTop: space[4], gap: space[2] },
  circle: { width: 176, height: 176, borderRadius: 88, backgroundColor: color.primary50, borderWidth: 2, borderColor: color.primary300, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  circleGlyph: { fontSize: 72 },
  livePill: { backgroundColor: color.dangerLight, borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 10 },
  livePillTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.dangerDark },
  centerHint: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  take: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, textAlign: 'center', marginTop: space[4] },
  takeSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, textAlign: 'center', marginTop: space[1] },
  tips: { marginTop: space[4], gap: space[2] },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  tipCheck: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.successDark },
  tipTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink700 },
  error: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[3], textAlign: 'center' },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[3], textAlign: 'center' },
  safe: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], marginTop: space[4], padding: space[3], borderRadius: radius.md, backgroundColor: color.successLight },
  safeIcon: { fontSize: 16 },
  safeTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.xs, color: color.successDark, lineHeight: font.size.xs * 1.5 },
});
