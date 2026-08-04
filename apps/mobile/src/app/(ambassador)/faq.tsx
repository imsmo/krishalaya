// apps/mobile/src/app/(ambassador)/faq.tsx · screen 167 (FAQ Cheat Sheet). Thin screen (guide §3): a searchable,
// category-filtered accordion of the fixed farmer-facing FAQ the ambassador reads out in the field. The entries are
// FIXED reference copy (identical for every ambassador, bundled so it works offline) → i18n keys, not DB rows
// (guide "READ FIRST": fixed reference copy is UI chrome). Filtering/counts come from the PURE faq-sheet helpers.
// Behind `ambassador_training`.
//
// §13 (NOT faked): "All · N" shows the REAL catalog length (not the mockup's hardcoded "20" — we render as many
// entries as are actually authored). The platform-fee entry is phrased generically ("Why is there a platform
// fee?") — it does NOT assert the mockup's "2.5%", because the real fee comes from the tenant's charge config, not
// static copy. DROPPED from the mockup (no contract): the "Updated weekly" freshness claim (the copy is bundled,
// not a server feed) and the "📥 Download PDF for Offline" CTA (no FAQ-PDF endpoint — and the content is already
// available offline, so the button would be a no-op).
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Card, EmptyState, Input, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { FAQ_CATALOG, FAQ_CATEGORIES, faqCategoryCounts, filterFaqs, type FaqCategory, type ResolvedFaq } from '../../features/ambassador/faq-sheet';

// The entries that ship with a vernacular "Tell farmer" coaching line (only where the design provides one).
const SCRIPT_IDS = new Set(['moneyAfterSelling']);

export default function Faq() {
  const { t } = useTranslation();
  const enabled = useFlag('ambassador_training');
  const [category, setCategory] = useState<'all' | FaqCategory>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(FAQ_CATALOG[0]?.id ?? null);

  const resolved: ResolvedFaq[] = useMemo(
    () => FAQ_CATALOG.map((e) => ({ id: e.id, category: e.category, q: t(`amb.faq.${e.id}.q`), a: t(`amb.faq.${e.id}.a`), script: SCRIPT_IDS.has(e.id) ? t(`amb.faq.${e.id}.script`) : undefined })),
    [t],
  );
  const counts = useMemo(() => faqCategoryCounts(), []);
  const visible = useMemo(() => filterFaqs(resolved, category, query), [resolved, category, query]);

  if (!enabled) return <ScreenScaffold title={t('amb.faq.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const chip = (value: 'all' | FaqCategory, label: string, n: number) => {
    const on = category === value;
    return (
      <Pressable key={value} onPress={() => setCategory(value)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]}>
        <Text style={[styles.chipText, on && styles.chipTextOn]}>{label} · {n}</Text>
      </Pressable>
    );
  };

  return (
    <ScreenScaffold title={t('amb.faq.title')} scroll>
      <View style={{ gap: space[3] }}>
        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroIcon}>📋</Text>
          <Text style={styles.heroSub}>{t('amb.faq.heroSub', { n: String(counts.all) })}</Text>
          <Text style={styles.heroOffline}>{t('amb.faq.offline')}</Text>
        </View>

        {/* Search */}
        <Input value={query} onChangeText={setQuery} placeholder={t('amb.faq.searchPlaceholder')} accessibilityLabel={t('amb.faq.searchPlaceholder')} />

        {/* Category chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {chip('all', t('amb.faq.all'), counts.all)}
          {FAQ_CATEGORIES.map((c) => chip(c, t(`amb.faq.cat.${c}`), counts[c]))}
        </ScrollView>

        {/* Accordion list */}
        {visible.length === 0 ? (
          <EmptyState title={t('amb.faq.noResults')} />
        ) : (
          visible.map((f) => {
            const isOpen = open === f.id;
            return (
              <Pressable key={f.id} onPress={() => setOpen(isOpen ? null : f.id)} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
                <Card style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.q}>{f.q}</Text>
                    <Text style={styles.chev}>{isOpen ? '−' : '+'}</Text>
                  </View>
                  {isOpen ? (
                    <>
                      <Text style={styles.a}>{f.a}</Text>
                      {f.script ? (
                        <View style={styles.scriptBox}>
                          <Text style={styles.scriptLabel}>{t('amb.faq.tellFarmer')}</Text>
                          <Text style={styles.scriptText}>{f.script}</Text>
                        </View>
                      ) : null}
                    </>
                  ) : null}
                </Card>
              </Pressable>
            );
          })
        )}
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { padding: space[4], borderRadius: radius.lg, backgroundColor: color.ink900, alignItems: 'center', gap: space[1] },
  heroIcon: { fontSize: 32 },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.card, textAlign: 'center' },
  heroOffline: { fontFamily: font.body, fontSize: font.size.xs, color: color.card, opacity: 0.85 },
  chipRow: { gap: space[2], paddingVertical: space[1] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.pill, borderWidth: 1, borderColor: color.ink200, backgroundColor: color.card, minHeight: 40, justifyContent: 'center' },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700 },
  chipTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
  card: { marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  q: { flex: 1, fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  chev: { fontFamily: font.body, fontSize: font.size.xl, color: color.ink500 },
  a: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600, marginTop: space[2], lineHeight: font.size.md * 1.5 },
  scriptBox: { marginTop: space[3], padding: space[3], borderRadius: radius.md, backgroundColor: color.primary50 },
  scriptLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.primary800, marginBottom: space[1] },
  scriptText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700 },
});
