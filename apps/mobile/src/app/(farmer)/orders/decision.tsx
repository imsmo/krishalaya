// apps/mobile/src/app/(farmer)/orders/decision.tsx · screen 57 "Order Decision" (seller accept/reject a NEW order).
// Thin screen (guide §3): getOrder + buyerReviewSummary → render the decision countdown (real acceptanceDeadline),
// the buyer card (real ⭐ from reviews.summary), order items, the payment breakdown (subtotal − platform fee =
// You receive, all real OrderDetail money via MoneyText/Law 2), and Reject / Accept. Accept→confirmOrder,
// Reject→cancelOrder (idempotent Law 3, flag-gated `orders_fulfilment`; the SERVER re-authorises). Degrade-never-die.
// Buyer trust context is now REAL (P1-2): the buyer's verified business type + their completed-order count come
// from the seller-scoped buyer-summary read (orderBuyerSummary), alongside the public review ⭐. §13 (still no
// contract → honest "—" / coming-soon, never faked): buyer distance / payment-rate / years-on-platform, item
// grade & harvest year, delivery method, and the buyer's free-text note aren't exposed, so those stay omitted.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { OrderDetail, OrderRole, ReviewSummary, OrderBuyerSummary } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, Icon, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getOrder, confirmOrder, cancelOrder, orderBuyerSummary } from '../../../features/orders/orders.api';
import { buyerReviewSummary } from '../../../features/reviews/reviews.api';
import { sellerNetMinor, decisionMinutesLeft, businessTypeKey } from '../../../features/orders/order-status';

