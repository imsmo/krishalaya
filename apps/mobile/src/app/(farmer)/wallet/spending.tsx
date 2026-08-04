// apps/mobile/src/app/(farmer)/wallet/spending.tsx · screen 182 (Spending Insights). Thin screen (guide §3):
// the caller's OWN wallet debits, aggregated server-side (walletSpending → WalletInsights, float-free bigint-minor,
// Law 2). Hero total + month-over-month delta, a spending-over-time bar chart, and a by-category breakdown. Money
// via MoneyText. FLAG_SECURE (financial data on screen, §4). Behind `wallet`. Degrade-never-die (skeleton/empty).
//
// §13 (NOT faked): the total, the month delta, the monthly trend, and the by-category amounts/percentages are ALL
// computed from the server's WalletInsights (byMonth + byType). The design's "Daily spending" chart (x-axis 1/5/
// 10/14) needs a DAILY read-model the insights contract does NOT provide (it's monthly granularity) → we render a
// real spending-over-time chart by MONTH and label it honestly, never fabricated daily bars. The design's peer
// comparison ("You spend 18% less than other farmers in Anand with 5-acre farms") has NO benchmark contract → it is
// OMITTED, never invented. Category labels fall back to the server's code when no friendly name exists.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { WalletInsights } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { walletSpending } from '../../../features/wallet/wallet.api';
import { currentMonth, momDelta, barChart, type Bucket } from '../../../features/wallet/earnings';
import { categoryBreakdown, spendingIcon } from '../../../features/wallet/spending';

function monthLabel(key: string | undefined, lang: string): string {
  if (!key) return '';
  try { return formatDate(`${key}-01T00:00:00Z`, lang, { month: 'short', year: 'numeric' }); } catch { return key; }
}

export default function SpendingInsights() {
  useSecureScreen();
  const { t, lang } = useTranslation();
  const enabled = useFlag('wallet');
  const [data, setData] = useState<WalletInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    try { setData(await walletSpending()); } catch { setFailed(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('spendInsights.title')}><EmptyState title={t('wallet.unavailable')} /></ScreenScaffold>;
  if (loading) return <ScreenScaffold title={t('spendInsights.title')}><SkeletonCard lines={3} /><SkeletonCard lines={5} /></ScreenScaffold>;

  const byMonth: Bucket[] = data?.byMonth ?? [];
  const byType: Bucket[] = data?.byType ?? [];
  const ccy = data?.currencyCode ?? 'INR';
  const cur = currentMonth(byMonth);
  const hasData = !!cur || byType.length > 0 || (data ? data.totalMinor !== '0' : false);

  if (failed || !data || !hasData) {
    return <ScreenScaffold title={t('spendInsights.title')}><EmptyState title={t('spendInsights.empty.title')} message={t('spendInsights.empty.message')} actionLabel={t('common.retry')} onAction={load} /></ScreenScaffold>;
  }

  const totalMinor = cur?.amountMinor ?? data.totalMinor;
  const delta = momDelta(byMonth);
  const bars = barChart(byMonth, 6);
  const cats = categoryBreakdown(byType, totalMinor);
  const prevKey = byMonth.length >= 2 ? byMonth[byMonth.length - 2].key : undefined;

  return (
    <ScreenScaffold title={t('spendInsights.title')} scroll>
      {/* Hero */}
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>{t('spendInsights.spentIn', { month: monthLabel(cur?.key, lang) })}</Text>
        <MoneyText minor={totalMinor} currencyCode={ccy} langCode={lang} size="3xl" style={styles.heroValue} />
        {delta ? (
          <Text style={styles.delta}>
            {delta.pct <= 0 ? '↓' : '↑'} {Math.abs(delta.pct)}% {t('spendInsights.vsMonth', { month: monthLabel(prevKey, lang) })}
          </Text>
        ) : null}
      </View>

      {/* Spending over time — §13: monthly granularity (no daily read-model) */}
      {bars.length > 0 ? (
        <>
          <Text style={styles.section}>{t('spendInsights.overTime')}</Text>
          <Card>
            <View style={styles.chart}>
              {bars.map((bar) => (
                <View key={bar.key} style={styles.barCol}>
                  <View style={styles.barTrack}><View style={[styles.barFill, { height: `${Math.max(3, bar.heightPct)}%` }]} /></View>
                  <Text style={styles.barLabel}>{monthLabel(bar.key, lang)}</Text>
                </View>
              ))}
            </View>
          </Card>
        </>
      ) : null}

      {/* By category */}
      {cats.length > 0 ? (
        <>
          <Text style={styles.section}>{t('spendInsights.byCategory')}</Text>
          <Card>
            {cats.map((c, i) => (
              <View key={c.key} style={[styles.catRow, i > 0 && styles.catDivider]}>
                <Text style={styles.catIcon}>{spendingIcon(c.key)}</Text>
                <Text style={styles.catName} numberOfLines={1}>{t(`spendInsights.cat.${c.key}`, { defaultValue: c.key })}</Text>
                <View style={styles.catRight}>
                  <MoneyText minor={c.amountMinor} currencyCode={ccy} langCode={lang} size="sm" />
                  <Text style={styles.catPct}>{c.pct}%</Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: space[4], backgroundColor: color.primary700, borderRadius: radius.lg, marginTop: space[2] },
  heroLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.white, opacity: 0.85, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: font.weight.semibold },
  heroValue: { color: color.white, marginTop: 6 },
  delta: { fontFamily: font.body, fontSize: font.size.sm, color: color.white, opacity: 0.9, marginTop: 6 },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  chart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 120, gap: space[2] },
  barCol: { flex: 1, alignItems: 'center', gap: space[1] },
  barTrack: { width: '70%', height: 90, backgroundColor: color.earth100, borderRadius: radius.sm, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', backgroundColor: color.primary600, borderRadius: radius.sm },
  barLabel: { fontFamily: font.body, fontSize: 10, color: color.ink400 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  catDivider: { borderTopWidth: 1, borderTopColor: color.ink100 },
  catIcon: { fontSize: font.size.lg },
  catName: { flex: 1, fontFamily: font.body, fontSize: font.size.md, color: color.ink800 },
  catRight: { alignItems: 'flex-end' },
  catPct: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 1 },
});
