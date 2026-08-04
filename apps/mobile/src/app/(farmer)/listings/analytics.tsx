// apps/mobile/src/app/(farmer)/listings/analytics.tsx · screen 115 (Listing Analytics) — built to the Phase-1
// design (Krishalaya_Design_System/screens/115-farmer-listing-analytics.html): a green hero (title · live-for ·
// listing #, + a 3-stat row), "Views by day", a "Buyer journey funnel", "Buyer locations", and a Boost CTA. Thin
// screen over features/listings; degrade-never-die (Law 12); ≥48px targets; i18n(hi/en/gu).
//
// REAL data (listings.analytics() — owner-only, anti-IDOR): total Views, Offers, savedCount, a per-UTC-day view
// series (viewsByDay, last 7 days, fed by the stream-processor → listing_view_daily, migration 0054), publishedAt
// (→ "live for N days"). Conversion rate is derived purely (offers ÷ views). "Views by day" renders the real
// series; the funnel uses the real stages Opened=views → Saved=savedCount → Offered=offers. Title + id from
// GET /listings/:id.
//
// FLAGGED GAPS (§13, never faked): the design's "Search saw" funnel stage needs a search-impression counter, and
// the "Buyer locations" split needs per-viewer geo (also DPDP-sensitive) — neither is captured yet, so the screen
// omits the search stage (with a "coming soon" note) and flags the locations section, never the mock 412 / 57%
// figures. The middle hero stat is Offers (the real engagement count), not the design's "Inquiries" (not tracked).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ListingCard, ListingAnalytics } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { EmptyState, SkeletonCard, Icon, color, font, space, radius, shadow } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getListing, listingAnalytics } from '../../../features/listings/listings.api';
import { relativeAge, type RelativeAge } from '../../../features/listings/listing-detail';
import { convRate, funnelFromAnalytics, viewsByDaySeries } from '../../../features/listings/listing-analytics';

function liveLabel(t: (k: string, p?: Record<string, unknown>) => string, a: RelativeAge | null): string | null {
  if (!a) return null;
  if (a.unit === 'today') return t('analytics.liveToday');
  return t(`analytics.liveFor.${a.unit}`, { n: a.value });
}

