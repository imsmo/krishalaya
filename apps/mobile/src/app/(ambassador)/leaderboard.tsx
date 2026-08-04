// apps/mobile/src/app/(ambassador)/leaderboard.tsx · screen 93 (Leaderboard). Thin screen (guide §3): the tenant
// leaderboard ranked by commission — a top-3 podium, the ranked list (own row marked YOU), and a motivator to
// reach #1. Period toggle (This month / All time) drives the query. Behind `ambassador_training`. Money is bigint
// minor via MoneyText (Law 2). Degrade-never-die.
//
// §13 (NOT faked): the leaderboard row carries {ambassadorId, userId, tierId, earnedMinor, events, rank} — NO
// ambassador NAME and NO cluster/region label. So each row shows rank + events + earned (MoneyText); the caller's
// own row is marked "YOU"; others are anonymised ("Ambassador #N") — never a fabricated "Rita Pandya · Anand
// cluster". The scope toggle (My cluster / National) has no server filter yet → cluster shows a coming-soon note
// over the tenant list, never fabricated cluster-scoped data. The #1 bonus AMOUNT has no contract → the motivator
// is framed generically (no fabricated "₹2,000"). The onboards-to-#1 target is derived from real events counts.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { LeaderboardEntry } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, SegmentedControl, ScreenScaffold, SkeletonCard, StatusPill, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useAuth } from '../../core/auth/auth.store';
import { leaderboard } from '../../features/ambassador/ambassador.api';
import { sortByRank, onboardsToReachTop } from '../../features/ambassador/ambassador-home';

type Period = 'month' | 'all';
type Scope = 'cluster' | 'national';
const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default function Leaderboard() {
  const { t, lang } = useTranslation();
  const { state } = useAuth();
  const enabled = useFlag('ambassador_training');
  const myId = state.profile?.id ?? null;
  const [period, setPeriod] = useState<Period>('month');
  const [scope, setScope] = useState<Scope>('national');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (p: Period) => {
    setLoading(true); setFailed(false);
    try { setEntries(await leaderboard(p)); } catch { setFailed(true); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) load(period); }, [enabled, period, load]));

  const ranked = useMemo(() => sortByRank(entries), [entries]);
  const podium = useMemo(() => {
    const top3 = ranked.slice(0, 3);
    return [top3[1], top3[0], top3[2]].filter(Boolean) as LeaderboardEntry[]; // visual order: 2nd, 1st, 3rd
  }, [ranked]);
  const rest = ranked.slice(3);
  const toTop = onboardsToReachTop(entries, myId);

  if (!enabled) return <ScreenScaffold title={t('amb.leaderboard.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const header = (
    <View style={{ gap: space[3] }}>
      <SegmentedControl
        accessibilityLabel={t('amb.leaderboard.periodLabel')}
        options={[{ value: 'month', label: t('amb.leaderboard.thisMonth') }, { value: 'all', label: t('amb.leaderboard.allTime') }]}
        value={period}
        onChange={(v) => setPeriod(v as Period)}
      />
      <SegmentedControl
        accessibilityLabel={t('amb.leaderboard.scopeLabel')}
        options={[{ value: 'cluster', label: t('amb.leaderboard.myCluster') }, { value: 'national', label: t('amb.leaderboard.national') }]}
        value={scope}
        onChange={(v) => setScope(v as Scope)}
      />
      {scope === 'cluster' ? <Text style={styles.scopeNote}>{t('amb.leaderboard.clusterSoon')}</Text> : null}

      {podium.length > 0 ? (
        <View style={styles.podium}>
          {podium.map((e) => {
            const mine = !!myId && e.userId === myId;
            return (
              <View key={e.userId} style={[styles.podCol, e.rank === 1 && styles.podFirst]}>
                <Text style={styles.podMedal}>{MEDAL[e.rank] ?? `#${e.rank}`}</Text>
                <Text style={[styles.podName, mine && styles.mineText]} numberOfLines={1}>
                  {mine ? t('amb.leaderboard.you') : t('amb.leaderboard.anonName', { rank: String(e.rank) })}
                </Text>
                <Text style={styles.podEvents}>{e.events}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );

  return (
    <ScreenScaffold title={t('amb.leaderboard.title')}>
      {loading ? <SkeletonCard lines={6} /> : failed ? (
        <EmptyState title={t('common.somethingWrong')} actionLabel={t('common.retry')} onAction={() => load(period)} />
      ) : ranked.length === 0 ? (
        <EmptyState title={t('amb.leaderboard.empty.title')} message={t('amb.leaderboard.empty.message')} />
      ) : (
        <FlatList
          data={rest}
          keyExtractor={(e) => e.userId}
          ListHeaderComponent={header}
          renderItem={({ item }) => <Row entry={item} mine={!!myId && item.userId === myId} lang={lang} t={t} />}
          ListFooterComponent={toTop != null ? (
            <View style={styles.motivator}>
              <Text style={styles.motIcon}>🏆</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.motTitle}>{t('amb.leaderboard.reachTop', { n: String(toTop) })}</Text>
                <Text style={styles.motBody}>{t('amb.leaderboard.topBonus')}</Text>
              </View>
            </View>
          ) : null}
          contentContainerStyle={{ paddingBottom: space[4], gap: space[2] }}
        />
      )}
    </ScreenScaffold>
  );
}

function Row({ entry, mine, lang, t }: { entry: LeaderboardEntry; mine: boolean; lang: string; t: (k: string, v?: Record<string, string | number>) => string }) {
  return (
    <Card style={[styles.row, mine && styles.mineRow]}>
      <Text style={styles.rank}>{entry.rank}</Text>
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, mine && styles.mineText]} numberOfLines={1}>
            {mine ? t('amb.leaderboard.you') : t('amb.leaderboard.anonName', { rank: String(entry.rank) })}
          </Text>
          {mine ? <StatusPill label={t('amb.leaderboard.youPill')} tone="accent" /> : null}
        </View>
        <View style={styles.earnedRow}>
          <MoneyText minor={entry.earnedMinor} langCode={lang} size="xs" tone="muted" />
          <Text style={styles.earnedLbl}>{t('amb.leaderboard.earned')}</Text>
        </View>
      </View>
      <Text style={styles.events}>{entry.events}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  scopeNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontStyle: 'italic' },
  podium: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space[2] },
  podCol: { flex: 1, alignItems: 'center', backgroundColor: color.primary50, borderRadius: radius.lg, paddingVertical: space[3], gap: 2 },
  podFirst: { backgroundColor: color.accent, paddingVertical: space[4] },
  podMedal: { fontSize: 28 },
  podName: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink800, maxWidth: '100%' },
  podEvents: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  mineRow: { borderWidth: 1.5, borderColor: color.primary600 },
  mineText: { color: color.primary700 },
  rank: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink500, minWidth: 24, textAlign: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  name: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800, flexShrink: 1 },
  earnedRow: { flexDirection: 'row', alignItems: 'center', gap: space[1], marginTop: 2 },
  earnedLbl: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  events: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900 },
  motivator: { flexDirection: 'row', gap: space[3], alignItems: 'center', backgroundColor: color.warningLight, borderRadius: radius.lg, padding: space[3], marginTop: space[3] },
  motIcon: { fontSize: 24 },
  motTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.warningDark },
  motBody: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, marginTop: 2 },
});
