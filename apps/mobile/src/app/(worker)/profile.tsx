// apps/mobile/src/app/(worker)/profile.tsx · screen 38 (My Profile — worker dashboard). Thin screen (guide §3):
// a read-only overview of the caller's worker profile — hero (name/region/language/rating), stat row (jobs done /
// years on platform / lifetime earnings), and link sections into Skills, Availability, edit (work area / min wage),
// insurance, KYC, reviews, and settings. "Edit ✎" opens the edit form (screen 136 at profile/edit). Behind
// `worker_app`. Degrade-never-die.
//
// §13 — REAL: name (auth displayName), region (lookups), language (locale), ⭐rating + review count (reviews
// summary), jobs done (worker.bookingsCompleted), years on platform (worker.createdAt), lifetime earnings (wallet
// insights total), skills-active count (skillIds), work-area (travelKm + region), minimum wage (minWageExpectation),
// KYC status. HONESTLY degraded (no field/endpoint → NEVER faked): availability day counts ("22 available · 7
// booked" is design seed → generic subtitle), PMSBY cover/validity, and the Bank/UPI details (no worker bank
// surface yet) → shown without invented values; Help & Support has no worker route → an informational row.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { WorkerProfile, LabourLookups, KycDocument } from '@krishalaya/sdk-js';
import { Card, EmptyState, Button, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius, type PillTone } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useAuth } from '../../core/auth/auth.store';
import { useFlag } from '../../core/flags/useFlag';
import { getMyWorker, workerRating, labourLookups } from '../../features/labour/labour.api';
import { walletEarnings } from '../../features/wallet/wallet.api';
import { listKyc } from '../../features/kyc/kyc.api';
import { canAcceptWork } from '../../features/labour/labour-status';
import { initials } from '../../features/labour/worker-home';
import { workerYears, regionName, compactLakh } from '../../features/labour/worker-profile';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';

const KYC_TONE: Record<string, PillTone> = { verified: 'success', pending: 'warning', rejected: 'danger', expired: 'danger' };

