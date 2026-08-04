// apps/mobile/src/app/(farmer)/mandi/history.tsx · screen 111 "Price History" (the [id] param is a PRODUCT id).
// Thin screen (guide §3): getPulse(productId) → header price + today's (PURE priceChange) and this-week (vs the
// price ~7d ago via modalOnOrBefore) change, a period-tabbed trend chart (trendByDays), a window range
// (summaryStats), the cross-yard compare table (listPrices×listMandis), and a best-price insight with a real
// haversine distance. Set Alert + Sell CTAs. Money bigint paise via MoneyText (Law 2). Behind `mandi_weather`.
// Degrade-never-die: loading skeleton, designed empty, inline retry.
// §13 gaps (no contract → rendered honestly, never faked): per-mandi day-over-day CHANGE in the compare table
// (one row per yard, no prior), and the transport-cost / net-gain in the insight (no logistics-quote) — shown as
// "—" / coming-soon, never invented.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { MandiPulse, MandiPrice, Mandi } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { haversineMeters } from '../../../core/location';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getPulse, listPrices, listMandis, defaultLatLng } from '../../../features/market/market.api';
import { sortedDesc, previousModalMinor, modalOnOrBefore, priceChange, summaryStats, trendByDays, nearbyMandiPrices, bestNearby, type MandiMeta } from '../../../features/market/mandi-detail';

const PERIODS: { key: string; days: number }[] = [
  { key: '7d', days: 7 }, { key: '30d', days: 30 }, { key: '3mo', days: 90 }, { key: '6mo', days: 180 }, { key: '1yr', days: 365 }, { key: '5yr', days: 1825 },
];

