// apps/mobile/src/app/(buyer)/checkout.tsx · screen 15 (checkout · Review Order). Thin screen (guide §3): the
// single-page review before paying — Your Order (the cart items), Delivery Method, Payment Method, and the
// SERVER-AUTHORITATIVE Price Breakup — then PLACE the order (a REAL, idempotent cart→orders conversion, Law 3) and
// pay. The bill (subtotal/delivery/platform-fee/discount/total) is computed SERVER-SIDE (CheckoutPreview) and shown
// as bigint-minor via MoneyText (Law 2) — the client NEVER re-adds money. Escrow is held server-side on capture —
// the client never moves money (Law 11). FLAG_SECURE (payment surface, §4). Behind `buyer_checkout`. Degrade-never-die.
//
// §13 (no contract → rendered honestly, never faked): the design's item meta "Grade A · Ramesh Patel" isn't in the
// cart/preview contract (CartItem carries only title/qty/price; the preview a sellerUserId, not a name/grade) → the
// item line shows the REAL quantity + unit only, never a fabricated grade or seller name. Delivery ETAs ("Tomorrow")
// + the pickup place ("Atladara") aren't in DeliveryMethod (id/name/fee only) → omitted, real fee shown (free when
// 0). The design's saved UPI handle / card ("Visa ••••") aren't stored by us — the instrument is picked INSIDE the
// secure gateway sheet → UPI/Card are two rails onto the SAME gateway, with generic descriptions, no fake instrument.
// The "Tax (GST 5%)" line isn't in the pre-order preview (tax is applied on the CREATED order) → not fabricated here.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SdkError, type Cart, type Address, type DeliveryMethod, type CheckoutPreview } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space, radius } from '@krishalaya/ui-native';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useSecureScreen } from '../../core/security/screen-guard';
import { getCart, checkoutPreview, deliveryMethods, placeOrder } from '../../features/cart/cart.api';
import { listAddresses } from '../../features/addresses/addresses.api';
import { walletBalance } from '../../features/wallet/wallet.api';
import { previewUnitMap, isFreeDelivery } from '../../features/cart/cart-math';
import { walletCovers, walletShortfallMinor, previewItemCount } from '../../features/cart/payment-methods';
import { defaultRail, isWalletRail, railSelectable, checkoutItemSubtitle, type ReviewRail } from '../../features/cart/review-order';
import { payForOrder, payOrderFromWallet } from '../../features/payments/payments.api';

