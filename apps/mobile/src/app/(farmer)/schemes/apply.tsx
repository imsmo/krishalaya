// apps/mobile/src/app/(farmer)/schemes/apply.tsx · screens 106+108 "Apply: <scheme>". A 3-step wizard (guide §3):
//  1) Your details — personal + land form (name pre-filled from the KV profile; the rest the farmer confirms),
//     client-validated (Aadhaar 12-digit, mobile, PIN — server re-validates). 2) Documents — upload each required
//     supporting doc (core/media P-01: pick → EXIF-drop/downscale → presign → PUT → confirm). 3) Review — a summary
//     (Aadhaar shown masked, §4) + consent → apply (idempotent draft, Law 3) + submit. FLAG_SECURE the whole flow.
//  Behind `schemes_govt`. Degrade-never-die.
// §13 / §4 notes (honest, never faked):
//  • "Auto-filled from your KV profile" — only the display NAME is on the profile contract; Aadhaar / father / DOB /
//    address have no auto-fill endpoint → those fields start empty (farmer fills them), flagged, never invented PII.
//  • The Aadhaar number is kept only in component state, shown MASKED (last-4) on review, and travels solely inside
//    the apply formData the SERVER stores — never logged / clipboard'd / sent to analytics (§4).
//  • The design's pre-VERIFIED doc rows (Aadhaar ✓ / Bank ••••2247 ✓), the auto SELF-DECLARATION, doc filenames/
//    sizes, and the "SMS me the talati office" help have no contract → shown as honest notes / coming-soon, never
//    a fabricated verification or filename. Doc-type names aren't exposed (UUIDs) → "Document N".
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, Input, Toggle, AddMediaTile, UploadTile, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useAuth } from '../../../core/auth/auth.store';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { captureFromCamera, pickFromGallery } from '../../../core/media';
import { uploadSchemeDocument, applyToScheme, submitApplication } from '../../../features/schemes/schemes.api';
import { docChecklist, allDocsUploaded, buildApplyDraft, buildSchemeDetailsDraft, onlyDigits, SCHEME_CATEGORIES, type DetailsForm } from '../../../features/schemes/schemes';

const GENDERS = ['male', 'female', 'other'] as const;
const TOTAL_STEPS = 3;

