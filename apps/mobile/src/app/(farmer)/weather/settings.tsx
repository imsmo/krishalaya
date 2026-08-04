// apps/mobile/src/app/(farmer)/weather/settings.tsx · screen 118 "Weather Alert Settings". Thin screen (guide §3):
// the critical always-on advisory types (the server always sends these — informational), the region weather is
// sourced from (the farmer's saved address), and the notification-delivery + daily-advisory preferences which are
// MANAGED in the shared notification settings (P-04) — this screen links there rather than persisting a separate
// weather-prefs blob (no such endpoint exists). Behind `mandi_weather`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked): per-toggle weather-pref persistence (delivery/daily
// advisory live in notification settings, linked here), the voice-call channel, and a "my crops" selection (no
// crops-for-weather contract) — shown as info rows / coming-soon, never wired to a fake mutation.
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { WeatherPrefs } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, StatusPill, Toggle, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { defaultRegionId, getWeatherPrefs, saveWeatherPrefs } from '../../../features/market/market.api';

const DEFAULT_PREFS: WeatherPrefs = { morningAdvisory: true, weeklyOutlook: true, severeOnly: false };

const CRITICAL = [
  { icon: '⛈', key: 'heavyRain' }, { icon: '🌨', key: 'hail' }, { icon: '🌡', key: 'heatWave' }, { icon: '❄', key: 'frost' },
] as const;

