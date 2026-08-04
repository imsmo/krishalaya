// apps/mobile/src/app/(farmer)/listings/[id].tsx · screen 112 (My Listing detail) — rebuilt to the Phase-1
// design (Krishalaya_Design_System/screens/112-farmer-my-listing-detail.html): crop hero + status badge +
// photo count, title + ₹/quintal + meta line, a 7-day stats strip (Views · Inquiries · Offers), quick actions
// (Edit · Extend · Boost · Stats · Remove), Recent inquiries, and a Listing-health checklist. Thin screen over
// features/listings; degrade-never-die (Law 12); money via MoneyText (paise); ≥48px targets; i18n(hi/en/gu).
//
// Real data: title/price/qty/status (GET /listings/:id), Views + Offers + publishedAt (GET /listings/:id/analytics,
// owner-only — anti-IDOR), photo count (GET /listings/:id/media). Edit is real; Boost is a real paid wallet debit
// (payFromWallet) gated behind the `listing_boost` flag.
// EXTEND (KV-BL-031): a 1-30 day stepper + confirm → POST /listings/:id/extend (Idempotency-Key); the refreshed
// expiry comes straight back in the response (the read-model has no expiresAt field to show BEFORE extending, so
// none is shown until the caller actually extends — never fabricated).
// REMOVE (KV-MF-08): confirm → POST /listings/:id/archive (Idempotency-Key, owner-only) — terminal, no undo (the
// domain state machine has no transition out of 'archived'). The entity already had an `archive()` method with no
// service/controller caller (the same gap the other domains had already closed via their own archive endpoints);
// this wires the missing piece end to end rather than leaving a permanent "coming soon". On success: invalidate
// the owner list/detail caches and navigate back to My Listings (which re-fetches on focus).
// INQUIRIES (KV-BL-031): GET /listings/:id/inquiries → real buyer-inquiry rows (conversationId/lastMessagePreview/
// unreadCount; no buyer name on this contract, so rows show a generic "Buyer inquiry" label, never a fabricated
// name) → tap opens the existing cross-role chat thread screen. FLAGGED GAPS (§13, never faked): grade/moisture,
// fair-price + verified-location chips, and the lab-report health row are not exposed by the read-model yet →
// hidden / "coming soon".
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ListingCard, ListingAnalytics, ListingInquiry } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { EmptyState, MoneyText, SkeletonCard, Icon, color, font, space, radius, shadow } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getListing, listingAnalytics, listingMedia, extendListing, listingInquiries, archiveListing, addListingPhoto } from '../../../features/listings/listings.api';
import { relativeAge, healthItems, clampExtendDays, EXTEND_MIN_DAYS, EXTEND_MAX_DAYS, EXTEND_DEFAULT_DAYS, MAX_LISTING_PHOTOS, type RelativeAge } from '../../../features/listings/listing-detail';
import { cropEmoji } from '../../../features/listings/my-listings';
import { sdkErrorMessage } from '../../../core/errors/sdk-error-message';
import { captureFromCamera, pickFromGallery, uploadPickedImage, type PickedImage } from '../../../core/media';

function ageLabel(t: (k: string, p?: Record<string, string | number>) => string, a: RelativeAge | null): string | null {
  if (!a) return null;
  if (a.unit === 'today') return t('listingDetail.listedToday');
  return t(`listingDetail.listedAgo.${a.unit}`, { n: a.value });
}

