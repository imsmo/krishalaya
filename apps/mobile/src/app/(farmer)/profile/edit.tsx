// apps/mobile/src/app/(farmer)/profile/edit.tsx · screen 119 "Edit Profile". Thin screen (guide §3): edit the
// caller's own name / app-language / email (PATCH /users/me — only CHANGED fields sent via buildProfilePatch).
// Behind `farmer_profile`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, read-only/disabled, NEVER wired to a fake write):
//  • Profile photo / "Change photo" — no avatar contract on the profile read-model → disabled + coming-soon.
//  • Separate "Display name", WhatsApp number, and Bio — the profile carries a single displayName + locale only,
//    no display-name/whatsapp/bio fields → shown disabled with a coming-soon note, never saved as a fake value.
//  • Mobile — changed only via the secure change-phone flow (not a free profile edit) → read-only here.
//  • Village / Taluka / District — the profile has no address; location lives on the farmer's parcels/region →
//    a note links to Farm details. Editing them here would be a fake write.
//  • "Languages spoken" (multi) — the profile stores ONE locale (the app language). We expose that real single
//    choice; a multi-language-spoken store doesn't exist yet.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { LANGUAGES } from '@krishalaya/i18n';
import { Button, Card, Input, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getMyProfile, updateMyProfile } from '../../../features/profile/profile.api';
import { buildProfilePatch, initials } from '../../../features/profile/profile';

export default function EditProfile() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('farmer_profile');
  const [fullName, setFullName] = useState('');
  const [languageCode, setLanguageCode] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    const p = await getMyProfile();
    if (p) { setFullName(p.displayName ?? ''); setLanguageCode(p.locale ?? ''); }
    setLoading(false);
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('profile.editProfile')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const save = async () => {
    const draft = buildProfilePatch({ fullName, languageCode, email });
    if (!draft.ok || !draft.patch) { setError(t(draft.reason === 'email' ? 'profile.edit.emailInvalid' : draft.reason === 'empty' ? 'profile.edit.noChanges' : 'common.error.generic')); return; }
    setSaving(true); setError(undefined);
    try { await updateMyProfile(draft.patch); router.back(); }
    catch { Alert.alert(t('profile.editProfile'), t('profile.edit.failed')); }
    finally { setSaving(false); }
  };

  return (
    <ScreenScaffold title={t('profile.editProfile')}>
      {loading ? <SkeletonCard lines={8} /> : (
        <>
          {/* Avatar + change photo (§13: no avatar contract) */}
          <View style={styles.photoRow}>
            <View style={styles.avatar}><Text style={styles.avatarTxt}>{initials(fullName)}</Text></View>
            <Pressable disabled accessibilityRole="button" style={styles.photoBtn}><Text style={styles.photoBtnTxt}>{t('profile.edit.changePhoto')}</Text></Pressable>
            <Text style={styles.soonInline}>{t('common.comingSoon')}</Text>
          </View>

          {/* Basic info */}
          <Text style={styles.section}>{t('profile.edit.basicInfo')}</Text>
          <Card>
            <Input label={t('profile.edit.name') + ' *'} value={fullName} onChangeText={setFullName} maxLength={200} />
            <ReadOnly label={t('profile.edit.displayName')} />
            <ReadOnly label={t('profile.edit.mobile')} note={t('profile.edit.mobileManaged')} />
            <ReadOnly label={t('profile.edit.whatsapp')} />
            <Input label={t('profile.edit.emailOptional')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" maxLength={200} error={error} />
          </Card>

          {/* Location — §13: profile has no address; lives on parcels */}
          <Text style={styles.section}>{t('profile.edit.location')}</Text>
          <Card>
            <ReadOnly label={t('profile.edit.village') + ' *'} note={t('profile.edit.locationManaged')} />
            <ReadOnly label={t('profile.edit.taluka')} />
            <ReadOnly label={t('profile.edit.district')} />
            <Pressable onPress={() => router.push('/(farmer)/profile/farm')} accessibilityRole="button" style={styles.linkRow}><Text style={styles.link}>{t('profile.farmDetails')} →</Text></Pressable>
          </Card>

          {/* App language (real, single locale) */}
          <Text style={styles.section}>{t('profile.edit.languages')}</Text>
          <View style={styles.chips}>
            {LANGUAGES.map((l) => {
              const on = l.code === languageCode;
              return <Pressable key={l.code} onPress={() => setLanguageCode(l.code)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}><Text style={[styles.chipText, on && styles.chipTextOn]}>{l.nameNative}{on ? ' ✓' : ''}</Text></Pressable>;
            })}
          </View>

          {/* Bio — §13: no bio contract */}
          <Text style={styles.section}>{t('profile.edit.about')}</Text>
          <Card>
            <Input label={t('profile.edit.bio')} value={''} editable={false} multiline placeholder={t('profile.edit.bioSoon')} />
            <Text style={styles.soon}>{t('common.comingSoon')}</Text>
          </Card>

          <View style={styles.actions}>
            <View style={{ flex: 1 }}><Button title={t('common.cancel')} variant="outline" onPress={() => router.back()} /></View>
            <View style={{ flex: 1 }}><Button title={t('profile.edit.save')} loading={saving} onPress={save} /></View>
          </View>
        </>
      )}
    </ScreenScaffold>
  );
}

function ReadOnly({ label, note }: { label: string; note?: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.roRow}>
      <Text style={styles.roLabel}>{label}</Text>
      <Text style={styles.roNote}>{note ?? t('common.comingSoon')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  photoRow: { alignItems: 'center', gap: space[2], paddingVertical: space[3] },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: color.primary600, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.white },
  photoBtn: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, opacity: 0.5 },
  photoBtnTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600 },
  soonInline: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[4], marginBottom: space[2] },
  roRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, borderBottomWidth: 1, borderBottomColor: color.ink100 },
  roLabel: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600 },
  roNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  linkRow: { minHeight: 44, justifyContent: 'center' },
  link: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary700 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { paddingHorizontal: space[4], minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600 },
  chipTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
  soon: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[1] },
  actions: { flexDirection: 'row', gap: space[3], marginTop: space[5] },
});
