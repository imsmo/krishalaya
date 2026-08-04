// apps/mobile/src/app/(farmer)/weather/[id].tsx · screen 117 (weather advisory detail). Thin screen (guide §3):
// the advisory's text, severity, validity window. Refetches the region's advisories and finds this one (the list
// read is the source — no per-id endpoint). Behind `mandi_weather`. Degrade-never-die.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { WeatherAlert } from '@krishalaya/sdk-js';
import { Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { weatherAlerts } from '../../../features/market/market.api';
import { weatherSeverityTone, isAdvisoryActive } from '../../../features/market/market';

export default function WeatherDetail() {
  const { id, regionId } = useLocalSearchParams<{ id: string; regionId?: string }>();
  const { t, lang } = useTranslation();
  const enabled = useFlag('mandi_weather');
  const [advisory, setAdvisory] = useState<WeatherAlert | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!regionId || !id) { setLoading(false); return; }
    setLoading(true);
    const list = await weatherAlerts(regionId, false);
    setAdvisory(list.find((w) => w.id === id) ?? null);
    setLoading(false);
  }, [id, regionId]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('weather.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('weather.detailTitle')}>
      {loading ? <SkeletonCard lines={4} /> : !advisory ? (
        <EmptyState title={t('weather.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <Card>
          <View style={styles.head}>
            <StatusPill label={t(`weather.severity.${advisory.severity}`, { defaultValue: advisory.severity })} tone={weatherSeverityTone(advisory.severity)} />
            {!isAdvisoryActive(advisory) ? <Text style={styles.expired}>{t('weather.expired')}</Text> : null}
          </View>
          <Text style={styles.body}>{t(advisory.advisoryTextKey)}</Text>
          {advisory.validFrom ? <Row k={t('weather.validFrom')} v={safeDate(advisory.validFrom, lang)} /> : null}
          {advisory.validTo ? <Row k={t('weather.validTo')} v={safeDate(advisory.validTo, lang)} /> : null}
        </Card>
      )}
    </ScreenScaffold>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <View style={styles.row}><Text style={styles.k}>{k}</Text><Text style={styles.v}>{v}</Text></View>;
}
function safeDate(value: string, langCode: string): string { try { return formatDate(value, langCode); } catch { return value; } }

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[2] },
  body: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700 },
  expired: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.ink100, marginTop: space[2] },
  k: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500 },
  v: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
});
