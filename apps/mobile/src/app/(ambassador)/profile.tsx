// apps/mobile/src/app/(ambassador)/profile.tsx · screen 95 (My Profile). Thin screen (guide §3): the ambassador's
// profile hub — identity header, 3 stat tiles, and grouped menu (Performance / Money / Tools / App) linking to the
// real sub-screens, plus language switch + sign out. Behind `ambassador_training`. Money via formatMoneyMinor
// (Law 2). Degrade-never-die.
//
// §13 (NOT faked): the ambassador contract exposes {clusterRegionIds, tierId, createdAt, isActive, …} + the auth
// profile's displayName — but NO rating, NO badge count, NO village/km coverage, and NO cluster/FPO NAME. So the
// Rating tile shows "—", the header subtitle is the honest role label (not a fabricated "Petlad cluster · Anand
// FPO"), Coverage shows the real region count (no km), and Achievements is generic (no fabricated "8 badges").
// Farmers/this-month/tenure/earnings/bank/training-progress are all derived live from the caller's own data.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { AmbassadorProfile, AmbassadorEarning, Referral, Enrollment, BankAccount } from '@krishalaya/sdk-js';
import { formatMoneyMinor, LANGUAGES } from '@krishalaya/i18n';
import { Button, Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useAuth } from '../../core/auth/auth.store';
import { config } from '../../core/config';
import { myProfile, listReferrals, myEarnings } from '../../features/ambassador/ambassador.api';
import { myEnrollments } from '../../features/education/education.api';
import { myBankAccounts } from '../../features/profile/profile.api';
import { personInitials, referralFunnel, referralsThisMonth, tenureYears } from '../../features/ambassador/ambassador-home';
import { withdrawableMinor } from '../../features/ambassador/commissions-summary';
import { bankLabel } from '../../features/profile/profile';