export default function ListingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const boostOn = useFlag('listing_boost');
  const [listing, setListing] = useState<ListingCard | null>(null);
  const [analytics, setAnalytics] = useState<ListingAnalytics | null>(null);
  const [photoCount, setPhotoCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [inquiries, setInquiries] = useState<ListingInquiry[]>([]);

  // EXTEND panel state (screen 112 EXTEND cta, KV-BL-031).
  const [extending, setExtending] = useState(false);
  const [extendDays, setExtendDays] = useState(EXTEND_DEFAULT_DAYS);
  const [extendBusy, setExtendBusy] = useState(false);
  const [extendError, setExtendError] = useState<string | undefined>();
  const [newExpiresAt, setNewExpiresAt] = useState<string | null>(null);

  // REMOVE (KV-MF-08): busy flag guards the confirm dialog's action from a double-tap re-submitting the archive
  // while the first call is in flight (the Idempotency-Key already makes a retry safe server-side; this just
  // avoids a redundant second network call from an eager tap).
  const [removing, setRemoving] = useState(false);

  // ADD PHOTO (KV-MF-14): the "Listing health → Add more photos (N)" row used to be dead text — the count itself
  // was ALSO always 0 because create-time photos were written to a table (`listing_media`) that the gallery
  // read-model never queried (fixed server-side: both now use the real `media_links` table). This makes the row
  // a REAL action: pick/capture → upload (same core/media pipeline as Create Listing) → attach to THIS existing
  // listing (POST :id/photos, new — there was no such endpoint before) → refresh. `addingPhoto` guards a double
  // tap from firing a second picker/upload while the first is in flight.
  const [addingPhoto, setAddingPhoto] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    const [res, an, media, inq] = await Promise.all([getListing(id), listingAnalytics(id), listingMedia(id), listingInquiries(id)]);
    setListing(res.listing); setFailed(!res.listing);
    setAnalytics(an); setPhotoCount(media.length);
    setInquiries(inq.items);
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const onEdit = () => router.push({ pathname: '/(farmer)/listings/edit', params: { id: id! } });
  // Boost (screen 114) is a real paid action: wallet → chosen boost tier (server-resolved price). Gated behind
  // listing_boost; the tile only shows when the flag is on, and routes to the boost screen.
  const onBoost = () => router.push({ pathname: '/(farmer)/listings/boost', params: { id: id! } });
  // Repost (screen 116) — real re-publish for a fresh window; surfaced for expired/sold-out listings only.
  const onRepost = () => router.push({ pathname: '/(farmer)/listings/repost', params: { id: id! } });
  // REMOVE (KV-MF-08): confirm → POST /listings/:id/archive (owner-only, Idempotency-Key). Terminal — no undo —
  // so this always confirms first. On success: navigate back to My Listings, which re-fetches on focus
  // (useFocusEffect in (farmer)/listings/index.tsx) so the removed listing disappears immediately. On failure the
  // REAL server message is shown (sdkErrorMessage) rather than a generic string, so e.g. an illegal-state 409
  // ("Cannot move listing from pending_approval to archived") is never silently swallowed.
  const onRemove = () => {
    if (!id || removing) return;
    Alert.alert(
      t('listingDetail.remove'),
      t('listingDetail.removeConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('listingDetail.remove'),
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            try {
              await archiveListing(id);
              router.replace({ pathname: '/(farmer)/listings', params: { notice: t('listingDetail.removeDone') } });
            } catch (e) {
              Alert.alert(t('listingDetail.remove'), sdkErrorMessage(e) ?? t('common.error.generic'));
            } finally {
              setRemoving(false);
            }
          },
        },
      ],
    );
  };

  const onOpenExtend = () => { setExtending(true); setExtendError(undefined); setNewExpiresAt(null); };
  const onConfirmExtend = () => {
    if (!id || extendBusy) return;
    Alert.alert(
      t('listingDetail.extend.confirmTitle'),
      t('listingDetail.extend.confirmMessage', { n: extendDays }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('listingDetail.extend.cta'),
          onPress: async () => {
            setExtendBusy(true); setExtendError(undefined);
            try {
              const res = await extendListing(id, extendDays);
              setNewExpiresAt(res.expiresAt);
            } catch (e) {
              setExtendError(e instanceof SdkError && e.isValidation ? t('listingDetail.extend.invalidDays') : t('common.error.generic'));
            } finally { setExtendBusy(false); }
          },
        },
      ],
    );
  };
  // ADD PHOTO (KV-MF-14): pick/capture → upload (core/media, same pipeline as Create Listing) → attach to THIS
  // already-created listing → reload the detail (so photoCount/gallery/hero tag all come back from the SAME
  // real read, never a locally-guessed count). A real upload/attach failure (e.g. the 10-photo cap) surfaces the
  // server's own message via sdkErrorMessage, same convention as EXTEND/REMOVE — never silently swallowed.
  const onAddPhoto = async (pick: () => Promise<PickedImage | null>) => {
    if (!id || addingPhoto) return;
    const picked = await pick();
    if (!picked) return;
    setAddingPhoto(true);
    try {
      const uploaded = await uploadPickedImage(picked);
      if (uploaded.queued || !uploaded.mediaId) {
        Alert.alert(t('listingDetail.health.addPhoto'), t('createListing.queued'));
        return;
      }
      await addListingPhoto(id, uploaded.mediaId);
      await load();
    } catch (e) {
      Alert.alert(t('listingDetail.health.addPhoto'), sdkErrorMessage(e) ?? t('common.error.generic'));
    } finally {
      setAddingPhoto(false);
    }
  };
  const onOpenAddPhoto = () => {
    if (photoCount >= MAX_LISTING_PHOTOS) { Alert.alert(t('listingDetail.health.addPhoto'), t('listingDetail.health.photosMax', { n: MAX_LISTING_PHOTOS })); return; }
    Alert.alert(t('createListing.photoSource'), undefined, [
      { text: t('createListing.camera'), onPress: () => onAddPhoto(captureFromCamera) },
      { text: t('createListing.gallery'), onPress: () => onAddPhoto(pickFromGallery) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };
  const onOpenInquiry = (inq: ListingInquiry) => router.push({
    pathname: '/(system)/chat/[id]',
    params: { id: inq.conversationId, ...(inq.buyerUserId ? { peerId: inq.buyerUserId } : {}), context: 'listing' },
  });

  const statusKey = listing?.status === 'draft' ? 'preview.status.draft' : listing?.status === 'sold' ? 'listings.badge.sold' : 'listingDetail.statusActive';
  const listed = ageLabel(t, relativeAge(analytics?.publishedAt));
  const health = listing ? healthItems({ photoCount, boostActive: !!analytics?.activeBoost }) : [];
  const newExpiresLabel = newExpiresAt ? (() => { try { return formatDate(newExpiresAt, lang, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return newExpiresAt; } })() : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.appbar}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={styles.backBtn}>
          <Icon name="arrow-left" size={20} color={color.ink700} />
        </Pressable>
        <Text style={styles.appbarTitle}>{t('listingDetail.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.body}><SkeletonCard lines={3} /><View style={{ height: space[3] }} /><SkeletonCard lines={5} /></View>
      ) : !listing || failed ? (
        <View style={styles.body}><EmptyState title={t('listings.unavailable')} actionLabel={t('common.retry')} onAction={load} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Hero */}
          <View style={styles.hero}>
            <Text style={styles.heroEmoji}>{cropEmoji(listing.title)}</Text>
            <View style={styles.heroBadge}><Text style={styles.heroBadgeTxt}>✓ {t(statusKey)}</Text></View>
            {photoCount > 0 ? <View style={styles.photoTag}><Text style={styles.photoTagTxt}>📷 {t('listingDetail.photos', { n: photoCount })}</Text></View> : null}
          </View>

          {/* Title + price + meta */}
          <Text style={styles.title}>{listing.title}</Text>
          <View style={styles.priceRow}>
            <MoneyText minor={listing.priceMinor} currencyCode={listing.currencyCode} langCode={lang} size="xl" />
            <Text style={styles.perUnit}> / {listing.unitCode}</Text>
          </View>
          <Text style={styles.meta}>
            {t('listingDetail.available', { n: listing.quantityAvailable, unit: listing.unitCode })}
            {listing.organicClaim ? ` · ${t('listings.organic')}` : ''}
            {listed ? ` · ${listed}` : ''}
          </Text>

          {/* 7-day stats */}
          <Text style={styles.sectionLabel}>{t('listingDetail.last7')}</Text>
          <View style={styles.statsRow}>
            <StatCell value={analytics ? String(analytics.views) : '—'} label={t('listingDetail.views')} tone={color.primary600} />
            <StatCell value={String(inquiries.length)} label={t('listingDetail.inquiries')} tone={color.info} />
            <StatCell value={analytics ? String(analytics.offers) : '—'} label={t('listingDetail.offers')} tone={color.accent700} />
          </View>

          {/* Quick actions */}
          <View style={styles.actions}>
            <ActionTile icon="✏️" label={t('listingDetail.edit')} onPress={onEdit} />
            {listing.status === 'expired' || listing.status === 'sold_out' ? (
              <ActionTile icon="♻️" label={t('listingDetail.repost')} onPress={onRepost} />
            ) : listing.status === 'published' ? (
              // EXTEND is only valid on an already-'published' listing (the domain entity rejects any other
              // status) — never shown for draft/paused/rejected/pending_approval, matching the server rule.
              <ActionTile icon="⏰" label={t('listingDetail.extend.cta')} onPress={onOpenExtend} />
            ) : null}
            {boostOn ? <ActionTile icon="🚀" label={t('listingDetail.boost')} onPress={onBoost} /> : null}
            <ActionTile icon="📊" label={t('listingDetail.stats')} onPress={() => router.push({ pathname: '/(farmer)/listings/analytics', params: { id: id! } })} />
            <ActionTile icon="🗑" label={t('listingDetail.remove')} onPress={onRemove} danger />
          </View>

          {/* EXTEND panel (screen 112 EXTEND cta, KV-BL-031): 1-30 day stepper → confirm → refreshed expiry. */}
          {extending ? (
            <View style={styles.extendPanel}>
              <Text style={styles.extendTitle}>{t('listingDetail.extend.title')}</Text>
              {newExpiresLabel ? (
                <>
                  <Text style={styles.extendDone}>{t('listingDetail.extend.done', { date: newExpiresLabel })}</Text>
                  <Pressable onPress={() => setExtending(false)} accessibilityRole="button" style={styles.extendCloseBtn}>
                    <Text style={styles.extendCloseTxt}>{t('common.ok')}</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <View style={styles.stepperRow}>
                    <Pressable
                      onPress={() => setExtendDays((d) => clampExtendDays(d - 1))}
                      disabled={extendDays <= EXTEND_MIN_DAYS}
                      accessibilityRole="button" accessibilityLabel={t('listingDetail.extend.minus')}
                      style={[styles.stepperBtn, extendDays <= EXTEND_MIN_DAYS && styles.stepperBtnOff]}
                    >
                      <Text style={styles.stepperGlyph}>−</Text>
                    </Pressable>
                    <Text style={styles.stepperValue}>{t('listingDetail.extend.days', { n: extendDays })}</Text>
                    <Pressable
                      onPress={() => setExtendDays((d) => clampExtendDays(d + 1))}
                      disabled={extendDays >= EXTEND_MAX_DAYS}
                      accessibilityRole="button" accessibilityLabel={t('listingDetail.extend.plus')}
                      style={[styles.stepperBtn, extendDays >= EXTEND_MAX_DAYS && styles.stepperBtnOff]}
                    >
                      <Text style={styles.stepperGlyph}>+</Text>
                    </Pressable>
                  </View>
                  {extendError ? <Text style={styles.extendError}>{extendError}</Text> : null}
                  <View style={styles.extendActions}>
                    <Pressable onPress={() => setExtending(false)} disabled={extendBusy} accessibilityRole="button" style={styles.extendCancelBtn}>
                      <Text style={styles.extendCancelTxt}>{t('common.cancel')}</Text>
                    </Pressable>
                    <Pressable onPress={onConfirmExtend} disabled={extendBusy} accessibilityRole="button" style={styles.extendConfirmBtn}>
                      <Text style={styles.extendConfirmTxt}>{extendBusy ? t('common.loading') : t('listingDetail.extend.confirm')}</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          ) : null}

          {/* Recent inquiries (KV-BL-031): real buyer-inquiry rows → tap opens the chat thread. */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{t('listingDetail.recentInquiries')}</Text>
          </View>
          {inquiries.length === 0 ? (
            <View style={styles.inqEmpty}>
              <Text style={styles.inqEmptyTxt}>{t('listingDetail.inquiriesEmpty')}</Text>
            </View>
          ) : (
            <View style={styles.inqList}>
              {inquiries.map((inq) => (
                <Pressable key={inq.conversationId} onPress={() => onOpenInquiry(inq)} accessibilityRole="button" style={styles.inqRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.inqFrom} numberOfLines={1}>{t('listingDetail.inquiryFrom')}</Text>
                    <Text style={styles.inqPreview} numberOfLines={1}>{inq.lastMessagePreview || t('listingDetail.inquiryNoPreview')}</Text>
                  </View>
                  {inq.unreadCount > 0 ? <View style={styles.inqBadge}><Text style={styles.inqBadgeTxt}>{inq.unreadCount}</Text></View> : <Text style={styles.chev}>›</Text>}
                </Pressable>
              ))}
            </View>
          )}

          {/* Listing health (from real photo count + boost; lab-report/expiry rows flagged) */}
          <Text style={[styles.sectionTitle, { marginTop: space[5], marginBottom: space[2] }]}>{t('listingDetail.health')}</Text>
          <View style={styles.healthCard}>
            {health.map((h) => {
              const row = (
                <View style={styles.healthRow}>
                  <Text style={[styles.healthIcon, { color: h.tone === 'good' ? color.successDark : color.accent700 }]}>{h.tone === 'good' ? '✓' : '⚠'}</Text>
                  <Text style={styles.healthTxt}>{t(h.labelKey, { n: h.count ?? 0 })}</Text>
                  {h.actionable ? <Text style={styles.healthChev}>{addingPhoto ? '…' : '›'}</Text> : null}
                </View>
              );
              // KV-MF-14: the photo row is a REAL cta (opens the same picker→upload→attach flow as Create
              // Listing), not dead text — every other row (boosted, and any future non-photo rows) stays
              // informational-only, matching the design's checklist intent.
              return h.actionable ? (
                <Pressable key={h.id} onPress={onOpenAddPhoto} disabled={addingPhoto} accessibilityRole="button" accessibilityLabel={t('listingDetail.health.addPhoto')}>
                  {row}
                </Pressable>
              ) : (
                <View key={h.id}>{row}</View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StatCell({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={[styles.statVal, { color: tone }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
function ActionTile({ icon, label, onPress, danger }: { icon: string; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable style={styles.tile} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={styles.tileIcon}>{icon}</Text>
      <Text style={[styles.tileLabel, danger && { color: color.dangerDark }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[2] },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },
  appbarTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  body: { flex: 1, padding: space[5] },
  scroll: { paddingHorizontal: space[5], paddingBottom: space[6] },

  hero: { height: 180, borderRadius: radius.lg, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.earth200, overflow: 'hidden' },
  heroEmoji: { fontSize: 72 },
  heroBadge: { position: 'absolute', top: space[3], left: space[3], backgroundColor: color.successLight, borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 10 },
  heroBadgeTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.successDark, letterSpacing: 0.4 },
  photoTag: { position: 'absolute', bottom: space[3], right: space[3], backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 10 },
  photoTagTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.white },

  title: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], letterSpacing: -0.3 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: space[1] },
  perUnit: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500 },
  meta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[1], lineHeight: 20 },

  sectionLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink400, letterSpacing: 0.5, marginTop: space[5], marginBottom: space[2], textTransform: 'uppercase' },
  statsRow: { flexDirection: 'row', gap: space[2] },
  statCell: { flex: 1, backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.md, paddingVertical: space[3], alignItems: 'center', ...shadow.card },
  statVal: { fontFamily: font.display, fontSize: font.size['2xl'], fontWeight: font.weight.bold, letterSpacing: -0.3 },
  statLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },

  actions: { flexDirection: 'row', gap: space[2], marginTop: space[4] },
  tile: { flex: 1, minHeight: 64, backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: space[2] },
  tileIcon: { fontSize: 22 },
  tileLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink700 },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[5], marginBottom: space[2] },
  sectionTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  viewAll: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  inqEmpty: { padding: space[4], borderRadius: radius.md, backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderStyle: 'dashed' },
  inqEmptyTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, textAlign: 'center' },

  healthCard: { backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.lg, paddingHorizontal: space[4], ...shadow.card },
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3], borderTopWidth: 1, borderTopColor: color.ink100 },
  healthIcon: { fontSize: font.size.md, fontWeight: font.weight.bold, width: 18, textAlign: 'center' },
  healthTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink700 },
  healthChev: { fontFamily: font.body, fontSize: font.size.lg, color: color.ink400, marginLeft: space[2] },

  extendPanel: { marginTop: space[4], padding: space[4], borderRadius: radius.lg, backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, ...shadow.card },
  extendTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[3] },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[4] },
  stepperBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: color.primary50, borderWidth: 1, borderColor: color.primary200 },
  stepperBtnOff: { opacity: 0.4 },
  stepperGlyph: { fontFamily: font.body, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.primary700 },
  stepperValue: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, minWidth: 96, textAlign: 'center' },
  extendError: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, textAlign: 'center', marginTop: space[3] },
  extendActions: { flexDirection: 'row', gap: space[2], marginTop: space[4] },
  extendCancelBtn: { flex: 1, minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.earth200 },
  extendCancelTxt: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink700 },
  extendConfirmBtn: { flex: 1.4, minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: color.primary600 },
  extendConfirmTxt: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.white },
  extendDone: { fontFamily: font.body, fontSize: font.size.sm, color: color.successDark, textAlign: 'center' },
  extendCloseBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: space[3] },
  extendCloseTxt: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary700 },

  inqList: { gap: space[2] },
  inqRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 56, padding: space[3], borderRadius: radius.md, backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },
  inqFrom: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  inqPreview: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  inqBadge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: color.primary600, alignItems: 'center', justifyContent: 'center' },
  inqBadgeTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.white },
  chev: { fontFamily: font.body, fontSize: font.size.xl, color: color.ink400 },
});