export default function MandiHistory() {
  const { id, regionId } = useLocalSearchParams<{ id: string; regionId?: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('mandi_weather');
  const region = typeof regionId === 'string' && regionId ? regionId : undefined;

  const [pulse, setPulse] = useState<MandiPulse | null>(null);
  const [prices, setPrices] = useState<MandiPrice[]>([]);
  const [mandis, setMandis] = useState<Mandi[]>([]);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!id) { setLoading(false); setFailed(true); return; }
    setLoading(true); setFailed(false);
    const [p, pr, md, geo] = await Promise.all([getPulse(id, region), listPrices({ productId: id, regionId: region }), listMandis(region), defaultLatLng()]);
    setPulse(p); setPrices(pr.items); setMandis(md.items); setHere(geo); setFailed(!p?.latest); setLoading(false);
  }, [id, region]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const history = pulse?.history ?? [];
  const latest = pulse?.latest ?? sortedDesc(history)[0] ?? null;
  const today = useMemo(() => latest ? priceChange(latest.modalMinor, previousModalMinor(history, latest.priceDate)) : null, [latest, history]);
  const week = useMemo(() => latest ? priceChange(latest.modalMinor, modalOnOrBefore(history, new Date(latest.priceDate).getTime() - 7 * 86_400_000)) : null, [latest, history]);
  const summary = useMemo(() => summaryStats(history, days), [history, days]);
  const bars = useMemo(() => trendByDays(history, days), [history, days]);
  const nearby = useMemo(() => {
    const meta: MandiMeta[] = mandis.map((m) => ({ id: m.id, name: m.defaultName, distanceKm: here && typeof m.lat === 'number' && typeof m.lng === 'number' ? Math.round(haversineMeters(here, { lat: m.lat, lng: m.lng }) / 1000) : null }));
    return nearbyMandiPrices(prices.map((p) => ({ mandiId: p.mandiId, modalMinor: p.modalMinor })), meta);
  }, [prices, mandis, here]);
  const best = useMemo(() => bestNearby(nearby), [nearby]);
  const gainMinor = best && latest ? (BigInt(best.modalMinor) - BigInt(latest.modalMinor)).toString() : '0';

  if (!enabled) return <ScreenScaffold title={t('mandiHistory.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold
      title={t('mandiHistory.title')}
      footer={latest ? (
        <View style={styles.footer}>
          <Button title={t('mandiDetail.setAlert')} variant="outline" onPress={() => router.push({ pathname: '/(farmer)/mandi/alerts', params: { productId: id!, regionId: region ?? '' } })} />
          <View style={{ flex: 1 }}><Button title={`${t('mandiHistory.sellAt')} ${moneyInline(latest.modalMinor, lang)} →`} onPress={() => router.push('/(farmer)/listings/new')} /></View>
        </View>
      ) : undefined}
    >
      {loading ? <SkeletonCard lines={10} /> : !latest || failed ? (
        <EmptyState title={t('mandi.noPrices.title')} message={t('mandi.noPrices.message')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <>
          {/* Header */}
          <View style={styles.hero}>
            <Text style={styles.heroName}>🌾 {latest.productName ?? t('mandiDetail.commodity')}{latest.gradeName ? ` — ${latest.gradeName}` : ''}{latest.regionName ? ` · ${latest.regionName}` : ''}</Text>
            <View style={styles.priceRow}>
              <MoneyText minor={latest.modalMinor} langCode={lang} size="2xl" />
              <Text style={styles.unit}> / {latest.unitCode}</Text>
            </View>
            <Text style={styles.changeLine}>
              {today ? <Text style={today.pct < 0 ? styles.down : styles.up}>{today.pct >= 0 ? '↑' : '↓'} {moneyInline(today.deltaMinor.replace('-', ''), lang)} {t('mandiHistory.today')}</Text> : null}
              {today && week ? '  ·  ' : ''}
              {week ? <Text style={week.pct < 0 ? styles.down : styles.up}>{week.pct >= 0 ? '↑' : '↓'} {(week.pct >= 0 ? '+' : '') + week.pct}% {t('mandiHistory.thisWeek')}</Text> : null}
            </Text>
          </View>

          {/* Period tabs */}
          <View style={styles.tabs}>
            {PERIODS.map((p) => (
              <Pressable key={p.key} onPress={() => setDays(p.days)} style={[styles.tab, days === p.days && styles.tabOn]} accessibilityRole="button" accessibilityState={{ selected: days === p.days }}>
                <Text style={[styles.tabTxt, days === p.days && styles.tabTxtOn]}>{t(`mandiHistory.period.${p.key}`)}</Text>
              </Pressable>
            ))}
          </View>

          {/* Trend chart + range */}
          <Card style={{ marginTop: space[3] }}>
            <View style={styles.trendHead}>
              <Text style={styles.section}>{t('mandiHistory.trend')}</Text>
              <Text style={styles.range}>{t('mandiHistory.range')}: {moneyInline(summary.lowMinor, lang)} – {moneyInline(summary.highMinor, lang)}</Text>
            </View>
            {bars.length ? (
              <>
                <View style={styles.chart}>
                  {bars.map((b, i) => <View key={b.dateIso + i} style={styles.barCol}><View style={[styles.barFill, { height: `${Math.max(b.heightPct, 4)}%` }]} /></View>)}
                </View>
                <View style={styles.axis}>
                  <Text style={styles.axisTxt}>{dayLabel(bars[0].dateIso, lang)}</Text>
                  <Text style={styles.axisTxt}>{dayLabel(bars[bars.length - 1].dateIso, lang)}</Text>
                </View>
              </>
            ) : <Text style={styles.muted}>{t('mandiDetail.noTrend')}</Text>}
          </Card>

          {/* Compare across mandis */}
          {nearby.length ? (
            <Card style={{ marginTop: space[3] }}>
              <Text style={styles.section}>{t('mandiHistory.compare')}</Text>
              <View style={styles.thead}>
                <Text style={[styles.th, { flex: 1.4 }]}>{t('mandiHistory.colMandi')}</Text>
                <Text style={[styles.th, styles.right, { flex: 1 }]}>{t('mandiHistory.colPrice')}</Text>
                <Text style={[styles.th, styles.right, { flex: 1 }]}>{t('mandiHistory.colChange')}</Text>
              </View>
              {nearby.map((n) => (
                <View key={n.mandiId} style={styles.trow}>
                  <Text style={[styles.tname, { flex: 1.4 }]} numberOfLines={1}>{n.name}</Text>
                  <View style={[styles.right, { flex: 1 }]}><MoneyText minor={n.modalMinor} langCode={lang} size="sm" /></View>
                  {/* §13: no per-mandi prior price in a single list read → change degrades to "—". */}
                  <Text style={[styles.tchange, styles.right, { flex: 1 }]}>—</Text>
                </View>
              ))}
            </Card>
          ) : null}

          {/* Insight */}
          {best && BigInt(gainMinor) > 0n ? (
            <View style={styles.insight}>
              <Text style={styles.insightEmoji}>💡</Text>
              <Text style={styles.insightTxt}>
                <Text style={styles.insightBold}>{best.name}</Text> {t('mandiHistory.insight', { km: best.distanceKm ?? '—', more: moneyInline(gainMinor, lang) })} {t('mandiHistory.insightSoon')}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </ScreenScaffold>
  );
}

function dayLabel(iso: string, lang: string): string { try { return formatDate(iso, lang, { day: 'numeric', month: 'short' }); } catch { return iso; } }
function moneyInline(minor: string, lang: string): string {
  try { return new Intl.NumberFormat(lang === 'en' ? 'en-IN' : lang === 'gu' ? 'gu-IN' : 'hi-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(BigInt(minor)) / 100); }
  catch { return '—'; }
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  hero: { alignItems: 'center', gap: 2, paddingVertical: space[2] },
  heroName: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700, fontWeight: font.weight.semibold, textAlign: 'center' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: space[1] },
  unit: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  changeLine: { fontFamily: font.body, fontSize: font.size.sm, marginTop: space[1] },
  up: { color: color.success, fontWeight: font.weight.semibold }, down: { color: color.danger, fontWeight: font.weight.semibold },

  tabs: { flexDirection: 'row', gap: space[1], marginTop: space[3] },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space[2], borderRadius: radius.pill, backgroundColor: color.earth100 },
  tabOn: { backgroundColor: color.primary600 },
  tabTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, fontWeight: font.weight.semibold },
  tabTxtOn: { color: color.white },

  trendHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[3] },
  section: { fontFamily: font.display, fontSize: font.size.lg, color: color.ink900, fontWeight: font.weight.bold },
  range: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 3 },
  barCol: { flex: 1, justifyContent: 'flex-end', height: '100%' },
  barFill: { width: '100%', backgroundColor: color.primary500, borderRadius: radius.sm },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] },
  axisTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  muted: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },

  thead: { flexDirection: 'row', paddingBottom: space[2], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  th: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, fontWeight: font.weight.semibold },
  right: { textAlign: 'right', alignItems: 'flex-end' },
  trow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.ink100 },
  tname: { fontFamily: font.body, fontSize: font.size.md, color: color.ink800 },
  tchange: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400 },

  insight: { flexDirection: 'row', gap: space[2], backgroundColor: color.accent50, borderRadius: radius.md, padding: space[3], marginTop: space[3] },
  insightEmoji: { fontSize: 18 },
  insightTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink700 },
  insightBold: { fontWeight: font.weight.bold, color: color.ink900 },
});