export default function AmbassadorProfileScreen() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const { state, setLanguage, signOut } = useAuth();
  const enabled = useFlag('ambassador_training');
  const [profile, setProfile] = useState<AmbassadorProfile | null>(null);
  const [refs, setRefs] = useState<Referral[]>([]);
  const [earnings, setEarnings] = useState<AmbassadorEarning[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [p, r, e, en, b] = await Promise.all([myProfile(), listReferrals(), myEarnings(), myEnrollments(), myBankAccounts()]);
    setProfile(p); setRefs(r.items); setEarnings(e.items); setEnrollments(en.items); setBanks(b); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  const name = state.profile?.displayName ?? t('amb.profile.defaultName');
  const farmers = referralFunnel(refs).total;
  const thisMonth = referralsThisMonth(refs, Date.now());
  const tenure = tenureYears(profile?.createdAt, Date.now());
  const available = formatMoneyMinor(withdrawableMinor(earnings), 'INR', lang);
  const primaryBank = useMemo(() => banks.find((b) => b.isPrimary) ?? banks[0] ?? null, [banks]);
  const trainingPct = enrollments.length ? Math.round(enrollments.reduce((s, e) => s + (e.progressPct ?? 0), 0) / enrollments.length) : null;
  const currentLang = LANGUAGES.find((l) => l.code === lang)?.nameNative ?? lang;

  if (!enabled) return <ScreenScaffold title={t('amb.profile.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('amb.profile.title')} scroll>
      {loading ? <SkeletonCard lines={8} /> : !profile ? (
        <EmptyState title={t('amb.home.notAmbassador.title')} message={t('amb.home.notAmbassador.message')} />
      ) : (
        <View style={{ gap: space[3] }}>
          {/* Identity header */}
          <View style={styles.hero}>
            <View style={styles.avatar}><Text style={styles.avatarTxt}>{personInitials(name)}</Text></View>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.role}>{t('amb.profile.roleLabel')}</Text>
          </View>

          {/* Stat tiles */}
          <View style={styles.tiles}>
            <Tile value={String(farmers)} label={t('amb.profile.tile.farmers')} />
            <Tile value={`⭐ ${t('common.dash')}`} label={t('amb.profile.tile.rating')} />
            <Tile value={tenure != null ? t('amb.profile.years', { n: String(tenure) }) : t('common.dash')} label={t('amb.profile.tile.tenure')} />
          </View>

          <Button title={t('amb.profile.editProfile')} variant="outline" onPress={() => router.push('/(system)/settings')} />

          {/* Performance */}
          <Text style={styles.section}>{t('amb.profile.perf')}</Text>
          <Card>
            <MenuRow icon="🏆" label={t('amb.profile.achievements')} value={t('amb.profile.achievementsSub')} onPress={() => router.push('/(ambassador)/leaderboard')} />
            <MenuRow icon="📈" label={t('amb.profile.myStats')} value={t('amb.profile.statsSub', { month: String(thisMonth), life: String(farmers) })} onPress={() => router.push('/(ambassador)/targets')} divide />
            <MenuRow icon="📍" label={t('amb.profile.coverage')} value={t('amb.profile.coverageSub', { n: String(profile.clusterRegionIds?.length ?? 0) })} onPress={() => router.push('/(ambassador)/visit-log')} divide />
          </Card>

          {/* Money */}
          <Text style={styles.section}>{t('amb.profile.money')}</Text>
          <Card>
            <MenuRow icon="💰" label={t('amb.profile.commission')} value={t('amb.profile.commissionSub', { available })} onPress={() => router.push('/(ambassador)/commissions')} />
            <MenuRow icon="🏦" label={t('amb.profile.bank')} value={primaryBank ? bankLabel(primaryBank) : t('amb.profile.noBank')} onPress={() => router.push('/(ambassador)/withdraw')} divide />
          </Card>

          {/* Tools */}
          <Text style={styles.section}>{t('amb.profile.tools')}</Text>
          <Card>
            <MenuRow icon="🎓" label={t('amb.profile.trainingHub')} value={trainingPct != null ? t('amb.profile.trainingPct', { pct: String(trainingPct) }) : t('amb.profile.trainingStart')} onPress={() => router.push('/(ambassador)/training')} />
            <MenuRow icon="📋" label={t('amb.profile.faq')} value={t('amb.profile.faqSub')} onPress={() => router.push('/(ambassador)/faq')} divide />
            <MenuRow icon="❓" label={t('amb.profile.help')} value={t('amb.profile.helpSub')} onPress={() => router.push('/(ambassador)/faq')} divide />
          </Card>

          {/* App */}
          <Text style={styles.section}>{t('amb.profile.app')}</Text>
          <Card>
            <View style={styles.langLabelRow}><Text style={styles.langIcon}>🌐</Text><Text style={styles.rowLabel}>{t('amb.profile.language')}</Text><Text style={styles.rowValue}>{currentLang}</Text></View>
            <View style={styles.langRow}>
              {LANGUAGES.map((l) => {
                const active = l.code === lang;
                return <Pressable key={l.code} onPress={() => setLanguage(l.code)} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: active }}><Text style={[styles.chipText, active && styles.chipTextOn]}>{l.nameNative}</Text></Pressable>;
              })}
            </View>
            <MenuRow icon="🔔" label={t('amb.profile.notifications')} value={t('amb.profile.manage')} onPress={() => router.push('/(system)/settings')} divide />
          </Card>

          <View style={{ marginTop: space[3], gap: space[2] }}>
            <Button title={t('profile.signOut')} variant="outline" onPress={() => signOut()} />
            <Text style={styles.version}>{t('amb.profile.version', { v: config.appVersion })}</Text>
          </View>
        </View>
      )}
    </ScreenScaffold>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function MenuRow({ icon, label, value, onPress, divide }: { icon: string; label: string; value: string; onPress: () => void; divide?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.row, divide && styles.divide]}>
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
      </View>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space[1], paddingVertical: space[3] },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: color.primary100, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.primary800 },
  name: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, marginTop: space[1] },
  role: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  tiles: { flexDirection: 'row', gap: space[3] },
  tile: { flex: 1, alignItems: 'center', backgroundColor: color.primary50, borderRadius: radius.lg, paddingVertical: space[3], gap: 2 },
  tileValue: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900 },
  tileLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2], minHeight: 48 },
  divide: { borderTopWidth: 1, borderTopColor: color.ink100 },
  rowIcon: { fontSize: 22 },
  rowLabel: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  rowValue: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  chev: { fontFamily: font.body, fontSize: font.size.xl, color: color.ink400 },
  langLabelRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  langIcon: { fontSize: 22 },
  langRow: { flexDirection: 'row', gap: space[2], paddingBottom: space[2], flexWrap: 'wrap' },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  chipTextOn: { color: color.primary700 },
  version: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center' },
});
