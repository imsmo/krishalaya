// apps/mobile/src/app/(auth)/profile.tsx · screen 05 (Set Up Profile) — rebuilt to match the Phase-1 design
// (Krishalaya_Design_System/screens/05-profile-setup.html): a header with "Set Up Your Profile" + a "Skip"
// action, a subtitle, a dashed circular photo-upload with a camera edit badge, the form (Full Name*, Village /
// Location* with "Detect via GPS", Pincode, Farm Size, UPI ID + helper), a "Your data is safe" consent card, and
// two footer CTAs (Save Draft / Save & Continue).
// Writes are REAL where a contract exists (name+photo → PATCH /users/me; UPI → bank-accounts add) and the
// village/pincode/farm-size/GPS extras are persisted locally + flagged (no server contract yet — never faked).
// See features/onboarding/profile-setup.api.ts. Thin screen (guide §3); tokens-only; i18n(hi/en/gu); ≥48px targets.
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button, Input, SegmentedControl, Icon, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useAuth } from '../../core/auth/auth.store';
import { captureFromCamera, pickFromGallery, type PickedImage } from '../../core/media';
import { getCurrentFix } from '../../core/location';
import { FARM_SIZES, EMPTY_SETUP_FORM, type ProfileSetupForm, type FarmSize } from '../../features/onboarding/profile-setup';
import { submitProfileSetup, saveDraft } from '../../features/onboarding/profile-setup.api';
import { homeRouteFor } from '../../core/auth/role-switcher';