export default function Checkout() {
  useSecureScreen();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('buyer_checkout');
  const payEnabled = useFlag('payments_addmoney');

  const [cart, setCart] = useState<Cart | null>(null);
  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [methods, setMethods] = useState<DeliveryMethod[]>([]);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [balanceMinor, setBalanceMinor] = useState('0');
  const [rail, setRail] = useState<ReviewRail>(defaultRail());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    const [c, p, addrs, b] = await Promise.all([getCart(), checkoutPreview(), listAddresses(), walletBalance()]);
    setCart(c); setPreview(p); setBalanceMinor(b.availableMinor);
    // Default destination drives the delivery-method fees; the choice binds server-side at placeOrder.
    const addr: Address | undefined = addrs.find((x) => x.isDefault) ?? addrs[0];
    setAddressId(addr?.id ?? null);
    const dm = await deliveryMethods(addr?.pincode ?? undefined, addr?.regionId ?? undefined);
    const ms = dm?.methods ?? [];
    setMethods(ms);
    setMethodId((prev) => prev ?? ms[0]?.id ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('reviewOrder.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;
  if (loading) return <ScreenScaffold title={t('reviewOrder.title')}><SkeletonCard lines={4} /><SkeletonCard lines={3} /><SkeletonCard lines={4} /></ScreenScaffold>;

  const ccy = preview?.currencyCode ?? 'INR';
  const totalMinor = preview?.grandTotalMinor ?? '0';
  const covers = walletCovers(balanceMinor, totalMinor);
  const shortfall = walletShortfallMinor(balanceMinor, totalMinor);
  const units = previewUnitMap(preview);
  const items = cart?.items ?? [];

  if (items.length === 0) {
    return <ScreenScaffold title={t('reviewOrder.title')}><EmptyState title={t('reviewOrder.empty')} actionLabel={t('common.retry')} onAction={load} /></ScreenScaffold>;
  }

  const onPlace = async () => {
    setBusy(true); setError(undefined);
    try {
      const res = await placeOrder({ deliveryAddressId: addressId ?? undefined, deliveryMethodId: methodId ?? undefined });
      const primary = res.orders[0];
      if (!primary) { setError(t('checkout.failed')); return; }
      // Escrow held server-side on capture; the app only initiates the chosen rail (wallet debit or gateway sheet).
      if (payEnabled && primary.totalMinor !== '0') {
        try {
          if (isWalletRail(rail)) await payOrderFromWallet(primary.id);
          else await payForOrder(primary.id, primary.totalMinor);
        } catch { /* order is placed; payment can be retried from the order screen */ }
      }
      router.replace({ pathname: '/(buyer)/orders/[id]', params: { id: primary.id, notice: t('checkout.placed') } });
    } catch (e) {
      setError(e instanceof SdkError && e.status === 409 ? t('checkout.changed')
        : e instanceof SdkError && (e.isValidation || e.status === 422) ? t('checkout.couponInvalid') : t('checkout.failed'));
    } finally { setBusy(false); }
  };

  const footer = (
    <Button title={t('reviewOrder.place', { total: formatMoneyMinor(totalMinor, ccy, lang) })} variant="accent"
      onPress={onPlace} loading={busy} disabled={!preview || (isWalletRail(rail) && !covers)} />
  );

  return (
    <ScreenScaffold title={t('reviewOrder.title')} scroll={false} footer={footer}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4] }}>
        {/* Your Order — the real cart items (quantity + unit; no fabricated grade/seller, §13) */}
        <Text style={styles.h3}>{t('reviewOrder.yourOrder')}</Text>
        <Card>
          {items.map((it, i) => (
            <View key={it.listingId} style={[styles.item, i > 0 && styles.itemDivider]}>
              <View style={styles.itemIcon}><Text style={styles.itemGlyph}>🌾</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle} numberOfLines={2}>{it.title ?? t('reviewOrder.itemFallback')}</Text>
                <Text style={styles.itemMeta}>{checkoutItemSubtitle(it.quantity, units[it.listingId])}</Text>
              </View>
              <MoneyText minor={it.lineTotalMinor} currencyCode={ccy} langCode={lang} size="md" />
            </View>
          ))}
        </Card>

        {/* Delivery Method — real methods + fees; the choice binds at placeOrder (deliveryMethodId) */}
        {methods.length > 0 ? (
          <>
            <Text style={styles.h3}>{t('reviewOrder.deliveryMethod')}</Text>
            {methods.map((m) => {
              const active = methodId === m.id;
              const free = isFreeDelivery(m.feeMinor);
              return (
                <Pressable key={m.id} onPress={() => setMethodId(m.id)} style={[styles.row, active && styles.rowOn]}
                  accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={m.name}>
                  <Text style={styles.rowIcon}>🚚</Text>
                  <Text style={[styles.rowName, active && styles.rowNameOn]}>{m.name}</Text>
                  {free ? <Text style={styles.free}>{t('reviewOrder.free')}</Text>
                    : <MoneyText minor={m.feeMinor} currencyCode={ccy} langCode={lang} size="md" />}
                </Pressable>
              );
            })}
          </>
        ) : null}

        {/* Payment Method — wallet (real balance) + two online rails onto the secure gateway (§13, no stored instrument) */}
        <Text style={styles.h3}>{t('reviewOrder.paymentMethod')}</Text>
        <Rail icon="💵" selected={rail === 'wallet'} disabled={!railSelectable('wallet', covers)} onPress={() => railSelectable('wallet', covers) && setRail('wallet')}
          name={t('reviewOrder.walletBalance')}
          meta={covers ? t('reviewOrder.walletAvailable', { amount: formatMoneyMinor(balanceMinor, ccy, lang) })
            : (shortfall ? t('reviewOrder.walletShort', { amount: formatMoneyMinor(shortfall, ccy, lang) }) : t('reviewOrder.walletAvailable', { amount: formatMoneyMinor(balanceMinor, ccy, lang) }))} />
        <Rail icon="📱" selected={rail === 'upi'} onPress={() => setRail('upi')} name={t('reviewOrder.upi')} meta={t('reviewOrder.upiDesc')} />
        <Rail icon="💳" selected={rail === 'card'} onPress={() => setRail('card')} name={t('reviewOrder.card')} meta={t('reviewOrder.cardDesc')} />

        {/* Price Breakup — the SERVER-authoritative bill; the client never re-adds money (Law 2) */}
        <Text style={styles.h3}>{t('reviewOrder.priceBreakup')}</Text>
        <Card>
          <BillRow label={t('reviewOrder.subtotalItems', { n: previewItemCount(preview) })} minor={preview?.subtotalMinor ?? '0'} ccy={ccy} lang={lang} />
          <BillRow label={t('reviewOrder.delivery')} minor={preview?.deliveryFeeMinor ?? '0'} ccy={ccy} lang={lang} divider />
          <BillRow label={t('reviewOrder.platformFee')} minor={preview?.platformFeeMinor ?? '0'} ccy={ccy} lang={lang} divider />
          {preview && preview.discountMinor !== '0' ? <BillRow label={t('reviewOrder.discount')} minor={preview.discountMinor} ccy={ccy} lang={lang} divider /> : null}
          <View style={[styles.billRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>{t('reviewOrder.youPay')}</Text>
            <MoneyText minor={totalMinor} currencyCode={ccy} langCode={lang} size="lg" tone="positive" />
          </View>
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </ScreenScaffold>
  );
}

