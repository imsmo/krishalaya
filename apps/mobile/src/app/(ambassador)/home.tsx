// apps/mobile/src/app/(ambassador)/home.tsx · screen 86 (Ambassador Home). Thin screen (guide §3): a greeting hero
// (the ambassador's OWN name + their cluster rank), three real stat tiles (farmers onboarded / this-month /
// commission earned), the onboard CTA, a "pending onboardings" list from their referrals, and a today's-activity
// feed. Behind `ambassador_app`. Money via MoneyText (Law 2). Degrade-never-die.
//
// §13 — REAL: own name (auth profile), cluster rank (leaderboard row), farmers/this-month counts (referrals),
// earned (sum of earnings). HONESTLY degraded (NEVER faked): referrals are PII-minimised (no farmer name/reason on
// the contract) → the pending list anonymises to a code-initial + the server status, never "Anil Kumar · Aadhaar
// pending"; a farmer ACTIVITY feed has no contract yet → a designed coming-soon, never invented "listed wheat /
// sale complete" rows; the per-onboarding commission amount isn't exposed → a generic incentive line, not "₹50".
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { AmbassadorProfile, Referral, AmbassadorEarning, LeaderboardEntry } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, MoneyText, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useAuth } from '../../core/auth/auth.store';
import { myProfile, listReferrals, myEarnings, leaderboard } from '../../features/ambassador/ambassador.api';
import { referralFunnel, referralStatusTone, sumEarningsMinor } from '../../features/ambassador/referral-flow';
import { referralsThisMonth, pendingReferrals, myRank, personInitials } from '../../features/ambassador/ambassador-home';

export default function AmbassadorHome() {
  const { t } = useTranslation();
  const { state } = useAuth();
  const router = useRouter();
  const enabled = useFlag('ambassador_app');
  const [profile, setProfile] = useState<AmbassadorProfile | null>(null);
  const [refs, setRefs] = useState<Referral[]>([]);
  const [earnings, setEarnings] = useState<AmbassadorEarning[]>([]);
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [p, r, e, b] = await Promise.all([myProfile(), listReferrals(), myEarnings(), leaderboard()]);
    setProfile(p); setRefs(r.items); setEarnings(e.items); setBoard(b); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('amb.home.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const name = state.profile?.displayName ?? t('amb.home.defaultName');
  const funnel = referralFunnel(refs);
  const thisMonth = referralsThisMonth(refs, Date.now());
  const earnedMinor = sumEarningsMinor(earnings);
  const rank = myRank(board, state.profile?.id ?? profile?.userId ?? null);
  const pending = pendingReferrals(refs);

  return (
    <ScreenScaffold title={t('amb.home.title')} scroll={false} footer={<Button title={t('amb.onboard.cta')} onPress={() => router.push('/(ambassador)/onboard-start')} />}>
      {loading ? <SkeletonCard lines={8} /> : !profile ? (
        <EmptyState title={t('amb.home.notAmbassador.title')} message={t('amb.home.notAmbassador.message')} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[3] }}>
          {/* Greeting hero */}
          <View style={styles.hero}>
            <Text style={styles.greeting}>{t('amb.home.greeting')}</Text>
            <Text style={styles.vern}>{t('amb.home.vern')}</Text>
            <Text style={styles.name}>{name}</Text>
            {rank != null ? <View style={styles.badge}><Text style={styles.badgeTxt}>{t('amb.home.rankBadge', { rank })}</Text></View> : null}
          </View>

          {/* Stats */}
          <View style={styles.stats}>
            <Stat value={String(funnel.total)} label={t('amb.home.stat.farmers')} />
            <Stat value={String(thisMonth)} label={t('amb.home.stat.thisMonth')} />
            <Stat valueNode={<MoneyText minor={earnedMinor} currencyCode="INR" langCode={state.language} size="lg" />} label={t('amb.home.stat.earned')} />
          </View>

          {/* Onboard CTA */}
          <Pressable onPress={() => router.push('/(ambassador)/onboard-start')} accessibilityRole="button">
            <Card style={styles.onboardCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.onboardTitle}>{t('amb.home.onboardTitle')}</Text>
                <Text style={styles.onboardSub}>{t('amb.home.onboardSub')}</Text>
              </View>
              <Text style={styles.onboardArrow}>→</Text>
            </Card>
          </Pressable>

          {/* Pending onboardings — real, anonymised (§13) */}
          <View style={styles.rowBetween}>
            <Text style={styles.section}>{t('amb.home.pendingTitle')}</Text>
            <Pressable onPress={() => router.push('/(ambassador)/farmers')} accessibilityRole="button"><Text style={styles.link}>{t('amb.home.allCount', { n: funnel.invited + funnel.signedUp })} →</Text></Pressable>
          </View>
          {pending.length === 0 ? (
            <Card><Text style={styles.muted}>{t('amb.home.pendingEmpty')}</Text></Card>
          ) : (
            <Card>
              {pending.map((r, i) => (
                <View key={r.id} style={[styles.pendRow, i > 0 && styles.divide]}>
                  <View style={styles.avatar}><Text style={styles.avatarTxt}>{personInitials(r.code)}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pendName}>{t('amb.home.referralAnon', { code: r.code })}</Text>
                    <StatusPill label={t(`amb.referral.status.${r.status}`, { defaultValue: r.status })} tone={referralStatusTone(r.status)} />
                  </View>
                  <Button title={t('amb.home.help')} variant="outline" size="sm" onPress={() => router.push('/(ambassador)/onboard-start')} />
                </View>
              ))}
            </Card>
          )}

          {/* Today's activity — §13 no farmer-activity feed contract yet */}
          <Text style={styles.section}>{t('amb.home.activityTitle')}</Text>
          <Card><Text style={styles.muted}>{t('amb.home.activitySoon')}</Text></Card>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function Stat({ value, valueNode, label }: { value?: string; valueNode?: React.ReactNode; label: string }) {
  return (
    <View style={styles.statCell}>
      {valueNode ?? <Text style={styles.statValue}>{value}</Text>}
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { padding: space[4], borderRadius: radius.lg, backgroundColor: color.primary50 },
  greeting: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  vern: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700, marginTop: 2 },
  name: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800, marginTop: 2 },
  badge: { alignSelf: 'flex-start', marginTop: space[2], backgroundColor: color.accent, borderRadius: radius.pill, paddingHorizontal: space[3], paddingVertical: 4 },
  badgeTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink900 },
  stats: { flexDirection: 'row', gap: space[2] },
  statCell: { flex: 1, alignItems: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.lg, paddingVertical: space[3], gap: 2 },
  statValue: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800 },
  statLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, textAlign: 'center' },
  onboardCard: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: color.primary600 },
  onboardTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.white },
  onboardSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.primary50, marginTop: 2 },
  onboardArrow: { fontFamily: font.display, fontSize: font.size.xl, color: color.white },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[2] },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  link: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  muted: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  pendRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  divide: { borderTopWidth: 1, borderTopColor: color.ink100 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.earth700 },
  pendName: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800, marginBottom: 4 },
});
