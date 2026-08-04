// apps/mobile/src/app/(farmer)/kyc/upload.tsx · screen 174 (Upload Document — KYC doc photo). Thin screen (guide §3):
// capture/pick a photo of a specific KYC document, then upload (core/media, idempotent) + submit as a KYC document
// (submitKyc, Law 3). The target doc-type arrives by `docTypeId` param (from the docs list); its NAME is resolved
// from the seeded catalogue. FLAG_SECURE (KYC + camera surface, §4). Behind the `kyc` flag. Degrade-never-die:
// skeleton while the catalogue loads; missing/unknown doc-type → designed EmptyState back to the docs flow;
// capture cancel/denied is a no-op; upload/submit failure → friendly inline error; offline → queued note.
//
// §13 (NOT faked): the heading is the REAL doc-type name from the catalogue (e.g. "7/12 Utara"). The design's
// per-document instruction ("Land record from talati office — must show name, survey number, and area") is
// doc-type-specific guidance the KycDocType contract (id/code/name only) does NOT carry → we show a GENERIC "clear
// photo" instruction, never a fabricated per-type description. The photo-tips + "blurry rejected" note are fixed
// chrome. Quality/readability/OCR checks are the SERVER's authority (Law 11) — the app never asserts acceptance.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import type { KycDocType } from '@krishalaya/sdk-js';
import { Button, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { captureFromCamera, pickFromGallery, uploadPickedImage } from '../../../core/media';
import { kycDocTypes, submitKyc } from '../../../features/kyc/kyc.api';
import { resolveDocType } from '../../../features/kyc/doc-upload';

const TIPS = ['light', 'flat', 'above', 'corners'] as const;

export default function UploadDocument() {
  useSecureScreen();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('kyc');
  const { docTypeId } = useLocalSearchParams<{ docTypeId?: string }>();
  const [docType, setDocType] = useState<KycDocType | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    setDocType(resolveDocType(await kycDocTypes(), docTypeId));
    setLoading(false);
  }, [docTypeId]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('kycUpload.title')}><EmptyState title={t('kyc.unavailable')} /></ScreenScaffold>;
  if (loading) return <ScreenScaffold title={t('kycUpload.title')}><SkeletonCard lines={3} /><SkeletonCard lines={4} /></ScreenScaffold>;
  // §13: no resolvable target doc-type → don't submit under a guess; send the user back to pick one.
  if (!docType) return <ScreenScaffold title={t('kycUpload.title')}><EmptyState title={t('kycUpload.noType')} actionLabel={t('kycUpload.chooseType')} onAction={() => router.replace('/(farmer)/kyc')} /></ScreenScaffold>;

  const submit = async (pick: () => Promise<import('../../../core/media').PickedImage | null>) => {
    setError(undefined);
    const picked = await pick();
    if (!picked) return; // cancelled / denied — no-op
    setBusy(true);
    try {
      const up = await uploadPickedImage(picked);
      if (!up.mediaId) { setError(t('kycUpload.queued')); return; } // offline-queued — submit once it uploads
      await submitKyc({ docTypeId: docType.id, mediaId: up.mediaId }); // server verifies/OCRs (Law 11)
      router.replace('/(farmer)/kyc');
    } catch {
      setError(t('kycUpload.failed'));
    } finally { setBusy(false); }
  };

  return (
    <ScreenScaffold title={t('kycUpload.title')} scroll={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4] }}>
        <Text style={styles.heading}>{t('kycUpload.photoOf', { name: docType.name })}</Text>
        {/* §13: generic instruction — the contract has no per-doc-type description. */}
        <Text style={styles.desc}>{t('kycUpload.genericInstruction')}</Text>

        {/* Align guide */}
        <View style={styles.frame}><Text style={styles.frameGlyph}>🪪</Text></View>
        <Text style={styles.alignHint}>{t('kycUpload.alignHint')}</Text>

        {/* Capture actions */}
        <View style={styles.actions}>
          <View style={{ flex: 1 }}><Button title={t('kycUpload.takePhoto')} onPress={() => submit(captureFromCamera)} loading={busy} disabled={busy} fullWidth /></View>
          <View style={{ flex: 1 }}><Button title={t('kycUpload.fromGallery')} variant="outline" onPress={() => submit(pickFromGallery)} disabled={busy} fullWidth /></View>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Tips */}
        <Text style={styles.tipsTitle}>{t('kycUpload.tipsTitle')}</Text>
        <View style={styles.tips}>
          {TIPS.map((k) => (
            <View key={k} style={styles.tipRow}>
              <Text style={styles.tipIcon}>{t(`kycUpload.tip.${k}.icon`)}</Text>
              <Text style={styles.tipTxt}>{t(`kycUpload.tip.${k}.text`)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.warn}>
          <Text style={styles.warnIcon}>⚠️</Text>
          <Text style={styles.warnTxt}>{t('kycUpload.blurryNote')}</Text>
        </View>
      </ScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, marginTop: space[2] },
  desc: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[1], lineHeight: font.size.sm * 1.5 },
  frame: { height: 200, borderRadius: radius.lg, borderWidth: 2, borderColor: color.primary300, borderStyle: 'dashed', backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center', marginTop: space[4] },
  frameGlyph: { fontSize: 64 },
  alignHint: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, textAlign: 'center', marginTop: space[2] },
  actions: { flexDirection: 'row', gap: space[3], marginTop: space[4] },
  error: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[3], textAlign: 'center' },
  tipsTitle: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[5], marginBottom: space[2] },
  tips: { gap: space[2] },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  tipIcon: { fontSize: font.size.md },
  tipTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink700 },
  warn: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], marginTop: space[4], padding: space[3], borderRadius: radius.md, backgroundColor: color.warningLight },
  warnIcon: { fontSize: 16 },
  warnTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.xs, color: color.warningDark, lineHeight: font.size.xs * 1.5 },
});
