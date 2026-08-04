// apps/mobile/src/app/(farmer)/weather/detail.tsx · screen 117 "Weather Detail" (expanded forecast). Thin screen
// (guide §3): the geocoded ForecastResult (P0-12) + regional advisories, shown in full. Current-conditions hero,
// the featured advisory banner (most-severe active, PURE pickPrimaryAdvisory), a conditions grid, a 7-day forecast
// with condition labels, and a crop-advisory block fed by the REAL regional advisories. Behind `mandi_weather`.
// Degrade-never-die. Reuses the unit-tested market helpers (weatherEmoji/weatherConditionKey/pickPrimaryAdvisory/
// forecastDayLabel) — no new pure logic.
// §13 gaps (no contract → rendered honestly, never faked): HOURLY forecast, FEELS-LIKE, HUMIDITY, UV, PRESSURE,
// VISIBILITY, SUNRISE (the daily ForecastDay has none of these), the wind BEARING, and the crop-stage personalised
// advisory (no crop-season↔weather link reachable here) — shown as "—" / coming-soon, never invented.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { WeatherAlert, ForecastResult, ForecastDay } from '@krishalaya/sdk-js';
import { formatRelative } from '@krishalaya/i18n';
import { Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { weatherAlerts, weatherForecast, defaultRegionId, defaultLatLng } from '../../../features/market/market.api';
import { weatherSeverityTone, forecastDayLabel, weatherEmoji, weatherConditionKey, pickPrimaryAdvisory, hourLabel, uvBand, windCompass } from '../../../features/market/market';

export default function WeatherDetail() {
  const { t, lang } = useTranslation();
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

  if (!enabled) return <ScreenScaffold title={t('weatherDetail.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const days = forecast?.forecast?.days ?? [];
  const today: ForecastDay | undefined = days[0];
  const hours = (forecast?.forecast?.hours ?? []).slice(0, 12);   // next ~12h strip (server bounds to 24)
  const nowHr = hours[0];                                          // current hour = richest real metrics source
  const place = forecast?.forecast?.placeName;                    // reverse-geocoded label (null → generic)
  const uvKey = uvBand(today?.uvIndexMax ?? nowHr?.uvIndex ?? null);
  const compass = windCompass(today?.windDirDeg ?? null);
  const primary = pickPrimaryAdvisory(items);
  const updated = forecast?.forecast?.fetchedAt;

  return (
    <ScreenScaffold title={t('weatherDetail.title')}>
      {loading ? <SkeletonCard lines={10} /> : (!forecast?.forecast && items.length === 0) ? (
        <EmptyState title={t('weather.empty.title')} message={forecast?.degraded ? t('weather.forecast.degraded') : t('weather.empty.message')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Current hero */}
          {today ? (
            <View style={styles.hero}>
              <Text style={styles.heroEmoji}>{weatherEmoji(today.code)}</Text>
              <Text style={styles.heroTemp}>{Math.round(today.tempMaxC)}°C</Text>
              <Text style={styles.heroCond}>{t(`weather.cond.${weatherConditionKey(today.code)}`)}{today.feelsLikeMaxC != null ? ` · ${t('weatherDetail.feelsLike', { t: `${Math.round(today.feelsLikeMaxC)}°C` })}` : ''}</Text>
              <Text style={styles.heroLoc}>📍 {place ?? t('weather.yourArea')}{updated ? ` · ${t('weather.updated', { ago: safeRel(updated, lang) })}` : ''}</Text>
            </View>
          ) : forecast?.degraded ? <Card style={{ marginBottom: space[3] }}><Text style={styles.muted}>{t('weather.forecast.degraded')}</Text></Card> : null}

          {/* Hourly strip (P1-4: real provider hourly). Degrades to nothing when the provider omits hourly. */}
          {hours.length ? (
            <Card style={{ marginTop: space[3] }}>
              <Text style={styles.section}>{t('weatherDetail.hourly')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hourRow}>
                {hours.map((h) => (
                  <View key={h.time} style={styles.hourCell}>
                    <Text style={styles.hourTime}>{hourLabel(h.time, lang)}</Text>
                    <Text style={styles.hourEmoji}>{weatherEmoji(h.code)}</Text>
                    <Text style={styles.hourTemp}>{Math.round(h.tempC)}°</Text>
                    <Text style={styles.hourRain}>💧{h.precipProbPct}%</Text>
                  </View>
                ))}
              </ScrollView>
            </Card>
          ) : null}

          {/* Featured advisory */}
          {primary ? (
            <View style={[styles.alert, { borderLeftColor: alertColor(primary.severity) }]}>
              <View style={styles.alertHead}>
                <Text style={styles.alertTitle} numberOfLines={2}>⚠ {t(primary.advisoryTextKey)}</Text>
                <StatusPill label={t(`weather.severity.${primary.severity}`, { defaultValue: primary.severity })} tone={weatherSeverityTone(primary.severity)} />
              </View>
            </View>
          ) : null}

          {/* Conditions grid */}
          <Card style={{ marginTop: space[3] }}>
            <Text style={styles.section}>{t('weatherDetail.conditions')}</Text>
            <View style={styles.grid}>
              <Cond label={t('weather.humidity')} value={nowHr?.humidityPct != null ? `${nowHr.humidityPct}%` : '—'} />
              <Cond label={t('weather.wind')} value={today ? `${t('weather.kmh', { n: Math.round(today.windKph) })}${compass ? ` ${t(`weather.compass.${compass}`)}` : ''}` : '—'} />
              <Cond label={t('weather.uv')} value={today?.uvIndexMax != null ? `${Math.round(today.uvIndexMax)}${uvKey ? ` · ${t(`weather.uvBand.${uvKey}`)}` : ''}` : '—'} />
              <Cond label={t('weatherDetail.pressure')} value={nowHr?.pressureHpa != null ? t('weatherDetail.hpa', { n: Math.round(nowHr.pressureHpa) }) : '—'} />
              <Cond label={t('weatherDetail.feelsLikeShort')} value={today?.feelsLikeMaxC != null ? `${Math.round(today.feelsLikeMaxC)}°C` : '—'} />
              <Cond label={t('weatherDetail.sunrise')} value={today?.sunrise ? hourLabel(today.sunrise, lang) : '—'} />
            </View>
            {/* §13: visibility isn't in the requested provider field set → honest "—" above (never invented). */}
          </Card>

          {/* For your crop (§13: crop-stage personalisation; show real regional advisories) */}
          <Card style={{ marginTop: space[3] }}>
            <Text style={styles.section}>{t('weatherDetail.forCrop')}</Text>
            {items.length ? items.map((a) => <Text key={a.id} style={styles.advisoryTxt}>{t(a.advisoryTextKey)}</Text>) : <Text style={styles.muted}>{t('weatherDetail.noAdvisory')}</Text>}
            <Text style={styles.note}>{t('weatherDetail.cropSoon')}</Text>
          </Card>

          {/* 7-day forecast */}
          {days.length ? (
            <Card style={{ marginTop: space[3] }}>
              <Text style={styles.section}>{t('weather.forecast.title')}</Text>
              {days.slice(0, 7).map((d, i) => (
                <View key={d.date} style={[styles.fcRow, i > 0 && styles.fcDivide]}>
                  <Text style={styles.fcDay}>{i === 0 ? t('weather.today') : forecastDayLabel(d)}</Text>
                  <Text style={styles.fcEmoji}>{weatherEmoji(d.code)}</Text>
                  <Text style={styles.fcCond} numberOfLines={1}>{t(`weather.cond.${weatherConditionKey(d.code)}`)}</Text>
                  <Text style={styles.fcTemps}><Text style={styles.fcMax}>{Math.round(d.tempMaxC)}°</Text> <Text style={styles.fcMin}>{Math.round(d.tempMinC)}°</Text></Text>
                </View>
              ))}
            </Card>
          ) : null}
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function Cond({ label, value }: { label: string; value: string }) {
  return <View style={styles.cond}><Text style={styles.condLabel}>{label}</Text><Text style={styles.condVal}>{value}</Text></View>;
}
function safeRel(value: string, lang: string): string { try { return formatRelative(value, lang); } catch { return value; } }
function alertColor(severity: string): string {
  if (severity === 'extreme' || severity === 'red' || severity === 'severe') return color.danger;
  if (severity === 'orange' || severity === 'moderate') return color.warning;
  return color.info;
}

const styles = StyleSheet.create({
  hero: { backgroundColor: color.primary600, borderRadius: radius.lg, padding: space[5], alignItems: 'center', gap: 2 },
  heroEmoji: { fontSize: 52 },
  heroTemp: { fontFamily: font.display, fontSize: font.size['3xl'], color: color.white, fontWeight: font.weight.bold },
  heroCond: { fontFamily: font.body, fontSize: font.size.md, color: color.white, fontWeight: font.weight.semibold },
  heroLoc: { fontFamily: font.body, fontSize: font.size.xs, color: color.primary100, marginTop: space[1] },

  section: { fontFamily: font.display, fontSize: font.size.lg, color: color.ink900, fontWeight: font.weight.bold, marginBottom: space[2] },
  muted: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[2] },

  alert: { backgroundColor: color.warningLight, borderRadius: radius.md, borderLeftWidth: 4, padding: space[3], marginTop: space[3] },
  alertHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3] },
  alertTitle: { flex: 1, fontFamily: font.body, fontSize: font.size.md, color: color.ink800, fontWeight: font.weight.semibold },

  hourRow: { gap: space[3], paddingVertical: space[1] },
  hourCell: { alignItems: 'center', gap: 2, minWidth: 48 },
  hourTime: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  hourEmoji: { fontSize: 20 },
  hourTemp: { fontFamily: font.display, fontSize: font.size.md, color: color.ink900, fontWeight: font.weight.bold },
  hourRain: { fontFamily: font.body, fontSize: font.size.xs, color: color.infoDark },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  cond: { width: '31%', flexGrow: 1, backgroundColor: color.page, borderRadius: radius.md, padding: space[3], gap: 2 },
  condLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  condVal: { fontFamily: font.display, fontSize: font.size.md, color: color.ink900, fontWeight: font.weight.bold },

  advisoryTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, marginBottom: space[2] },

  fcRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space[2] },
  fcDivide: { borderTopWidth: 1, borderTopColor: color.ink100 },
  fcDay: { flex: 1, fontFamily: font.body, fontSize: font.size.md, color: color.ink800, fontWeight: font.weight.semibold },
  fcEmoji: { width: 34, textAlign: 'center', fontSize: 20 },
  fcCond: { flex: 1.6, fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  fcTemps: { flex: 1, textAlign: 'right' },
  fcMax: { fontFamily: font.body, fontSize: font.size.md, color: color.ink900, fontWeight: font.weight.bold },
  fcMin: { fontFamily: font.body, fontSize: font.size.md, color: color.ink400 },
});
