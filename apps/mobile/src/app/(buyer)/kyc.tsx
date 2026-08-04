// apps/mobile/src/app/(buyer)/kyc.tsx · screen 133 (Business KYC · details + documents). Thin screen (guide §3):
// the buyer declares their business identity (type + legal name + GSTIN/PAN) AND uploads proof documents. The
// business-KYC submission (P0-5) is now a REAL contract: submitBusinessKyc sends the raw GSTIN/PAN ONCE, the SERVER
// validates + MASKS them and stores only the masked forms (DPDP §4) — the read (businessKycStatus) returns masked
// values + a review status. Document uploads (media → submitKyc) and the doc-type catalogue are real too. Raw doc
// NUMBERS for the uploaded images are never sent (photo + server verification only). FLAG_SECURE. Behind `kyc`.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import type { KycDocument, KycDocType, KycStatus, UserProfile, BusinessKycStatus, BusinessType } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius, type PillTone } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useSecureScreen } from '../../core/security/screen-guard';
import { getMyProfile, updateMyProfile } from '../../features/profile/profile.api';
import { listKyc, kycDocTypes, submitKyc, businessKycStatus, submitBusinessKyc } from '../../features/kyc/kyc.api';
import { kycStatusFor, BUSINESS_TYPES, canSubmitBusinessKyc, isValidGstin, isValidPan } from '../../features/kyc/kyc';
import { pickFromGallery } from '../../core/media/picker';
import { uploadPickedImage } from '../../core/media/uploader';

const TONE: Record<KycStatus, PillTone> = { pending: 'warning', verified: 'success', rejected: 'danger', expired: 'neutral' };
const BIZ_TONE: Record<string, PillTone> = { pending: 'warning', verified: 'success', rejected: 'danger', expired: 'neutral', none: 'neutral' };