function Rail({ icon, name, meta, selected, disabled, onPress }: {
  icon: string; name: string; meta: string; selected?: boolean; disabled?: boolean; onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.method, selected && styles.methodOn, disabled && styles.methodOff]}
      accessibilityRole="radio" accessibilityState={{ selected: !!selected, disabled: !!disabled }} accessibilityLabel={name}>
      <View style={styles.methodIcon}><Text style={styles.methodGlyph}>{icon}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.methodName}>{name}</Text>
        <Text style={styles.methodMeta}>{meta}</Text>
      </View>
    </Pressable>
  );
}

function BillRow({ label, minor, ccy, lang, divider }: { label: string; minor: string; ccy: string; lang: string; divider?: boolean }) {
  return (
    <View style={[styles.billRow, divider && styles.billDivider]}>
      <Text style={styles.billLabel}>{label}</Text>
      <MoneyText minor={minor} currencyCode={ccy} langCode={lang} size="sm" />
    </View>
  );
}

const styles = StyleSheet.create({
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  item: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  itemDivider: { borderTopWidth: 1, borderTopColor: color.ink100 },
  itemIcon: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  itemGlyph: { fontSize: 22 },
  itemTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  itemMeta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], borderRadius: radius.md, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card, marginBottom: space[2] },
  rowOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  rowIcon: { fontSize: 20 },
  rowName: { flex: 1, fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  rowNameOn: { color: color.primary800 },
  free: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.successDark },
  method: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], borderRadius: radius.md, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card, marginBottom: space[2] },
  methodOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  methodOff: { opacity: 0.55 },
  methodIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  methodGlyph: { fontSize: 22 },
  methodName: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  methodMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  billRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  billDivider: { borderTopWidth: 1, borderTopColor: color.ink100, borderStyle: 'dashed' },
  billLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  totalRow: { borderTopWidth: 1, borderTopColor: color.ink200, marginTop: 6, paddingTop: space[2] },
  totalLabel: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  error: { fontFamily: font.body, fontSize: font.size.sm, color: color.danger, marginTop: space[3], textAlign: 'center' },
});
