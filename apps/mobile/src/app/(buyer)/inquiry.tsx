// apps/mobile/src/app/(buyer)/inquiry.tsx · screen 97 "Send Inquiry". Thin screen (guide §3): compose the first
// message of a direct conversation with the seller about a listing. Quick templates prefill the box; a 500-char
// message (unicode-safe counter) sends via messaging.sendInquiry (openDirect + postText, idempotent Law 3) →
// navigate to the chat thread. Reads the real listing (title/price/qty/unit) via getPublicListing. Behind
// `buyer_app`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • Seller NAME ("Ramesh Patel") + crop emoji: the public listing read-model has sellerUserId (not a name) and no
//    product/category → a generic seller label + neutral 📦 glyph; never an invented name/crop.
//  • The pre-filled demo message ("Namaste Ramesh ji … — Priya Mehta") is seed data → the box starts EMPTY; a
//    template or the buyer's own words fill it. We never fabricate a signed paragraph.
//  • "Auto-translated to seller's language": there is no client translation contract → shown as an informational
//    note only (the server/seller side handles locale); the message is sent verbatim, never fake-translated.
//  • Attach photos: attachments post to an EXISTING conversation (core/media flow) → on this pre-send compose the
//    tile is a disabled "add in chat" affordance (coming soon), never a broken control. "Save Draft": no draft
//    endpoint → coming-soon (disabled), never a silent no-op that claims success.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SdkError, type ListingCard } from '@krishalaya/sdk-js';
import { Button, Input, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { getPublicListing } from '../../features/buyer/browse.api';
import { sendInquiry } from '../../features/messaging/messaging.api';
import { INQUIRY_TEMPLATE_KEYS, MAX_INQUIRY_LEN, inquiryCharCount, isSendableInquiry } from '../../features/buyer/inquiry';

export default function BuyerInquiry() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('buyer_app');
  const [listing, setListing] = useState<ListingCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!listingId) { setFailed(true); setLoading(false); return; }
    setLoading(true); setFailed(false);
    const l = await getPublicListing(listingId);
    setListing(l); setFailed(!l); setLoading(false);
  }, [listingId]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('inquiry.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const pickTemplate = (key: string) => { setSelected(key); setText(t(`inquiry.tpl.${key}`)); setError(undefined); };
  const onChange = (v: string) => { setText(v); setSelected(null); };

  const onSend = async () => {
    if (!listing || !isSendableInquiry(text)) { setError(t('inquiry.invalid')); return; }
    setBusy(true); setError(undefined);
    try {
      const convo = await sendInquiry(listing.sellerUserId, listing.id, text);
      router.replace({ pathname: '/(buyer)/chat/[id]', params: { id: convo.id, notice: t('inquiry.sent') } });
    } catch (e) {
      setError(e instanceof SdkError && e.isForbidden ? t('inquiry.notAllowed') : t('inquiry.failed'));
    } finally { setBusy(false); }
  };

  const count = inquiryCharCount(text);
  const sendable = !!listing && isSendableInquiry(text) && !busy;

  const footer = (
    <View style={styles.ctaBar}>
      <View style={{ flex: 1 }}><Button title={t('inquiry.saveDraft')} variant="outline" disabled onPress={() => {}} /></View>
      <View style={{ flex: 1.5 }}><Button title={t('inquiry.send')} onPress={onSend} disabled={!sendable} loading={busy} /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('inquiry.title')} scroll={false} footer={listing ? footer : undefined}>
      {loading ? <View style={{ padding: space[4] }}><SkeletonCard lines={6} /></View> : !listing || failed ? (
        <EmptyState title={t('inquiry.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: space[6] }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Listing summary */}
          <View style={styles.listing}>
            <View style={styles.thumb} accessibilityElementsHidden importantForAccessibility="no"><Text style={styles.thumbGlyph}>📦</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.lTitle} numberOfLines={1}>{listing.title}</Text>
              <Text style={styles.lMeta}>{t('inquiry.availMeta', { seller: t('inquiry.sellerGeneric'), n: listing.quantityAvailable, unit: t(`units.${listing.unitCode}`) })}</Text>
              <View style={styles.priceLine}>
                <MoneyText minor={listing.priceMinor} currencyCode={listing.currencyCode} langCode={lang} size="sm" />
                <Text style={styles.per}> / {t(`units.${listing.unitCode}`)}</Text>
              </View>
            </View>
          </View>

          {/* Quick templates */}
          <View style={styles.section}>
            <Text style={styles.h3}>{t('inquiry.templates')}</Text>
            {INQUIRY_TEMPLATE_KEYS.map((k) => {
              const on = selected === k;
              return (
                <Pressable key={k} onPress={() => pickTemplate(k)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.tpl, on && styles.tplOn]}>
                  <Text style={[styles.tplTxt, on && styles.tplTxtOn]}>{t(`inquiry.tpl.${k}`)}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Or write your own */}
          <View style={styles.section}>
            <Text style={styles.h3}>{t('inquiry.own')}</Text>
            <Input value={text} onChangeText={onChange} placeholder={t('inquiry.placeholder')} multiline maxLength={MAX_INQUIRY_LEN} error={error} />
            <View style={styles.metaRow}>
              <Text style={styles.metaNote}>{t('inquiry.autoTranslate')}</Text>
              <Text style={[styles.count, count > MAX_INQUIRY_LEN && styles.countOver]}>{t('inquiry.count', { n: count, max: MAX_INQUIRY_LEN })}</Text>
            </View>
          </View>

          {/* Attach photos — §13 coming soon (attachments post to an existing conversation) */}
          <View style={styles.section}>
            <Text style={styles.h3}>{t('inquiry.attach')}</Text>
            <View style={styles.addTile} accessibilityElementsHidden>
              <Text style={styles.addGlyph}>📷</Text>
              <Text style={styles.addTxt}>{t('inquiry.add')}</Text>
            </View>
            <Text style={styles.soon}>{t('inquiry.attachSoon')}</Text>
          </View>

          {/* Reply-time / privacy note */}
          <View style={styles.note}><Text style={styles.noteTxt}>{t('inquiry.replyNote')}</Text></View>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  listing: { flexDirection: 'row', gap: space[3], alignItems: 'center', margin: space[4], padding: space[3], backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.md },
  thumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: color.accent50, alignItems: 'center', justifyContent: 'center' },
  thumbGlyph: { fontSize: 26 },
  lTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  lMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', marginTop: 2 },
  per: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  section: { paddingHorizontal: space[4], paddingVertical: space[2] },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  tpl: { padding: space[3], backgroundColor: color.card, borderWidth: 1.5, borderColor: color.ink200, borderRadius: radius.md, marginBottom: space[2] },
  tplOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  tplTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, lineHeight: 20 },
  tplTxtOn: { color: color.primary800 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  metaNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, flex: 1 },
  count: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  countOver: { color: color.dangerDark },
  addTile: { width: 64, height: 64, borderWidth: 2, borderColor: color.ink200, borderStyle: 'dashed', borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', opacity: 0.6 },
  addGlyph: { fontSize: 20 },
  addTxt: { fontFamily: font.body, fontSize: 9, fontWeight: font.weight.semibold, color: color.ink500, marginTop: 2 },
  soon: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: 4 },
  note: { margin: space[4], marginTop: space[2], padding: space[3], backgroundColor: color.infoLight, borderRadius: radius.md },
  noteTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.infoDark, lineHeight: 18 },
  ctaBar: { flexDirection: 'row', gap: space[2] },
});