export default function BusinessKyc() {
  useSecureScreen();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('kyc');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType | ''>('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [biz, setBiz] = useState<BusinessKycStatus | null>(null);
  const [types, setTypes] = useState<KycDocType[]>([]);
  const [docs, setDocs] = useState<KycDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyType, setBusyType] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reloadDocs = useCallback(async () => { setDocs(await listKyc()); }, []);
  const load = useCallback(async () => {
    setLoading(true);
    const [p, b, tt] = await Promise.all([getMyProfile(), businessKycStatus(), kycDocTypes()]);
    setProfile(p); setName(p?.displayName ?? '');
    setBiz(b);
    if (b.businessType) setBusinessType(b.businessType);
    setTypes(tt);
    await reloadDocs();
    setLoading(false);
  }, [reloadDocs]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('businessKyc.title')}><EmptyState title={t('kyc.unavailable')} /></ScreenScaffold>;

  const upload = async (docTypeId: string) => {
    const picked = await pickFromGallery();
    if (!picked) return;
    setBusyType(docTypeId);
    try {
      const res = await uploadPickedImage(picked);
      if (res.mediaId) { await submitKyc({ docTypeId, mediaId: res.mediaId }); await reloadDocs(); }
      else Alert.alert(t('businessKyc.uploadQueued'));
    } catch { Alert.alert(t('businessKyc.uploadFailed')); }
    finally { setBusyType(null); }
  };

  const canSubmit = canSubmitBusinessKyc({ businessType, legalName: name, pan, gstin });
  const gstinErr = gstin.trim().length > 0 && !isValidGstin(gstin) ? t('businessKyc.invalidGstin') : undefined;
  const panErr = pan.trim().length > 0 && !isValidPan(pan) ? t('businessKyc.invalidPan') : undefined;

  const onContinue = async () => {
    setSaving(true);
    try {
      // Persist the business-KYC contract (server masks GSTIN/PAN); also keep the profile display name in sync.
      const updated = await submitBusinessKyc({ businessType: businessType as BusinessType, legalName: name.trim(), pan: pan.trim().toUpperCase(), gstin: gstin.trim() ? gstin.trim().toUpperCase() : undefined });
      setBiz(updated); setGstin(''); setPan('');
      if (name.trim() && name.trim() !== (profile?.displayName ?? '')) await updateMyProfile({ fullName: name.trim() });
      Alert.alert(t('businessKyc.title'), t('businessKyc.submitted'));
      router.back();
    } catch { Alert.alert(t('businessKyc.title'), t('businessKyc.submitFailed')); }
    finally { setSaving(false); }
  };

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('common.back')} variant="outline" onPress={() => router.back()} />
      <View style={{ flex: 1 }}><Button title={t('businessKyc.continue')} onPress={onContinue} loading={saving} disabled={!canSubmit} fullWidth /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('businessKyc.title')} footer={footer}>
      {/* Step 2 of 3 */}
      <View style={styles.progress}>
        <View style={styles.bar}>
          <View style={[styles.seg, styles.segDone]} />
          <View style={[styles.seg, styles.segCurrent]} />
          <View style={[styles.seg, styles.segPending]} />
        </View>
        <View style={styles.progressRow}><Text style={styles.step}>{t('businessKyc.step')}</Text><Text style={styles.stepLabel}>{t('businessKyc.stepName')}</Text></View>
      </View>

      {loading ? <View style={{ marginTop: space[4] }}><SkeletonCard lines={3} /><SkeletonCard lines={4} /></View> : (
        <>
          <View style={styles.why}><Text style={styles.whyText}><Text style={styles.whyBold}>{t('businessKyc.whyTitle')} </Text>{t('businessKyc.whyBody')}</Text></View>

          <View style={styles.h3Row}>
            <Text style={styles.h3}>{t('businessKyc.businessProof')}</Text>
            {biz && biz.status !== 'none' ? <StatusPill label={t(`businessKyc.status.${biz.status}`)} tone={BIZ_TONE[biz.status] ?? 'neutral'} /> : null}
          </View>
          {biz && biz.status === 'rejected' && biz.rejectReason ? <Card style={styles.rejectCard}><Text style={styles.rejectText}>{biz.rejectReason}</Text></Card> : null}

          <Input label={t('businessKyc.businessName')} value={name} onChangeText={setName} maxLength={120} />

          {/* Business type — a real controlled vocabulary (mirrors the server CHECK). */}
          <Text style={styles.fieldLabel}>{t('businessKyc.businessType')}</Text>
          <View style={styles.chips}>
            {BUSINESS_TYPES.map((bt) => (
              <Pressable key={bt} onPress={() => setBusinessType(bt)} style={[styles.chip, businessType === bt && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: businessType === bt }}>
                <Text style={[styles.chipTxt, businessType === bt && styles.chipTxtOn]}>{t(`businessKyc.type.${bt}`)}</Text>
              </Pressable>
            ))}
          </View>

          <Input label={t('businessKyc.pan')} value={pan} onChangeText={(v) => setPan(v.toUpperCase())} autoCapitalize="characters" maxLength={10} placeholder="ABCDE1234F" error={panErr} />
          <Input label={t('businessKyc.gstin')} value={gstin} onChangeText={(v) => setGstin(v.toUpperCase())} autoCapitalize="characters" maxLength={15} placeholder="27ABCDE1234F1Z5" error={gstinErr} />
          <Text style={styles.note}>{t('businessKyc.gstinOptional')}</Text>
          {biz && (biz.gstinMasked || biz.panMasked) ? (
            <Card style={{ marginTop: space[2] }}>
              {biz.panMasked ? <Text style={styles.onFile}>{t('businessKyc.panOnFile', { v: biz.panMasked })}</Text> : null}
              {biz.gstinMasked ? <Text style={styles.onFile}>{t('businessKyc.gstinOnFile', { v: biz.gstinMasked })}</Text> : null}
            </Card>
          ) : null}

          <Text style={styles.h3}>{t('businessKyc.documents')}</Text>
          {types.length === 0 ? (
            <Card><Text style={styles.note}>{t('businessKyc.noTypes')}</Text></Card>
          ) : types.map((dt) => {
            const status = kycStatusFor(docs, dt.id);
            return (
              <Card key={dt.id} style={styles.doc}>
                <View style={styles.docRow}>
                  <Text style={styles.docName}>{dt.name}</Text>
                  {status ? <StatusPill label={t(`kyc.status.${status}`)} tone={TONE[status] ?? 'neutral'} /> : null}
                </View>
                {!status || status === 'rejected' ? (
                  <View style={{ marginTop: space[2] }}>
                    <Button title={t('businessKyc.upload')} variant="outline" size="sm" onPress={() => upload(dt.id)} loading={busyType === dt.id} />
                  </View>
                ) : null}
              </Card>
            );
          })}
        </>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  progress: { paddingBottom: space[3], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  bar: { flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 4, borderRadius: 2 },
  segDone: { backgroundColor: color.success },
  segCurrent: { backgroundColor: color.primary600 },
  segPending: { backgroundColor: color.earth200 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] },
  step: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink600 },
  stepLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  why: { marginTop: space[4], padding: space[3], borderRadius: radius.md, backgroundColor: color.infoLight },
  whyText: { fontFamily: font.body, fontSize: font.size.xs, color: color.infoDark, lineHeight: font.size.xs * 1.5 },
  whyBold: { fontWeight: font.weight.bold },
  h3Row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[4], marginBottom: space[2] },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  fieldLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, fontWeight: font.weight.semibold, marginTop: space[3], marginBottom: space[2] },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, lineHeight: font.size.xs * 1.5, marginTop: space[1] },
  onFile: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, fontWeight: font.weight.semibold },
  rejectCard: { backgroundColor: color.dangerLight, marginBottom: space[2] },
  rejectText: { fontFamily: font.body, fontSize: font.size.xs, color: color.danger },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { paddingVertical: space[1], paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.earth200, backgroundColor: color.card, minHeight: 36, justifyContent: 'center' },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  chipTxtOn: { color: color.primary700 },
  doc: { marginBottom: space[2] },
  docRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  docName: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