export default function ProfileSetup() {
  const router = useRouter();
  const { t } = useTranslation();
  const { state, loadProfile } = useAuth();

  const [form, setForm] = useState<ProfileSetupForm>(EMPTY_SETUP_FORM);
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [gpsState, setGpsState] = useState<'idle' | 'busy' | 'ok' | 'denied'>('idle');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);

  const set = <K extends keyof ProfileSetupForm>(k: K, v: ProfileSetupForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const choosePhoto = () => {
    const attach = async (pick: () => Promise<PickedImage | null>) => {
      try { const p = await pick(); if (p) setPicked(p); } catch { /* picker cancelled/denied — Law 12 */ }
    };
    Alert.alert(t('setup.addPhoto'), undefined, [
      { text: t('createListing.camera'), onPress: () => attach(captureFromCamera) },
      { text: t('createListing.gallery'), onPress: () => attach(pickFromGallery) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const detectGps = async () => {
    setGpsState('busy');
    const r = await getCurrentFix();
    if (r.ok && r.fix) { set('gps', { lat: r.fix.lat, lng: r.fix.lng }); setGpsState('ok'); }
    else setGpsState('denied');
  };

  // The role picker (screen 04) already granted + set the ACTIVE role server-side/locally before landing here —
  // route to THAT role's home (not a hardcoded farmer home), so a self-serve buyer grant doesn't strand the
  // caller on the farmer dashboard. Falls back to farmer when no active role is known yet (defensive).
  const goHome = async () => { await loadProfile(); router.replace(homeRouteFor(state.activeRole) as never); };

  const onSaveDraft = async () => {
    if (draftBusy) return;
    setDraftBusy(true);
    try { await saveDraft(form); await goHome(); } finally { setDraftBusy(false); }
  };

  const onSaveContinue = async () => {
    if (busy) return;
    setBusy(true); setError(undefined);
    try {
      const res = await submitProfileSetup(form, picked);
      if (res === 'invalid') { setError(t('setup.nameRequired')); return; }
      await goHome();
    } catch (e) {
      console.error('[profile-setup] submit failed:', JSON.stringify({ message: (e as any)?.message, code: (e as any)?.code, status: (e as any)?.status }));
      setError(t('setup.saveFailed'));
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header: title + Skip */}
      <View style={styles.header}>
        <Text style={styles.title}>{t('setup.title')}</Text>
        <Pressable onPress={goHome} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('setup.skip')}>
          <Text style={styles.skip}>{t('setup.skip')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>{t('setup.subtitle')}</Text>

        {/* Photo upload */}
        <View style={styles.photoWrap}>
          <Pressable onPress={choosePhoto} style={styles.photo} accessibilityRole="button" accessibilityLabel={t('setup.addPhoto')}>
            {picked ? (
              <Image source={{ uri: picked.uri }} style={styles.photoImg} />
            ) : (
              <>
                <Icon name="camera" size={30} color={color.primary700} />
                <Text style={styles.photoLabel}>{t('setup.addPhoto')}</Text>
              </>
            )}
            <View style={styles.photoEdit}><Icon name="camera" size={16} color={color.white} /></View>
          </Pressable>
        </View>

        {/* Full name */}
        <View style={styles.field}>
          <Text style={styles.label}>{t('setup.fullName')} <Text style={styles.req}>*</Text></Text>
          <Input value={form.fullName} onChangeText={(v) => set('fullName', v)} placeholder={t('setup.fullNamePlaceholder')} maxLength={200} error={error === t('setup.nameRequired') ? error : undefined} />
        </View>

        {/* Village / location + GPS */}
        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>{t('setup.village')} <Text style={styles.req}>*</Text></Text>
            <Pressable onPress={detectGps} style={styles.gpsBtn} accessibilityRole="button" accessibilityLabel={t('setup.detectGps')}>
              <Icon name="location" size={13} color={color.primary700} />
              <Text style={styles.gpsBtnText}>{gpsState === 'busy' ? t('setup.gpsBusy') : t('setup.detectGps')}</Text>
            </Pressable>
          </View>
          <Input value={form.village} onChangeText={(v) => set('village', v)} placeholder={t('setup.villagePlaceholder')} maxLength={120} />
          {gpsState === 'ok' ? <Text style={styles.gpsOk}>{t('setup.gpsCaptured')}</Text> : null}
          {gpsState === 'denied' ? <Text style={styles.gpsDenied}>{t('setup.gpsDenied')}</Text> : null}
        </View>

        {/* Pincode */}
        <View style={styles.field}>
          <Text style={styles.label}>{t('setup.pincode')}</Text>
          <Input value={form.pincode} onChangeText={(v) => set('pincode', v.replace(/[^0-9]/g, ''))} placeholder={t('setup.pincodePlaceholder')} keyboardType="number-pad" maxLength={6} />
        </View>

        {/* Farm size */}
        <View style={styles.field}>
          <Text style={styles.label}>{t('setup.farmSize')}</Text>
          <SegmentedControl
            layout="stack"
            value={form.farmSize}
            onChange={(v) => set('farmSize', v as FarmSize)}
            accessibilityLabel={t('setup.farmSize')}
            options={FARM_SIZES.map((s) => ({ value: s, label: t(`setup.farmSize.${s}`) }))}
          />
        </View>

        {/* UPI */}
        <View style={styles.field}>
          <Text style={styles.label}>{t('setup.upiId')} <Text style={styles.helper}>{t('setup.upiHint')}</Text></Text>
          <Input value={form.upiId} onChangeText={(v) => set('upiId', v)} placeholder={t('setup.upiPlaceholder')} maxLength={257} />
        </View>

        {/* Consent */}
        <View style={styles.consent}>
          <Icon name="shield" size={22} color={color.primary600} />
          <View style={{ flex: 1 }}>
            <Text style={styles.consentTitle}>{t('setup.safeTitle')}</Text>
            <Text style={styles.consentBody}>{t('setup.safeBody')}</Text>
          </View>
        </View>

        {error ? <Text style={styles.formError}>{error}</Text> : null}
      </ScrollView>

      {/* Footer CTAs */}
      <View style={styles.footer}>
        <View style={{ flex: 1 }}>
          <Button title={t('setup.saveDraft')} variant="outline" size="lg" onPress={onSaveDraft} loading={draftBusy} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title={t('setup.saveContinue')} size="lg" onPress={onSaveContinue} loading={busy} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], paddingTop: space[3], paddingBottom: space[1] },
  title: { fontFamily: font.display, fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: color.ink800, letterSpacing: -0.3 },
  skip: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary700 },

  scroll: { paddingHorizontal: space[5], paddingBottom: space[6] },
  subtitle: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500, marginTop: space[1] },

  photoWrap: { alignItems: 'center', paddingVertical: space[5] },
  photo: { width: 120, height: 120, borderRadius: 60, backgroundColor: color.earth100, borderWidth: 3, borderStyle: 'dashed', borderColor: color.primary300, alignItems: 'center', justifyContent: 'center', gap: space[1] },
  photoImg: { width: 120, height: 120, borderRadius: 60 },
  photoLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.primary700 },
  photoEdit: { position: 'absolute', bottom: 0, right: 4, width: 36, height: 36, borderRadius: 18, backgroundColor: color.primary600, borderWidth: 3, borderColor: color.page, alignItems: 'center', justifyContent: 'center' },

  field: { marginTop: space[4] },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700, marginBottom: space[1] },
  req: { color: color.danger },
  helper: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.regular, color: color.ink400 },

  gpsBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 10, backgroundColor: color.primary50, borderWidth: 1, borderColor: color.primary200, borderRadius: radius.pill },
  gpsBtnText: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.primary700 },
  gpsOk: { fontFamily: font.body, fontSize: font.size.xs, color: color.primary700, marginTop: space[1] },
  gpsDenied: { fontFamily: font.body, fontSize: font.size.xs, color: color.dangerDark, marginTop: space[1] },

  consent: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[5], padding: space[4], backgroundColor: color.primary50, borderRadius: radius.md },
  consentTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  consentBody: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2, lineHeight: 18 },

  formError: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[3], textAlign: 'center' },

  footer: { flexDirection: 'row', gap: space[3], paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[4], borderTopWidth: 1, borderTopColor: color.ink100, backgroundColor: color.card },
});
