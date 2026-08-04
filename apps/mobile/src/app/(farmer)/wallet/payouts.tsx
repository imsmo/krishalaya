// apps/mobile/src/app/(farmer)/wallet/payouts.tsx · screen 59 (Payout History) — rebuilt to the Phase-1 design
// (Krishalaya_Design_System/screens/59-farmer-payout-history.html): a header band + month-grouped payout rows,
// each with a status icon (RECEIVED ✓ / HOLD ⏱ / FAILED !), title, date and amount. Thin screen (guide §3);
// FLAG_SECURE (§4); behind the `wallet` flag; money via MoneyText/paise (Law 2); degrade-never-die (Law 12).
//
// REAL data: the caller's payouts (GET /payouts), keyset-paged. Status → row treatment via payoutKind; grouped by
// 'YYYY-MM'. Amounts + statuses come straight from the server.
//
// HONEST GAPS (§13, never faked): the design's hero "₹4,28,750 lifetime · 87 payouts · since Jan 2024" needs a
// payout-aggregate read-model the API doesn't expose → shown as a plain header (no fabricated lifetime total).
// The design's per-row UTR + linked order number aren't on the PayoutSummary contract → omitted, not invented;
// the row shows the real purpose + date.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import type { PayoutSummary } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { Button, EmptyState, SkeletonCard, MoneyText, Icon, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security';
import { listPayouts } from '../../../features/wallet/wallet.api';
import { groupPayoutsByMonth, payoutKind, type PayoutKind } from '../../../features/wallet/txn-history';

export default function Payouts() {
  useSecureScreen();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('wallet');
  const [rows, setRows] = useState<PayoutSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (next?: string) => {
    setLoading(true);
    const page = await listPayouts(next);
    setRows((prev) => (next ? [...prev, ...page.items] : page.items));
    setCursor(page.nextCursor);
    setFailed(!next && page.items.length === 0 && page.nextCursor === null);
    setLoading(false);
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const groups = groupPayoutsByMonth(rows);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.appbar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back} accessibilityLabel={t('common.back')} accessibilityRole="button"><Icon name="arrow-left" size={20} color={color.ink700} /></Pressable>
        <Text style={styles.appbarTitle}>{t('payout.title')}</Text>
        <View style={styles.back} />
      </View>

      {!enabled ? (
        <View style={styles.body}><EmptyState title={t('wallet.unavailable')} /></View>
      ) : (
        <>
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>{t('payout.heroLabel')}</Text>
            <Text style={styles.heroSub}>{t('payout.heroSub')}</Text>
          </View>

          {loading && rows.length === 0 ? (
            <View style={styles.body}><SkeletonCard lines={3} /><View style={{ height: space[3] }} /><SkeletonCard lines={3} /></View>
          ) : rows.length === 0 ? (
            <View style={styles.body}>
              <EmptyState title={t('wallet.payoutEmpty.title')} message={t('wallet.payoutEmpty.message')} actionLabel={failed ? t('common.retry') : undefined} onAction={failed ? () => load() : undefined} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              {groups.map((g) => (
                <View key={g.key}>
                  <Text style={styles.monthHead}>{monthLabel(g.key, lang)}</Text>
                  <View style={styles.list}>
                    {g.items.map((p) => <PayoutRow key={p.id} payout={p} t={t} lang={lang} />)}
                  </View>
                </View>
              ))}
              {cursor ? <View style={{ padding: space[5] }}><Button title={t('common.loadMore')} variant="outline" loading={loading} onPress={() => load(cursor)} /></View> : null}
            </ScrollView>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const ICON_BG: Record<PayoutKind, string> = { success: color.successLight, pending: color.warningLight, failed: color.dangerLight };
const ICON_FG: Record<PayoutKind, string> = { success: color.successDark, pending: color.warningDark, failed: color.dangerDark };
const ICON_GLYPH: Record<PayoutKind, string> = { success: '✓', pending: '⏱', failed: '!' };

function PayoutRow({ payout, t, lang }: { payout: PayoutSummary; t: (k: string) => string; lang: string }) {
  const kind = payoutKind(payout.status);
  const title = payout.purpose ? safeT(t, `payout.purpose.${payout.purpose}`, 'payout.purpose.generic') : t('payout.purpose.generic');
  const date = (() => { try { return payout.createdAt ? formatDate(payout.createdAt, lang, { dateStyle: 'medium' }) : ''; } catch { return ''; } })();
  const meta = kind === 'pending' ? t('payout.inEscrow') : date;
  const sign = kind === 'failed' ? '− ' : '+ ';
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: ICON_BG[kind] }]}><Text style={[styles.rowGlyph, { color: ICON_FG[kind] }]}>{ICON_GLYPH[kind]}</Text></View>
      <View style={styles.rowInfo}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
      </View>
      <View style={styles.rowAmt}>
        <View style={styles.amtRow}>
          <Text style={[styles.amtSign, { color: ICON_FG[kind] }]}>{sign.trim()}</Text>
          <MoneyText minor={payout.amountMinor} currencyCode={payout.currencyCode} langCode={lang} size="md" tone={kind === 'failed' ? 'negative' : kind === 'pending' ? 'default' : 'positive'} />
        </View>
        <Text style={[styles.amtStatus, { color: ICON_FG[kind] }]}>{t(`payout.status.${kind}`)}</Text>
      </View>
    </View>
  );
}

function monthLabel(ym: string, lang: string): string {
  try { return formatDate(`${ym}-01T00:00:00Z`, lang, { month: 'long', year: 'numeric' }); } catch { return ym; }
}
/** t() with a fallback key when the primary key is missing (returns the key itself when unresolved). */
function safeT(t: (k: string) => string, key: string, fallback: string): string {
  const v = t(key);
  return v === key ? t(fallback) : v;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[2] },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },
  appbarTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  body: { flex: 1, padding: space[5] },
  scroll: { paddingBottom: space[6] },

  hero: { backgroundColor: color.primary50, paddingVertical: space[4], paddingHorizontal: space[5], alignItems: 'center' },
  heroLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: 4, textAlign: 'center' },

  monthHead: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink500, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: space[5], paddingTop: space[4], paddingBottom: space[2] },
  list: { gap: space[2], paddingHorizontal: space[5] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.md },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowGlyph: { fontSize: 16, fontWeight: font.weight.bold },
  rowInfo: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  rowMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  rowAmt: { alignItems: 'flex-end' },
  amtRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  amtSign: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold },
  amtStatus: { fontFamily: font.body, fontSize: 10, fontWeight: font.weight.bold, marginTop: 2, letterSpacing: 0.3 },
});
