// apps/mobile/src/app/(farmer)/home.tsx · screen 09 (Farmer Home) — rebuilt to match the Phase-1 design
// (Krishalaya_Design_System/screens/09-farmer-home.html): avatar + bilingual greeting header, the ⚡AI-POWERED
// green hero with a gold "Speak to Sell" + glass "Photo", My-Listings/Wallet stat cards, horizontal "Today's Mandi
// Pulse", and "Today's Tip". Thin screen (guide §3): all data via features/farmer/dashboard.api; money via
// MoneyText (Law 2); sections that fail simply HIDE rather than show fakes (Law 12). Pull-to-refresh.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { MoneyText, SkeletonCard, EmptyState, color, font, space, radius, shadow } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useAuth } from '../../core/auth/auth.store';
import { useFlag } from '../../core/flags/useFlag';
import { loadFarmerHome, type MandiRow, type HomeTip, type HomeWeather } from '../../features/farmer/dashboard.api';
import { speakToSellTargetMode } from '../../features/listings/create-listing';

// Crop → emoji is presentational iconography (UI chrome), not data: a small map with a sensible default so a
// commodity the design didn't anticipate still renders. The price/name themselves are real (from the API).
const CROP_EMOJI: Record<string, string> = {
  wheat: '🌾', paddy: '🌾', rice: '🌾', maize: '🌽', corn: '🌽', chilli: '🌶️', chili: '🌶️',
  onion: '🧅', potato: '🥔', tomato: '🍅', cotton: '🧶', soybean: '🫘', bajra: '🌾', groundnut: '🥜',
};
function cropEmoji(name: string): string {
  const key = name.trim().toLowerCase();
  for (const k of Object.keys(CROP_EMOJI)) if (key.includes(k)) return CROP_EMOJI[k];
  return '🌾';
}

