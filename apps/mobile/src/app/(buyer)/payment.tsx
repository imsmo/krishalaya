// apps/mobile/src/app/(buyer)/payment.tsx · screen 130 (checkout Step 3 · Payment). Thin screen (guide §3): the
// final step — show the SERVER-AUTHORITATIVE order summary (CheckoutPreview: subtotal/delivery/platform-fee/
// discount/total, Law 2 bigint-minor via MoneyText), pick a payment rail, then PLACE the order (idempotent, Law 3)
// and pay. Escrow is held SERVER-SIDE on capture — the client never moves money (Law 11). FLAG_SECURE (payment
// surface, §4). Behind `buyer_checkout`. Degrade-never-die (skeleton / inline retry / friendly error).
//
// §13 (no contract → rendered honestly, never faked): the design's saved UPI handle ("priya@oksbi") + linked bank
// ("SBI ••••8421") aren't stored by us — the instrument is chosen INSIDE the secure gateway sheet → we show one
// "UPI / Cards / Net Banking" online rail, not a fabricated saved VPA. Cash-on-delivery isn't offered under the
// escrow model → shown disabled with a note. "Delivery (30 km)" distance isn't in the totals contract → the row
// shows the real fee without an invented distance. Wallet balance + the shortfall ("need ₹X more") are REAL.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SdkError, type CheckoutPreview } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space, radius } from '@krishalaya/ui-native';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useSecureScreen } from '../../core/security/screen-guard';
import { checkoutPreview, placeOrder } from '../../features/cart/cart.api';
import { walletBalance } from '../../features/wallet/wallet.api';
import { payForOrder, payOrderFromWallet } from '../../features/payments/payments.api';
import { walletCovers, walletShortfallMinor, previewItemCount, type PaymentMethodKey } from '../../features/cart/payment-methods';

export default function Payment() {
  useSecureScreen();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('buyer_checkout');
  const params = useLocalSearchParams<{ addressId?: string; methodId?: string; couponCode?: string }>();

  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [balanceMinor, setBalanceMinor] = useState('0');
  const [method, setMethod] = useState<PaymentMethodKey>('online');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    const [p, b] = await Promise.all([checkoutPreview(params.couponCode || undefined), walletBalance()]);
    setPreview(p); setBalanceMinor(b.availableMinor);
    setLoading(false);
  }, [params.couponCode]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('payment.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const ccy = preview?.currencyCode ?? 'INR';
  const totalMinor = preview?.grandTotalMinor ?? '0';
  const covers = walletCovers(balanceMinor, totalMinor);
  const shortfall = walletShortfallMinor(balanceMinor, totalMinor);

  const onPay = async () => {
    setBusy(true); setError(undefined);
    try {
      const res = await placeOrder({ deliveryAddressId: params.addressId || undefined, deliveryMethodId: params.methodId || undefined, couponCode: params.couponCode || undefined });
      const primary = res.orders[0];
      if (!primary) { setError(t('checkout.failed')); return; }
      if (primary.totalMinor !== '0') {
        try {
          if (method === 'wallet') await payOrderFromWallet(primary.id);
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
    <View style={styles.footerRow}>
      <Button title={t('common.back')} variant="outline" onPress={() => router.back()} />
      <View style={{ flex: 1 }}>
        <Button title={t('payment.pay', { total: formatMoneyMinor(totalMinor, ccy, lang) })} variant="accent" onPress={onPay} loading={busy} disabled={!preview} fullWidth />
      </View>
    </View>
  );

  if (loading) return <ScreenScaffold title={t('payment.title')}><SkeletonCard lines={5} /><SkeletonCard lines={4} /></ScreenScaffold>;
  if (!preview) return <ScreenScaffold title={t('payment.title')}><EmptyState title={t('checkout.failed')} actionLabel={t('common.retry')} onAction={load} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('payment.title')} scroll={false} footer={footer}>
      {/* Step 3 of 3 progress */}
      <View style={styles.progress}>
        <View style={styles.bar}>
          <View style={[styles.seg, styles.segDone]} />
          <View style={[styles.seg, styles.segDone]} />
          <View style={[styles.seg, styles.segCurrent]} />
        </View>
        <View style={styles.progressRow}>
          <Text style={styles.step}>{t('payment.step')}</Text>
          <Text style={styles.stepLabel}>{t('payment.orderTotal', { total: formatMoneyMinor(totalMinor, ccy, lang) })}</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4] }}>
        <Text style={styles.h3}>{t('payment.how')}</Text>

        {/* Online (gateway) — RECOMMENDED */}
        <Method icon="📱" selected={method === 'online'} onPress={() => setMethod('online')}
          name={t('payment.online')} meta={t('payment.onlineMeta')} recommended recommendedLabel={t('payment.recommended')} />

        {/* Wallet — real balance + shortfall */}
        <Method icon="💵" selected={method === 'wallet'} disabled={!covers} onPress={() => covers && setMethod('wallet')}
          name={t('payment.wallet', { balance: formatMoneyMinor(balanceMinor, ccy, lang) })}
          meta={covers ? t('payment.walletReady') : (shortfall ? t('payment.walletShort', { amount: formatMoneyMinor(shortfall, ccy, lang) }) : t('payment.walletShortGeneric'))} />

        {/* §13: cash-on-delivery not offered under escrow → disabled, honest note */}
        <Method icon="📋" disabled name={t('payment.cod')} meta={t('payment.codComingSoon')} />

        <Text style={styles.h3}>{t('payment.summary')}</Text>
        <Card>
          <SummaryRow label={t('payment.items', { n: previewItemCount(preview) })} minor={preview.subtotalMinor} ccy={ccy} lang={lang} />
          <SummaryRow label={t('payment.delivery')} minor={preview.deliveryFeeMinor} ccy={ccy} lang={lang} divider />
          <SummaryRow label={t('payment.platformFee')} minor={preview.platformFeeMinor} ccy={ccy} lang={lang} divider />
          {preview.discountMinor !== '0' ? <SummaryRow label={t('payment.discount')} minor={preview.discountMinor} ccy={ccy} lang={lang} divider /> : null}
          <View style={[styles.sumRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>{t('payment.total')}</Text>
            <MoneyText minor={totalMinor} currencyCode={ccy} langCode={lang} size="lg" tone="positive" />
          </View>
        </Card>

        <View style={styles.escrow}>
          <Text style={styles.lock}>🔒</Text>
          <Text style={styles.escrowText}><Text style={styles.escrowBold}>{t('payment.protectionTitle')} </Text>{t('payment.protectionBody')}</Text>
        </View>
      </ScrollView>
    </ScreenScaffold>
  );
}