export default function WorkerProfile() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const { state } = useAuth();
  const enabled = useFlag('worker_app');
  const kycEnabled = useFlag('kyc');
  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [ratingAvg, setRatingAvg] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [lifetimeMinor, setLifetimeMinor] = useState<string | null>(null);
  const [kyc, setKyc] = useState<KycDocument | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const w = await getMyWorker(); setWorker(w);
    if (w) {
      const [lk, rating, ins, kycList] = await Promise.all([
        labourLookups(), workerRating(w.userId), walletEarnings(), kycEnabled ? listKyc() : Promise.resolve([]),
      ]);
      setLookups(lk); setRatingAvg(rating?.averageStars ?? null); setRatingCount(rating?.count ?? 0);
      setLifetimeMinor(ins.totalMinor); setKyc(kycList[0] ?? null);
    }
    setLoading(false);
  }, [kycEnabled]);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('worker.profileView.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const name = state.profile?.displayName ?? t('worker.home.defaultName');
  const region = worker ? regionName(lookups?.regions ?? [], worker.villageRegionId) : null;
  const years = worker ? workerYears(worker.createdAt) : null;
  const verified = kyc?.status === 'verified' || !!worker?.ageVerified18;
  const langName = t(`worker.profileView.lang.${lang}`);
  const subtitleBits = [region, langName, ratingAvg != null ? `⭐ ${ratingAvg.toFixed(1)}` : null].filter(Boolean).join(' · ');

  return (
    <ScreenScaffold title={t('worker.profileView.title')} scroll={false}>
      {loading ? <SkeletonCard lines={10} /> : !worker ? (
        <Card>
          <Text style={styles.h}>{t('worker.onboard.title')}</Text>
          <Text style={styles.note}>{t('worker.onboard.body')}</Text>
          <View style={{ marginTop: space[4] }}><Button title={t('worker.onboard.register')} onPress={() => router.push('/(worker)/profile/edit')} /></View>
        </Card>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[6] }}>
          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={styles.avatar}><Text style={styles.avatarTxt}>{initials(name)}</Text></View>
              <Pressable onPress={() => router.push('/(worker)/profile/edit')} hitSlop={8} accessibilityRole="button"><Text style={styles.edit}>{t('worker.profileView.edit')} ✎</Text></Pressable>
            </View>
            <Text style={styles.name}>{name}{verified ? ' ✓' : ''}</Text>
            {subtitleBits ? <Text style={styles.sub}>{subtitleBits}</Text> : null}
          </View>

          {/* Stats */}
          <View style={styles.stats}>
            <Stat value={worker.bookingsCompleted != null ? String(worker.bookingsCompleted) : '—'} label={t('worker.profileView.jobsDone')} />
            <Stat value={years != null ? t('worker.profileView.years', { n: years }) : '—'} label={t('worker.profileView.onPlatform')} />
            <Stat value={compactLakh(lifetimeMinor)} label={t('worker.profileView.lifetime')} />
          </View>

          {/* Work preferences */}
          <Text style={styles.section}>{t('worker.profileView.prefs')}</Text>
          <Card>
            <LinkRow icon="🌾" title={t('worker.skills.title')} sub={t('worker.profileView.skillsActive', { n: worker.skillIds?.length ?? 0 })} onPress={() => router.push('/(worker)/skills')} />
            <LinkRow icon="📅" title={t('worker.avail.title')} sub={t('worker.profileView.availSub')} onPress={() => router.push('/(worker)/availability')} />
            <LinkRow icon="📍" title={t('worker.profileView.workArea')} sub={worker.travelKm != null ? t('worker.profileView.workAreaSub', { km: worker.travelKm, place: region ?? t('worker.profileView.yourVillage') }) : t('worker.profileView.notSet')} onPress={() => router.push('/(worker)/profile/edit')} />
            <LinkRow icon="💰" title={t('worker.profileView.minWage')} sub={worker.minWageExpectationMinor ? t('worker.profileView.perDay', { amount: formatMoneyMinor(worker.minWageExpectationMinor, 'INR', lang) }) : t('worker.profileView.notSet')} onPress={() => router.push('/(worker)/profile/edit')} last />
          </Card>

          {/* Protection & ID */}
          <Text style={styles.section}>{t('worker.profileView.protection')}</Text>
          <Card>
            <LinkRow icon="🛡️" title={t('worker.insurance.title')} sub={t('worker.profileView.insuranceSub')} onPress={() => router.push('/(worker)/insurance')} />
            <LinkRow icon="📋" title={t('worker.profileView.aadhaar')} sub={kyc ? t('worker.profileView.kycStatus', { status: t(`kyc.status.${kyc.status}`), date: kyc.createdAt ? safeDate(kyc.createdAt, lang) : '' }) : t('worker.profileView.notVerified')} onPress={() => router.push('/(worker)/profile/edit')} rightNode={kyc ? <StatusPill label={t(`kyc.status.${kyc.status}`)} tone={KYC_TONE[kyc.status] ?? 'neutral'} /> : undefined} last />
          </Card>
          {/* §13: no worker bank surface yet — shown without invented account/UPI values */}
          <Card><LinkRow icon="🏦" title={t('worker.profileView.bank')} sub={t('worker.profileView.bankSoon')} last /></Card>

          {/* Ratings & reviews */}
          <Text style={styles.section}>{t('worker.profileView.ratings')}</Text>
          <Card>
            <LinkRow icon="⭐" title={t('worker.profileView.viewReviews')} sub={t('worker.profileView.ratingsCount', { n: ratingCount })} onPress={() => router.push('/(worker)/reviews')} />
            <LinkRow icon="📜" title={t('workerHistory.title')} sub={t('workerHistory.jobsCount', { n: worker.bookingsCompleted ?? 0 })} onPress={() => router.push('/(worker)/work-history')} last />
          </Card>

          {/* Account */}
          <Text style={styles.section}>{t('worker.profileView.account')}</Text>
          <Card>
            <LinkRow icon="🗂" title={t('workerDocs.title')} onPress={() => router.push('/(worker)/documents')} />
            <LinkRow icon="⚙️" title={t('worker.profileView.settings')} onPress={() => router.push('/(system)/settings')} />
            <LinkRow icon="❓" title={t('worker.profileView.help')} sub={t('worker.profileView.helpSub')} onPress={() => router.push('/(worker)/help')} last />
          </Card>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return <View style={styles.stat}><Text style={styles.statVal}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}
function LinkRow({ icon, title, sub, onPress, rightNode, last }: { icon: string; title: string; sub?: string; onPress?: () => void; rightNode?: React.ReactNode; last?: boolean }) {
  const Wrap: any = onPress ? Pressable : View;
  return (
    <Wrap onPress={onPress} style={[styles.linkRow, !last && styles.linkBorder]} accessibilityRole={onPress ? 'button' : undefined}>
      <Text style={styles.linkIcon}>{icon}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.linkTitle}>{title}</Text>
        {sub ? <Text style={styles.linkSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {rightNode ?? (onPress ? <Text style={styles.chevron}>›</Text> : null)}
    </Wrap>
  );
}
function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } }

const styles = StyleSheet.create({
  h: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  note: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600 },
  hero: { alignItems: 'center', padding: space[4], borderRadius: radius.lg, backgroundColor: color.primary50 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: color.accent500, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.white },
  edit: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  name: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, marginTop: space[3] },
  sub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: 2, textAlign: 'center' },
  stats: { flexDirection: 'row', gap: space[3], marginTop: space[3] },
  stat: { flex: 1, backgroundColor: color.card, borderRadius: radius.lg, padding: space[3], alignItems: 'center', gap: 2 },
  statVal: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900 },
  statLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, textAlign: 'center' },
  section: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink500, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: space[4], marginBottom: space[2] },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3], minHeight: 48 },
  linkBorder: { borderBottomWidth: 1, borderBottomColor: color.ink100 },
  linkIcon: { fontSize: 22, width: 28, textAlign: 'center' },
  linkTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  linkSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  chevron: { fontFamily: font.display, fontSize: font.size.lg, color: color.ink300 },
});