export default function ListingAnalyticsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const boostOn = useFlag('listing_boost');
  const [listing, setListing] = useState<ListingCard | null>(null);
  const [analytics, setAnalytics] = useState<ListingAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    const [res, an] = await Promise.all([getListing(id), listingAnalytics(id)]);
    setListing(res.listing); setAnalytics(an); setFailed(!res.listing);
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const views = analytics?.views ?? 0;
  const offers = analytics?.offers ?? 0;
  const saved = analytics?.savedCount ?? 0;
  const conv = analytics ? convRate(offers, views) : null;
  const live = liveLabel(t, relativeAge(analytics?.publishedAt));
  const funnel = analytics ? funnelFromAnalytics({ views, saved, offers }) : [];
  const bars = analytics ? viewsByDaySeries(analytics.viewsByDay ?? []) : [];
  const num = (n: number) => formatNumber(n, lang);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.appbar}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={styles.backBtn}>
          <Icon name="arrow-left" size={20} color={color.ink700} />
        </Pressable>
        <Text style={styles.appbarTitle}>{t('analytics.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.body}><SkeletonCard lines={4} /><View style={{ height: space[3] }} /><SkeletonCard lines={4} /></View>
      ) : failed || !listing ? (
        <View style={styles.body}><EmptyState title={t('listings.unavailable')} actionLabel={t('common.retry')} onAction={load} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Green hero */}
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>{listing.title}</Text>
            <Text style={styles.heroSub}>
              {live ? `${live} · ` : ''}{t('analytics.listingNo', { id: shortId(listing.id) })}
            </Text>
            <View style={styles.statRow}>
              <HeroStat value={num(views)} label={t('analytics.totalViews')} />
              <HeroStat value={num(offers)} label={t('analytics.offers')} />
              <HeroStat value={conv === null ? '—' : `${num(conv)}%`} label={t('analytics.convRate')} accent />
            </View>
          </View>

          {/* Views by day — REAL per-day series (listing_view_daily, last 7 UTC days). */}
          <Text style={styles.section}>{t('analytics.viewsByDay')}</Text>
          <View style={styles.barsCard}>
            <View style={styles.bars}>
              {bars.map((b) => (
                <View key={b.day} style={styles.barCol}>
                  <View style={styles.barTrack}>
                    {b.views > 0 ? <View style={[styles.bar, { height: `${b.heightPct}%` }]} /> : null}
                  </View>
                  <Text style={styles.barDay}>{t(`analytics.dow.${b.dow}`)}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.barsCaption}>{t('analytics.totalViewsN', { n: num(views) })}</Text>
          </View>

          {/* Buyer journey funnel — real stages (Opened → Saved → Offered). */}
          <Text style={styles.section}>{t('analytics.funnel')}</Text>
          <View style={styles.funnel}>
            {funnel.map((s) => (
              <View key={s.id} style={styles.funnelRow}>
                <Text style={styles.funnelName}>{t(s.labelKey)}</Text>
                <View style={styles.funnelTrack}>
                  <View style={[styles.funnelBar, { width: `${Math.max(s.widthPct, s.value > 0 ? 14 : 0)}%` }, s.id === 'offered' && styles.funnelBarAccent]}>
                    <Text style={styles.funnelVal}>{num(s.value)}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
          <Text style={styles.funnelNote}>{t('analytics.funnelSoon')}</Text>

          {/* Buyer locations — no geo split in the read-model (§13) → honest note, never fabricated %s. */}
          <Text style={styles.section}>{t('analytics.locations')}</Text>
          <View style={styles.noteCard}>
            <Text style={styles.noteTxt}>{t('analytics.locationsSoon')}</Text>
          </View>

          {/* Boost CTA → real boost screen (114). No hardcoded price; tiers load there. */}
          {boostOn ? (
            <Pressable
              style={styles.boost}
              onPress={() => router.push({ pathname: '/(farmer)/listings/boost', params: { id: listing.id } })}
              accessibilityRole="button"
              accessibilityLabel={t('analytics.boostTitle')}
            >
              <Text style={styles.boostEmoji}>🚀</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.boostTitle}>{t('analytics.boostTitle')}</Text>
                <Text style={styles.boostSub}>{t('analytics.boostSub')}</Text>
              </View>
              <Icon name="chevron-right" size={18} color={color.accent700} />
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function HeroStat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statVal, accent && { color: color.accent300 }]}>{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}

function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[2] },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },
  appbarTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  body: { flex: 1, padding: space[5] },
  scroll: { paddingHorizontal: space[5], paddingBottom: space[6] },

  hero: { backgroundColor: color.primary700, borderRadius: radius.lg, padding: space[4], marginTop: space[2], marginBottom: space[4] },
  heroTitle: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.white },
  heroSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.white, opacity: 0.85, marginTop: 2 },
  statRow: { flexDirection: 'row', gap: space[3], marginTop: space[3] },
  stat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.md, paddingVertical: space[2], alignItems: 'center' },
  statVal: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.white },
  statLbl: { fontFamily: font.body, fontSize: 9, color: color.white, opacity: 0.8, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 2, fontWeight: font.weight.semibold },

  section: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  noteCard: { backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.md, padding: space[3], ...shadow.card },
  noteTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.primary700, marginBottom: 2 },
  noteTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, lineHeight: 20 },

  barsCard: { backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.md, padding: space[3], ...shadow.card },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 130, gap: 6 },
  barCol: { flex: 1, alignItems: 'center' },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', alignItems: 'stretch' },
  bar: { width: '100%', minHeight: 6, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: color.primary500 },
  barDay: { fontFamily: font.body, fontSize: 9, fontWeight: font.weight.semibold, color: color.ink500, marginTop: 4 },
  barsCaption: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[2], textAlign: 'center' },

  funnel: { gap: space[2] },
  funnelRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  funnelName: { width: 78, fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink600, textTransform: 'uppercase', letterSpacing: 0.4 },
  funnelTrack: { flex: 1, height: 32, justifyContent: 'center' },
  funnelBar: { height: 32, backgroundColor: color.primary400, borderRadius: radius.sm, justifyContent: 'center', paddingHorizontal: 12, minWidth: 40 },
  funnelBarAccent: { backgroundColor: color.accent500 },
  funnelVal: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.white },
  funnelNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[2] },

  boost: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[4], padding: space[3], borderRadius: radius.md, backgroundColor: color.accent50, borderWidth: 1, borderColor: color.accent300 },
  boostEmoji: { fontSize: 22 },
  boostTitle: { fontFamily: font.display, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.accent700 },
  boostSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.accent700, marginTop: 1, lineHeight: 18 },
});
