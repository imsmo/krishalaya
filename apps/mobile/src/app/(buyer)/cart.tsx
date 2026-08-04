// apps/mobile/src/app/(buyer)/cart.tsx · screen 96 "My Cart". Thin screen (guide §3): the SERVER's cart (live
// prices/availability) → adjust qty (±, within stock), remove, and a SERVER-authoritative bill (CheckoutPreview:
// subtotal + delivery + platform fee + discount + grand total) with a buyer-protection note, then proceed to
// checkout. Money is bigint-minor via MoneyText (Law 2) — the client never re-adds money. canCheckout/blockers
// come from pure cart-math. Behind `buyer_checkout`. Degrade-never-die (skeleton / designed empty / friendly).
// §13 gaps (the Cart/CartItem contract carries no seller name / region / grade → rendered honestly, never faked):
//  • "Ramesh Patel · Anand · Grade A" meta line: CartItem is {listingId,title,quantity,unitPriceMinor,lineTotal,
//    available,purchasable} — no seller/region/grade → the meta line is omitted rather than invented (a per-item
//    seller-profile read would be an N+1; flagged for a richer cart read-model).
//  • Crop emoji: no product/category on the cart row → a neutral 📦 glyph, never a guessed crop.
//  • Unit label ("/ quintal"): not on CartItem → taken from the CheckoutPreview item slice (real unitCode) when
//    available, else omitted. GST line: the preview exposes no separate tax line (tax lands on the created order)
//    → no fabricated GST row (§13). If the preview can't load, the CTA/total fall back to the cart subtotal.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { Cart, CartItem, CheckoutPreview } from '@krishalaya/sdk-js';
import { Button, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { getCart, checkoutPreview, setCartQuantity, removeFromCart } from '../../features/cart/cart.api';
import { canCheckout, clampQuantity, cartCount, checkoutSummaryRows, previewUnitMap } from '../../features/cart/cart-math';

export default function CartScreen() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('buyer_checkout');
  const [cart, setCart] = useState<Cart | null>(null);
  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const c = await getCart();
    setCart(c);
    setPreview(c.items.length > 0 ? await checkoutPreview() : null);
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('cart.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const refresh = async () => { const c = await getCart(); setCart(c); setPreview(c.items.length > 0 ? await checkoutPreview() : null); };
  const step = async (it: CartItem, delta: number) => {
    const q = clampQuantity(it.quantity, delta, it.available);
    if (q === it.quantity) return;
    setBusy(true); try { await setCartQuantity(it.listingId, q); await refresh(); } finally { setBusy(false); }
  };
  const remove = async (it: CartItem) => { setBusy(true); try { await removeFromCart(it.listingId); await refresh(); } finally { setBusy(false); } };

  const ready = canCheckout(cart);
  const count = cartCount(cart);
  const units = previewUnitMap(preview);
  // Grand total = the server preview's authoritative figure; fall back to the cart subtotal if the preview failed.
  const totalMinor = preview?.grandTotalMinor ?? cart?.subtotalMinor ?? '0';
  const ccy = preview?.currencyCode ?? 'INR';
  const unitLabel = (code: string | undefined) => (code ? t(`units.${code}`, undefined) : '');

  const summaryRow = (label: string, node: React.ReactNode, opts?: { total?: boolean }) => (
    <View style={[styles.sumRow, opts?.total && styles.sumTotal]}>
      <Text style={[styles.sumLabel, opts?.total && styles.sumTotalLabel]}>{label}</Text>
      {node}
    </View>
  );

  const Footer = cart && cart.items.length > 0 ? (
    <Button title={t('cart.checkoutTotal', { total: formatMoneyMinor(totalMinor, ccy, lang) })} onPress={() => router.push('/(buyer)/delivery')} disabled={!ready || busy} fullWidth />
  ) : undefined;

  return (
    <ScreenScaffold title={count > 0 ? t('cart.titleCount', { n: count }) : t('cart.title')} scroll={false} footer={Footer}>
      {loading ? <View style={{ padding: space[4], gap: space[3] }}><SkeletonCard lines={3} /><SkeletonCard lines={3} /></View> : (
        <FlatList
          data={cart?.items ?? []}
          keyExtractor={(i) => i.listingId}
          contentContainerStyle={{ paddingBottom: space[6] }}
          ListEmptyComponent={<View style={{ padding: space[6] }}><EmptyState title={t('cart.empty.title')} message={t('cart.empty.message')} /></View>}
          renderItem={({ item }) => {
            const unit = unitLabel(units[item.listingId]);
            return (
              <View style={styles.row}>
                <View style={styles.thumb} accessibilityElementsHidden importantForAccessibility="no"><Text style={styles.thumbGlyph}>📦</Text></View>
                <View style={styles.info}>
                  <Text style={styles.title} numberOfLines={1}>{item.title ?? t('cart.item')}</Text>
                  <View style={styles.priceLine}>
                    <MoneyText minor={item.unitPriceMinor} currencyCode={ccy} langCode={lang} size="sm" tone="muted" />
                    {unit ? <Text style={styles.per}> / {unit}</Text> : null}
                  </View>
                  {/* qty stepper + line total */}
                  <View style={styles.qtyRow}>
                    <Pressable onPress={() => step(item, -1)} disabled={busy} style={styles.qtyBtn} accessibilityRole="button" accessibilityLabel={t('cart.decrease')}><Text style={styles.qtyGlyph}>−</Text></Pressable>
                    <Text style={styles.qtyVal}>{t('cart.qtyUnit', { n: item.quantity, unit: unit || t('cart.units') })}</Text>
                    <Pressable onPress={() => step(item, +1)} disabled={busy} style={styles.qtyBtn} accessibilityRole="button" accessibilityLabel={t('cart.increase')}><Text style={styles.qtyGlyph}>+</Text></Pressable>
                    <View style={{ marginLeft: 'auto' }}><MoneyText minor={item.lineTotalMinor} currencyCode={ccy} langCode={lang} size="sm" /></View>
                  </View>
                  {/* per-item blockers (real server fields) */}
                  {!item.purchasable ? <Text style={styles.warn}>{t('cart.warn.unavailable')}</Text>
                    : item.quantity > item.available ? <Text style={styles.warn}>{t('cart.warn.insufficient', { n: item.available })}</Text>
                    : item.priceChanged ? <Text style={styles.note}>{t('cart.warn.priceChanged')}</Text> : null}
                  <Pressable onPress={() => remove(item)} hitSlop={8} accessibilityRole="button"><Text style={styles.remove}>{t('cart.remove')}</Text></Pressable>
                </View>
              </View>
            );
          }}
          ListFooterComponent={cart && cart.items.length > 0 ? (
            <View>
              {/* Bill summary — server-authoritative (CheckoutPreview); falls back to the cart subtotal */}
              <View style={styles.summary}>
                {preview ? checkoutSummaryRows(preview).map((r) => summaryRow(
                  t(`cart.summary.${r.key}`),
                  r.free
                    ? <Text style={styles.free}>{t('cart.free')}</Text>
                    : <MoneyText minor={r.minor} currencyCode={ccy} langCode={lang} size="sm" tone={r.negative ? 'positive' : 'default'} style={r.negative ? undefined : styles.sumVal} />,
                )) : summaryRow(t('cart.summary.subtotal'), <MoneyText minor={cart.subtotalMinor} currencyCode={ccy} langCode={lang} size="sm" style={styles.sumVal} />)}
                {summaryRow(t('cart.summary.total'), <MoneyText minor={totalMinor} currencyCode={ccy} langCode={lang} size="lg" style={styles.totalVal} />, { total: true })}
              </View>
              {/* Buyer protection (static chrome) */}
              <View style={styles.protect}>
                <Text style={styles.protectIcon}>🛡️</Text>
                <Text style={styles.protectText}>{t('cart.protection')}</Text>
              </View>
            </View>
          ) : null}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[3], padding: space[3], borderBottomWidth: 1, borderBottomColor: color.ink100, backgroundColor: color.card },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: color.accent50, alignItems: 'center', justifyContent: 'center' },
  thumbGlyph: { fontSize: 30 },
  info: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
  per: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[2] },
  qtyBtn: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: color.ink200, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card },
  qtyGlyph: { fontSize: 18, fontWeight: font.weight.bold, color: color.ink700 },
  qtyVal: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800, minWidth: 52, textAlign: 'center' },
  warn: { fontFamily: font.body, fontSize: font.size.xs, color: color.dangerDark, marginTop: space[2] },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.warningDark, marginTop: space[2] },
  remove: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.primary700, marginTop: space[2] },
  summary: { padding: space[4], backgroundColor: color.card, marginTop: space[2] },
  sumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  sumLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  sumVal: { color: color.ink700 },
  sumTotal: { borderTopWidth: 1, borderTopColor: color.ink200, borderStyle: 'dashed', paddingTop: space[3], marginTop: space[2] },
  sumTotalLabel: { fontWeight: font.weight.bold, color: color.ink800, fontSize: font.size.md },
  totalVal: { color: color.primary700, fontWeight: font.weight.bold },
  free: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.successDark },
  protect: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start', margin: space[4], marginTop: space[3], padding: space[3], backgroundColor: color.successLight, borderRadius: radius.md },
  protectIcon: { fontSize: 16 },
  protectText: { flex: 1, fontFamily: font.body, fontSize: font.size.xs, color: color.successDark, lineHeight: 18 },
});
