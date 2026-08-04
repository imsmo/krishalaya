// apps/mobile/src/app/(buyer)/profile.tsx · screen 132 (buyer Business Profile) + 133 (KYC status). Thin screen
// (guide §3): the buyer's identity hero (initials + business name + real buyer rating + a KYC-verified badge), a
// 3-up stat row, and the account utilities (KYC status, Saved/Addresses/Offers/Chats/Auctions, sign out). Behind
// `buyer_app`. Degrade-never-die (skeleton / friendly).
//
// §13 — the buyer's UserProfile contract is only {id, displayName, roles, locale}; there is NO business registry
// (GSTIN/PAN/FSSAI/business-type/owner/established), no region/"since", no email/website/phone on the profile or
// session (phone is deliberately NOT held client-side, §4), no buyer order-count / lifetime-spend read-model, and
// the KycDocument contract can't distinguish a GST vs FSSAI doc. So we render what's REAL — business name, buyer
// rating (reviews.summary buyer), KYC-verified status — and honestly degrade the Business-details / Contact /
// Procurement-preferences sections + the Orders/Lifetime stats to "—" + a note, never fabricating a GSTIN or "₹84L".
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { KycDocument, UserProfile, ReviewSummary } from '@krishalaya/sdk-js';
import { Button, Card, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, type PillTone } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useAuth } from '../../core/auth/auth.store';
import { listKyc } from '../../features/kyc/kyc.api';
import { getMyProfile, myBuyerRating } from '../../features/profile/profile.api';
import { initials, hasVerifiedKyc } from '../../features/profile/profile';

const KYC_TONE: Record<string, PillTone> = { verified: 'success', pending: 'warning', rejected: 'danger', expired: 'danger' };

export default function BuyerProfile() {
  const { t } = useTranslation();
  const router = useRouter();
  const { signOut } = useAuth();
  const enabled = useFlag('buyer_app');
  const kycEnabled = useFlag('kyc');
  const offersChat = useFlag('offers_chat');
  const auctionsOn = useFlag('auctions');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [rating, setRating] = useState<ReviewSummary | null>(null);
  const [kyc, setKyc] = useState<KycDocument[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const p = await getMyProfile();
    setProfile(p);
    setRating(p ? await myBuyerRating(p.id) : null);
    if (kycEnabled) setKyc(await listKyc());
    setLoading(false);
  }, [kycEnabled]);
  useFocusEffect(useCallback(() => { if (enabled) { load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('buyerProfile.title')} />;

  const latest = kyc?.[0];
  const name = profile?.displayName?.trim() || t('buyerProfile.genericName');
  const hasRating = !!rating && rating.count > 0;
  const ratingText = hasRating ? `★ ${rating!.averageStars.toFixed(1)}` : '—';
  const verified = hasVerifiedKyc(kyc);

  return (
    <ScreenScaffold title={t('buyerProfile.title')}>
      {loading ? <SkeletonCard lines={3} /> : (
        <>
          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(name)}</Text></View>
            <Text style={styles.name}>{name}</Text>
            <View style={styles.tags}>
              {hasRating ? <StatusPill label={ratingText} tone="success" /> : null}
              {verified ? <StatusPill label={t('buyerProfile.verified')} tone="success" /> : null}
            </View>
          </View>

          {/* Stats — rating is real; orders + lifetime are §13 (no read-model) → "—" */}
          <View style={styles.stats}>
            <Stat value="—" label={t('buyerProfile.orders')} />
            <Stat value="—" label={t('buyerProfile.lifetime')} />
            <Stat value={ratingText} label={t('buyerProfile.rating')} />
          </View>

          {/* Business details — real: business name + verification; the rest is §13 */}
          <Text style={styles.h3}>{t('buyerProfile.businessDetails')}</Text>
          <Card>
            <Row label={t('buyerProfile.businessName')} value={name} />
            <Row label={t('buyerProfile.verification')} pill={<StatusPill label={t(`kyc.status.${latest?.status ?? 'none'}`)} tone={latest ? (KYC_TONE[latest.status] ?? 'neutral') : 'neutral'} />} />
            <Text style={styles.note}>{t('buyerProfile.detailsNote')}</Text>
          </Card>

          {/* Contact — §13 (no phone/email/website on the profile contract) */}
          <Text style={styles.h3}>{t('buyerProfile.contact')}</Text>
          <Card><Text style={styles.note}>{t('buyerProfile.contactNote')}</Text></Card>

          {/* Procurement preferences — §13 (no contract) */}
          <Text style={styles.h3}>{t('buyerProfile.procurement')}</Text>
          <Card><Text style={styles.note}>{t('buyerProfile.procurementNote')}</Text></Card>

          {/* Account utilities */}
          <Text style={styles.h3}>{t('buyerProfile.account')}</Text>
          <View style={styles.links}>
            {kycEnabled ? <Pressable onPress={() => router.push('/(buyer)/kyc')} style={styles.link} accessibilityRole="button"><Text style={styles.linkText}>{t('businessKyc.title')}</Text></Pressable> : null}
            <Pressable onPress={() => router.push('/(buyer)/saved')} style={styles.link} accessibilityRole="button"><Text style={styles.linkText}>{t('buyer.tabs.saved')}</Text></Pressable>
            <Pressable onPress={() => router.push('/(buyer)/addresses')} style={styles.link} accessibilityRole="button"><Text style={styles.linkText}>{t('address.title')}</Text></Pressable>
            {offersChat ? <Pressable onPress={() => router.push('/(buyer)/offers')} style={styles.link} accessibilityRole="button"><Text style={styles.linkText}>{t('offer.title')}</Text></Pressable> : null}
            {offersChat ? <Pressable onPress={() => router.push('/(buyer)/chats')} style={styles.link} accessibilityRole="button"><Text style={styles.linkText}>{t('chat.title')}</Text></Pressable> : null}
            {auctionsOn ? <Pressable onPress={() => router.push('/(buyer)/auctions')} style={styles.link} accessibilityRole="button"><Text style={styles.linkText}>{t('auction.title')}</Text></Pressable> : null}
          </View>

          <View style={{ marginTop: space[5] }}>
            <Button title={t('profile.signOut')} variant="outline" onPress={() => signOut()} />
          </View>
        </>
      )}
    </ScreenScaffold>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Card style={styles.stat}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </Card>
  );
}
function Row({ label, value, pill }: { label: string; value?: string; pill?: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowL}>{label}</Text>
      {pill ?? <Text style={styles.rowV}>{value}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: space[4] },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center', marginBottom: space[3] },
  avatarText: { fontFamily: font.display, fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: color.primary700 },
  name: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800 },
  tags: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  stats: { flexDirection: 'row', gap: space[3], marginTop: space[2], marginBottom: space[2] },
  stat: { flex: 1, alignItems: 'center' },
  statVal: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.primary700 },
  statLbl: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink500, marginTop: space[1], textAlign: 'center' },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[1] },
  rowL: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  rowV: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800, flexShrink: 1, textAlign: 'right' },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[2] },
  links: { },
  link: { minHeight: 52, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: color.ink100 },
  linkText: { fontFamily: font.body, fontSize: font.size.md, color: color.ink800 },
});
