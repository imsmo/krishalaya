// apps/mobile/src/app/(worker)/claim.tsx · screen 146 (File Insurance Claim — worker). Thin screen (guide §3): pick
// a claim type, enter incident details, see the required-document checklist, then submit. Behind `worker_app`.
// FLAG_SECURE (medical/incident + PII). Money via MoneyText where shown. Degrade-never-die.
//
// DEV-24 (KV-BL-055): `POST /v1/insurance/claims` is REAL (DEV-23) — this screen now requires a real, ACTIVE
// (on-cover) PMSBY policy before showing the claim form (the API itself only accepts claims against an active
// policy; showing the form to someone with no cover would just 409 at submit, so this screen checks first and
// degrades to an honest "enrol first" EmptyState instead). Document upload rides the EXISTING media socket
// (`core/media`'s `uploadPickedImage`, the SAME primitive `orders/pod.tsx`'s proof-of-delivery photo uses) — no
// new upload primitive. Submit is a REAL, online, direct `fileClaim()` call (Law 6: throws visibly, never queued).
// FIR/incident status fields still have no server-side status of their own (§13, unchanged) — the FIR document
// slot stays a plain optional-upload row, never an invented "filed at ... PS" status line.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, ScreenScaffold, SkeletonCard, UploadTile, color, font, space, radius, type UploadStatus } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useSecureScreen } from '../../core/security/screen-guard';
import { captureFromCamera, pickFromGallery, uploadPickedImage, type PickedImage } from '../../core/media';
import { CLAIM_TYPES, CLAIM_DOCS, CLAIM_EVENT_CODE, normalizeClaimText, canSubmitClaim, type ClaimTypeKey, type ClaimDocKey } from '../../features/labour/insurance-claim';
import { findPmsbyProduct, myPmsbyPolicy, fileClaim, type InsurancePolicyView } from '../../features/insurance/insurance.api';

type DocUpload = { uri: string; status: UploadStatus; progress: number; mediaId?: string };