export default function FarmerHome() {
  const router = useRouter();
  const { t, lang } = useTranslation();
  const { state, loadProfile } = useAuth();
  const notifOn = useFlag('notifications');
  // KV-MF-05: "Speak to Sell" stays visible (it's the product's signature) but must not dead-end into the
  // Voice tab's dead mic while STT isn't wired up (§13) — route to Manual until the `voice_listing` flag flips.
  const voiceListingOn = useFlag('voice_listing');
  const [listingCount, setListingCount] = useState<number | null>(null);
  const [mandi, setMandi] = useState<MandiRow[] | null>(null);
  const [walletMinor, setWalletMinor] = useState<string | null>(null);
  const [tip, setTip] = useState<HomeTip | null>(null);
  const [weather, setWeather] = useState<HomeWeather | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setErrored(false);
    try {
      await loadProfile();
      const home = await loadFarmerHome();
      setListingCount(home.listingCount);
      setMandi(home.mandi);
      setWalletMinor(home.walletBalanceMinor);
      setTip(home.tip);
      setWeather(home.weather);
    } catch {
      // Whole-screen fetch failed with nothing cached — show a designed retry rather than a blank/white screen (Law 12).
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, [loadProfile]);

  // KV-MF-10: every OTHER farmer tab (Wallet, My Listings, Mandi, …) refetches via useFocusEffect, so a
  // transient failure (e.g. the wallet read racing the boot-time token restore, or a flaky network blip)
  // self-heals the next time the tab regains focus. Home was the one screen still using a plain mount-only
  // useEffect — a failed wallet read on the very first paint stuck at "—" for the rest of the session,
  // never retried, while re-visiting the dedicated Wallet screen (which DOES refetch on focus) showed the
  // real balance moments later. Matching the app-wide convention here fixes that divergence for every tile,
  // not just wallet.
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  const name = state.profile?.displayName ?? t('home.defaultName');
  const initial = (name.trim()[0] ?? 'K').toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header — avatar · bilingual greeting · notification bell */}
      <View style={styles.top}>
        <View style={styles.avatar}><Text style={styles.avatarTxt}>{initial}</Text></View>
        <View style={styles.greet}>
          <Text style={styles.greetLine} numberOfLines={1}>
            <Text style={styles.greetVern}>नमस्ते, </Text>{name}
          </Text>
          {weather ? (
            <Text style={styles.greetSub} numberOfLines={1}>
              {t('home.weather.temp', { deg: weather.tempC })} · {t(`home.weather.${weather.code}`)}{weather.place ? ` · ${weather.place}` : ''}
            </Text>
          ) : (
            <Text style={styles.greetSub}>{t('home.welcomeBack')}</Text>
          )}
        </View>
        {notifOn ? (
          <Pressable onPress={() => router.push('/(farmer)/notifications')} accessibilityRole="button" accessibilityLabel={t('notifications.title')} hitSlop={8} style={styles.bell}>
            <Text style={{ fontSize: 18 }}>🔔</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}>

        {/* Loading — skeleton that mirrors THIS layout (hero + 2 stat cards + a pulse row). Never a blank body (Law 12). */}
        {loading ? (
          <View style={styles.skeleton}>
            <SkeletonCard lines={4} />
            <View style={{ flexDirection: 'row', gap: space[2] }}><View style={{ flex: 1 }}><SkeletonCard lines={2} /></View><View style={{ flex: 1 }}><SkeletonCard lines={2} /></View></View>
            <SkeletonCard lines={3} />
          </View>
        ) : errored ? (
          <View style={styles.errorWrap}>
            <EmptyState title={t('common.somethingWrong')} message={t('common.retryHint')} actionLabel={t('common.retry')} onAction={load} />
          </View>
        ) : (
        <>
        {/* AI hero */}
        <View style={styles.hero}>
          <View style={styles.heroGlow} />
          <View style={styles.heroTag}><Text style={styles.heroTagTxt}>⚡ {t('home.aiPowered')}</Text></View>
          <Text style={styles.heroTitle}>{t('home.sellIn60')}</Text>
          <Text style={styles.heroVern}>अपनी फसल बेचें</Text>
          <View style={styles.heroActions}>
            <Pressable style={styles.ctaMic} onPress={() => router.push({ pathname: '/(farmer)/listings/new', params: { mode: speakToSellTargetMode(voiceListingOn) } })} accessibilityRole="button" accessibilityLabel={t('home.speakToSell')}>
              <Text style={styles.ctaMicTxt}>🎤  {t('home.speakToSell')}</Text>
            </Pressable>
            <Pressable style={styles.ctaPhoto} onPress={() => router.push({ pathname: '/(farmer)/listings/new', params: { mode: 'photo' } })} accessibilityRole="button" accessibilityLabel={t('home.photo')}>
              <Text style={styles.ctaPhotoTxt}>📷  {t('home.photo')}</Text>
            </Pressable>
          </View>
        </View>

        {/* Stat cards */}
        <View style={styles.stats}>
          <Pressable style={styles.stat} onPress={() => router.push('/(farmer)/listings')} accessibilityRole="button" accessibilityLabel={t('home.myListings')}>
            <View style={[styles.statIcon, { backgroundColor: color.primary50 }]}><Text style={{ fontSize: 18 }}>🌾</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statLabel}>{t('home.myListings')}</Text>
              <Text style={styles.statVal}>{listingCount == null ? '—' : t('home.active', { count: listingCount })}</Text>
            </View>
          </Pressable>
          <Pressable style={styles.stat} onPress={() => router.push('/(farmer)/wallet')} accessibilityRole="button" accessibilityLabel={t('home.wallet')}>
            <View style={[styles.statIcon, { backgroundColor: color.accent50 }]}><Text style={{ fontSize: 18 }}>💰</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statLabel}>{t('home.wallet')}</Text>
              {/* R2-01 (founder screenshot review): walletMinor is null ONLY on a genuine read failure
                  (walletTileMinor degrades a failed fetch to null, never a fabricated ₹0 — a real zero balance
                  comes through as '0' and renders normally below). It used to print a bare "—" here with no way
                  to recover; that reads as a dead/broken tile. A small tap-to-retry affordance instead. */}
              {walletMinor == null ? (
                <Pressable onPress={load} hitSlop={6}><Text style={styles.statValError}>{t('common.retry')}</Text></Pressable>
              ) : (
                <MoneyText minor={walletMinor} langCode={lang} size="lg" />
              )}
            </View>
          </Pressable>
        </View>

        {/* Today's Mandi Pulse */}
        {mandi && mandi.length > 0 ? (
          <>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t('home.mandiPulse')}</Text>
              <Pressable onPress={() => router.push('/(farmer)/mandi')} hitSlop={8}><Text style={styles.sectionLink}>{t('home.viewAll')} →</Text></Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mandiList}>
              {mandi.map((m) => (
                <Pressable key={m.id} style={styles.mandiCard} onPress={() => router.push('/(farmer)/mandi')}>
                  <Text style={styles.mandiEmoji}>{cropEmoji(m.commodity)}</Text>
                  <Text style={styles.mandiName} numberOfLines={1}>{m.commodity}</Text>
                  <MoneyText minor={m.modalPriceMinor} langCode={lang} size="lg" />
                  <Text style={styles.mandiUnit}>{t('home.perQtl')}</Text>
                  {m.changePct != null ? (
                    <Text style={[styles.mandiDelta, { color: m.changePct >= 0 ? color.successDark : color.danger }]}>
                      {m.changePct >= 0 ? '▲' : '▼'} {Math.abs(m.changePct).toFixed(1)}%
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}

        {/* Today's Tip */}
        {tip ? (
          <>
            <View style={styles.sectionHead}><Text style={styles.sectionTitle}>{t('home.todaysTip')}</Text></View>
            <Pressable style={styles.tipCard} onPress={() => router.push(`/(farmer)/tips/${tip.id}`)} accessibilityRole="button" accessibilityLabel={tip.title}>
              <View style={styles.tipIcon}><Text style={{ fontSize: 22 }}>💡</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.tipLabel}>{tip.kind.toUpperCase()}</Text>
                <Text style={styles.tipTitle} numberOfLines={2}>{tip.title}</Text>
                {tip.body ? <Text style={styles.tipDesc} numberOfLines={2}>{tip.body}</Text> : null}
              </View>
            </Pressable>
          </>
        ) : null}
        </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  // Loading / error
  skeleton: { paddingHorizontal: space[5], gap: space[3] },
  errorWrap: { paddingHorizontal: space[5], paddingTop: space[8] },
  // Header
  top: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[5], paddingVertical: space[4] },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.primary600, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: color.white, fontFamily: font.display, fontWeight: font.weight.bold, fontSize: font.size.lg },
  greet: { flex: 1, minWidth: 0 },
  greetLine: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800, letterSpacing: -0.3 },
  greetVern: { fontFamily: font.body, color: color.primary700, fontWeight: font.weight.semibold },
  greetSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  bell: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: space[8] },
  // Hero
  hero: { marginHorizontal: space[5], marginBottom: space[4], borderRadius: radius.xl, padding: space[5], backgroundColor: color.primary700, overflow: 'hidden', ...shadow.card },
  heroGlow: { position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(243,156,18,0.18)' },
  heroTag: { alignSelf: 'flex-start', backgroundColor: 'rgba(243,156,18,0.25)', borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 },
  heroTagTxt: { color: color.accent200, fontFamily: font.body, fontSize: 11, fontWeight: font.weight.bold, letterSpacing: 0.5 },
  heroTitle: { fontFamily: font.display, fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: color.white, marginTop: space[2], letterSpacing: -0.3 },
  heroVern: { fontFamily: font.body, fontSize: font.size.md, color: 'rgba(255,255,255,0.9)', marginTop: 2 },
  heroActions: { flexDirection: 'row', gap: space[2], marginTop: space[4] },
  ctaMic: { flex: 2, backgroundColor: color.accent500, borderRadius: radius.md, paddingVertical: space[3], alignItems: 'center', justifyContent: 'center' },
  ctaMicTxt: { fontFamily: font.body, fontWeight: font.weight.bold, color: color.ink900, fontSize: font.size.md },
  ctaPhoto: { flex: 1, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: radius.md, paddingVertical: space[3], alignItems: 'center', justifyContent: 'center' },
  ctaPhotoTxt: { fontFamily: font.body, fontWeight: font.weight.semibold, color: color.white, fontSize: font.size.md },
  // Stats
  stats: { flexDirection: 'row', gap: space[2], paddingHorizontal: space[5], marginBottom: space[3] },
  stat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.md, padding: space[3] },
  statIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  statVal: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, letterSpacing: -0.3 },
  statValError: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.primary700, textDecorationLine: 'underline' },
  // Section heads
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], paddingVertical: space[2] },
  sectionTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  sectionLink: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  // Mandi
  mandiList: { gap: space[2], paddingHorizontal: space[5], paddingBottom: space[3] },
  mandiCard: { width: 130, backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.md, padding: space[3] },
  mandiEmoji: { fontSize: 22, marginBottom: 2 },
  mandiName: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  mandiUnit: { fontFamily: font.body, fontSize: 10, color: color.ink400, marginTop: 2 },
  mandiDelta: { fontFamily: font.body, fontSize: 11, fontWeight: font.weight.semibold, marginTop: 4 },
  // Tip
  tipCard: { flexDirection: 'row', gap: space[3], marginHorizontal: space[5], marginBottom: space[4], padding: space[4], backgroundColor: color.accent50, borderWidth: 1, borderColor: color.accent200, borderRadius: radius.lg },
  tipIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: color.accent500, alignItems: 'center', justifyContent: 'center' },
  tipLabel: { fontFamily: font.body, fontSize: 10, fontWeight: font.weight.bold, color: color.accent700, letterSpacing: 0.5 },
  tipTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: 2 },
  tipDesc: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, marginTop: 2 },
});
