// apps/mobile/src/app/(dairy)/d2c.tsx · D2C milk subscription (PC-55 B6, on PC-54 W54-5 + PC-55 A5).
// The household's standing order for milk at home. This tab replaces the coming-note the dairy home carried until
// the endpoints existed.
//
// THREE CONTROLS THE HOUSEHOLD OWNS, not a support request: pause, resume, cancel. Each is offered only in the state
// the API accepts, so a tap never becomes a 409 the person has to interpret.
//
// PAUSE ASKS FOR AN END DATE, because the API requires one — and because a pause with no end is an abandoned
// subscription nobody resumes. The date must be in the future and is capped at a year: a longer gap is a
// cancellation being avoided, and pretending otherwise leaves a household's milk in limbo.
//
// WHAT THIS SCREEN NEVER DOES: compute a monthly cost. The plan's price per delivery is the seller's (a bigint minor
// string), and the bill is a SERVER-side postpaid statement over drops that ACTUALLY happened. Multiplying price by
// frequency would produce a confident number that ignores every pause, skip and failed delivery — and a household
// would rightly call it a lie when the real bill arrived. So the screen shows the per-delivery price, the deliveries
// that actually happened, and says where the bill comes from.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Pressable, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { d2cPlans, myD2cSubscriptions, subscribeD2c, pauseD2c, resumeD2c, cancelD2c, myD2cDeliveries, myAddresses } from '../../features/dairy/dairy.api';
import {
  buildPause, buildSubscribe, canCancel, canPause, canResume, subscriptionState, billableCount,
  type SubscriptionRow,
} from '../../features/dairy/d2c';

type PlanRow = Record<string, unknown> & { id?: string; defaultName?: string; frequency?: string; qtyPerDelivery?: string; unitCode?: string; pricePerDeliveryMinor?: string; deliveryWindow?: string | null };
type AddressRow = { id: string; line1?: string; village?: string; pincode?: string };

const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  active: 'success', starting: 'neutral', paused_until: 'warning', resuming_today: 'warning', paused: 'warning', cancelled: 'danger',
};

