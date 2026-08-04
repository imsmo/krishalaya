// apps/mobile/src/app/(buyer)/filters.tsx · screen 68 "Filters" (buyer search filter sheet). Thin screen (guide §3):
// edit the catalogue filters, then "Show results" returns to Search (67) with the state as route params (the pure
// search-query builder turns them into a ListingQuery). "Clear all (N)" / "Reset" wipe the form. Behind `buyer_app`.
// Real, server-backed filters: Categories (single categoryId, from the live taxonomy tree), Price range (paise —
// Law 2), and the Organic certification toggle. Money inputs are whole rupees → paise server-side.
// §13 gaps (the public listing feed's ListingQuery has no param for these → rendered for parity but disabled with a
// "coming soon" note; NEVER a control that silently applies nothing):
//  • Distance radius (5/50/100km) — no geo-distance filter on the feed (only regionId).
//  • Quality grade (A/B/C) — grade is a catalogue attribute, not a feed filter param.
//  • FSSAI verified / PMFBY insured — only `organic` is a real feed filter today.
//  • Seller type (Individual / FPO / Verified) — no seller-type facet on the feed.
//  • "Show 42 results": the feed is keyset-paginated with no grand total → the CTA shows "Show results" (no
//    fabricated count); the honest loaded-count lives on Search (67).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { CategoryNode } from '@krishalaya/sdk-js';
import { Button, Input, Toggle, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { topCategories } from '../../features/buyer/browse.api';
import type { SortKey } from '../../features/buyer/search-query';

// Coming-soon option sets (rendered for parity, disabled — §13; no feed filter param yet).
const DISTANCE_KEYS = ['5km', '50km', '100km', 'any'] as const;
const GRADE_KEYS = ['a', 'b', 'c'] as const;
const SELLER_KEYS = ['individual', 'fpo', 'verified'] as const;

export default function BuyerFilters() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('buyer_app');
  const params = useLocalSearchParams<{ q?: string; categoryId?: string; saleType?: string; organic?: string; priceMinRupees?: string; priceMaxRupees?: string; sort?: string }>();

  const [categoryId, setCategoryId] = useState(params.categoryId || '');
  const [organic, setOrganic] = useState(params.organic === '1');
  const [min, setMin] = useState(params.priceMinRupees || '');
  const [max, setMax] = useState(params.priceMaxRupees || '');
  const [cats, setCats] = useState<CategoryNode[]>([]);
  const [loadingCats, setLoadingCats] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    topCategories().then((c) => { if (live) { setCats(c); setLoadingCats(false); } });
    return () => { live = false; };
  }, [enabled]);

  // Count of the REAL, applicable filters currently set (drives "Clear all (N)").
  const activeN = (categoryId ? 1 : 0) + (organic ? 1 : 0) + (min.trim() ? 1 : 0) + (max.trim() ? 1 : 0);

  const apply = useCallback(() => router.replace({ pathname: '/(buyer)/search', params: {
    q: params.q || undefined,
    categoryId: categoryId || undefined,
    saleType: params.saleType || undefined,      // preserved (set elsewhere); no section on 68 per design
    organic: organic ? '1' : undefined,
    priceMinRupees: min.trim() || undefined,
    priceMaxRupees: max.trim() || undefined,
    sort: (params.sort as SortKey) || undefined,  // preserved (67 owns the sort control)
  } }), [router, params.q, params.saleType, params.sort, categoryId, organic, min, max]);

  const clearAll = () => { setCategoryId(''); setOrganic(false); setMin(''); setMax(''); };

  if (!enabled) {
    return <ScreenScaffold title={t('buyer.filters')}><View style={{ padding: space[4] }}><Text style={styles.comingSoon}>{t('common.unavailable')}</Text></View></ScreenScaffold>;
  }

  const footer = (
    <View style={styles.footer}>
      <View style={{ flex: 1 }}><Button title={t('buyer.resetFilters')} variant="ghost" onPress={clearAll} /></View>
      <View style={{ flex: 1.5 }}><Button title={t('filters.showResults')} onPress={apply} /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('buyer.filters')} scroll={false} footer={footer}>
      <ScrollView contentContainerStyle={{ paddingBottom: space[6] }} showsVerticalScrollIndicator={false}>
        {/* Clear all */}
        <View style={styles.clearRow}>
          <Pressable onPress={clearAll} accessibilityRole="button" accessibilityLabel={t('filters.clearAll', { n: activeN })}>
            <Text style={styles.clearTxt}>{t('filters.clearAll', { n: activeN })}</Text>
          </Pressable>
        </View>

        {/* Categories (real, single-select categoryId) */}
        <Section title={t('filters.categories')} count={categoryId ? t('filters.selected', { n: 1 }) : undefined}>
          {loadingCats ? <SkeletonCard lines={2} /> : cats.length === 0 ? (
            <Text style={styles.comingSoon}>{t('filters.noCategories')}</Text>
          ) : (
            <View style={styles.chips}>
              {cats.map((c) => {
                const on = categoryId === c.id;
                return (
                  <Pressable key={c.id} onPress={() => setCategoryId(on ? '' : c.id)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]}>
                    <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{c.defaultName}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </Section>

        {/* Price range (real, paise) */}
        <Section title={t('filters.priceRange')}>
          <View style={styles.priceRow}>
            <View style={{ flex: 1 }}><Input label={t('buyer.priceMin')} value={min} onChangeText={setMin} keyboardType="number-pad" maxLength={9} placeholder="0" /></View>
            <View style={{ flex: 1 }}><Input label={t('buyer.priceMax')} value={max} onChangeText={setMax} keyboardType="number-pad" maxLength={9} placeholder="—" /></View>
          </View>
          <View style={styles.rangeLabels}>
            <Text style={styles.rangeBound}>{t('filters.rangeMin')}</Text>
            <Text style={styles.rangeSel}>{min.trim() || max.trim() ? t('filters.rangeSelected', { min: min.trim() || '0', max: max.trim() || '∞' }) : t('filters.rangeAny')}</Text>
            <Text style={styles.rangeBound}>{t('filters.rangeMax')}</Text>
          </View>
        </Section>

        {/* Distance — §13 coming soon */}
        <ComingSoonChips title={t('filters.distance')} t={t} keys={DISTANCE_KEYS} prefix="filters.dist" />

        {/* Quality grade — §13 coming soon */}
        <ComingSoonChips title={t('filters.grade')} t={t} keys={GRADE_KEYS} prefix="filters.grade" />

        {/* Certifications — organic is real; FSSAI/PMFBY coming soon */}
        <Section title={t('filters.certifications')}>
          <Toggle label={t('filters.cert.organic')} hint={t('filters.cert.organicHint')} value={organic} onValueChange={setOrganic} />
          <Toggle label={t('filters.cert.fssai')} hint={`${t('filters.cert.fssaiHint')} · ${t('filters.comingSoon')}`} value={false} onValueChange={() => {}} disabled />
          <Toggle label={t('filters.cert.pmfby')} hint={`${t('filters.cert.pmfbyHint')} · ${t('filters.comingSoon')}`} value={false} onValueChange={() => {}} disabled />
        </Section>

        {/* Seller type — §13 coming soon */}
        <ComingSoonChips title={t('filters.sellerType')} t={t} keys={SELLER_KEYS} prefix="filters.seller" last />
      </ScrollView>
    </ScreenScaffold>
  );
}

function Section({ title, count, children }: { title: string; count?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {count ? <Text style={styles.sectionCount}>{count}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function ComingSoonChips({ title, keys, prefix, t, last }: { title: string; keys: readonly string[]; prefix: string; t: (k: string, v?: Record<string, string | number>) => string; last?: boolean }) {
  return (
    <View style={[styles.section, last && { borderBottomWidth: 0 }]}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.soonBadge}>{t('filters.comingSoon')}</Text>
      </View>
      <View style={styles.chips}>
        {keys.map((k) => (
          <View key={k} style={[styles.chip, styles.chipDisabled]} accessibilityElementsHidden>
            <Text style={styles.chipTxtDisabled}>{t(`${prefix}.${k}`)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clearRow: { alignItems: 'flex-end', paddingHorizontal: space[4], paddingTop: space[2] },
  clearTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  section: { paddingHorizontal: space[4], paddingVertical: space[4], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[3] },
  sectionTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  sectionCount: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.accent700 },
  soonBadge: { fontFamily: font.body, fontSize: 10, fontWeight: font.weight.semibold, color: color.ink400, textTransform: 'uppercase', letterSpacing: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { paddingHorizontal: space[3], minHeight: 40, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipDisabled: { opacity: 0.5, backgroundColor: color.ink50 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  chipTxtOn: { color: color.primary800, fontWeight: font.weight.semibold },
  chipTxtDisabled: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400 },
  priceRow: { flexDirection: 'row', gap: space[3] },
  rangeLabels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[2] },
  rangeBound: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  rangeSel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.primary700 },
  comingSoon: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  footer: { flexDirection: 'row', gap: space[2] },
});