export default function SchemeApply() {
  useSecureScreen();
  const { id, docs } = useLocalSearchParams<{ id: string; docs?: string }>();
  const { t } = useTranslation();
  const { state } = useAuth();
  const router = useRouter();
  const enabled = useFlag('schemes_govt');
  const requiredDocTypeIds = useMemo(() => (docs ? docs.split(',').filter(Boolean) : []), [docs]);

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<DetailsForm>({ fullName: state.profile?.displayName ?? '' });
  const [land, setLand] = useState({ surveyNo: '', areaAcres: '' });
  const [missing, setMissing] = useState<string[]>([]);
  const [uploaded, setUploaded] = useState<Record<string, string>>({});
  const [busyDoc, setBusyDoc] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const set = (k: keyof DetailsForm, v: string) => setForm((p) => ({ ...p, [k]: v }));

  if (!enabled) return <ScreenScaffold title={t('schemes.apply.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;
  if (!id) return <ScreenScaffold title={t('schemes.apply.title')}><EmptyState title={t('schemes.unavailable')} /></ScreenScaffold>;

  const mErr = (field: string) => (missing.includes(field) ? t('schemes.apply.required') : undefined);

  const continueFromDetails = () => {
    const draft = buildSchemeDetailsDraft(form);
    if (!draft.ok) { setMissing(draft.missing ?? []); return; }
    setMissing([]); setStep(2);
  };

  const attach = (docTypeId: string) => {
    Alert.alert(t('schemes.docs.add'), undefined, [
      { text: t('schemes.docs.camera'), onPress: () => runUpload(docTypeId, captureFromCamera) },
      { text: t('schemes.docs.gallery'), onPress: () => runUpload(docTypeId, pickFromGallery) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };
  const runUpload = useCallback(async (docTypeId: string, pick: () => Promise<any>) => {
    setBusyDoc(docTypeId);
    try {
      const picked = await pick();
      if (!picked) return;
      const mediaId = await uploadSchemeDocument(picked);
      if (mediaId) setUploaded((prev) => ({ ...prev, [docTypeId]: mediaId }));
      else Alert.alert(t('schemes.apply.title'), t('schemes.docs.uploadFailed'));
    } finally { setBusyDoc(null); }
  }, [t]);

  const buildDetails = () => {
    const d = buildSchemeDetailsDraft(form);
    const base = d.ok ? d.details! : {};
    const landDetails: Record<string, string> = {};
    if (land.surveyNo.trim()) landDetails.surveyNo = land.surveyNo.trim();
    if (land.areaAcres.trim()) landDetails.areaAcres = land.areaAcres.trim();
    return Object.keys(landDetails).length ? { ...base, landDetails } : base;
  };

  const saveDraft = async () => {
    try { await applyToScheme({ schemeId: id, formData: buildDetails() }); Alert.alert(t('schemes.apply.title'), t('schemes.apply.draftSaved')); }
    catch { Alert.alert(t('schemes.apply.title'), t('schemes.apply.failed')); }
  };

  const submit = async () => {
    const draft = buildApplyDraft({ schemeId: id, requiredDocTypeIds, uploaded, consent, details: buildDetails() });
    if (!draft.ok || !draft.input) {
      Alert.alert(t('schemes.apply.title'), t(draft.reason === 'consent' ? 'schemes.apply.needConsent' : draft.reason === 'documents' ? 'schemes.apply.needDocs' : 'common.error.generic'));
      return;
    }
    setSubmitting(true);
    try {
      const app = await applyToScheme(draft.input);
      await submitApplication(app.id);
      router.replace({ pathname: '/(farmer)/schemes/status', params: { id: app.id } });
    } catch { Alert.alert(t('schemes.apply.title'), t('schemes.apply.failed')); }
    finally { setSubmitting(false); }
  };

  const checklist = docChecklist(requiredDocTypeIds, uploaded);
  const aadhaarLast4 = onlyDigits(form.aadhaar).slice(-4);

  return (
    <ScreenScaffold title={t('schemes.apply.title')}>
      <ScrollView contentContainerStyle={{ paddingBottom: space[6] }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.step}>{t('schemes.apply.stepOf', { n: step, total: TOTAL_STEPS })}</Text>

        {step === 1 ? (
          <>
            <Card>
              <Text style={styles.h}>{t('schemes.apply.detailsTitle')}</Text>
              <Text style={styles.note}>{t('schemes.apply.detailsNote')}</Text>
              <Text style={styles.autofill}>✨ {t('schemes.apply.autofill')}</Text>
              <Input label={t('schemes.apply.field.fullName') + ' *'} value={form.fullName ?? ''} onChangeText={(v) => set('fullName', v)} error={mErr('fullName')} />
              <Input label={t('schemes.apply.field.aadhaar') + ' *'} value={form.aadhaar ?? ''} onChangeText={(v) => set('aadhaar', v)} keyboardType="number-pad" maxLength={14} error={mErr('aadhaar')} />
              <Input label={t('schemes.apply.field.mobile') + ' *'} value={form.mobile ?? ''} onChangeText={(v) => set('mobile', v)} keyboardType="phone-pad" maxLength={15} error={mErr('mobile')} />
              <Input label={t('schemes.apply.field.fatherName') + ' *'} value={form.fatherName ?? ''} onChangeText={(v) => set('fatherName', v)} error={mErr('fatherName')} />
              <Input label={t('schemes.apply.field.dob') + ' *'} value={form.dob ?? ''} onChangeText={(v) => set('dob', v)} placeholder={t('schemes.apply.dobHint')} error={mErr('dob')} />

              <Text style={styles.fieldLabel}>{t('schemes.apply.field.category')} *</Text>
              <View style={styles.chips}>
                {SCHEME_CATEGORIES.map((c) => {
                  const on = (form.category ?? '') === c;
                  return <Pressable key={c} onPress={() => set('category', c)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}><Text style={[styles.chipText, on && styles.chipTextOn]}>{t(`schemes.apply.category.${c}`)}</Text></Pressable>;
                })}
              </View>
              {missing.includes('category') ? <Text style={styles.err}>{t('schemes.apply.required')}</Text> : null}

              <Text style={styles.fieldLabel}>{t('schemes.apply.field.gender')} *</Text>
              <View style={styles.chips}>
                {GENDERS.map((g) => {
                  const on = (form.gender ?? '') === g;
                  return <Pressable key={g} onPress={() => set('gender', g)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}><Text style={[styles.chipText, on && styles.chipTextOn]}>{t(`schemes.gender.${g}`)}</Text></Pressable>;
                })}
              </View>
              {missing.includes('gender') ? <Text style={styles.err}>{t('schemes.apply.required')}</Text> : null}
            </Card>

            <Card style={styles.section}>
              <Text style={styles.h}>{t('schemes.apply.addressTitle')}</Text>
              <Input label={t('schemes.apply.field.village') + ' *'} value={form.village ?? ''} onChangeText={(v) => set('village', v)} error={mErr('village')} />
              <Input label={t('schemes.apply.field.taluka') + ' *'} value={form.taluka ?? ''} onChangeText={(v) => set('taluka', v)} error={mErr('taluka')} />
              <Input label={t('schemes.apply.field.district') + ' *'} value={form.district ?? ''} onChangeText={(v) => set('district', v)} error={mErr('district')} />
              <Input label={t('schemes.apply.field.state') + ' *'} value={form.state ?? ''} onChangeText={(v) => set('state', v)} error={mErr('state')} />
              <Input label={t('schemes.apply.field.pincode') + ' *'} value={form.pincode ?? ''} onChangeText={(v) => set('pincode', v)} keyboardType="number-pad" maxLength={6} error={mErr('pincode')} />
            </Card>

            <Card style={styles.section}>
              <Text style={styles.h}>{t('schemes.apply.landTitle')}</Text>
              <Text style={styles.note}>{t('schemes.apply.landNote')}</Text>
              <Input label={t('schemes.apply.field.surveyNo')} value={land.surveyNo} onChangeText={(v) => setLand((p) => ({ ...p, surveyNo: v }))} />
              <Input label={t('schemes.apply.field.areaAcres')} value={land.areaAcres} onChangeText={(v) => setLand((p) => ({ ...p, areaAcres: v }))} keyboardType="decimal-pad" maxLength={7} />
            </Card>

            <View style={styles.actions}>
              <View style={{ flex: 1 }}><Button title={t('schemes.apply.saveDraft')} variant="outline" onPress={saveDraft} /></View>
              <View style={{ flex: 1 }}><Button title={t('schemes.apply.continueDocs')} onPress={continueFromDetails} /></View>
            </View>
          </>
        ) : step === 2 ? (
          <>
            <Card>
              <Text style={styles.h}>{t('schemes.apply.docsTitle')}</Text>
              {checklist.length === 0 ? <Text style={styles.note}>{t('schemes.docs.none')}</Text> : checklist.map((d) => (
                <View key={d.docTypeId} style={styles.docRow}>
                  <Text style={styles.docLabel}>{t('schemes.docs.item', { n: d.index + 1 })}</Text>
                  {d.mediaId ? (
                    <UploadTile uri={''} status="done" removeLabel={t('schemes.docs.remove')} onRemove={() => setUploaded((p) => { const n = { ...p }; delete n[d.docTypeId]; return n; })} size={64} />
                  ) : (
                    <AddMediaTile label={busyDoc === d.docTypeId ? t('schemes.docs.uploading') : t('schemes.docs.takePhoto')} onPress={() => attach(d.docTypeId)} disabled={busyDoc === d.docTypeId} size={64} />
                  )}
                </View>
              ))}
              <Text style={styles.note}>{t('schemes.apply.preVerifiedNote')}</Text>
            </Card>

            {/* Self-declaration — §13: no generator/e-sign contract */}
            <Card style={styles.section}>
              <View style={styles.declRow}>
                <Text style={styles.declIcon}>✍️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.declTitle}>{t('schemes.apply.selfDecl.title')}</Text>
                  <Text style={styles.note}>{t('schemes.apply.selfDecl.note')}</Text>
                </View>
              </View>
            </Card>

            {/* No 7/12? help — §13: SMS-office feature not live */}
            <Card style={styles.help}>
              <Text style={styles.helpTitle}>💡 {t('schemes.apply.no712.title')}</Text>
              <Text style={styles.helpBody}>{t('schemes.apply.no712.body')}</Text>
            </Card>

            <View style={styles.actions}>
              <View style={{ flex: 1 }}><Button title={t('common.back')} variant="outline" onPress={() => setStep(1)} /></View>
              <View style={{ flex: 1 }}><Button title={t('schemes.apply.continueReview')} onPress={() => setStep(3)} /></View>
            </View>
          </>
        ) : (
          <>
            <Card>
              <Text style={styles.h}>{t('schemes.apply.reviewTitle')}</Text>
              <Review k={t('schemes.apply.field.fullName')} v={form.fullName ?? '—'} />
              <Review k={t('schemes.apply.field.aadhaar')} v={aadhaarLast4 ? t('schemes.apply.aadhaarMasked', { last4: aadhaarLast4 }) : '—'} />
              <Review k={t('schemes.apply.field.category')} v={form.category ? t(`schemes.apply.category.${form.category}`) : '—'} />
              <Review k={t('schemes.apply.field.gender')} v={form.gender ? t(`schemes.gender.${form.gender}`) : '—'} />
              <Review k={t('schemes.apply.field.village')} v={[form.village, form.district].filter(Boolean).join(', ') || '—'} />
              <Review k={t('schemes.docs.title')} v={t('schemes.apply.docsCount', { n: Object.keys(uploaded).length, total: requiredDocTypeIds.length })} />
            </Card>
            <Card style={styles.section}>
              <Toggle label={t('schemes.apply.consent')} hint={t('schemes.apply.consentHint')} value={consent} onValueChange={setConsent} />
            </Card>
            <View style={styles.actions}>
              <View style={{ flex: 1 }}><Button title={t('common.back')} variant="outline" onPress={() => setStep(2)} /></View>
              <View style={{ flex: 1 }}><Button title={t('schemes.apply.submit')} loading={submitting} disabled={!consent || !allDocsUploaded(requiredDocTypeIds, uploaded)} onPress={submit} /></View>
            </View>
          </>
        )}
      </ScrollView>
    </ScreenScaffold>
  );
}

function Review({ k, v }: { k: string; v: string }) {
  return <View style={styles.reviewRow}><Text style={styles.reviewK}>{k}</Text><Text style={styles.reviewV}>{v}</Text></View>;
}

const styles = StyleSheet.create({
  step: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700, marginBottom: space[2] },
  h: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink900, marginBottom: space[2] },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[2] },
  autofill: { fontFamily: font.body, fontSize: font.size.xs, color: color.primary700, marginBottom: space[2] },
  fieldLabel: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700, marginTop: space[2], marginBottom: space[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  chipTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
  err: { fontFamily: font.body, fontSize: font.size.xs, color: color.danger, marginTop: space[1] },
  section: { marginTop: space[3] },
  docRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[2] },
  docLabel: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700, flex: 1 },
  declRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  declIcon: { fontSize: 24 },
  declTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  help: { marginTop: space[3], backgroundColor: color.primary50 },
  helpTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, marginBottom: space[1] },
  helpBody: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: space[3], marginTop: space[4] },
  reviewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.ink100 },
  reviewK: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, flex: 1 },
  reviewV: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, flex: 1, textAlign: 'right' },
});
