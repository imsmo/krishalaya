// apps/mobile/src/app/(farmer)/mandi/[id].tsx · screen 53 "Commodity Price Detail" (the [id] param is a PRODUCT
// id). Thin screen (guide §3): getPulse(productId) → header price + day-over-day change (PURE priceChange from
// real history), a trend chart (period tabs over real history), a 30-day summary (PURE summaryStats), and the
// nearby-yard prices for THIS commodity (listPrices×listMandis joined with a real haversine distance from the
// farmer's saved location). Best-price recommendation + Set Alert + List-now CTAs. All money bigint paise via
// MoneyText (Law 2). Behind `mandi_weather`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked): a transport-cost estimate for the best yard (no
// logistics-quote contract), and distance when the farmer has no saved coordinates (shown without "km").
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { MandiPulse, MandiPrice, Mandi } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { haversineMeters } from '../../../core/location';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getPulse, listPrices, listMandis, defaultLatLng } from '../../../features/market/market.api';
import { sortedDesc, previousModalMinor, priceChange, summaryStats, trendSeries, nearbyMandiPrices, bestNearby, TREND_PERIODS, type TrendPeriod, type MandiMeta } from '../../../features/market/mandi-detail';

export default function CommodityDetail() {
  const { id, regionId } = useLocalSearchParams<{ id: string; regionId?: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('mandi_weather');
  const region = typeof regionId === 'string' && regionId ? regionId : undefined;

  const [pulse, setPulse] = useState<MandiPulse | null>(null);
  const [prices, setPrices] = useState<MandiPrice[]>([]);
  const [mandis, setMandis] = useState<Mandi[]>([]);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [period, setPeriod] = useState<TrendPeriod>('1M');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!id) { setLoading(false); setFailed(true); return; }
    setLoading(true); setFailed(false);
    const [p, pr, md, geo] = await Promise.all([
      getPulse(id, region), listPrices({ productId: id, regionId: region }), listMandis(region), defaultLatLng(),
    ]);
    setPulse(p); setPrices(pr.items); setMandis(md.items); setHere(geo); setFailed(!p?.latest); setLoading(false);
  }, [id, region]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const history = pulse?.history ?? [];
  const latest = pulse?.latest ?? sortedDesc(history)[0] ?? null;
  const change = useMemo(() => latest ? priceChange(latest.modalMinor, previousModalMinor(history, latest.priceDate)) : null, [latest, history]);
  const summary = useMemo(() => summaryStats(history, 30), [history]);
  const bars = useMemo(() => trendSeries(history, period), [history, period]);
  const nearby = useMemo(() => {
    const meta: MandiMeta[] = mandis.map((m) => ({
      id: m.id, name: m.defaultName,
      distanceKm: here && typeof m.lat === 'number' && typeof m.lng === 'number'
        ? Math.round(haversineMeters(here, { lat: m.lat, lng: m.lng }) / 1000) : null,
    }));
    return nearbyMandiPrices(prices.map((p) => ({ mandiId: p.mandiId, modalMinor: p.modalMinor })), meta);
  }, [prices, mandis, here]);
  const best = useMemo(() => bestNearby(nearby), [nearby]);
  const cc = latest?.modalMinor ? 'INR' : 'INR';
  const title = latest?.productName ?? t('mandiDetail.commodity');

  if (!enabled) return <ScreenScaffold title={t('mandi.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold
      title={title}
      footer={latest ? (
        <View style={styles.footer}>
          <Button title={t('mandiDetail.setAlert')} variant="outline"
            onPress={() => router.push({ pathname: '/(farmer)/mandi/alerts', params: { productId: id!, regionId: region ?? '' } })} />
          <View style={{ flex: 1 }}>
            <Button title={t('mandiDetail.listNow')} onPress={() => router.push('/(farmer)/listings/new')} />
          </View>
        </View>
      ) : undefined}
    >
      {loading ? <SkeletonCard lines={10} /> : !latest || failed ? (
        <EmptyState title={t('mandi.noPrices.title')} message={t('mandi.noPrices.message')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <>
          {/* Header price */}
          <View style={styles.hero}>
            <View style={styles.heroThumb}><Text style={styles.heroGlyph}>🌾</Text></View>
            <Text style={styles.heroName}>{latest.productName ?? title}{latest.gradeName ? ` · ${latest.gradeName}` : ''}</Text>
            {/* Commodity category (P1-3) — real catalogue join; omitted (never faked) when the id doesn't resolve. */}
            {latest.categoryName ? <View style={styles.catChip}><Text style={styles.catChipTxt}>{latest.categoryName}</Text></View> : null}
            <Text style={styles.heroSub}>{t('mandiDetail.todaysRate')}</Text>
            <MoneyText minor={latest.modalMinor} currencyCode={cc} langCode={lang} size="3xl" />
            <Text style={styles.heroUnit}>{t('mandi.perUnit', { unit: latest.unitCode })}</Text>
            {change ? (
              <Text style={[styles.change, change.pct < 0 ? styles.changeDown : styles.changeUp]}>
                {change.pct >= 0 ? '↑' : '↓'} {moneyInline(change.deltaMinor.replace('-', ''), lang)} ({(change.pct >= 0 ? '+' : '') + change.pct}%)
              </Text>
            ) : null}
          </View>

          {/* Trend chart */}
          <Card style={{ marginTop: space[3] }}>
            <Text style={styles.section}>{t('mandiDetail.trend')}</Text>
            <View style={styles.tabs}>
              {TREND_PERIODS.map((p) => (
                <Pressable key={p} onPress={() => setPeriod(p)} style={[styles.tab, period === p && styles.tabOn]} accessibilityRole="button" accessibilityState={{ selected: period === p }}>
                  <Text style={[styles.tabTxt, period === p && styles.tabTxtOn]}>{p}</Text>
                </Pressable>
              ))}
            </View>
            {bars.length ? (
              <View style={styles.chart}>
                {bars.map((b, i) => <View key={b.dateIso + i} style={styles.barCol}><View style={[styles.barFill, { height: `${Math.max(b.heightPct, 4)}%` }]} /></View>)}
              </View>
            ) : <Text style={styles.muted}>{t('mandiDetail.noTrend')}</Text>}
            <Pressable onPress={() => router.push({ pathname: '/(farmer)/mandi/history', params: { id: id!, regionId: region ?? '' } })} accessibilityRole="button" hitSlop={6}>
              <Text style={styles.historyLink}>{t('mandiDetail.viewHistory')} →</Text>
            </Pressable>
          </Card>

          {/* 30-day summary */}
          <Card style={{ marginTop: space[3] }}>
            <Text style={styles.section}>{t('mandiDetail.summary')}</Text>
            <View style={styles.sumGrid}>
              <Sum label={t('mandiDetail.high')}><MoneyText minor={summary.highMinor} currencyCode={cc} langCode={lang} size="md" /></Sum>
              <Sum label={t('mandiDetail.low')}><MoneyText minor={summary.lowMinor} currencyCode={cc} langCode={lang} size="md" /></Sum>
              <Sum label={t('mandiDetail.average')}><MoneyText minor={summary.avgMinor} currencyCode={cc} langCode={lang} size="md" /></Sum>
              <Sum label={t('mandiDetail.volatility')}><Text style={styles.sumTxt}>{t(`mandiDetail.vol.${summary.volatility}`)}</Text></Sum>
            </View>
          </Card>

          {/* Nearby mandi prices */}
          <Card style={{ marginTop: space[3] }}>
            <Text style={styles.section}>{t('mandiDetail.nearby')}</Text>
            {nearby.length ? nearby.map((n) => (
              <View key={n.mandiId} style={styles.nRow}>
                <Text style={styles.nName} numberOfLines={1}>{n.name}{n.distanceKm !== null ? ` · ${t('mandiDetail.km', { n: n.distanceKm })}` : ''}</Text>
                <MoneyText minor={n.modalMinor} currencyCode={cc} langCode={lang} size="md" />
              </View>
            )) : <Text style={styles.muted}>{t('mandiDetail.noNearby')}</Text>}
            {best ? (
              <View style={styles.bestBox}>
                <Text style={styles.bestTitle}>{t('mandiDetail.bestIn', { name: best.name })}</Text>
                <View style={styles.bestRow}>
                  <MoneyText minor={best.modalMinor} currencyCode={cc} langCode={lang} size="md" tone="positive" />
                  <Text style={styles.bestUnit}>/{latest.unitCode}</Text>
                </View>
                {/* §13: no logistics-quote contract → distance is real, transport cost is not shown (never faked). */}
                {best.distanceKm !== null ? <Text style={styles.bestMeta}>{t('mandiDetail.km', { n: best.distanceKm })} · {t('mandiDetail.transportSoon')}</Text> : null}
              </View>
            ) : null}
          </Card>
        </>
      )}
    </ScreenScaffold>
  );
}

function Sum({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={styles.sum}>{children}<Text style={styles.sumLabel}>{label}</Text></View>;
}
function moneyInline(minor: string, lang: string): string {
  try {
    const r = Number(BigInt(minor)) / 100;
    return new Intl.NumberFormat(lang === 'en' ? 'en-IN' : lang === 'gu' ? 'gu-IN' : 'hi-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(r);
  } catch { return '—'; }
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  hero: { alignItems: 'center', gap: 2, paddingVertical: space[3] },
  heroThumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center', marginBottom: space[2] },
  heroGlyph: { fontSize: 28 },
  heroName: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900, textAlign: 'center' },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginBottom: space[2] },
  catChip: { backgroundColor: color.earth100, borderRadius: radius.pill, paddingHorizontal: space[2], paddingVertical: 2, marginTop: space[1] },
  catChipTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, fontWeight: font.weight.semibold },
  heroUnit: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  change: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, marginTop: space[1] },
  changeUp: { color: color.success }, changeDown: { color: color.danger },

  section: { fontFamily: font.display, fontSize: font.size.lg, color: color.ink900, fontWeight: font.weight.bold, marginBottom: space[3] },
  tabs: { flexDirection: 'row', gap: space[2], marginBottom: space[3] },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space[2], borderRadius: radius.pill, backgroundColor: color.earth100 },
  tabOn: { backgroundColor: color.primary600 },
  tabTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, fontWeight: font.weight.semibold },
  tabTxtOn: { color: color.white },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 3 },
  barCol: { flex: 1, justifyContent: 'flex-end', height: '100%' },
  barFill: { width: '100%', backgroundColor: color.primary500, borderRadius: radius.sm },
  muted: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  historyLink: { fontFamily: font.body, fontSize: font.size.sm, color: color.primary700, fontWeight: font.weight.semibold, marginTop: space[3], textAlign: 'center' },

  sumGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  sum: { width: '47%', flexGrow: 1, backgroundColor: color.page, borderRadius: radius.md, padding: space[3], gap: 2 },
  sumTxt: { fontFamily: font.display, fontSize: font.size.md, color: color.ink900, fontWeight: font.weight.bold },
  sumLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },

  nRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.ink100 },
  nName: { flex: 1, fontFamily: font.body, fontSize: font.size.md, color: color.ink700 },
  bestBox: { marginTop: space[3], backgroundColor: color.successLight, borderRadius: radius.md, padding: space[3], gap: 2 },
  bestTitle: { fontFamily: font.body, fontSize: font.size.sm, color: color.successDark, fontWeight: font.weight.bold },
  bestRow: { flexDirection: 'row', alignItems: 'baseline' },
  bestUnit: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  bestMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600 },
});
