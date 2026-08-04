// apps/mobile/src/app/(farmer)/orders/review.tsx · screen 24 "Rate Your Order" (review after completion). Thin
// screen (guide §3): a completed-order banner (real orderNo from getOrder), a 1–5 star rating + derived quality
// word, the "What went well?" tag chips, an optional comment with the design's 500-char counter, and Skip /
// Submit. The review TARGET (who is reviewed) is resolved SERVER-SIDE from the completed order (anti-IDOR) — the
// client never sends a target id. Submit is idempotent (Law 3). Behind `orders_fulfilment`. Degrade-never-die:
// a not-eligible/duplicate error shows a friendly message; a missing orderNo degrades to generic copy.
// §13: the CreateReview contract has NO photo/media field, so "Add photos" is rendered but honestly marked
// coming-soon rather than wired to a fake upload.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { OrderDetail, OrderRole } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Input, EmptyState, ScreenScaffold, SkeletonCard, Icon, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getOrder } from '../../../features/orders/orders.api';
import { submitReview } from '../../../features/reviews/reviews.api';
import { ratingLabelKey, ratingNumber, REVIEW_TAGS, REVIEW_BODY_MAX, toggleTag, canSubmitReview } from '../../../features/reviews/review-form';

const STARS = [1, 2, 3, 4, 5];

