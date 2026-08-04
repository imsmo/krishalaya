// apps/mobile/src/app/(farmer)/schemes/index.tsx · screen 60 "Government Schemes". Thin screen (guide §3): a
// "Schemes for you" header, the govt scheme catalogue (cached → offline) as rich cards (real name, resolved
// authority name, processing fee / Free, an APPLIED pill cross-referenced from the caller's REAL applications),
// and a link to my applications. Tap a scheme → detail/eligibility/apply. Behind `schemes_govt`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • The personalised recommendation header — "Based on your profile: Farmer · Anand · 5-acre" + "eligible for N
//    schemes" — has NO batch-recommendation/eligibility-summary endpoint (eligibility is an explainable PER-SCHEME
//    check run on the detail screen). So we show a neutral intro + a note, never a fabricated profile line or count.
//  • Per-scheme BENEFIT amount/unit ("₹6,000/year", "₹60,000 cover") lives in the opaque `benefitSummary` JSON the
//    server evaluates — not a parseable money contract → shown on the detail screen, not invented here. The
//    `processingFee` (real bigint minor) IS shown.
//  • ELIGIBLE / NOT-ELIGIBLE badges require the per-scheme eligibility eval → only the REAL APPLIED status is
//    badged on the list (from myApplications); eligibility is determined on the detail screen.
//  • Category ICON: categoryId is a uuid (no name) → a single neutral scheme glyph, never a guessed emoji.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { Scheme, SchemeAuthority, SchemeApplication, ApplicationStatus } from '@krishalaya/sdk-js';
import { MoneyText, Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { listSchemes, listAuthorities, myApplications } from '../../../features/schemes/schemes.api';
import { applicationsBySchemeId, applicationStatusTone } from '../../../features/schemes/schemes';

export default function Schemes() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('schemes_govt');
  const [items, setItems] = useState<Scheme[]>([]);
  const [authorities, setAuthorities] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, ApplicationStatus | string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [schemes, auths, appsPage] = await Promise.all([listSchemes(), listAuthorities(), myApplications()]);
    setItems(schemes);
    setAuthorities(Object.fromEntries((auths as SchemeAuthority[]).map((a) => [a.id, a.name])));
    setApplied(applicationsBySchemeId((appsPage.items as SchemeApplication[]).map((a) => ({ schemeId: a.schemeId, status: a.status, createdAt: a.createdAt }))));
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) load(); }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('schemes.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('schemes.title')}>
      {loading ? <SkeletonCard lines={6} /> : items.length === 0 ? (
        <EmptyState title={t('schemes.empty.title')} message={t('schemes.empty.message')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(s) => s.id}
          ListHeaderComponent={
            <View style={styles.head}>
              <Text style={styles.forYou}>{t('schemes.forYou')}</Text>
              <Text style={styles.forYouNote}>{t('schemes.forYouNote')}</Text>
              <Pressable onPress={() => router.push('/(farmer)/schemes/mine')} accessibilityRole="button"><Text style={styles.link}>📋 {t('schemes.mine.title')} →</Text></Pressable>
            </View>
          }
          renderItem={({ item }) => {
            const status = applied[item.id];
            const authority = item.authorityId ? authorities[item.authorityId] : undefined;
            const fee = BigInt(item.processingFeeMinor || '0');
            return (
              <Pressable onPress={() => router.push({ pathname: '/(farmer)/schemes/[id]', params: { id: item.id } })} accessibilityRole="button">
                <Card style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.glyph}>🏛️</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                      <Text style={styles.authority} numberOfLines={1}>{authority ?? (item.code || t('schemes.centralScheme'))}</Text>
                    </View>
                    {status ? <StatusPill label={t(`schemes.statusLabel.${status}`, { defaultValue: String(status) })} tone={applicationStatusTone(status)} /> : null}
                  </View>
                  <View style={styles.feeRow}>
                    <Text style={styles.feeLabel}>{t('schemes.processingFee')}</Text>
                    {fee > 0n
                      ? <MoneyText minor={item.processingFeeMinor} langCode={lang} size="sm" />
                      : <Text style={styles.free}>{t('schemes.free')}</Text>}
                  </View>
                  <Text style={styles.action}>{status ? t('schemes.viewStatus') : t('schemes.viewApply')} →</Text>
                </Card>
              </Pressable>
            );
          }}
          contentContainerStyle={{ paddingBottom: space[6] }}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  head: { marginBottom: space[3] },
  forYou: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900 },
  forYouNote: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[1], marginBottom: space[2], lineHeight: 18 },
  link: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary700, paddingVertical: space[2] },
  card: { marginBottom: space[3] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  glyph: { fontSize: 30, width: 40, textAlign: 'center' },
  name: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink900, lineHeight: 20 },
  authority: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  feeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[3], paddingTop: space[2], borderTopWidth: 1, borderTopColor: color.ink100 },
  feeLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  free: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.success },
  action: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700, marginTop: space[3], textAlign: 'right' },
});
