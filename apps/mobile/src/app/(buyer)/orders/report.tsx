// apps/mobile/src/app/(buyer)/orders/report.tsx · screen 135 (Report Order Issue → open a dispute). Thin screen
// (guide §3): the real order (getOrder) heads the form; the buyer picks a reason + desired resolution, describes
// the issue, and submits — which opens a REAL dispute case server-side (reportOrder → orders.dispute, idempotent
// Law 3; escrow stays held until resolution). Behind `buyer_app`. Degrade-never-die.
//
// §13 — the dispute contract carries only a FREE-TEXT note (no structured reason/resolution/attachment fields).
// So the chosen reason + resolution are composed INTO the note (real, sent to the server), never faked as columns;
// and the design's evidence attachments ("Lab report.pdf", "Photo (3)") have no dispute-attachment endpoint yet →
// shown as an honest "coming soon" note, never a fabricated attached file.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { OrderDetail } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getOrder, reportOrder } from '../../../features/orders/orders.api';
import { DISPUTE_REASONS, DISPUTE_RESOLUTIONS, composeDisputeNote, canSubmitDispute, type DisputeReason, type DisputeResolution } from '../../../features/orders/dispute';
import { cropEmoji } from '../../../features/listings/my-listings';

export default function ReportOrder() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('buyer_app');
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState<DisputeReason | null>(null);
  const [resolution, setResolution] = useState<DisputeResolution>('partial');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => { if (!orderId) return; setLoading(true); setOrder(await getOrder(orderId)); setLoading(false); }, [orderId]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('report.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;
  if (loading) return <ScreenScaffold title={t('report.title')}><SkeletonCard lines={3} /><SkeletonCard lines={5} /></ScreenScaffold>;
  if (!order) return <ScreenScaffold title={t('report.title')}><EmptyState title={t('orders.unavailable')} actionLabel={t('common.retry')} onAction={load} /></ScreenScaffold>;

  const line = order.items[0];
  const canSubmit = canSubmitDispute(reason, description) && !busy;

  const onSubmit = async () => {
    if (!reason) return;
    setBusy(true); setError(undefined);
    const note = composeDisputeNote([
      t('report.noteReason', { v: t(`report.reason.${reason}`) }),
      t('report.noteResolution', { v: t(`report.resolution.${resolution}`) }),
      description,
    ]);
    try { await reportOrder(order.id, note); router.replace({ pathname: '/(buyer)/orders/[id]', params: { id: order.id, notice: t('report.submitted') } }); }
    catch { setError(t('report.failed')); }
    finally { setBusy(false); }
  };

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('common.cancel')} variant="outline" onPress={() => router.back()} />
      <View style={{ flex: 1 }}><Button title={t('report.submit')} variant="danger" onPress={onSubmit} loading={busy} disabled={!canSubmit} fullWidth /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('report.title')} footer={footer}>
      {/* Order header (real) */}
      <Card style={styles.orderCard}>
        <View style={styles.thumb}><Text style={styles.thumbGlyph}>{cropEmoji(line?.title_snapshot)}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.orderTitle} numberOfLines={1}>{line?.title_snapshot ?? t('report.orderGeneric')}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{t('report.orderMeta', { no: order.orderNo, qty: line ? `${line.quantity} ${line.unit_code}` : '—' })} · </Text>
            <MoneyText minor={order.totalMinor} currencyCode={order.currencyCode} langCode={lang} size="sm" />
          </View>
          {order.status === 'delivered' || order.status === 'completed' ? <Text style={styles.delivered}>{t(`orders.status.${order.status}`)}</Text> : null}
        </View>
      </Card>

      <Text style={styles.h2}>{t('report.whatWrong')}</Text>
      <View style={{ gap: space[2] }}>
        {DISPUTE_REASONS.map((r) => {
          const active = reason === r;
          return (
            <Pressable key={r} onPress={() => setReason(r)} style={[styles.issue, active && styles.issueOn]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.issueName}>{t(`report.reason.${r}`)}</Text>
                <Text style={styles.issueHint}>{t(`report.reasonHint.${r}`)}</Text>
              </View>
              {active ? <Text style={styles.check}>✓</Text> : null}
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.h3}>{t('report.describe')}</Text>
      <Input value={description} onChangeText={setDescription} placeholder={t('report.describeHint')} multiline maxLength={2000} error={error} />
      <Card style={{ marginTop: space[2] }}><Text style={styles.note}>{t('report.attachNote')}</Text></Card>

      <Text style={styles.h3}>{t('report.whatWant')}</Text>
      <Card>
        {DISPUTE_RESOLUTIONS.map((r, i) => {
          const active = resolution === r;
          return (
            <Pressable key={r} onPress={() => setResolution(r)} style={[styles.resRow, i > 0 && styles.resDivider]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
              <View style={[styles.radio, active && styles.radioOn]}>{active ? <View style={styles.radioDot} /> : null}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.resName}>{t(`report.resolution.${r}`)}</Text>
                <Text style={styles.resHint}>{t(`report.resolutionHint.${r}`)}</Text>
              </View>
            </Pressable>
          );
        })}
      </Card>

      <View style={styles.escrow}><Text style={styles.escrowText}>{t('report.escrowNote')}</Text></View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  orderCard: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  thumb: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  thumbGlyph: { fontSize: 24 },
  orderTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  meta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  delivered: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.successDark, marginTop: 2 },
  h2: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[3] },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  issue: { flexDirection: 'row', alignItems: 'center', gap: space[2], padding: space[3], borderRadius: radius.md, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  issueOn: { borderColor: color.danger, backgroundColor: color.dangerLight },
  issueName: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  issueHint: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  check: { fontSize: 16, color: color.danger, fontWeight: font.weight.bold },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, lineHeight: font.size.xs * 1.5 },
  resRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], paddingVertical: space[2] },
  resDivider: { borderTopWidth: 1, borderTopColor: color.ink100, borderStyle: 'dashed' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: color.ink300, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  radioOn: { borderColor: color.primary600 },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.primary600 },
  resName: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  resHint: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  escrow: { marginTop: space[4], padding: space[3], borderRadius: radius.md, backgroundColor: color.infoLight },
  escrowText: { fontFamily: font.body, fontSize: font.size.xs, color: color.infoDark, lineHeight: font.size.xs * 1.5 },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
