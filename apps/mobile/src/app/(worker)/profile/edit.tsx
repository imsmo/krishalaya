// apps/mobile/src/app/(worker)/profile/edit.tsx · screen 136 (Edit Profile — worker). Thin screen (guide §3): edit
// the worker's identity profile (name, gender, primary language → users.updateMe) AND labour prefs (home village,
// travel radius, daily rate → labour.updateWorker) via the PURE buildWorkerProfileEdit split. Money is bigint paise
// (Law 2). Behind `worker_app`. Degrade-never-die. (The read-only profile dashboard is screen 38 at profile.tsx.)
//
// §13 — REAL: name (displayName), home village (lookups.regions), travel km, daily rate (paise) and the primary
// language all persist via the two real endpoints. HONESTLY degraded (NEVER faked — no contract field): AGE (the
// contract has `dob`, not an age — we never fabricate a dob from an age), the ABOUT-ME intro, the multi-language
// SPEAK list (only the primary maps to the account languageCode), the profile PHOTO (media-upload flow not wired
// here), and the "local market range ₹350-500 · fair range" hint (no labour wage-range read) — each is rendered for
// design parity but marked not-yet-saved, never a fabricated value.
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { WorkerProfile, UserProfile, LabourLookups } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getMyWorker, updateWorker, labourLookups } from '../../../features/labour/labour.api';
import { getMyProfile, updateMyProfile } from '../../../features/profile/profile.api';
import { buildWorkerProfileEdit, toggleLanguage, GENDERS, LANGUAGE_CODES, type Gender, type LanguageCode, type WorkerEditField } from '../../../features/labour/worker-edit';

