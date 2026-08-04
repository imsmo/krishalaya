// apps/mobile/src/app/(farmer)/schemes/mine.tsx · screen 109 "My Scheme Applications". Thin screen (guide §3): the
// caller's own applications (keyset, owner-scoped server-side) with status-filter tabs + real counts, rich cards
// (resolved scheme name, applied date + govt ref, status badge, a milestone "Stage n of 5" derived from status,
// and the real rejection reason), and a Browse-all CTA. Tap → status. Behind `schemes_govt`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • Per-card BENEFIT ("₹6,000 / year", "₹2 Lakh cover") lives in the opaque scheme benefitSummary → not parsed
//    here (it's on the scheme-detail screen); never an invented figure.
//  • "~15 days left", "Action required: Nominee form pending", a "Download PDF" of a result doc, and "Set reminder"
//    have no contract → omitted; the real rejection reason IS shown.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { SchemeApplication, Scheme } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { myApplications, listSchemes } from '../../../features/schemes/schemes.api';
import { applicationStatusTone, schemeAppCounts, matchesSchemeAppTab, schemeAppStage, schemeAppTab, type SchemeAppTab } from '../../../features/schemes/schemes';

const TABS: SchemeAppTab[] = ['all', 'active', 'received', 'rejected'];

export default function MySchemes() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('schemes_govt');
  const [items, setItems] = useState<SchemeApplication[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [tab, setTab] = useState<SchemeAppTab>('all');
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);

  const load = useCallback(async () => {
    const [r, schemes] = await Promise.all([myApplications(), listSchemes()]);
    setItems(r.items); setCursor(r.nextCursor);
    setNames(Object.fromEntries((schemes as Scheme[]).map((s) => [s.id, s.name])));
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  const more = useCallback(async () => {
    if (!cursor || paging) return;
    setPaging(true);
    try { const r = await myApplications(cursor); setItems((prev) => [...prev, ...r.items]); setCursor(r.nextCursor); }
    finally { setPaging(false); }
  }, [cursor, paging]);

  const counts = useMemo(() => schemeAppCounts(items), [items]);
  const shown = useMemo(() => items.filter((a) => matchesSchemeAppTab(a.status, tab)), [items, tab]);

  if (!enabled) return <ScreenScaffold title={t('schemes.mine.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('schemes.mine.title')}>
      {loading ? <SkeletonCard lines={6} /> : items.length === 0 ? (
        <EmptyState title={t('schemes.mine.empty.title')} message={t('schemes.mine.empty.message')} actionLabel={t('schemes.title')} onAction={() => router.push('/(farmer)/schemes')} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(a) => a.id}
          ListHeaderComponent={
            <FlatList
              horizontal showsHorizontalScrollIndicator={false} style={styles.tabRow}
              data={TABS}
              keyExtractor={(x) => x}
              renderItem={({ item: x }) => {
                const on = tab === x;
                return (
                  <Pressable onPress={() => setTab(x)} style={[styles.tab, on && styles.tabOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                    <Text style={[styles.tabTxt, on && styles.tabTxtOn]}>{t(`schemes.mine.tab.${x}`)} · {counts[x]}</Text>
                  </Pressable>
                );
              }}
            />
          }
          renderItem={({ item }) => {
            const grp = schemeAppTab(item.status);
            const stage = schemeAppStage(item.status);
            const applied = item.submittedAt ?? item.createdAt;
            return (
              <Pressable onPress={() => router.push({ pathname: '/(farmer)/schemes/status', params: { id: item.id } })} accessibilityRole="button">
                <Card style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.name} numberOfLines={2}>{names[item.schemeId] ?? t('schemes.mine.scheme')}</Text>
                    <StatusPill label={t(`schemes.statusLabel.${item.status}`, { defaultValue: item.status })} tone={applicationStatusTone(item.status)} />
                  </View>
                  <Text style={styles.meta}>
                    {t('schemes.mine.applied')} {applied ? safeDate(applied, lang) : '—'}{item.govtAppRef ? ` · ${item.govtAppRef}` : ''}
                  </Text>
                  {grp === 'active' ? (
                    <Text style={styles.stage}>{t('schemes.mine.stageOf', { n: stage.stage, total: stage.total })} · {t(`schemes.status.step.${stage.stepKey}`)}</Text>
                  ) : null}
                  {item.status === 'rejected' && item.rejectionReason ? <Text style={styles.reason}>{item.rejectionReason}</Text> : null}
                </Card>
              </Pressable>
            );
          }}
          onEndReached={more}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={<View style={{ paddingTop: space[4] }}><EmptyState title={t('schemes.mine.tabEmpty')} /></View>}
          ListFooterComponent={
            <View>
              {paging ? <SkeletonCard lines={1} /> : null}
              <Text style={styles.browseTitle}>{t('schemes.mine.browseTitle')}</Text>
              <Button title={t('schemes.mine.browse')} variant="outline" onPress={() => router.push('/(farmer)/schemes')} />
            </View>
          }
          contentContainerStyle={{ paddingBottom: space[6] }}
        />
      )}
    </ScreenScaffold>
  );
}

function safeDate(value: string, langCode: string): string { try { return formatDate(value, langCode); } catch { return value; } }

const styles = StyleSheet.create({
  tabRow: { flexGrow: 0, marginBottom: space[3] },
  tab: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space[3], marginRight: space[2], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  tabOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  tabTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  tabTxtOn: { color: color.primary800, fontWeight: font.weight.semibold },
  card: { marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3] },
  name: { flex: 1, fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink900 },
  meta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[1] },
  stage: { fontFamily: font.body, fontSize: font.size.sm, color: color.primary700, fontWeight: font.weight.semibold, marginTop: space[1] },
  reason: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[1] },
  browseTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink700, marginTop: space[4], marginBottom: space[2], textAlign: 'center' },
});
