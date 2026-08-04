// apps/mobile/src/app/(farmer)/profile.tsx · screen 61 "My Profile". The farmer's identity hero (avatar initials +
// name + role), a Verification card (REAL KYC status + masked doc no, primary bank, farm parcels — all server-
// owned, masked PII only §4), Farm Details (real land-holding summary), an Account list (Settings / Help / Logout)
// and the inline language switcher. Behind `farmer_profile`. Degrade-never-die; deeper edit/farm/bank/docs screens
// are reachable from the cards.
// §13 gaps (no contract → rendered honestly, never faked):
//  • Seller RATING / SALES count / "on platform N yrs" / "Farmer since YYYY" — no farmer self-reputation/tenure
//    contract reachable here → shown as a "reputation coming soon" note, never a fabricated 4.8/87/3yrs.
//  • The KYC doc TYPE name ("Aadhaar") is a uuid (no name) → labelled generically "Identity (KYC)" + the real
//    masked number; CROPS GROWN + IRRIGATION-type NAME aren't on the parcel contract → coming-soon, never invented.
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { UserProfile, KycDocument, BankAccount, LandParcel } from '@krishalaya/sdk-js';
import { LANGUAGES } from '@krishalaya/i18n';
import { Button, Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useAuth } from '../../core/auth/auth.store';
import { useFlag } from '../../core/flags/useFlag';
import { useSecureScreen } from '../../core/security/screen-guard';
import { myDocuments, myBankAccounts, myParcels } from '../../features/profile/profile.api';
import { initials, landHoldingLabel, bankLabel, parcelStatusTone } from '../../features/profile/profile';

