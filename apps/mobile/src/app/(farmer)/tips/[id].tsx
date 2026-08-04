// apps/mobile/src/app/(farmer)/tips/[id].tsx · screen 101 "Tip Detail". Thin screen (guide §3): a curated tip's
// hero (kind tag + title + byline), Save / Share / open-asset actions, the article body, and REAL related tips
// from the same cached catalogue (PURE relatedTips). The bookmark toggle is SERVER-persisted (buyer/saves
// entityType='tip', P1-16) with an offline mirror. Behind `tips_assistant`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • AUTHOR byline ("Dr. Mehta · ICAR") — the resource read-model carries ownerUserId (uuid) but no author NAME/
//    affiliation, so the byline shows the REAL derived read-time + content language, not an invented name.
//  • "🎧 Listen / Read aloud by AI" — there is no TTS contract → shown as a coming-soon affordance, never a fake
//    player. Duration is the derived read-time estimate.
//  • The design's STRUCTURED sections (Signs / Treatment / Prevention / quick-check / cost) are curated CMS blocks
//    the contract doesn't carry — only free-text `body`. We render the real body; the structured layout awaits a
//    structured-content contract. NEVER fabricate (no invented chemical/dosage/cost).
//  • "Apply" action — no "apply tip" contract → omitted (not wired to a fake mutation).
//  • Related-tip READ COUNTS ("12.4k reads") — no contract → omitted; titles/kind/read-time are real.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking, Share, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { LearningResource } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getTipDetail, tipMediaUrl, loadSavedTips, saveTip, unsaveTip } from '../../../features/content/content.api';
import { kindLabelKey, kindTone, tipSnapshot, isSaved, readTimeMinutes, languageLabelKey, type TipSnapshot } from '../../../features/content/content';

function kindGlyph(kind: string): string {
  switch (kind) {
    case 'video': return '📹';
    case 'audio': return '🎧';
    case 'blog': return '📝';
    case 'post': return '📣';
    default: return '🌾';
  }
}
const LANG_FLAG: Record<string, string> = { hi: '🇮🇳', gu: '🇮🇳', en: '🇬🇧', other: '🌐' };

export default function TipDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tips_assistant');
  const [tip, setTip] = useState<LearningResource | null>(null);
  const [related, setRelated] = useState<LearningResource[]>([]);
  const [saved, setSaved] = useState<TipSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    setLoading(true);
    const [d, s] = await Promise.all([getTipDetail(id), loadSavedTips()]);
    setTip(d.tip); setRelated(d.related); setSaved(s); setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('content.tips.detailTitle')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const bookmarked = tip ? isSaved(saved, tip.id) : false;
  const toggle = async () => {
    if (!tip) return;
    setSaved(bookmarked ? await unsaveTip(tip.id, saved) : await saveTip(tipSnapshot(tip), saved));
  };
  const share = async () => {
    if (!tip) return;
    try { await Share.share({ message: tip.externalUrl ? `${tip.title}\n${tip.externalUrl}` : tip.title }); } catch { /* user cancelled / unavailable */ }
  };
  const openAsset = async () => {
    if (!tip) return;
    let url = tip.externalUrl;
    if (!url && tip.mediaId) url = await tipMediaUrl(tip.mediaId);
    if (url && /^https:\/\//i.test(url)) Linking.openURL(url).catch(() => Alert.alert(t('content.tips.detailTitle'), t('common.error.generic')));
    else Alert.alert(t('content.tips.detailTitle'), t('content.tips.noAsset'));
  };

  return (
    <ScreenScaffold title={t('content.tips.detailTitle')}>
      {loading ? <SkeletonCard lines={8} /> : !tip ? (
        <EmptyState title={t('content.tips.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[6] }}>
          {/* Hero: kind tag, title, byline (§13: read-time + language, no author name) */}
          <View style={styles.hero}>
            <StatusPill label={t(kindLabelKey(tip.kind))} tone={kindTone(tip.kind)} />
            <Text style={styles.title}>{tip.title}</Text>
            <Text style={styles.byline}>
              🕐 {t('content.readTime', { n: readTimeMinutes(tip.body) })}
              {'   '}{LANG_FLAG[languageLabelKey(tip.languageCode)] ?? '🌐'} {t(`content.lang.${languageLabelKey(tip.languageCode)}`)}
            </Text>
            <View style={styles.actions}>
              <Pressable onPress={toggle} accessibilityRole="button" accessibilityState={{ selected: bookmarked }} style={[styles.actBtn, bookmarked && styles.actBtnOn]}>
                <Text style={[styles.actTxt, bookmarked && styles.actTxtOn]}>{bookmarked ? `🔖 ${t('tipDetail.bookmarked')}` : `🔖 ${t('tipDetail.save')}`}</Text>
              </Pressable>
              <Pressable onPress={share} accessibilityRole="button" style={styles.actBtn}>
                <Text style={styles.actTxt}>↗ {t('tipDetail.share')}</Text>
              </Pressable>
            </View>
          </View>

          {/* Listen — §13: no TTS contract → coming-soon affordance, never a fake player */}
          <Card style={{ marginTop: space[3] }}>
            <View style={styles.listenRow}>
              <Text style={styles.listenGlyph}>🎧</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.listenTitle}>{t('tipDetail.listenTitle')}</Text>
                <Text style={styles.listenSub}>{t('tipDetail.listenSub', { n: readTimeMinutes(tip.body) })}</Text>
              </View>
              <Text style={styles.soon}>{t('common.comingSoon')}</Text>
            </View>
          </Card>

          {/* Article body (real free-text). §13: structured Signs/Treatment/Prevention blocks await a structured
              content contract — we render the real body and never fabricate dosages/costs. */}
          <Card style={{ marginTop: space[3] }}>
            {tip.body ? <Text style={styles.body}>{tip.body}</Text> : <Text style={styles.muted}>{t('tipDetail.noBody')}</Text>}
            {tip.externalUrl || tip.mediaId ? (
              <View style={{ marginTop: space[4] }}>
                <Button title={tip.kind === 'video' || tip.kind === 'audio' ? t('content.tips.openMedia') : t('content.tips.open')} variant="outline" onPress={openAsset} />
              </View>
            ) : null}
          </Card>

          {/* Related tips — REAL resources from the catalogue (no fabricated read counts) */}
          {related.length ? (
            <View style={{ marginTop: space[4] }}>
              <Text style={styles.section}>{t('tipDetail.related')}</Text>
              {related.map((r) => (
                <Pressable key={r.id} onPress={() => router.push({ pathname: '/(farmer)/tips/[id]', params: { id: r.id } })} accessibilityRole="button">
                  <Card style={styles.relCard}>
                    <Text style={styles.relGlyph}>{kindGlyph(r.kind)}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.relTitle} numberOfLines={2}>{r.title}</Text>
                      <Text style={styles.relMeta}>🕐 {t('content.readTime', { n: readTimeMinutes(r.body) })}</Text>
                    </View>
                  </Card>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: color.card, borderRadius: radius.lg, borderWidth: 1, borderColor: color.ink100, padding: space[4], gap: space[2] },
  title: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, lineHeight: 28 },
  byline: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  actions: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
  actBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  actBtnOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  actTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  actTxtOn: { color: color.primary700 },

  listenRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  listenGlyph: { fontSize: 26 },
  listenTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  listenSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  soon: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },

  body: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700, lineHeight: 24 },
  muted: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },

  section: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900, marginBottom: space[2] },
  relCard: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[2] },
  relGlyph: { fontSize: 28, width: 40, textAlign: 'center' },
  relTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  relMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
});
