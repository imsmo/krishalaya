// apps/mobile/src/app/(farmer)/weather/index.tsx · screen 54 "7-Day Weather". Thin screen (guide §3): a geocoded
// forecast for the farmer's saved location PLUS regional advisories (P0-12). Current conditions hero (today's
// code/temp), today's stats, the most-severe active advisory banner, a 7-day forecast list, and the advisory text.
// If the provider is down the server degrades to advisories (degraded:true) — a forecast is NEVER fabricated.
// Behind `mandi_weather`. Degrade-never-die: loading skeleton, designed empty, inline retry.
// §13 gaps (no contract → rendered honestly, never faked): a place-NAME for the header (forecast carries lat/lng,
// not a label), and HUMIDITY / UV (not in ForecastDay) — shown as "—", never invented. "Today's" temp uses the
// day's high since the contract has no current/hourly reading.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { WeatherAlert, ForecastResult, ForecastDay } from '@krishalaya/sdk-js';
import { Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { weatherAlerts, weatherForecast, defaultRegionId, defaultLatLng } from '../../../features/market/market.api';
import { weatherSeverityTone, forecastDayLabel, weatherEmoji, weatherConditionKey, pickPrimaryAdvisory } from '../../../features/market/market';

export default function Weather() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('mandi_weather');
  const [region, setRegion] = useState<string | null>(null);
  const [items, setItems] = useState<WeatherAlert[]>([]);
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, geo] = await Promise.all([defaultRegionId(), defaultLatLng()]);
    setRegion(r);
    setItems(r ? await weatherAlerts(r) : []);
    setForecast(geo ? await weatherForecast(geo.lat, geo.lng, r) : null);
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('weather.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const days = forecast?.forecast?.days ?? [];
  const today: ForecastDay | undefined = days[0];
  const primary = pickPrimaryAdvisory(items);

  return (
    <ScreenScaffold
      title={t('weather.title')}
      footer={
        <View style={styles.footerRow}>
          <Pressable onPress={() => router.push('/(farmer)/weather/detail')} accessibilityRole="button"><Text style={styles.link}>{t('weatherDetail.fullForecast')} →</Text></Pressable>
          <Pressable onPress={() => router.push('/(farmer)/weather/settings')} accessibilityRole="button"><Text style={styles.link}>{t('weather.settings.title')} →</Text></Pressable>
        </View>
      }
    >
      {loading ? <SkeletonCard lines={10} /> : (!forecast?.forecast && items.length === 0) ? (
        !region
          ? <EmptyState title={t('weather.noRegion.title')} message={t('weather.noRegion.message')} actionLabel={t('weather.settings.title')} onAction={() => router.push('/(farmer)/weather/settings')} />
          : <EmptyState title={t('weather.empty.title')} message={forecast?.degraded ? t('weather.forecast.degraded') : t('weather.empty.message')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Location header (§13: no place name in the forecast contract → region/your-area label) */}
          <Text style={styles.loc}>📍 {t('weather.yourArea')}</Text>

          {/* Current conditions hero (today) */}
          {today ? (
            <View style={styles.hero}>
              <Text style={styles.heroEmoji}>{weatherEmoji(today.code)}</Text>
              <Text style={styles.heroTemp}>{Math.round(today.tempMaxC)}°</Text>
              <Text style={styles.heroCond}>{t(`weather.cond.${weatherConditionKey(today.code)}`)}</Text>
              <Text style={styles.heroNote}>{t('weather.todayHigh')}</Text>
              <View style={styles.stats}>
                <Stat label={t('weather.humidity')} value="—" />
                <Stat label={t('weather.wind')} value={t('weather.kmh', { n: Math.round(today.windKph) })} />
                <Stat label={t('weather.rain')} value={`${today.precipProbPct}%`} />
                <Stat label={t('weather.uv')} value="—" />
              </View>
            </View>
          ) : forecast?.degraded ? <Card style={{ marginBottom: space[3] }}><Text style={styles.muted}>{t('weather.forecast.degraded')}</Text></Card> : null}

          {/* Featured advisory banner */}
          {primary ? (
            <View style={[styles.alert, { borderLeftColor: alertColor(primary.severity) }]}>
              <View style={styles.alertHead}>
                <Text style={styles.alertTitle} numberOfLines={2}>{t(primary.advisoryTextKey)}</Text>
                <StatusPill label={t(`weather.severity.${primary.severity}`, { defaultValue: primary.severity })} tone={weatherSeverityTone(primary.severity)} />
              </View>
            </View>
          ) : null}

          {/* 7-day forecast */}
          {days.length ? (
            <Card style={{ marginTop: space[3] }}>
              <Text style={styles.section}>{t('weather.forecast.title')}</Text>
              {days.slice(0, 7).map((d, i) => (
                <View key={d.date} style={[styles.fcRow, i > 0 && styles.fcDivide]}>
                  <Text style={styles.fcDay}>{i === 0 ? t('weather.today') : forecastDayLabel(d)}</Text>
                  <Text style={styles.fcEmoji}>{weatherEmoji(d.code)}</Text>
                  <Text style={styles.fcRain}>💧 {d.precipProbPct}%{d.precipMm >= 1 ? ` · ${Math.round(d.precipMm)}mm` : ''}</Text>
                  <Text style={styles.fcTemps}><Text style={styles.fcMax}>{Math.round(d.tempMaxC)}°</Text> <Text style={styles.fcMin}>{Math.round(d.tempMinC)}°</Text></Text>
                </View>
              ))}
            </Card>
          ) : null}

          {/* Advisory text section */}
          {items.length ? (
            <Card style={{ marginTop: space[3] }}>
              <Text style={styles.section}>{t('weather.advisoryTitle')}</Text>
              {items.map((a) => (
                <Text key={a.id} style={styles.advisoryTxt}>{t(a.advisoryTextKey)}</Text>
              ))}
            </Card>
          ) : null}
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.stat}><Text style={styles.statVal}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}
function alertColor(severity: string): string {
  if (severity === 'extreme' || severity === 'red' || severity === 'severe') return color.danger;
  if (severity === 'orange' || severity === 'moderate') return color.warning;
  return color.info;
}

const styles = StyleSheet.create({
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary700 },
  loc: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600, marginBottom: space[2] },

  hero: { backgroundColor: color.primary600, borderRadius: radius.lg, padding: space[5], alignItems: 'center', gap: 2 },
  heroEmoji: { fontSize: 52 },
  heroTemp: { fontFamily: font.display, fontSize: font.size['3xl'], color: color.white, fontWeight: font.weight.bold },
  heroCond: { fontFamily: font.body, fontSize: font.size.md, color: color.white, fontWeight: font.weight.semibold },
  heroNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.primary100, marginBottom: space[3] },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], justifyContent: 'space-between', alignSelf: 'stretch' },
  stat: { width: '23%', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.md, paddingVertical: space[2] },
  statVal: { fontFamily: font.body, fontSize: font.size.md, color: color.white, fontWeight: font.weight.bold },
  statLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.primary100, marginTop: 2 },

  alert: { backgroundColor: color.warningLight, borderRadius: radius.md, borderLeftWidth: 4, padding: space[3], marginTop: space[3] },
  alertHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3] },
  alertTitle: { flex: 1, fontFamily: font.body, fontSize: font.size.md, color: color.ink800, fontWeight: font.weight.semibold },

  section: { fontFamily: font.display, fontSize: font.size.lg, color: color.ink900, fontWeight: font.weight.bold, marginBottom: space[2] },
  fcRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space[2] },
  fcDivide: { borderTopWidth: 1, borderTopColor: color.ink100 },
  fcDay: { flex: 1.2, fontFamily: font.body, fontSize: font.size.md, color: color.ink800, fontWeight: font.weight.semibold },
  fcEmoji: { width: 36, textAlign: 'center', fontSize: 20 },
  fcRain: { flex: 1.6, fontFamily: font.body, fontSize: font.size.sm, color: color.info },
  fcTemps: { flex: 1, textAlign: 'right' },
  fcMax: { fontFamily: font.body, fontSize: font.size.md, color: color.ink900, fontWeight: font.weight.bold },
  fcMin: { fontFamily: font.body, fontSize: font.size.md, color: color.ink400 },

  advisoryTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, marginBottom: space[2] },
  muted: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
});