export default function WeatherSettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('mandi_weather');
  const notifOn = useFlag('notifications');
  const [region, setRegion] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<WeatherPrefs>(DEFAULT_PREFS);
  const [savingKey, setSavingKey] = useState<keyof WeatherPrefs | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [r, p] = await Promise.all([defaultRegionId(), getWeatherPrefs()]);
    setRegion(r); setPrefs(p ?? DEFAULT_PREFS); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  // Optimistic toggle → persist (P1-4). On failure, revert and tell the user (never a fake "saved").
  const setPref = async (key: keyof WeatherPrefs, value: boolean) => {
    const prev = prefs; const next = { ...prefs, [key]: value };
    setPrefs(next); setSavingKey(key);
    try { await saveWeatherPrefs(next); }
    catch { setPrefs(prev); Alert.alert(t('weatherSettings.title'), t('common.error.generic')); }
    finally { setSavingKey(null); }
  };

  if (!enabled) return <ScreenScaffold title={t('weatherSettings.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const toPrefs = () => router.push('/(farmer)/notifications/settings');

  return (
    <ScreenScaffold title={t('weatherSettings.title')}>
      {loading ? <SkeletonCard lines={10} /> : (
        <>
          {/* Critical alerts — always on */}
          <Card>
            <View style={styles.head}>
              <Text style={styles.section}>{t('weatherSettings.criticalTitle')}</Text>
              <StatusPill label={t('weatherSettings.alwaysOn')} tone="success" />
            </View>
            {CRITICAL.map((c, i) => (
              <View key={c.key} style={[styles.row, i > 0 && styles.divide]}>
                <Text style={styles.icon}>{c.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{t(`weatherSettings.crit.${c.key}.title`)}</Text>
                  <Text style={styles.rowDesc}>{t(`weatherSettings.crit.${c.key}.desc`)}</Text>
                </View>
              </View>
            ))}
          </Card>

          {/* Daily advisory content prefs — REAL persistence (P1-4). Channel delivery still links to notif settings. */}
          <Card style={{ marginTop: space[3] }}>
            <Text style={styles.section}>{t('weatherSettings.dailyTitle')}</Text>
            <ToggleRow icon="🌅" title={t('weatherSettings.morning.title')} desc={t('weatherSettings.morning.desc')}
              value={prefs.morningAdvisory} busy={savingKey === 'morningAdvisory'} onChange={(v) => setPref('morningAdvisory', v)} />
            <ToggleRow icon="📅" title={t('weatherSettings.weekly.title')} desc={t('weatherSettings.weekly.desc')}
              value={prefs.weeklyOutlook} busy={savingKey === 'weeklyOutlook'} onChange={(v) => setPref('weeklyOutlook', v)} />
            <ToggleRow icon="⚠️" title={t('weatherSettings.severeOnly.title')} desc={t('weatherSettings.severeOnly.desc')}
              value={prefs.severeOnly} busy={savingKey === 'severeOnly'} onChange={(v) => setPref('severeOnly', v)} />
            <PrefRow icon="📞" title={t('weatherSettings.voice.title')} desc={t('weatherSettings.voice.desc')} badge={t('weatherSettings.soon')} />
          </Card>

          {/* Notification delivery → real notification settings */}
          <Card style={{ marginTop: space[3] }}>
            <Text style={styles.section}>{t('weatherSettings.deliveryTitle')}</Text>
            <PrefRow icon="📱" title={t('weatherSettings.push')} onPress={notifOn ? toPrefs : undefined} />
            <PrefRow icon="💬" title={t('weatherSettings.sms')} desc={t('weatherSettings.smsDesc')} onPress={notifOn ? toPrefs : undefined} />
            {!notifOn ? <Text style={styles.note}>{t('weatherSettings.deliverySoon')}</Text> : null}
          </Card>

          {/* Crop selection (§13: no crops-for-weather contract) */}
          <Card style={{ marginTop: space[3] }}>
            <Text style={styles.section}>{t('weatherSettings.cropTitle')}</Text>
            <Text style={styles.note}>{t('weatherSettings.cropSoon')}</Text>
            <Pressable onPress={() => router.push('/(farmer)/profile')} accessibilityRole="button" style={styles.addCrop}><Text style={styles.addCropTxt}>+ {t('weatherSettings.addCrop')}</Text></Pressable>
          </Card>

          {/* Region source */}
          <Card style={{ marginTop: space[3] }}>
            <View style={styles.regionRow}>
              <Text style={styles.k}>{t('weather.settings.region')}</Text>
              <Text style={styles.v}>{region ? region.slice(0, 8).toUpperCase() : t('weather.settings.none')}</Text>
            </View>
            <Text style={styles.note}>{t('weather.settings.regionNote')}</Text>
            <View style={{ marginTop: space[3] }}><Button title={t('weather.settings.changeAddress')} variant="outline" onPress={() => router.push('/(farmer)/profile')} /></View>
          </Card>
        </>
      )}
    </ScreenScaffold>
  );
}

function ToggleRow({ icon, title, desc, value, busy, onChange }: { icon: string; title: string; desc?: string; value: boolean; busy: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.prefRow}>
      <Text style={styles.icon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {desc ? <Text style={styles.rowDesc}>{desc}</Text> : null}
      </View>
      <Toggle label="" value={value} onValueChange={onChange} disabled={busy} />
    </View>
  );
}
function PrefRow({ icon, title, desc, badge, onPress }: { icon: string; title: string; desc?: string; badge?: string; onPress?: () => void }) {
  const body = (
    <View style={styles.prefRow}>
      <Text style={styles.icon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {desc ? <Text style={styles.rowDesc}>{desc}</Text> : null}
      </View>
      {badge ? <Text style={styles.badge}>{badge}</Text> : onPress ? <Text style={styles.chevron}>›</Text> : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button">{body}</Pressable> : body;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[2] },
  section: { fontFamily: font.display, fontSize: font.size.lg, color: color.ink900, fontWeight: font.weight.bold, marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  divide: { borderTopWidth: 1, borderTopColor: color.ink100 },
  prefRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3], borderTopWidth: 1, borderTopColor: color.ink100 },
  icon: { fontSize: 20, width: 28, textAlign: 'center' },
  rowTitle: { fontFamily: font.body, fontSize: font.size.md, color: color.ink800, fontWeight: font.weight.semibold },
  rowDesc: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2 },
  badge: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  chevron: { fontFamily: font.body, fontSize: font.size.lg, color: color.ink400 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[1] },
  addCrop: { marginTop: space[3], alignSelf: 'flex-start', paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1, borderColor: color.primary600 },
  addCropTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.primary700, fontWeight: font.weight.semibold },
  regionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  k: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500 },
  v: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
});