export default function Profile() {
  useSecureScreen();
  const router = useRouter();
  const { t, lang } = useTranslation();
  const { state, setLanguage, signOut } = useAuth();
  const profileOn = useFlag('farmer_profile');
  const systemOn = useFlag('system_screens');
  const [docs, setDocs] = useState<KycDocument[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [parcels, setParcels] = useState<LandParcel[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, b, p] = await Promise.all([myDocuments(), myBankAccounts(), myParcels()]);
    setDocs(d); setBanks(b); setParcels(p.items); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (profileOn) load(); else setLoading(false); }, [profileOn, load]));

  const onSignOut = async () => { await signOut(); router.replace('/(auth)/welcome'); };

  const profile: UserProfile | undefined = state.profile;
  const name = profile?.displayName ?? t('home.defaultName');
  const role = state.activeRole ?? 'farmer';

  const kyc = docs.find((x) => x.status === 'verified') ?? docs[0];
  const bank = banks.find((x) => x.isPrimary) ?? banks[0];
  const land = landHoldingLabel(parcels);
  const farmVerified = parcels.some((p) => p.verificationStatus === 'verified');

  return (
    <ScreenScaffold title={t('profile.title')}>
      {/* Identity hero */}
      <View style={styles.hero}>
        <View style={styles.avatar}><Text style={styles.avatarTxt}>{initials(profile?.displayName)}</Text></View>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.roleLine}>{t(`profile.role.${role}`, { defaultValue: t('profile.role.farmer') })}</Text>
        <Text style={styles.repNote}>{t('profile.reputationSoon')}</Text>
      </View>

      {loading ? <SkeletonCard lines={8} /> : !profileOn ? (
        <EmptyState title={t('common.unavailable')} />
      ) : (
        <>
          {/* Verification */}
          <Text style={styles.section}>{t('profile.verification')}</Text>
          <Card>
            <VerRow icon="🪪" label={t('profile.kycLabel')} value={kyc?.docNoMasked ?? t('profile.notSubmitted')}
              pill={kyc ? t(`profile.kycStatus.${kyc.status}`, { defaultValue: kyc.status }) : t('profile.kycStatus.none')}
              tone={kyc?.status === 'verified' ? 'success' : kyc ? 'warning' : 'neutral'}
              onPress={() => router.push('/(farmer)/kyc')} />
            <VerRow icon="🏦" label={t('profile.bankLabel')} value={bank ? bankLabel(bank) : t('profile.noBank')}
              pill={bank ? t('profile.active') : t('profile.kycStatus.none')} tone={bank ? 'success' : 'neutral'}
              onPress={() => router.push('/(farmer)/profile/bank')} divide />
            <VerRow icon="📍" label={t('profile.farmLabel')} value={land ? `${land.area} ${land.unit}` : t('profile.noFarm')}
              pill={farmVerified ? t('profile.tagged') : (parcels.length ? t('profile.kycStatus.pending') : t('profile.kycStatus.none'))}
              tone={parcels.length ? parcelStatusTone(farmVerified ? 'verified' : 'pending') : 'neutral'}
              onPress={() => router.push('/(farmer)/profile/farm')} divide />
          </Card>

          {/* Farm Details */}
          <Text style={styles.section}>{t('profile.farmDetailsTitle')}</Text>
          <Card>
            <Detail icon="🌾" label={t('profile.cropsGrown')} value={t('profile.cropsSoon')} muted />
            <Detail icon="📐" label={t('profile.landHolding')}
              value={land ? `${land.area} ${land.unit} · ${t(`profile.ownership.${land.ownership}`)}` : t('profile.noFarm')} divide />
            <Detail icon="💧" label={t('profile.irrigation')} value={t('profile.irrigationSoon')} muted divide />
          </Card>

          {/* Account */}
          <Text style={styles.section}>{t('profile.account')}</Text>
          <Card>
            <Pressable onPress={() => router.push('/(farmer)/profile/edit')} accessibilityRole="button" style={styles.acctRow}><Text style={styles.acctTxt}>{t('profile.editProfile')}</Text><Text style={styles.chev}>›</Text></Pressable>
            {systemOn ? <Pressable onPress={() => router.push('/(system)/settings')} accessibilityRole="button" style={[styles.acctRow, styles.divide]}><Text style={styles.acctTxt}>{t('system.settings.title')}</Text><Text style={styles.chev}>›</Text></Pressable> : null}
            <Pressable onPress={() => router.push('/(farmer)/profile/help')} accessibilityRole="button" style={[styles.acctRow, styles.divide]}><Text style={styles.acctTxt}>{t('profile.help')}</Text><Text style={styles.chev}>›</Text></Pressable>
          </Card>

          {/* Language */}
          <Text style={styles.section}>{t('language.title')}</Text>
          <View style={styles.langRow}>
            {LANGUAGES.map((l) => {
              const active = l.code === lang;
              return <Pressable key={l.code} onPress={() => setLanguage(l.code)} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: active }}><Text style={[styles.chipText, active && styles.chipTextOn]}>{l.nameNative}</Text></Pressable>;
            })}
          </View>

          <View style={{ marginTop: space[6] }}>
            <Button title={t('common.signOut')} variant="outline" onPress={onSignOut} />
          </View>
        </>
      )}
    </ScreenScaffold>
  );
}

function VerRow({ icon, label, value, pill, tone, onPress, divide }: { icon: string; label: string; value: string; pill: string; tone: any; onPress: () => void; divide?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.verRow, divide && styles.divide]}>
      <Text style={styles.verIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.verLabel}>{label}</Text>
        <Text style={styles.verValue} numberOfLines={1}>{value}</Text>
      </View>
      <StatusPill label={pill} tone={tone} />
    </Pressable>
  );
}
function Detail({ icon, label, value, muted, divide }: { icon: string; label: string; value: string; muted?: boolean; divide?: boolean }) {
  return (
    <View style={[styles.verRow, divide && styles.divide]}>
      <Text style={styles.verIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.verLabel}>{label}</Text>
        <Text style={[styles.verValue, muted && styles.mutedVal]} numberOfLines={2}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: space[4] },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: color.primary600, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.white },
  name: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, marginTop: space[2] },
  roleLine: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2, textTransform: 'capitalize' },
  repNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[1] },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[5], marginBottom: space[2] },
  verRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  divide: { borderTopWidth: 1, borderTopColor: color.ink100 },
  verIcon: { fontSize: 22, width: 28, textAlign: 'center' },
  verLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  verValue: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, marginTop: 1 },
  mutedVal: { color: color.ink400, fontWeight: font.weight.regular },
  acctRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  acctTxt: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  chev: { fontFamily: font.body, fontSize: font.size.lg, color: color.ink400 },
  langRow: { flexDirection: 'row', gap: space[2] },
  chip: { paddingHorizontal: space[4], minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600 },
  chipTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
});
