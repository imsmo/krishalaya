// apps/mobile/src/app/(buyer)/seller/[id].tsx · screen 100 (buyer Seller Profile). Thin screen (guide §3):
// composes the REAL public seller contract — hero (initials + display name + rating/tenure tags), a 3-up stat
// grid, a Quick-facts card and Recent reviews — from features/buyer.sellerProfile / sellerSummary / sellerReviews,
// plus a Message CTA (opens a direct conversation) and an on-device Follow (save-seller) toggle. Behind `buyer_app`.
// Money would be bigint-minor (Law 2) via MoneyText — but the public browse contract carries no seller-scoped
// listing feed, so there are no prices to render here (see §13 below). Degrade-never-die: loading skeleton, a
// designed empty/error, and every missing datum shown honestly.
//
// §13 — the design mockup is SEED/demo content ("Ramesh Patel", "Anand · Gujarat", "42 / 187 / 156", the About
// paragraph, farm-size/crops/languages/response-time/on-time-%, the three listing cards, review author names).
// The real SellerPublicProfile contract is deliberately lean — {displayName, regionId, memberSince, rating{count,
// avgStars}, listingsActive} — and PublicReview is PII-free (no reviewer name). So we render only what the contract
// carries and degrade the rest, never fabricating:
//  • Location line ("Anand · Gujarat"): regionId is an opaque id with no cheap district→state resolution here →
//    the line is omitted (not guessed).
//  • VERIFIED ✓ badge: no verified flag on the contract → omitted.
//  • "N YRS ON KV": derived from memberSince (yearsOnKv) → shown only when a membership date exists.
//  • "Sales done" (187): no sales-count field → the stat shows "—".
//  • About paragraph + farm size / primary crops / languages / avg response time / on-time delivery: not on the
//    contract → the Quick-facts card shows only Member since (real); the rest is omitted.
//  • "Active listings (3)" cards: the public browse has no seller filter → we show the real active-listing COUNT
//    (listingsActive) with a "listings-not-yet-browsable" note, never invented listing cards/prices.
//  • Review author ("Anand Stores · 2 days ago"): PII-free contract → each review is labelled by its verified-
//    purchase status + real relative date, never an invented author.
//  • "View All Listings" CTA: no seller-scoped listing read → the footer offers the real actions (Message + Follow)
//    instead of a link that can't be honoured.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import type { ReviewSummary, SellerPublicProfile, PublicReview } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate, formatRelative } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { sellerSummary, sellerProfile, sellerReviews } from '../../../features/buyer/browse.api';
import { getSavedSellers, toggleSavedSeller } from '../../../features/buyer/saved.api';
import { openDirect } from '../../../features/messaging/messaging.api';
import { initials } from '../../../features/profile/profile';
import { yearsOnKv } from '../../../features/buyer/seller-profile';