export default function OrderDecision() {
  const { id, party, role } = useLocalSearchParams<{ id: string; party?: string; role?: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const canAct = useFlag('orders_fulfilment');
  const orderRole: OrderRole = role === 'buyer' ? 'buyer' : 'seller';
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [buyer, setBuyer] = useState<ReviewSummary | null>(null);
  const [summary, setSummary] = useState<OrderBuyerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);

  const load = useCallback(async () => {
    if (!id) { setLoading(false); setFailed(true); return; }
    setLoading(true); setFailed(false);
    const o = await getOrder(id);
    setOrder(o); setFailed(!o);
    if (o?.buyerUserId) setBuyer(await buyerReviewSummary(o.buyerUserId)); // public summary; degrades to zeros
    setSummary(await orderBuyerSummary(id)); // seller-scoped trust summary; degrades to null → §13 "—"
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const decide = async (kind: 'accept' | 'reject') => {
    if (!id) return;
    setBusy(kind);
    try {
      await (kind === 'accept' ? confirmOrder(id) : cancelOrder(id));
      router.replace({ pathname: '/(farmer)/orders/received' });
    } catch (e) {
      const msg = e instanceof SdkError && e.isConflict ? t('orders.action.conflict')
        : e instanceof SdkError && e.isForbidden ? t('orders.action.forbidden') : t('common.error.generic');
      Alert.alert(t('orders.action.failed'), msg);
    } finally { setBusy(null); }
  };
  const confirmReject = () => Alert.alert(t('ordersRecv.reject.title'), t('ordersRecv.reject.message'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('ordersRecv.reject.confirm'), style: 'destructive', onPress: () => decide('reject') },
  ]);

  const partyName = typeof party === 'string' && party.trim() ? party.trim() : null;
  const netMinor = order ? sellerNetMinor(order.subtotalMinor, order.commissionMinor) : '0';
  const minsLeft = decisionMinutesLeft(order?.acceptanceDeadline);

  return (
    <ScreenScaffold
      title={order ? t('orders.orderNo', { id: order.orderNo }) : ' '}
      footer={order ? (
        <View style={styles.footer}>
          <Button title={t('ordersRecv.reject')} variant="outline" onPress={confirmReject} loading={busy === 'reject'} disabled={!canAct || busy === 'accept'} />
          <View style={{ flex: 1 }}>
            <AcceptButton netMinor={netMinor} cc={order.currencyCode} lang={lang} t={t} loading={busy === 'accept'} disabled={!canAct || busy === 'reject'} onPress={() => decide('accept')} />
          </View>
        </View>
      ) : undefined}
    >
      {loading ? <SkeletonCard lines={10} /> : !order || failed ? (
        <EmptyState title={t('orders.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <>
          {/* Decision countdown */}
          {minsLeft !== null ? (
            <View style={[styles.urgent, minsLeft <= 0 && styles.urgentExpired]}>
              <Text style={styles.urgentTxt}>
                ⏱ {minsLeft <= 0 ? t('orderDecision.expired') : t('orderDecision.within', { time: humanLeft(minsLeft, t) })} · {t('orderDecision.buyerWaiting')}
              </Text>
            </View>
          ) : null}

          {/* Buyer card */}
          <Card style={{ marginTop: space[3] }}>
            <View style={styles.buyerRow}>
              <View style={styles.avatar}><Text style={styles.avatarTxt}>{initials(partyName)}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.buyerName} numberOfLines={1}>{partyName ?? t('orders.counterpartyUnknown')}</Text>
                <Text style={styles.buyerRole}>{t('orderDecision.buyerRole')}</Text>
                {/* Verified business type (real; only when the buyer has a verified business-KYC profile). */}
                {businessTypeKey(summary?.businessType) ? (
                  <View style={styles.bizChip}><Text style={styles.bizChipTxt}>{t(businessTypeKey(summary!.businessType)!)}</Text></View>
                ) : null}
              </View>
              {buyer && buyer.count > 0 ? (
                <View style={styles.ratingPill}>
                  <Icon name="star" size={13} color={color.accent600} />
                  <Text style={styles.ratingTxt}>{buyer.averageStars.toFixed(1)}</Text>
                </View>
              ) : null}
            </View>
            {/* Reviews + completed-orders are REAL; payment-rate has no honest contract → §13 "—". */}
            <View style={styles.trustRow}>
              <Trust value={buyer && buyer.count > 0 ? String(buyer.count) : '—'} label={t('orderDecision.reviews')} />
              <Trust value={summary ? String(summary.completedAsBuyer) : '—'} label={t('orderDecision.ordersPlaced')} />
              <Trust value="—" label={t('orderDecision.paymentRate')} />
            </View>
            {!summary ? <Text style={styles.note}>{t('orderDecision.buyerStatsSoon')}</Text> : null}
          </Card>

          {/* Order items */}
          <Card style={{ marginTop: space[3] }}>
            <Text style={styles.section}>{t('orderDecision.items')}</Text>
            {order.items.map((it, i) => (
              <View key={it.listing_id + i} style={[styles.item, i > 0 && styles.itemDivide]}>
                <View style={styles.thumb}><Text style={styles.thumbGlyph}>📦</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName} numberOfLines={1}>{it.title_snapshot}</Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.itemMeta}>{it.quantity} {it.unit_code} × </Text>
                    <MoneyText minor={it.unit_price_minor} currencyCode={order.currencyCode} langCode={lang} size="sm" tone="muted" />
                  </View>
                </View>
                <MoneyText minor={it.line_total_minor} currencyCode={order.currencyCode} langCode={lang} size="md" />
              </View>
            ))}
          </Card>

          {/* Payment breakdown */}
          <Card style={{ marginTop: space[3] }}>
            <Text style={styles.section}>{t('orderDecision.payment')}</Text>
            <Row label={t('orders.subtotal')}><MoneyText minor={order.subtotalMinor} currencyCode={order.currencyCode} langCode={lang} size="md" /></Row>
            <Row label={t('orderDecision.platformFee')}>
              <View style={styles.negRow}><Text style={styles.neg}>− </Text><MoneyText minor={order.commissionMinor} currencyCode={order.currencyCode} langCode={lang} size="md" tone="muted" /></View>
            </Row>
            <View style={styles.netRow}>
              <Text style={styles.netLabel}>{t('orderDecision.youReceive')}</Text>
              <MoneyText minor={netMinor} currencyCode={order.currencyCode} langCode={lang} size="xl" tone="positive" />
            </View>
            <View style={styles.escrow}><Icon name="shield" size={14} color={color.successDark} /><Text style={styles.escrowTxt}>{t('orderDecision.escrow')}</Text></View>
          </Card>

          {/* Delivery (§13 degrade — no delivery-method field on the order contract) */}
          <Card style={{ marginTop: space[3] }}>
            <Text style={styles.section}>{t('orderDecision.delivery')}</Text>
            <Text style={styles.muted}>{t('orderDecision.deliverySoon')}</Text>
          </Card>

          {/* Buyer's note (§13 degrade — no note field on the order contract) */}
          <Card style={{ marginTop: space[3] }}>
            <Text style={styles.section}>{t('orderDecision.buyerNote')}</Text>
            <Text style={styles.muted}>{t('orderDecision.noteSoon')}</Text>
          </Card>
        </>
      )}
    </ScreenScaffold>
  );
}