export default function FileClaim() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_app');
  useSecureScreen();
  const [policy, setPolicy] = useState<InsurancePolicyView | null>(null);
  const [loadingPolicy, setLoadingPolicy] = useState(true);
  const [type, setType] = useState<ClaimTypeKey | null>(null);
  const [date, setDate] = useState('');
  const [place, setPlace] = useState('');
  const [what, setWhat] = useState('');
  const [docs, setDocs] = useState<Partial<Record<ClaimDocKey, DocUpload>>>({});
  const [submitting, setSubmitting] = useState(false);

  const loadPolicy = useCallback(async () => {
    setLoadingPolicy(true);
    try {
      const product = await findPmsbyProduct();
      const p = product ? await myPmsbyPolicy(product.id) : null;
      setPolicy(p && p.status === 'active' ? p : null);
    } finally {
      setLoadingPolicy(false);
    }
  }, []);
  useEffect(() => { if (enabled) loadPolicy(); }, [enabled, loadPolicy]);

  if (!enabled) return <ScreenScaffold title={t('insuranceClaim.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const addDoc = async (key: ClaimDocKey, pick: () => Promise<PickedImage | null>) => {
    const picked = await pick();
    if (!picked) return;
    setDocs((d) => ({ ...d, [key]: { uri: picked.uri, status: 'uploading', progress: 0 } }));
    try {
      const res = await uploadPickedImage(picked, { onProgress: (f) => setDocs((d) => (d[key] ? { ...d, [key]: { ...d[key]!, progress: f } } : d)) });
      setDocs((d) => (d[key] ? { ...d, [key]: { ...d[key]!, status: res.queued ? 'queued' : 'done', mediaId: res.mediaId ?? undefined } } : d));
    } catch {
      setDocs((d) => (d[key] ? { ...d, [key]: { ...d[key]!, status: 'failed' } } : d));
    }
  };
  const pickSource = (key: ClaimDocKey) => Alert.alert(t('createListing.photoSource'), undefined, [
    { text: t('createListing.camera'), onPress: () => addDoc(key, captureFromCamera) },
    { text: t('createListing.gallery'), onPress: () => addDoc(key, pickFromGallery) },
    { text: t('common.cancel'), style: 'cancel' },
  ]);

  const soon = (title: string) => Alert.alert(title, t('insuranceClaim.comingSoon'));
  const canSubmit = !!policy && canSubmitClaim(type, date, what) && !submitting;

  /** REAL submit (Law 6: online, direct, never queued). Throws surface as a friendly, specific alert. */
  const submit = async () => {
    if (!policy || !type || !canSubmitClaim(type, date, what) || submitting) return;
    setSubmitting(true);
    try {
      // The DTO carries no separate "place" field (CreateInsuranceClaimSchema: policyId/eventDate/eventTypeCode/
      // description/evidenceMediaIds only) — fold the collected place into the free-text description rather than
      // silently dropping what the worker typed (never invent a schema field; never discard captured input either).
      const normalizedWhat = normalizeClaimText(what) ?? '';
      const normalizedPlace = place.trim();
      const description = (normalizedPlace ? `${normalizedWhat} — ${normalizedPlace}` : normalizedWhat) || undefined;
      const evidenceMediaIds = Object.values(docs).map((d) => d?.mediaId).filter((id): id is string => !!id);
      await fileClaim({ policyId: policy.id, eventDate: date, eventTypeCode: CLAIM_EVENT_CODE[type], description, evidenceMediaIds: evidenceMediaIds.length ? evidenceMediaIds : undefined });
      router.replace({ pathname: '/(worker)/insurance', params: { notice: t('insuranceClaim.submittedNotice') } });
    } catch (e) {
      Alert.alert(
        t('insuranceClaim.title'),
        e instanceof SdkError && e.status === 409 ? t('insuranceClaim.notOnCover') : t('insuranceClaim.submitFailed'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const footer = policy ? (
    <View style={styles.footerRow}>
      <Button title={t('insuranceClaim.saveDraft')} variant="outline" onPress={() => soon(t('insuranceClaim.saveDraft'))} disabled={submitting} />
      <View style={{ flex: 1 }}>
        <Button title={submitting ? t('insuranceClaim.submitting') : t('insuranceClaim.submit')} onPress={submit} loading={submitting} disabled={!canSubmit} fullWidth />
      </View>
    </View>
  ) : undefined;

  if (loadingPolicy) {
    return <ScreenScaffold title={t('insuranceClaim.title')}><SkeletonCard lines={6} /></ScreenScaffold>;
  }
  if (!policy) {
    return (
      <ScreenScaffold title={t('insuranceClaim.title')}>
        <EmptyState
          title={t('insuranceClaim.noPolicy.title')}
          message={t('insuranceClaim.noPolicy.message')}
          actionLabel={t('insuranceClaim.noPolicy.action')}
          onAction={() => router.push('/(worker)/pmsby-enroll')}
        />
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold title={t('insuranceClaim.title')} scroll={false} footer={footer}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[3] }}>
        {/* Policy header — DEV-24: the caller's OWN real, active PMSBY policy (gated above) */}
        <View style={styles.policy}>
          <Text style={styles.policyTitle}>{t('insuranceClaim.yourPmsby')}</Text>
          <Text style={styles.policyNote}>{t('insuranceClaim.coveredUntil', { date: policy.validUntil })}</Text>
        </View>

        {/* Claim type */}
        <Text style={styles.section}>{t('insuranceClaim.whatType')}</Text>
        {CLAIM_TYPES.map((c) => {
          const on = type === c.key;
          return (
            <Pressable key={c.key} onPress={() => setType(c.key)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[styles.typeRow, on && styles.typeOn]}>
              <Text style={styles.typeIcon}>{c.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.typeTitle, on && styles.typeTitleOn]}>{t(`insuranceClaim.type.${c.key}.title`)}</Text>
                <Text style={styles.typeSub}>{t(`insuranceClaim.type.${c.key}.sub`)}</Text>
              </View>
              {on ? <Text style={styles.tick}>✓</Text> : null}
            </Pressable>
          );
        })}

        {/* Incident details */}
        <Text style={styles.section}>{t('insuranceClaim.incidentDetails')}</Text>
        <Card>
          <Input label={t('insuranceClaim.dateOfIncident')} value={date} onChangeText={setDate} placeholder={t('insuranceClaim.datePh')} maxLength={10} />
          <View style={{ marginTop: space[3] }}>
            <Input label={t('insuranceClaim.place')} value={place} onChangeText={setPlace} placeholder={t('insuranceClaim.placePh')} maxLength={120} />
          </View>
          <View style={{ marginTop: space[3] }}>
            <Input label={t('insuranceClaim.whatHappened')} value={what} onChangeText={setWhat} placeholder={t('insuranceClaim.whatPh')} multiline maxLength={2000} />
          </View>
        </Card>

        {/* Documents needed */}
        <Text style={styles.section}>{t('insuranceClaim.documentsNeeded')}</Text>
        <Card>
          {CLAIM_DOCS.map((d, i) => {
            const up = docs[d.key];
            return (
              <View key={d.key} style={[styles.docRow, i > 0 && styles.divide]}>
                <Text style={styles.docIcon}>{d.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.docTitle}>{t(`insuranceClaim.doc.${d.key}.title`)}{d.required ? ' *' : ''}</Text>
                  <Text style={styles.docSub}>{t(`insuranceClaim.doc.${d.key}.sub`)}</Text>
                </View>
                {up ? (
                  <UploadTile
                    uri={up.uri} status={up.status} progress={up.progress}
                    queuedLabel={t('common.offline')} retryLabel={t('common.retry')} removeLabel={t('common.cancel')}
                    onRemove={() => setDocs((cur) => { const next = { ...cur }; delete next[d.key]; return next; })}
                    onRetry={() => setDocs((cur) => { const next = { ...cur }; delete next[d.key]; return next; })}
                  />
                ) : (
                  <Pressable onPress={() => pickSource(d.key)} accessibilityRole="button" style={styles.uploadBtn}>
                    <Text style={styles.uploadTxt}>📷 {t('insuranceClaim.upload')}</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </Card>

        {/* After-submission note — fixed program info */}
        <View style={styles.after}>
          <Text style={styles.afterTxt}>{t('insuranceClaim.afterNote')}</Text>
        </View>
      </ScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  policy: { backgroundColor: color.primary50, borderRadius: radius.lg, padding: space[3] },
  policyTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.primary700 },
  policyNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, marginTop: 2 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[2], marginBottom: space[1] },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  typeOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  typeIcon: { fontSize: 24, width: 34, textAlign: 'center' },
  typeTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  typeTitleOn: { color: color.primary700 },
  typeSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  tick: { fontSize: 18, color: color.primary700, fontWeight: '700' },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  divide: { borderTopWidth: 1, borderTopColor: color.ink100 },
  docIcon: { fontSize: 22, width: 30, textAlign: 'center' },
  docTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  docSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  uploadBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.md, borderWidth: 1.5, borderColor: color.primary300 },
  uploadTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.primary700 },
  after: { backgroundColor: color.successLight, borderRadius: radius.lg, padding: space[3] },
  afterTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, lineHeight: font.size.xs * 1.5 },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