export default function SellerProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('buyer_app');
  const [profile, setProfile] = useState<SellerPublicProfile | null>(null);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [messaging, setMessaging] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [p, s, r, saved] = await Promise.all([sellerProfile(id), sellerSummary(id), sellerReviews(id, 3), getSavedSellers()]);
    setProfile(p); setSummary(s); setReviews(r); setFollowing(saved.includes(id));
    setLoading(false);
  }, [id]);
  useFocusEffect(useCallback(() => { if (enabled) load(); }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title=" "><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const onFollow = async () => { if (!id) return; setFollowing((await toggleSavedSeller(id)).includes(id)); };
  const onMessage = async () => {
    if (!id || messaging) return;
    setMessaging(true);
    const convo = await openDirect(id).catch(() => null);
    setMessaging(false);
    if (convo) router.push({ pathname: '/(buyer)/chat/[id]', params: { id: convo.id, peerId: id } });
  };

  // Rating: prefer the profile's embedded rating, else the standalone summary (both real). null → "no rating yet".
  const rating = profile?.rating ?? (summary ? { count: summary.count, avgStars: summary.averageStars } : { count: 0, avgStars: 0 });
  const hasRating = rating.count > 0;
  const name = profile?.displayName?.trim() || t('seller.genericName');
  const tenure = yearsOnKv(profile?.memberSince);

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('seller.message')} variant="outline" onPress={onMessage} loading={messaging} />
      <View style={{ flex: 1 }}>
        <Button title={t(following ? 'seller.following' : 'seller.follow')} variant={following ? 'outline' : 'primary'} onPress={onFollow} fullWidth />
      </View>
    </View>
  );

  return (
    <ScreenScaffold title={t('seller.title')} scroll footer={footer} contentStyle={styles.content}>
      {loading ? (
        <View style={{ padding: space[5], gap: space[4] }}><SkeletonCard lines={3} /><SkeletonCard lines={4} /></View>
      ) : (
        <>
          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(name)}</Text></View>
            <Text style={styles.name}>{name}</Text>
            <View style={styles.tags}>
              {hasRating ? <StatusPill label={`★ ${rating.avgStars.toFixed(1)}`} tone="success" /> : null}
              {tenure !== null ? <StatusPill label={t('seller.yearsOnKv', { n: tenure })} tone="neutral" /> : null}
            </View>
          </View>

          {/* Stats */}
          <View style={styles.stats}>
            <Card style={styles.stat}>
              <Text style={styles.statVal}>{profile ? String(profile.listingsActive) : '—'}</Text>
              <Text style={styles.statLbl}>{t('seller.liveListings')}</Text>
            </Card>
            <Card style={styles.stat}>
              <Text style={styles.statVal}>—</Text>
              <Text style={styles.statLbl}>{t('seller.salesDone')}</Text>
            </Card>
            <Card style={styles.stat}>
              <Text style={styles.statVal}>{hasRating ? `★ ${rating.avgStars.toFixed(1)}` : '—'}</Text>
              <Text style={styles.statLbl}>{t('seller.reviewCount', { n: rating.count })}</Text>
            </Card>
          </View>

          {/* Quick facts — only fields the contract supplies */}
          {profile?.memberSince ? (
            <View style={styles.section}>
              <Text style={styles.h3}>{t('seller.quickFacts')}</Text>
              <Card>
                <View style={styles.row}>
                  <Text style={styles.rowL}>{t('seller.memberSince')}</Text>
                  <Text style={styles.rowV}>{safeDate(profile.memberSince, lang)}</Text>
                </View>
              </Card>
            </View>
          ) : null}

          {/* Active listings — real count; the seller-scoped feed isn't browsable yet (§13) */}
          <View style={styles.section}>
            <Text style={styles.h3}>{t('seller.activeListings', { n: profile?.listingsActive ?? 0 })}</Text>
            <Card><Text style={styles.note}>{t('seller.listingsComingSoon')}</Text></Card>
          </View>

          {/* Recent reviews — real, PII-free */}
          <View style={styles.section}>
            <Text style={styles.h3}>{t('seller.recentReviews')}</Text>
            {reviews.length === 0 ? (
              <Card><Text style={styles.note}>{t('seller.noReviews')}</Text></Card>
            ) : reviews.map((rv) => (
              <Card key={rv.id} style={styles.review}>
                <Text style={styles.stars}>{stars(rv.stars)}</Text>
                {rv.body ? <Text style={styles.reviewText}>{rv.body}</Text> : null}
                <Text style={styles.reviewMeta}>
                  {rv.isVerifiedPurchase ? `${t('seller.verifiedPurchase')} · ` : ''}{safeRelative(rv.createdAt, lang)}
                </Text>
              </Card>
            ))}
          </View>
        </>
      )}
    </ScreenScaffold>
  );
}

/** Filled/empty stars for a rounded rating (0–5). Pure, display-only. */
function stars(value: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}
function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { month: 'long', year: 'numeric' }); } catch { return '—'; } }
function safeRelative(iso: string, langCode: string): string { try { return formatRelative(iso, langCode); } catch { return ''; } }

const styles = StyleSheet.create({
  content: { padding: 0, gap: 0 },
  hero: { backgroundColor: color.primary800, paddingVertical: space[5], paddingHorizontal: space[5], alignItems: 'center' },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: color.white, alignItems: 'center', justifyContent: 'center', marginBottom: space[3] },
  avatarText: { fontFamily: font.display, fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: color.primary700 },
  name: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.white },
  tags: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  stats: { flexDirection: 'row', gap: space[3], paddingHorizontal: space[5], marginTop: -space[4], marginBottom: space[2] },
  stat: { flex: 1, alignItems: 'center' },
  statVal: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.primary700, lineHeight: font.size.lg * 1.1 },
  statLbl: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink500, marginTop: space[1], textAlign: 'center' },
  section: { paddingHorizontal: space[5], paddingTop: space[3], gap: space[2] },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[1] },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space[1] },
  rowL: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  rowV: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  review: { gap: space[1] },
  stars: { fontSize: font.size.md, color: color.accent500 },
  reviewText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, lineHeight: font.size.sm * 1.5 },
  reviewMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400 },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