function AcceptButton({ netMinor, cc, lang, t, loading, disabled, onPress }: {
  netMinor: string; cc: string; lang: string; t: (k: string) => string; loading: boolean; disabled: boolean; onPress: () => void;
}) {
  // The CTA shows the net the seller will receive; MoneyText can't live inside Button's title, so compose a label.
  return <Button title={`${t('orderDecision.accept')} · ${moneyInline(netMinor, cc, lang)}`} onPress={onPress} loading={loading} disabled={disabled} />;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text>{children}</View>;
}
function Trust({ value, label }: { value: string; label: string }) {
  return <View style={styles.trust}><Text style={styles.trustVal}>{value}</Text><Text style={styles.trustLabel}>{label}</Text></View>;
}
function initials(name: string | null): string {
  if (!name) return '—';
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '—';
}
function humanLeft(mins: number, t: (k: string, p?: Record<string, string | number>) => string): string {
  const h = Math.floor(mins / 60); const m = mins % 60;
  return h > 0 ? t('orderDecision.hm', { h, m }) : t('orderDecision.m', { m });
}
// Lightweight INR formatter for the button label (real paise → rupees, locale grouping). Mirrors MoneyText output.
function moneyInline(minor: string, cc: string, lang: string): string {
  try {
    const rupees = Number(BigInt(minor)) / 100;
    return new Intl.NumberFormat(lang === 'en' ? 'en-IN' : lang === 'gu' ? 'gu-IN' : 'hi-IN', { style: 'currency', currency: cc, maximumFractionDigits: 0 }).format(rupees);
  } catch { return '—'; }
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  urgent: { backgroundColor: color.warningLight, borderRadius: radius.md, paddingVertical: space[3], paddingHorizontal: space[4] },
  urgentExpired: { backgroundColor: color.dangerLight },
  urgentTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink800, fontWeight: font.weight.semibold, textAlign: 'center' },

  buyerRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: color.primary100, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.display, fontSize: font.size.md, color: color.primary700, fontWeight: font.weight.bold },
  buyerName: { fontFamily: font.body, fontSize: font.size.md, color: color.ink900, fontWeight: font.weight.bold },
  buyerRole: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 1 },
  bizChip: { alignSelf: 'flex-start', marginTop: space[1], backgroundColor: color.primary50, paddingHorizontal: space[2], paddingVertical: 2, borderRadius: radius.pill },
  bizChipTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.primary800, fontWeight: font.weight.semibold },
  ratingPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: color.accent50, paddingHorizontal: space[2], paddingVertical: 4, borderRadius: radius.pill },
  ratingTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.accent700, fontWeight: font.weight.bold },
  trustRow: { flexDirection: 'row', gap: space[2], marginTop: space[4] },
  trust: { flex: 1, alignItems: 'center', backgroundColor: color.page, borderRadius: radius.md, paddingVertical: space[3] },
  trustVal: { fontFamily: font.display, fontSize: font.size.lg, color: color.ink900, fontWeight: font.weight.bold },
  trustLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, textAlign: 'center', marginTop: 2 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[2] },

  section: { fontFamily: font.display, fontSize: font.size.lg, color: color.ink900, fontWeight: font.weight.bold, marginBottom: space[3] },
  item: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  itemDivide: { borderTopWidth: 1, borderTopColor: color.ink100, marginTop: space[1], paddingTop: space[3] },
  thumb: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  thumbGlyph: { fontSize: 22 },
  itemName: { fontFamily: font.body, fontSize: font.size.md, color: color.ink800, fontWeight: font.weight.semibold },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 2 },
  itemMeta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[2] },
  rowLabel: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500 },
  negRow: { flexDirection: 'row', alignItems: 'center' },
  neg: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500 },
  netRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: color.ink100, marginTop: space[1], paddingTop: space[3] },
  netLabel: { fontFamily: font.body, fontSize: font.size.md, color: color.ink800, fontWeight: font.weight.bold },
  escrow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[3], backgroundColor: color.successLight, borderRadius: radius.md, padding: space[3] },
  escrowTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.xs, color: color.successDark },
  muted: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
});