export default function ReviewOrder() {
  const { orderId, party, role } = useLocalSearchParams<{ orderId: string; party?: string; role?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('orders_fulfilment');
  const orderRole: OrderRole = role === 'buyer' ? 'buyer' : 'seller';

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!orderId) { setLoading(false); return; }
    setLoading(true);
    const o = await getOrder(orderId).catch(() => null);
    setOrder(o); setLoading(false);
  }, [orderId]);
  useEffect(() => { load(); }, [load]);

  if (!enabled) return <ScreenScaffold title={t('review.title')}><EmptyState title={t('orders.unavailable')} /></ScreenScaffold>;

  const onSubmit = async () => {
    if (!orderId || !canSubmitReview(stars)) { setError(t('review.pickStars')); return; }
    setBusy(true); setError(undefined);
    try {
      await submitReview({ orderId, stars, body: body.trim() || undefined, tags: tags.length ? tags : undefined });
      router.replace({ pathname: '/(farmer)/orders', params: { notice: t('review.thanks') } });
    } catch (e) {
      setError(e instanceof SdkError && e.isConflict ? t('review.already')
        : e instanceof SdkError && e.isForbidden ? t('review.notEligible') : t('review.failed'));
    } finally { setBusy(false); }
  };

  const onSkip = () => router.replace({ pathname: '/(farmer)/orders', params: { role } });
  // §13: no review-media field in the contract yet → honest coming-soon, not a fake uploader.
  const onAddPhoto = () => Alert.alert(t('review.photo.title'), t('review.photo.soon'));

  const partyName = typeof party === 'string' && party.trim() ? party.trim() : null;
  const targetKey = orderRole === 'buyer' ? 'review.rateSeller' : 'review.rateBuyer';
  const labelKey = ratingLabelKey(stars);

  return (
    <ScreenScaffold
      title={t('review.title')}
      footer={
        <View style={styles.footer}>
          <Button title={t('review.skip')} variant="outline" onPress={onSkip} disabled={busy} />
          <View style={{ flex: 1 }}>
            <Button title={t('review.submit')} onPress={onSubmit} loading={busy} disabled={!canSubmitReview(stars)} />
          </View>
        </View>
      }
    >
      {loading ? <SkeletonCard lines={8} /> : (
        <>
          {/* Completed banner */}
          <View style={styles.banner}>
            <View style={styles.badge}><Icon name="check" size={14} color={color.white} /><Text style={styles.badgeTxt}>{t('review.completed')}</Text></View>
            <Text style={styles.bannerTitle}>{t('review.deliveredOk')}</Text>
            <Text style={styles.bannerSub}>
              {order ? t('review.completedFor', { id: order.orderNo }) : t('review.completedGeneric')}
            </Text>
          </View>

          {/* Star rating */}
          <Text style={styles.section}>{t('review.howWas')}</Text>
          <Text style={styles.rateTarget}>{partyName ? t(targetKey, { name: partyName }) : t(`${targetKey}.generic`)}</Text>
          <View style={styles.stars} accessibilityRole="adjustable" accessibilityLabel={t('review.stars', { n: stars })}>
            {STARS.map((s) => (
              <Pressable key={s} onPress={() => setStars(s)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('review.starN', { n: s })}>
                <Text style={[styles.star, s <= stars && styles.starOn]}>{s <= stars ? '★' : '☆'}</Text>
              </Pressable>
            ))}
          </View>
          {labelKey ? <Text style={styles.ratingWord}>{ratingNumber(stars)} — {t(`review.word.${labelKey}`)}</Text> : null}

          {/* What went well — tag chips */}
          <Text style={[styles.section, { marginTop: space[5] }]}>{t('review.wentWell')}</Text>
          <View style={styles.chips}>
            {REVIEW_TAGS.map((tag) => {
              const on = tags.includes(tag.code);
              return (
                <Pressable key={tag.code} onPress={() => setTags((cur) => toggleTag(cur, tag.code))}
                  style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  {on ? <Icon name="check" size={13} color={color.primary700} /> : null}
                  <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{t(tag.labelKey)}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Comment + counter */}
          <View style={{ marginTop: space[5] }}>
            <Input label={t('review.noteLabel')} value={body} onChangeText={setBody} multiline maxLength={REVIEW_BODY_MAX} error={error}
              placeholder={t('review.notePlaceholder')} />
            <Text style={styles.counter}>{[...body].length} / {REVIEW_BODY_MAX}</Text>
          </View>

          {/* Add photos (optional) — §13 coming-soon */}
          <Text style={[styles.section, { marginTop: space[5] }]}>{t('review.addPhotos')}</Text>
          <Pressable style={styles.photoTile} onPress={onAddPhoto} accessibilityRole="button">
            <Icon name="camera" size={22} color={color.ink500} />
            <Text style={styles.photoTxt}>{t('review.addPhoto')}</Text>
          </Pressable>
        </>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: space[3], alignItems: 'center' },

  banner: { backgroundColor: color.successLight, borderRadius: radius.lg, padding: space[4], alignItems: 'center', gap: space[2], marginBottom: space[5] },
  badge: { flexDirection: 'row', alignItems: 'center', gap: space[1], backgroundColor: color.success, paddingHorizontal: space[3], paddingVertical: 4, borderRadius: radius.pill },
  badgeTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.white, fontWeight: font.weight.bold },
  bannerTitle: { fontFamily: font.display, fontSize: font.size.lg, color: color.successDark, fontWeight: font.weight.bold, textAlign: 'center' },
  bannerSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, textAlign: 'center' },

  section: { fontFamily: font.display, fontSize: font.size.lg, color: color.ink900, fontWeight: font.weight.bold, marginBottom: space[2] },
  rateTarget: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600, marginBottom: space[3] },
  stars: { flexDirection: 'row', gap: space[2], justifyContent: 'center' },
  star: { fontSize: 42, color: color.ink300 },
  starOn: { color: color.accent500 },
  ratingWord: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700, fontWeight: font.weight.semibold, textAlign: 'center', marginTop: space[2] },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space[1], paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.pill, borderWidth: 1, borderColor: color.ink200, backgroundColor: color.white },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  chipTxtOn: { color: color.primary700, fontWeight: font.weight.semibold },

  counter: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'right', marginTop: 4 },

  photoTile: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], paddingVertical: space[4], borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: color.ink300 },
  photoTxt: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500, fontWeight: font.weight.semibold },
});