export default function WorkerProfileEdit() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_app');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<WorkerEditField[]>([]);

  // form state
  const [fullName, setFullName] = useState('');
  const [age, setAge] = useState('');            // no contract field (dob only) → captured, not persisted (§13)
  const [gender, setGender] = useState<Gender | ''>('');
  const [languages, setLanguages] = useState<LanguageCode[]>([]);
  const [villageRegionId, setVillage] = useState('');
  const [travelKm, setTravelKm] = useState('');
  const [dailyRate, setDailyRate] = useState('');
  const [about, setAbout] = useState('');         // no contract field → captured, not persisted (§13)
  const [discoverable, setDiscoverable] = useState(false);   // P0-2 consent: show my name/rating to employers

  const load = useCallback(async () => {
    setLoading(true);
    const [p, w, lk] = await Promise.all([getMyProfile(), getMyWorker(), labourLookups()]);
    setProfile(p); setWorker(w); setLookups(lk);
    if (p?.displayName) setFullName(p.displayName);
    if (p?.locale && (LANGUAGE_CODES as readonly string[]).includes(p.locale)) setLanguages([p.locale as LanguageCode]);
    if (w) {
      setVillage(w.villageRegionId ?? '');
      setTravelKm(w.travelKm != null ? String(w.travelKm) : '');
      try { setDailyRate(w.minWageExpectationMinor ? String(BigInt(w.minWageExpectationMinor) / 100n) : ''); } catch { /* leave blank */ }
      setDiscoverable(!!w.discoverable);
    }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) load(); }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('workerEdit.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const save = async () => {
    const draft = buildWorkerProfileEdit({ fullName, gender, languages, villageRegionId, travelKm, dailyRateRupees: dailyRate });
    setErrors(draft.errors);
    if (!draft.ok) return;
    setBusy(true);
    try {
      await Promise.all([updateMyProfile(draft.profilePatch), updateWorker({ ...draft.workerPatch, discoverable })]);
      router.back();
    } catch { Alert.alert(t('workerEdit.saveFailed'), t('common.error.generic')); }
    finally { setBusy(false); }
  };

  const initials = (fullName || profile?.displayName || '').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '👤';
  const regions = lookups?.regions ?? [];
  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('common.cancel')} variant="outline" disabled={busy} onPress={() => router.back()} />
      <View style={{ flex: 1 }}><Button title={t('common.save')} onPress={save} loading={busy} fullWidth /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('workerEdit.title')} scroll={false} footer={footer}>
      {loading ? (
        <View style={{ gap: space[3] }}><SkeletonCard lines={4} /><SkeletonCard lines={5} /><SkeletonCard lines={4} /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[8], gap: space[3] }}>
          {/* Avatar + change photo (media upload not wired here → honest note) */}
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}><Text style={styles.avatarTxt}>{initials}</Text></View>
            <Pressable onPress={() => Alert.alert(t('workerEdit.photoTitle'), t('workerEdit.photoSoon'))} accessibilityRole="button">
              <Text style={styles.changePhoto}>{t('workerEdit.changePhoto')}</Text>
            </Pressable>
          </View>

          {/* Basic info */}
          <Card>
            <Text style={styles.section}>{t('workerEdit.basic')}</Text>
            <Input label={t('workerEdit.fullName')} value={fullName} onChangeText={setFullName} maxLength={80} error={errors.includes('name') ? t('workerEdit.err.name') : undefined} />
            <Input label={t('workerEdit.mobile')} value={t('workerEdit.mobileManaged')} onChangeText={() => {}} editable={false} />
            <Input label={t('workerEdit.age')} value={age} onChangeText={setAge} keyboardType="number-pad" maxLength={3} />
            <Text style={styles.fieldLabel}>{t('workerEdit.gender')}</Text>
            <View style={styles.chips}>
              {GENDERS.map((g) => {
                const on = gender === g;
                return (
                  <Pressable key={g} onPress={() => setGender(g)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(`workerEdit.gender.${g}`)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          {/* Languages */}
          <Card>
            <Text style={styles.section}>{t('workerEdit.languages')}</Text>
            <View style={styles.chips}>
              {LANGUAGE_CODES.map((code) => {
                const on = languages.includes(code);
                return (
                  <Pressable key={code} onPress={() => setLanguages((cur) => toggleLanguage(cur, code))} style={[styles.chip, on && styles.chipOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(`workerEdit.lang.${code}`)}{on ? ' ✓' : ''}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.hint}>{t('workerEdit.langHint')}</Text>
          </Card>

          {/* Location & work area */}
          <Card>
            <Text style={styles.section}>{t('workerEdit.location')}</Text>
            <Text style={styles.fieldLabel}>{t('workerEdit.homeVillage')}</Text>
            {regions.length === 0 ? <Text style={styles.hint}>{t('workerEdit.regionsUnavailable')}</Text> : (
              <View style={styles.chips}>
                {regions.map((r) => {
                  const on = villageRegionId === r.id;
                  return (
                    <Pressable key={r.id} onPress={() => setVillage(r.id)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{r.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {errors.includes('village') ? <Text style={styles.errText}>{t('workerEdit.err.village')}</Text> : null}
            <Input label={t('workerEdit.travelKm')} value={travelKm} onChangeText={setTravelKm} keyboardType="number-pad" maxLength={4} error={errors.includes('travelKm') ? t('workerEdit.err.travelKm') : undefined} />
            <View style={styles.rateRow}>
              <Text style={styles.rupee}>₹</Text>
              <View style={{ flex: 1 }}><Input label={t('workerEdit.dailyRate')} value={dailyRate} onChangeText={setDailyRate} keyboardType="number-pad" maxLength={10} error={errors.includes('rate') ? t('workerEdit.err.rate') : undefined} /></View>
            </View>
            <Text style={styles.hint}>{t('workerEdit.rateHint')}</Text>
          </Card>

          {/* Privacy — consent to be shown to employers with identity (P0-2, real: labour.updateWorker.discoverable) */}
          <Card>
            <Text style={styles.section}>{t('workerEdit.privacy')}</Text>
            <Pressable onPress={() => setDiscoverable((v) => !v)} style={styles.toggleRow} accessibilityRole="switch" accessibilityState={{ checked: discoverable }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleTitle}>{t('workerEdit.discoverable')}</Text>
                <Text style={styles.hint}>{t('workerEdit.discoverableHint')}</Text>
              </View>
              <View style={[styles.switch, discoverable && styles.switchOn]}>
                <View style={[styles.knob, discoverable && styles.knobOn]} />
              </View>
            </Pressable>
          </Card>

          {/* About me (no contract field → captured, not persisted) */}
          <Card>
            <Text style={styles.section}>{t('workerEdit.about')}</Text>
            <Input label={t('workerEdit.intro')} value={about} onChangeText={setAbout} multiline maxLength={400} />
            <Text style={styles.hint}>{t('workerEdit.aboutSoon')}</Text>
          </Card>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  avatarWrap: { alignItems: 'center', gap: space[2], marginTop: space[2] },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.body, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.earth700 },
  changePhoto: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink700, marginBottom: space[2] },
  fieldLabel: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700, marginTop: space[2], marginBottom: space[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { paddingHorizontal: space[4], minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  chipTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
  hint: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[2] },
  errText: { fontFamily: font.body, fontSize: font.size.xs, color: color.danger, marginTop: space[1] },
  rateRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2], marginTop: space[2] },
  rupee: { fontFamily: font.body, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink600, paddingBottom: space[3] },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  toggleTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  switch: { width: 48, height: 28, borderRadius: 14, backgroundColor: color.ink200, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: color.primary600 },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: color.card },
  knobOn: { alignSelf: 'flex-end' },
});