export default function D2cSubscriptions() {
  const { t, lang } = useTranslation();
  const [subs, setSubs] = useState<SubscriptionRow[] | undefined>(undefined);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [deliveries, setDeliveries] = useState<Array<{ status?: string | null }>>([]);
  const [busy, setBusy] = useState(false);
  const [planId, setPlanId] = useState('');
  const [addressId, setAddressId] = useState('');
  const [startsOn, setStartsOn] = useState(today());
  const [pauseUntil, setPauseUntil] = useState('');

  const load = useCallback(async () => {
    const [s, p, a, d] = await Promise.all([myD2cSubscriptions(), d2cPlans(), myAddresses(), myD2cDeliveries(monthAgo(), today())]);
    setSubs(s as SubscriptionRow[]);
    setPlans(p as PlanRow[]);
    setAddresses(a as AddressRow[]);
    setDeliveries(d as Array<{ status?: string | null }>);
    if (!addressId && a.length > 0) setAddressId(a[0].id);
  }, [addressId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const subscribe = async () => {
    const built = buildSubscribe({ planId, addressId, startsOn }, today());
    if (!built.ok) { Alert.alert(t('d2c.subscribe.title'), t(`d2c.error.${built.error}`)); return; }
    setBusy(true);
    try { await subscribeD2c(built.value); setPlanId(''); await load(); Alert.alert(t('d2c.subscribe.title'), t('d2c.subscribed')); }
    catch { Alert.alert(t('d2c.subscribe.title'), t('d2c.error.save')); }
    finally { setBusy(false); }
  };

  const doPause = (id: string) => {
    const built = buildPause({ pausedUntil: pauseUntil }, today());
    if (!built.ok) { Alert.alert(t('d2c.pause.title'), t(`d2c.error.${built.error}`)); return; }
    Alert.alert(t('d2c.pause.title'), t('d2c.pause.confirm', { until: built.value.pausedUntil }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), onPress: async () => {
        setBusy(true);
        try { await pauseD2c(id, built.value.pausedUntil); setPauseUntil(''); await load(); }
        catch { Alert.alert(t('d2c.pause.title'), t('d2c.error.save')); }
        finally { setBusy(false); }
      } },
    ]);
  };

  const doResume = async (id: string) => {
    setBusy(true);
    try { await resumeD2c(id); await load(); } catch { Alert.alert(t('d2c.title'), t('d2c.error.save')); } finally { setBusy(false); }
  };

  const doCancel = (id: string) => {
    // Cancellation is FINAL — the household re-subscribes rather than un-cancelling — so it is confirmed, and the
    // confirmation says so instead of implying it can be undone.
    Alert.alert(t('d2c.cancel.title'), t('d2c.cancel.confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('d2c.cancel.yes'), style: 'destructive', onPress: async () => {
        setBusy(true);
        try { await cancelD2c(id); await load(); } catch { Alert.alert(t('d2c.cancel.title'), t('d2c.error.save')); } finally { setBusy(false); }
      } },
    ]);
  };

  if (subs === undefined) return <ScreenScaffold title={t('d2c.title')}><SkeletonCard lines={6} /></ScreenScaffold>;

  const plan = (s: SubscriptionRow) => plans.find((p) => p.id === s.planId);

  return (
    <ScreenScaffold title={t('d2c.title')}>
      <ScrollView>
        <Text style={styles.muted}>{t('d2c.hint')}</Text>

        <Text style={styles.section}>{t('d2c.mine')}</Text>
        {subs.length === 0 ? <EmptyState title={t('d2c.noneTitle')} message={t('d2c.noneBody')} /> : subs.map((s) => {
          const st = subscriptionState(s, today());
          const p = plan(s);
          return (
            <Card key={String(s.id)}>
              <View style={styles.between}>
                <Text style={styles.value}>{String(p?.defaultName ?? s.planName ?? t('d2c.plan'))}</Text>
                <StatusPill label={t(`d2c.state.${st}`)} tone={TONE[st] ?? 'neutral'} />
              </View>
              {p?.frequency ? <Text style={styles.muted}>{t(`d2c.freq.${String(p.frequency)}`) || String(p.frequency)}</Text> : null}
              {p?.qtyPerDelivery ? <Text style={styles.muted}>{t('d2c.perDelivery', { qty: String(p.qtyPerDelivery), unit: String(p.unitCode ?? '') })}</Text> : null}
              {p?.pricePerDeliveryMinor ? (
                <View style={styles.between}>
                  <Text style={styles.label}>{t('d2c.pricePerDelivery')}</Text>
                  <MoneyText minor={String(p.pricePerDeliveryMinor)} langCode={lang} size="sm" />
                </View>
              ) : null}
              {s.startsOn ? <Text style={styles.muted}>{t('d2c.startsOn')}: {String(s.startsOn)}</Text> : null}
              {st === 'paused_until' && s.pausedUntil ? <Text style={styles.muted}>{t('d2c.pausedUntil')}: {String(s.pausedUntil)}</Text> : null}
              {st === 'resuming_today' ? <Text style={styles.muted}>{t('d2c.resumingToday')}</Text> : null}

              {canPause(s.status) ? (<>
                <Text style={styles.label}>{t('d2c.pause.until')}</Text>
                <TextInput value={pauseUntil} onChangeText={setPauseUntil} style={styles.input} placeholder="YYYY-MM-DD" accessibilityLabel={t('d2c.pause.until')} />
                <Text style={styles.muted}>{t('d2c.pause.hint')}</Text>
                <Button title={t('d2c.pause.btn')} variant="outline" disabled={busy} onPress={() => doPause(String(s.id))} />
              </>) : null}
              {canResume(s.status) ? <Button title={t('d2c.resume.btn')} disabled={busy} onPress={() => doResume(String(s.id))} /> : null}
              {canCancel(s.status) ? <Button title={t('d2c.cancel.btn')} variant="outline" disabled={busy} onPress={() => doCancel(String(s.id))} /> : null}
              {s.status === 'cancelled' ? <Text style={styles.muted}>{t('d2c.cancelledNote')}</Text> : null}
            </Card>
          );
        })}

        <Text style={styles.section}>{t('d2c.recent')}</Text>
        <Text style={styles.muted}>{t('d2c.recentCount', { n: String(billableCount(deliveries)), total: String(deliveries.length) })}</Text>
        <Text style={styles.muted}>{t('d2c.billingNote')}</Text>

        <Text style={styles.section}>{t('d2c.subscribe.title')}</Text>
        {plans.length === 0 ? <Text style={styles.muted}>{t('d2c.noPlans')}</Text> : (
          <Card>
            <Text style={styles.label}>{t('d2c.choosePlan')}</Text>
            {plans.map((p) => (
              <Pressable key={String(p.id)} onPress={() => setPlanId(String(p.id))} accessibilityRole="radio" accessibilityState={{ selected: planId === p.id }} style={[styles.option, planId === p.id && styles.optionActive]}>
                <View style={styles.between}>
                  <Text style={styles.value}>{String(p.defaultName ?? '')}</Text>
                  {p.pricePerDeliveryMinor ? <MoneyText minor={String(p.pricePerDeliveryMinor)} langCode={lang} size="sm" /> : null}
                </View>
                <Text style={styles.muted}>
                  {t(`d2c.freq.${String(p.frequency)}`) || String(p.frequency ?? '')}
                  {p.qtyPerDelivery ? ` · ${t('d2c.perDelivery', { qty: String(p.qtyPerDelivery), unit: String(p.unitCode ?? '') })}` : ''}
                  {p.deliveryWindow ? ` · ${String(p.deliveryWindow)}` : ''}
                </Text>
              </Pressable>
            ))}

            <Text style={styles.label}>{t('d2c.deliverTo')}</Text>
            {addresses.length === 0 ? <Text style={styles.muted}>{t('d2c.noAddress')}</Text> : addresses.map((a) => (
              <Pressable key={a.id} onPress={() => setAddressId(a.id)} accessibilityRole="radio" accessibilityState={{ selected: addressId === a.id }} style={[styles.option, addressId === a.id && styles.optionActive]}>
                <Text style={styles.value}>{a.line1 ?? a.village ?? a.id.slice(0, 8)}</Text>
                {a.pincode ? <Text style={styles.muted}>{a.pincode}</Text> : null}
              </Pressable>
            ))}

            <Text style={styles.label}>{t('d2c.startsOn')}</Text>
            <TextInput value={startsOn} onChangeText={setStartsOn} style={styles.input} placeholder="YYYY-MM-DD" accessibilityLabel={t('d2c.startsOn')} />
            <Text style={styles.muted}>{t('d2c.startsOnHint')}</Text>
            <Button title={t('d2c.subscribe.btn')} disabled={busy || !planId || !addressId} onPress={subscribe} />
          </Card>
        )}
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  section: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, marginTop: space[3] },
  label: { fontSize: font.size.xs, color: color.ink500, marginTop: space[2] },
  value: { fontSize: font.size.md, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  input: { borderWidth: 1, borderColor: color.ink200, borderRadius: 8, padding: space[2], marginTop: space[1], fontSize: font.size.sm, color: color.ink800, minHeight: 44 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space[1] },
  option: { borderWidth: 1, borderColor: color.ink200, borderRadius: 12, padding: space[2], marginTop: space[2] },
  optionActive: { borderColor: color.primary700, backgroundColor: color.ink100 },
});