function Method({ icon, name, meta, selected, disabled, recommended, recommendedLabel, onPress }: {
  icon: string; name: string; meta: string; selected?: boolean; disabled?: boolean; recommended?: boolean; recommendedLabel?: string; onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.method, selected && styles.methodOn, disabled && styles.methodOff]}
      accessibilityRole="radio" accessibilityState={{ selected: !!selected, disabled: !!disabled }} accessibilityLabel={name}>
      <View style={styles.methodIcon}><Text style={styles.methodGlyph}>{icon}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.methodName}>{name}</Text>
        <Text style={styles.methodMeta}>{meta}</Text>
      </View>
      {recommended && recommendedLabel ? <StatusPill label={recommendedLabel} tone="success" /> : null}
    </Pressable>
  );
}

function SummaryRow({ label, minor, ccy, lang, divider }: { label: string; minor: string; ccy: string; lang: string; divider?: boolean }) {
  return (
    <View style={[styles.sumRow, divider && styles.sumDivider]}>
      <Text style={styles.sumLabel}>{label}</Text>
      <MoneyText minor={minor} currencyCode={ccy} langCode={lang} size="sm" />
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { paddingBottom: space[3], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  bar: { flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 4, borderRadius: 2 },
  segDone: { backgroundColor: color.success },
  segCurrent: { backgroundColor: color.primary600 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] },
  step: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink600 },
  stepLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  method: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], borderRadius: radius.md, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card, marginBottom: space[2] },
  methodOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  methodOff: { opacity: 0.55 },
  methodIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  methodGlyph: { fontSize: 22 },
  methodName: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  methodMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  sumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  sumDivider: { borderTopWidth: 1, borderTopColor: color.ink100, borderStyle: 'dashed' },
  sumLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  totalRow: { borderTopWidth: 1, borderTopColor: color.ink200, marginTop: 6, paddingTop: space[2] },
  totalLabel: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  escrow: { flexDirection: 'row', gap: space[2], marginTop: space[4], padding: space[3], borderRadius: radius.md, backgroundColor: color.successLight },
  lock: { fontSize: 16 },
  escrowText: { flex: 1, fontFamily: font.body, fontSize: font.size.xs, color: color.successDark, lineHeight: font.size.xs * 1.5 },
  escrowBold: { fontWeight: font.weight.bold },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
