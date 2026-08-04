// apps/mobile/src/app/(buyer)/delivery.tsx · screen 129 (checkout Step 2 · Delivery). Thin screen (guide §3):
// pick a saved delivery address (radio) and a delivery method, then Continue → the checkout/payment step which
// places + pays. Addresses + methods + fees are REAL (features/addresses + cart.deliveryMethods, Law 2 bigint-
// minor via MoneyText); the chosen address + method bind through placeOrder (deliveryAddressId + deliveryMethodId).
// Behind `buyer_checkout`. Degrade-never-die (skeleton / designed empty+add / inline note).
//
// §13 (no contract → rendered honestly, never faked): the design's per-address "📍 30 km from seller · Delivery in
// 2 days" distance + ETA aren't in any read-model → omitted (the real per-method FEE is shown instead); the address
// TYPE tag (WAREHOUSE/RESTAURANT) is an opaque labelId with no cheap resolution → only the real PRIMARY (isDefault)
// tag is shown; and buyer-facing delivery SLOTS have no contract → the slot section shows a "scheduled at dispatch"
// note rather than fabricated Mon/Tue time windows.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import type { Address, DeliveryMethod } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { listAddresses } from '../../features/addresses/addresses.api';
import { deliveryMethods } from '../../features/cart/cart.api';
import { formatAddress } from '../../features/cart/cart-math';
import { defaultMethodId, deliverySavingMinor } from '../../features/cart/delivery';
import { formatMoneyMinor } from '@krishalaya/i18n';

export default function DeliveryStep() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('buyer_checkout');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [methods, setMethods] = useState<DeliveryMethod[]>([]);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [currency, setCurrency] = useState('INR');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const a = await listAddresses();
    setAddresses(a);
    setAddressId((prev) => prev ?? a.find((x) => x.isDefault)?.id ?? a[0]?.id ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  // Re-fetch delivery options whenever the chosen destination changes (fees depend on the address pincode/region).
  useEffect(() => {
    if (!enabled || !addressId) return;
    const addr = addresses.find((x) => x.id === addressId);
    let alive = true;
    (async () => {
      const res = await deliveryMethods(addr?.pincode ?? undefined, addr?.regionId ?? undefined);
      if (!alive) return;
      const ms = res?.methods ?? [];
      setMethods(ms);
      setCurrency(res?.currencyCode ?? 'INR');
      setMethodId((prev) => defaultMethodId(ms, prev));
    })();
    return () => { alive = false; };
  }, [enabled, addressId, addresses]);

  if (!enabled) return <ScreenScaffold title={t('delivery.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const onContinue = () => router.push({ pathname: '/(buyer)/payment', params: { addressId: addressId ?? undefined, methodId: methodId ?? undefined } });

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('common.back')} variant="outline" onPress={() => router.back()} />
      <View style={{ flex: 1 }}>
        <Button title={t('delivery.continue')} onPress={onContinue} disabled={!addressId} fullWidth />
      </View>
    </View>
  );

  return (
    <ScreenScaffold title={t('delivery.title')} scroll={false} footer={footer}>
      {/* Step 2 of 3 progress */}
      <View style={styles.progress}>
        <View style={styles.bar}>
          <View style={[styles.seg, styles.segDone]} />
          <View style={[styles.seg, styles.segCurrent]} />
          <View style={[styles.seg, styles.segPending]} />
        </View>
        <View style={styles.progressRow}>
          <Text style={styles.step}>{t('delivery.step')}</Text>
          <Text style={styles.stepLabel}>{t('delivery.stepName')}</Text>
        </View>
      </View>

      {loading ? <View style={{ marginTop: space[4] }}><SkeletonCard lines={4} /><SkeletonCard lines={3} /></View> : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4] }}>
          <Text style={styles.h3}>{t('delivery.whereTo')}</Text>
          {addresses.length === 0 ? (
            <Card>
              <Text style={styles.note}>{t('checkout.noAddress')}</Text>
              <Pressable onPress={() => router.push('/(buyer)/addresses')} accessibilityRole="button"><Text style={styles.link}>{t('delivery.addNew')}</Text></Pressable>
            </Card>
          ) : (
            <>
              {addresses.map((a) => {
                const active = addressId === a.id;
                return (
                  <Pressable key={a.id} onPress={() => setAddressId(a.id)} style={[styles.addr, active && styles.addrOn]}
                    accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={formatAddress(a)}>
                    {a.isDefault ? <StatusPill label={t('delivery.primary')} tone="success" /> : null}
                    {a.contactName ? <Text style={styles.addrName}>{a.contactName}</Text> : null}
                    <Text style={styles.addrFull}>{formatAddress(a)}</Text>
                    {a.contactPhone ? <Text style={styles.addrContact}>{t('delivery.contact', { phone: a.contactPhone })}</Text> : null}
                  </Pressable>
                );
              })}
              <Pressable onPress={() => router.push('/(buyer)/addresses')} style={styles.addBtn} accessibilityRole="button">
                <Text style={styles.addBtnTxt}>{t('delivery.addNew')}</Text>
              </Pressable>
            </>
          )}

          {methods.length > 0 ? (
            <>
              <Text style={styles.h3}>{t('delivery.options')}</Text>
              {methods.map((m) => {
                const active = methodId === m.id;
                const saving = deliverySavingMinor(m.id, methods);
                return (
                  <Pressable key={m.id} onPress={() => setMethodId(m.id)} style={[styles.addr, active && styles.addrOn]}
                    accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={m.name}>
                    <View style={styles.methodRow}>
                      <Text style={[styles.methodName, active && styles.addrNameOn]}>{m.name}</Text>
                      <MoneyText minor={m.feeMinor} currencyCode={currency} langCode={lang} size="md" />
                    </View>
                    {saving ? <Text style={styles.saving}>{t('delivery.save', { amount: formatMoneyMinor(saving, currency, lang) })}</Text> : null}
                  </Pressable>
                );
              })}
            </>
          ) : null}

          {/* §13: no buyer-facing delivery-slot contract → honest note, never fabricated Mon/Tue windows. */}
          <Text style={styles.h3}>{t('delivery.slot')}</Text>
          <Card><Text style={styles.note}>{t('delivery.slotComingSoon')}</Text></Card>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  progress: { paddingBottom: space[3], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  bar: { flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 4, borderRadius: 2 },
  segDone: { backgroundColor: color.success },
  segCurrent: { backgroundColor: color.primary600 },
  segPending: { backgroundColor: color.earth200 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] },
  step: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink600 },
  stepLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  addr: { padding: space[3], borderRadius: radius.md, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card, marginBottom: space[2], gap: 4 },
  addrOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  addrName: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  addrNameOn: { color: color.primary800 },
  addrFull: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, lineHeight: font.size.sm * 1.5 },
  addrContact: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  addBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1.5, borderColor: color.primary300, borderStyle: 'dashed', backgroundColor: color.primary50, marginBottom: space[2] },
  addBtnTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  methodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  methodName: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  saving: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.successDark },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  link: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary700, marginTop: space[2] },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
