// apps/mobile/src/app/(farmer)/mandi/alerts.tsx · screen 110 "Mandi Price Alerts". Thin screen (guide §3): the
// farmer's price-threshold subscriptions. A stats header (active count from the PURE alertSummary), the active
// alerts list with an enable/disable toggle (idempotent), "+ Add new" → the mandi prices list to pick a commodity,
// and an alert-preferences block linking to notification settings. When opened from a price row (productId param)
// it shows the create form (direction + threshold ₹→paise via BigInt, Law 2; create idempotent, Law 3). Delivery
// is a server PUSH (P-04) when a price crosses. Behind `mandi_weather`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked): triggered-today / this-week COUNTS and the triggered-
// alerts feed (no trigger-history read-model), and per-alert product name / mandi names / current price (would be
// N+1) — shown as "—" or a coming-soon note, never invented.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { PriceAlert, AlertActivity } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, MoneyText, StatusPill, Toggle, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { listAlerts, createAlert, setAlertActive, alertActivity } from '../../../features/market/market.api';
import { buildAlertDraft, alertTone, alertSummary } from '../../../features/market/market';

const DIRS = ['above', 'below'] as const;

export default function MandiAlerts() {
  const { productId, regionId, rupees: rupeesParam } = useLocalSearchParams<{ productId?: string; regionId?: string; rupees?: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('mandi_weather');
  const [items, setItems] = useState<PriceAlert[]>([]);
  const [activity, setActivity] = useState<AlertActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState<'above' | 'below'>('above');
  const [rupees, setRupees] = useState(rupeesParam ?? '');
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    const [r, act] = await Promise.all([listAlerts(), alertActivity()]);
    setItems(r.items); setActivity(act); setLoading(false);
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('mandi.alerts.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const toggle = async (a: PriceAlert) => {
    try { await setAlertActive(a.id, !a.isActive); await load(); }
    catch { Alert.alert(t('mandi.alerts.title'), t('common.error.generic')); }
  };
  const create = async () => {
    const draft = buildAlertDraft({ productId, regionId: regionId || null, direction, rupees });
    if (!draft.ok || !draft.input) { setError(t(draft.reason === 'threshold' ? 'mandi.alerts.amountInvalid' : 'mandi.alerts.invalid')); return; }
    setBusy(true); setError(undefined);
    try { await createAlert(draft.input); setRupees(''); await load(); }
    catch { Alert.alert(t('mandi.alerts.title'), t('mandi.alerts.createFailed')); }
    finally { setBusy(false); }
  };

  const stats = alertSummary(items);

  return (
    <ScreenScaffold title={t('mandi.alerts.title')}>
      {/* Create form (deep-linked from a price row's "Set Alert") */}
      {productId ? (
        <Card style={styles.createCard}>
          <Text style={styles.h}>{t('mandi.alerts.newTitle')}</Text>
          <View style={styles.dirs}>
            {DIRS.map((d) => {
              const on = direction === d;
              return (
                <Pressable key={d} onPress={() => setDirection(d)} style={[styles.dchip, on && styles.dchipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Text style={[styles.dchipText, on && styles.dchipTextOn]}>{t(`mandi.alerts.dir.${d}`)}</Text>
                </Pressable>
              );
            })}
          </View>
          <Input label={t('mandi.alerts.threshold')} value={rupees} onChangeText={setRupees} keyboardType="number-pad" maxLength={9} error={error} />
          <View style={{ marginTop: space[3] }}><Button title={t('mandi.alerts.create')} loading={busy} onPress={create} /></View>
          <Text style={styles.note}>{t('mandi.alerts.pushNote')}</Text>
        </Card>
      ) : null}

      {loading ? <SkeletonCard lines={8} /> : (
        <FlatList
          data={items}
          keyExtractor={(a) => a.id}
          ListHeaderComponent={
            <View>
              {/* Stats header */}
              <View style={styles.statsRow}>
                <Stat value={String(stats.active)} label={t('mandi.alerts.statActive')} tone="primary" />
                <Stat value={activity ? String(activity.triggeredToday) : '—'} label={t('mandi.alerts.statTriggeredToday')} />
                <Stat value={activity ? String(activity.triggeredThisWeek) : '—'} label={t('mandi.alerts.statThisWeek')} />
                <Stat value={t('mandi.alerts.smsFree')} label={t('mandi.alerts.statSms')} />
              </View>

              <View style={styles.listHead}>
                <Text style={styles.section}>{t('mandi.alerts.activeTitle')}</Text>
                <Pressable onPress={() => router.push('/(farmer)/mandi')} accessibilityRole="button" hitSlop={8}><Text style={styles.addNew}>+ {t('mandi.alerts.addNew')}</Text></Pressable>
              </View>
            </View>
          }
          ListEmptyComponent={<EmptyState title={t('mandi.alerts.empty.title')} message={t('mandi.alerts.empty.message')} />}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.cardRow}>
                <View style={styles.thumb}><Text style={styles.thumbGlyph}>🌾</Text></View>
                <View style={{ flex: 1 }}>
                  {/* §13: alert carries productId only (no name) → generic label; threshold/direction is the real content. */}
                  <Text style={styles.alertName}>{t('mandi.alerts.priceAlert')}</Text>
                  <View style={styles.thresholdRow}>
                    <Text style={styles.dirLabel}>{t(`mandi.alerts.when.${item.direction}`)} </Text>
                    <MoneyText minor={item.thresholdMinor} langCode={lang} size="sm" />
                  </View>
                </View>
                <Toggle label={t('mandi.alerts.enabled')} value={item.isActive} onValueChange={() => toggle(item)} />
              </View>
              <View style={styles.cardFoot}>
                <StatusPill label={t(item.isActive ? 'mandi.alerts.active' : 'mandi.alerts.paused')} tone={alertTone(item)} />
              </View>
            </Card>
          )}
          ListFooterComponent={
            <Card style={{ marginTop: space[3] }}>
              <Text style={styles.section}>{t('mandi.alerts.prefsTitle')}</Text>
              <PrefRow icon="📱" label={t('mandi.alerts.prefPush')} onPress={() => router.push('/(farmer)/notifications/settings')} />
              <PrefRow icon="💬" label={t('mandi.alerts.prefSms')} onPress={() => router.push('/(farmer)/notifications/settings')} />
              <PrefRow icon="🔇" label={t('mandi.alerts.prefQuiet')} onPress={() => router.push('/(farmer)/notifications/settings')} />
            </Card>
          }
          contentContainerStyle={{ paddingBottom: space[6] }}
        />
      )}
    </ScreenScaffold>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'primary' }) {
  return <View style={styles.stat}><Text style={[styles.statVal, tone === 'primary' && { color: color.primary700 }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}
function PrefRow({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.prefRow} accessibilityRole="button">
      <Text style={styles.prefIcon}>{icon}</Text>
      <Text style={styles.prefLabel}>{label}</Text>
      <Text style={styles.prefChevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  createCard: { backgroundColor: color.primary50, marginBottom: space[3] },
  h: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, marginBottom: space[2] },
  dirs: { flexDirection: 'row', gap: space[2], marginBottom: space[3] },
  dchip: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  dchipOn: { borderColor: color.primary600 },
  dchipText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  dchipTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400, marginTop: space[3] },

  statsRow: { flexDirection: 'row', gap: space[2], marginBottom: space[2] },
  stat: { flex: 1, backgroundColor: color.card, borderRadius: radius.lg, paddingVertical: space[3], paddingHorizontal: space[1], alignItems: 'center', gap: 2 },
  statVal: { fontFamily: font.display, fontSize: font.size.lg, color: color.ink900, fontWeight: font.weight.bold },
  statLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, textAlign: 'center' },
  gapNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginBottom: space[3] },

  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[2] },
  section: { fontFamily: font.display, fontSize: font.size.lg, color: color.ink900, fontWeight: font.weight.bold },
  addNew: { fontFamily: font.body, fontSize: font.size.sm, color: color.primary700, fontWeight: font.weight.semibold },

  card: { marginBottom: space[2] },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  thumb: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  thumbGlyph: { fontSize: 20 },
  alertName: { fontFamily: font.body, fontSize: font.size.md, color: color.ink800, fontWeight: font.weight.semibold },
  thresholdRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  dirLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  cardFoot: { marginTop: space[2], flexDirection: 'row' },

  prefRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3], borderTopWidth: 1, borderTopColor: color.ink100 },
  prefIcon: { fontSize: 18 },
  prefLabel: { flex: 1, fontFamily: font.body, fontSize: font.size.md, color: color.ink700 },
  prefChevron: { fontFamily: font.body, fontSize: font.size.lg, color: color.ink400 },
});
