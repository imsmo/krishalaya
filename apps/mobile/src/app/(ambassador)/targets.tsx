// apps/mobile/src/app/(ambassador)/targets.tsx · screen 169 (Monthly Targets). Thin screen (guide §3): the
// ambassador's per-period goals — the REAL server targets (myTargets) joined with their OWN real activity
// (referrals / visits / commission credits) to show achieved-vs-target progress. All progress math is PURE
// (features/ambassador/targets). Behind `ambassador_training`. Degrade-never-die.
//
// §13 (NOT faked): the period, the target values and the progress % are all real. Progress is computed only for
// metrics with a real feed (onboardings, visits, earnings_minor); a metric with no achieved feed (e.g.
// sales_facilitated) shows the target with achieved "—" rather than a fabricated count. DROPPED from the mockup
// (no contract): the specific bonus amounts (₹200/₹25-each), the "🥉/🥈/🥇 tier ladder" with ₹500/₹2,000/₹5,000
// bonuses, and the "⭐4.8 satisfaction / Top performer" line — none of these have a backing contract, so they are
// omitted rather than invented. When the server has set no targets, the screen shows the designed empty state.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { AmbassadorTarget, Referral, AmbassadorVisit, AmbassadorEarning } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { Card, EmptyState, MoneyText, ProgressBar, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { myTargets, listReferrals, listVisits, myEarnings } from '../../features/ambassador/ambassador.api';
import { targetProgress, daysLeft, remaining, type TargetProgress } from '../../features/ambassador/targets';

const KNOWN_METRICS = new Set(['onboardings', 'sales_facilitated', 'earnings_minor', 'visits']);

export default function Targets() {
  const { t, lang } = useTranslation();
  const enabled = useFlag('ambassador_training');
  const [targets, setTargets] = useState<AmbassadorTarget[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [visits, setVisits] = useState<AmbassadorVisit[]>([]);
  const [earnings, setEarnings] = useState<AmbassadorEarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    try {
      const [tg, rf, vs, ea] = await Promise.all([myTargets(), listReferrals(), listVisits(), myEarnings()]);
      setTargets(tg.filter((x) => KNOWN_METRICS.has(x.metric)));
      setReferrals(rf.items); setVisits(vs.items); setEarnings(ea.items);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const rows: TargetProgress[] = useMemo(
    () => targets.map((tg) => targetProgress(tg, { referrals, visits, earnings })),
    [targets, referrals, visits, earnings],
  );
  // Headline = the onboardings target if present, else the first target.
  const primaryIdx = useMemo(() => { const i = targets.findIndex((x) => x.metric === 'onboardings'); return i >= 0 ? i : 0; }, [targets]);
  const primary = targets[primaryIdx];
  const primaryRow = rows[primaryIdx];
  const periodLabel = primary ? formatDate(primary.periodStart, lang, { month: 'short', year: 'numeric' }) : '';
  const days = primary ? daysLeft(primary.periodEnd, Date.now()) : 0;

  if (!enabled) return <ScreenScaffold title={t('amb.targets.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const title = periodLabel ? t('amb.targets.title2', { period: periodLabel }) : t('amb.targets.title');

  return (
    <ScreenScaffold title={title} scroll>
      {loading ? <SkeletonCard lines={6} /> : failed ? (
        <EmptyState title={t('common.somethingWrong')} actionLabel={t('common.retry')} onAction={load} />
      ) : targets.length === 0 ? (
        <EmptyState title={t('amb.targets.soon.title')} message={t('amb.targets.soon.message')} />
      ) : (
        <View style={{ gap: space[3] }}>
          {/* Hero — primary goal % + days left */}
          <View style={styles.hero}>
            <Text style={styles.heroIcon}>🎯</Text>
            <Text style={styles.heroPct}>{t('amb.targets.headline', { pct: String(primaryRow?.pct ?? 0) })}</Text>
            <Text style={styles.heroDays}>{t('amb.targets.daysLeft', { days: String(days) })}</Text>
            <View style={styles.heroTrack}><ProgressBar value={(primaryRow?.pct ?? 0) / 100} /></View>
          </View>

          {/* Per-metric goal cards */}
          {rows.map((r, i) => (
            <Card key={targets[i].id} style={{ gap: space[2] }}>
              <View style={styles.rowTop}>
                <Text style={styles.metric}>{t(`amb.targets.metric.${r.metric}`)}</Text>
                {r.isMoney ? (
                  <View style={styles.valRow}>
                    <MoneyText minor={r.achievedMinor ?? '0'} langCode={lang} size="sm" tone="positive" />
                    <Text style={styles.ofTarget}> / </Text>
                    <MoneyText minor={r.targetMinor ?? '0'} langCode={lang} size="sm" tone="muted" />
                  </View>
                ) : (
                  <Text style={styles.count}>{r.achieved == null ? t('common.dash') : `${r.achieved} / ${r.targetValue}`}</Text>
                )}
              </View>
              <ProgressBar value={r.pct / 100} />
              <View style={styles.rowBot}>
                <Text style={styles.pct}>{t('amb.targets.pctOf', { pct: String(r.pct) })}</Text>
                {!r.isMoney && r.achieved != null && remaining(r.achieved, r.targetValue) > 0 ? (
                  <Text style={styles.needMore}>{t('amb.targets.needMore', { n: String(remaining(r.achieved, r.targetValue)) })}</Text>
                ) : null}
              </View>
            </Card>
          ))}
        </View>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { padding: space[4], borderRadius: radius.lg, backgroundColor: color.ink900, alignItems: 'center', gap: space[1] },
  heroIcon: { fontSize: 32 },
  heroPct: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.card },
  heroDays: { fontFamily: font.body, fontSize: font.size.sm, color: color.card, opacity: 0.85, marginBottom: space[2] },
  heroTrack: { alignSelf: 'stretch' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  metric: { flex: 1, fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  valRow: { flexDirection: 'row', alignItems: 'center' },
  ofTarget: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400 },
  count: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  rowBot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pct: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  needMore: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
});
