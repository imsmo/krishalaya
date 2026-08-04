// apps/mobile/src/app/(farmer)/wallet/txn-detail.tsx · screen 71 (Transaction Detail) — rebuilt to the Phase-1
// design (screens/71-transaction-detail.html): a tinted status hero (signed amount + type + ✓/⏳/✕ status), a
// "Transaction Details" card, a "Money Flow" card, and a Help action. Thin screen (guide §3): loads ONE payment
// OR payout by id (the `kind` param picks the real endpoint). Money via MoneyText (Law 2), status via StatusPill.
// FLAG_SECURE (amounts on screen, §4). Behind the `wallet` flag. Degrade-never-die (skeleton / not-found retry).
// The server re-checks ownership on the read — a guessed id returns nothing that isn't yours (no IDOR, §4).
//
// §13 (NOT faked): the payment/payout read-model (PaymentSummary/PayoutSummary) carries only id/status/amount/
// currency/purpose/createdAt. So the design's COUNTERPARTY name ("Priya Mehta") + VPA ("priya@oksbi"), the UPI
// reference, the linked order (#KV-…), and the Subtotal / Platform-fee / Net-credit SPLIT have NO mobile contract
// → we NEVER fabricate them. The hero title is the transaction TYPE (not an invented payer name); Money Flow names
// only the user's OWN wallet side (server-derived from the amount sign) and the real net amount, with an honest
// note that payer + itemised fees live on the related order. When a receipt/settlement read-model ships, this fills in.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getPayment, getPayout } from '../../../features/wallet/wallet.api';
import { presentPayment, presentPayout, statusLabelKey, txnTitleKey, txnFlow, type TxnView } from '../../../features/wallet/txn';
import { useSecureScreen } from '../../../core/security';

const STATUS_GLYPH: Record<'success' | 'failed' | 'pending', string> = { success: '✓', failed: '✕', pending: '⏳' };

export default function TxnDetail() {
  useSecureScreen(); // transaction detail (amounts) on screen — FLAG_SECURE (§4)
  const { id, kind } = useLocalSearchParams<{ id: string; kind: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('wallet');
  const [txn, setTxn] = useState<TxnView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    if (kind === 'payout') {
      const p = await getPayout(id); setTxn(p ? presentPayout(p) : null); setFailed(!p);
    } else {
      const p = await getPayment(id); setTxn(p ? presentPayment(p) : null); setFailed(!p);
    }
    setLoading(false);
  }, [id, kind]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('txnDetail.title')}><EmptyState title={t('wallet.unavailable')} /></ScreenScaffold>;
  if (loading) return <ScreenScaffold title={t('txnDetail.title')}><SkeletonCard lines={3} /><SkeletonCard lines={4} /></ScreenScaffold>;
  if (!txn || failed) return <ScreenScaffold title={t('txnDetail.title')}><EmptyState title={t('txnDetail.unavailable')} actionLabel={t('common.retry')} onAction={load} /></ScreenScaffold>;

  const outcome = statusLabelKey(txn.status);
  const title = t(`wallet.txnTitle.${txnTitleKey(txn)}`);
  const flow = txnFlow(txn.moneyTone);
  const positive = txn.moneyTone === 'positive';
  const negative = txn.moneyTone === 'negative';

  return (
    <ScreenScaffold title={t('txnDetail.title')} scroll footer={<Button title={t('txnDetail.help')} variant="ghost" onPress={() => router.push('/(farmer)/profile/help')} />}>
      {/* Status hero */}
      <View style={[styles.hero, outcome === 'success' ? styles.heroOk : outcome === 'failed' ? styles.heroBad : styles.heroWait]}>
        <MoneyText minor={txn.amountMinor} langCode={lang} size="3xl" tone={positive ? 'positive' : negative ? 'negative' : 'default'} style={styles.heroAmt} />
        <Text style={styles.heroTitle}>{title}</Text>
        <View style={styles.statusChip}>
          <Text style={styles.statusGlyph}>{STATUS_GLYPH[outcome]}</Text>
          <StatusPill label={t(`wallet.status.${outcome}`)} tone={txn.tone} />
        </View>
      </View>

      {/* Transaction Details */}
      <Text style={styles.section}>{t('txnDetail.section.details')}</Text>
      <Card>
        <Row label={t('txnDetail.type')} value={title} />
        {txn.createdAt ? <Row label={t('txnDetail.date')} value={safeDateTime(txn.createdAt, lang)} divider /> : null}
        <Row label={t('txnDetail.transactionId')} value={txn.id} mono divider />
      </Card>

      {/* Money Flow — only the user's OWN wallet side + real net; counterparty/fees have no contract (§13) */}
      <Text style={styles.section}>{t('txnDetail.section.moneyFlow')}</Text>
      <Card>
        <Row label={t(`txnDetail.${flow.walletSide}`)} value={t('txnDetail.wallet')} />
        <View style={[styles.row, styles.rowDivider, styles.netRow]}>
          <Text style={styles.netLabel}>{t(`txnDetail.${flow.netKey}`)}</Text>
          <MoneyText minor={txn.amountMinor} langCode={lang} size="lg" tone={positive ? 'positive' : negative ? 'negative' : 'default'} />
        </View>
      </Card>
      <Text style={styles.note}>{t('txnDetail.flowNote')}</Text>
    </ScreenScaffold>
  );
}

function Row({ label, value, mono, divider }: { label: string; value: string; mono?: boolean; divider?: boolean }) {
  return (
    <View style={[styles.row, divider && styles.rowDivider]}>
      <Text style={styles.k}>{label}</Text>
      <Text style={[styles.v, mono && styles.mono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function safeDateTime(iso: string, langCode: string): string {
  try { return formatDate(iso, langCode, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso.slice(0, 10); }
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space[2], padding: space[5], borderRadius: radius.lg, marginBottom: space[2] },
  heroOk: { backgroundColor: color.successLight },
  heroBad: { backgroundColor: color.dangerLight },
  heroWait: { backgroundColor: color.infoLight },
  heroAmt: { marginBottom: 2 },
  heroTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink700 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  statusGlyph: { fontSize: font.size.md, color: color.ink700 },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], paddingVertical: space[3] },
  rowDivider: { borderTopWidth: 1, borderTopColor: color.ink100 },
  k: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500 },
  v: { flex: 1, textAlign: 'right', fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  mono: { fontSize: font.size.sm, fontWeight: font.weight.regular },
  netRow: { marginTop: 2 },
  netLabel: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[2], textAlign: 'center' },
});
