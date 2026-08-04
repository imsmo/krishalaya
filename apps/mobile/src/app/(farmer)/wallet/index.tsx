// apps/mobile/src/app/(farmer)/wallet/index.tsx · the wallet HUB (screen 19) — rebuilt to the Phase-1 design
// (Krishalaya_Design_System/screens/19-wallet-home.html): a green balance hero (Available Balance + show/hide
// eye + a 3-stat strip: In Escrow · This Month · Pending), three action tiles (Add Money / Send / Withdraw), and a
// "Recent Transactions" feed with View All. Thin tab screen (guide §3); money via MoneyText/paise (Law 2);
// degrade-never-die (Law 12); FLAG_SECURE (wallet balance on screen, §4); i18n(hi/en/gu).
//
// REAL data (all server-truth, ledger-derived — the client never computes a balance): Available + In-Escrow come
// from GET /wallet/balance (available / held). This-Month is the current 'YYYY-MM' bucket from GET
// /wallet/earnings. Pending is the sum of in-flight payouts (GET /payouts, status→pending). Recent Transactions
// is the unified GET /wallet/ledger feed (signed amounts + running balance); each row's in/out/hold kind is
// derived from the server's sign + txnType.
//
// HONEST GAPS (§13, never faked): "Send" is peer-to-peer wallet transfer — there is no P2P transfer endpoint yet.
// R2-06 (founder screenshot review): a permanently-disabled "Coming soon" button reads as broken, not honest — so
// the tile is hidden entirely at pilot (gated on `wallet_p2p`, default OFF) rather than shown dead. Add Money is
// gated by `payments_addmoney`, Withdraw + the ledger feed by `wallet` (both flags); a gated action shows a
// coming-soon note.
//
// R2-01 (founder screenshot review): the balance hero used to render MoneyText(availableMinor) even when the
// read had FAILED (bal.failed) — availableMinor degrades to '0' on failure, so a failed fetch and a genuine ₹0
// balance were visually IDENTICAL (a confident "₹0.00"), with only a small "Retry" link below the 3-stat row as
// a clue. Now the hero itself shows a distinct retry affordance on failure — never a number that might be wrong.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import type { WalletLedgerEntry } from '@krishalaya/sdk-js';
import { formatRelative } from '@krishalaya/i18n';
import { EmptyState, SkeletonCard, MoneyText, color, font, space, radius, shadow } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security';
import { walletBalance, walletLedger, walletEarnings, listPayouts } from '../../../features/wallet/wallet.api';
import { currentYearMonth, monthBucketMinor, pendingPayoutMinor, ledgerKind, recentLedger, type LedgerKind } from '../../../features/wallet/wallet-home';

export default function WalletHome() {
  useSecureScreen(); // wallet balance on screen — FLAG_SECURE (§4)
  const { t, lang } = useTranslation();
  const router = useRouter();
  const addMoneyOn = useFlag('payments_addmoney');
  const walletOn = useFlag('wallet');
  const sendOn = useFlag('wallet_p2p'); // R2-06: P2P transfer has no backend yet — hidden until this flips
  const { notice } = useLocalSearchParams<{ notice?: string }>();

  const [availableMinor, setAvailableMinor] = useState('0');
  const [heldMinor, setHeldMinor] = useState('0');
  const [monthMinor, setMonthMinor] = useState('0');
  const [pendingMinor, setPendingMinor] = useState('0');
  const [entries, setEntries] = useState<WalletLedgerEntry[]>([]);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    const [bal, earn, payouts, ledger] = await Promise.all([
      walletBalance(),
      walletEarnings(),
      walletOn ? listPayouts() : Promise.resolve({ items: [], nextCursor: null }),
      walletOn ? walletLedger() : Promise.resolve({ items: [], nextCursor: null }),
    ]);
    setAvailableMinor(bal.availableMinor); setHeldMinor(bal.heldMinor); setFailed(bal.failed);
    setMonthMinor(monthBucketMinor(earn.byMonth, currentYearMonth()));
    setPendingMinor(pendingPayoutMinor(payouts.items));
    setEntries(recentLedger(ledger.items, 5));
    setLoading(false);
  }, [walletOn]);
  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load])); // refresh after an action (add money / withdraw)

  const soon = (titleKey: string) => Alert.alert(t(titleKey), t('wallet.comingSoon'));
  const onAdd = () => (addMoneyOn ? router.push('/(farmer)/wallet/add-money') : soon('wallet.addMoney'));
  const onSend = () => soon('wallet.send'); // §13: no P2P transfer endpoint yet
  const onWithdraw = () => (walletOn ? router.push('/(farmer)/wallet/withdraw') : soon('wallet.withdraw'));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.appbar}><Text style={styles.appbarTitle}>{t('tabs.wallet')}</Text></View>

      {loading ? (
        <View style={styles.body}><SkeletonCard lines={3} /><View style={{ height: space[3] }} /><SkeletonCard lines={4} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}

          {/* Balance hero */}
          <View style={styles.hero}>
            <Text style={styles.balLabel}>{t('wallet.available')}</Text>
            <View style={styles.balRow}>
              {/* R2-01: a FAILED read must never look like a confident ₹0.00 (bal.availableMinor degrades to '0'
                  on failure, same as a genuine zero balance) — show a distinct retry affordance instead, never a
                  number that might be wrong and never a bare "—" placeholder either. */}
              {failed ? (
                <Pressable onPress={load} hitSlop={8} style={styles.balErrorRow} accessibilityRole="button">
                  <Text style={styles.balError}>{t('wallet.retryLoad')}</Text>
                </Pressable>
              ) : hidden ? (
                <Text style={styles.balHidden}>₹ ••••••</Text>
              ) : (
                <MoneyText minor={availableMinor} langCode={lang} size="3xl" style={styles.balValue} />
              )}
              {failed ? null : (
                <Pressable onPress={() => setHidden((h) => !h)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t(hidden ? 'wallet.showBalance' : 'wallet.hideBalance')}>
                  <Text style={styles.eye}>{hidden ? '🙈' : '👁'}</Text>
                </Pressable>
              )}
            </View>
            {failed ? null : (
              <View style={styles.statRow}>
                <HeroStat label={t('wallet.inEscrow')} minor={heldMinor} lang={lang} />
                <HeroStat label={t('wallet.thisMonth')} minor={monthMinor} lang={lang} plus />
                <HeroStat label={t('wallet.pending')} minor={pendingMinor} lang={lang} />
              </View>
            )}
          </View>

          {/* Actions — R2-06: Send (P2P transfer) has no backend yet; hidden at pilot (wallet_p2p, default OFF)
              rather than shown as a permanently-disabled "Coming soon" tile. */}
          <View style={styles.actions}>
            <ActionTile glyph="➕" tint={color.success} label={t('wallet.addMoney')} onPress={onAdd} />
            {sendOn ? <ActionTile glyph="📤" tint={color.accent500} label={t('wallet.send')} onPress={onSend} /> : null}
            <ActionTile glyph="🏧" tint={color.info} label={t('wallet.withdraw')} onPress={onWithdraw} />
          </View>

          {/* Recent transactions */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{t('wallet.recent')}</Text>
            {walletOn && entries.length > 0 ? (
              <Pressable onPress={() => router.push('/(farmer)/wallet/statement')} hitSlop={8}>
                <Text style={styles.viewAll}>{t('wallet.viewAll')} →</Text>
              </Pressable>
            ) : null}
          </View>

          {entries.length === 0 ? (
            <View style={styles.emptyWrap}><EmptyState title={t('wallet.noTxns')} /></View>
          ) : (
            <View style={styles.txns}>
              {entries.map((e) => <TxnItem key={e.entryId} entry={e} t={t} lang={lang} />)}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function HeroStat({ label, minor, lang, plus }: { label: string; minor: string; lang: string; plus?: boolean }) {
  const positive = (() => { try { return BigInt(minor) > 0n; } catch { return false; } })();
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statValRow}>
        {plus && positive ? <Text style={styles.statPlus}>+</Text> : null}
        <MoneyText minor={minor} langCode={lang} size="md" style={styles.statVal} />
      </View>
    </View>
  );
}

function ActionTile({ glyph, tint, label, onPress }: { glyph: string; tint: string; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.action} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.actionIcon, { backgroundColor: tint }]}><Text style={styles.actionGlyph}>{glyph}</Text></View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const KIND_BG: Record<LedgerKind, string> = { in: color.successLight, out: color.dangerLight, hold: color.warningLight };
const KIND_FG: Record<LedgerKind, string> = { in: color.successDark, out: color.dangerDark, hold: color.warningDark };
const KIND_GLYPH: Record<LedgerKind, string> = { in: '↓', out: '↑', hold: '🔒' };

function TxnItem({ entry, t, lang }: { entry: WalletLedgerEntry; t: (k: string) => string; lang: string }) {
  const kind = ledgerKind(entry);
  const title = entry.description && entry.description.trim().length > 0 ? entry.description : t(`wallet.txnType.${kind}`);
  const when = (() => { try { return formatRelative(entry.createdAt, lang); } catch { return ''; } })();
  const tone = kind === 'in' ? 'positive' : kind === 'out' ? 'negative' : 'default';
  const sign = kind === 'in' ? '+ ' : kind === 'hold' ? '' : '− ';
  return (
    <View style={styles.txn}>
      <View style={[styles.txnIcon, { backgroundColor: KIND_BG[kind] }]}><Text style={[styles.txnGlyph, { color: KIND_FG[kind] }]}>{KIND_GLYPH[kind]}</Text></View>
      <View style={styles.txnBody}>
        <Text style={styles.txnTitle} numberOfLines={1}>{title}</Text>
        {when ? <Text style={styles.txnTime}>{when}</Text> : null}
      </View>
      <View style={styles.txnAmt}>
        {sign ? <Text style={[styles.txnSign, { color: KIND_FG[kind] }]}>{sign.trim()}</Text> : null}
        <MoneyText minor={absMinor(entry.amountMinor)} langCode={lang} size="sm" tone={tone === 'positive' ? 'positive' : tone === 'negative' ? 'negative' : 'default'} />
      </View>
    </View>
  );
}

/** Magnitude of a signed minor string (drop the sign for display; the +/− is shown separately). Pure BigInt. */
function absMinor(minor: string): string {
  try { const v = BigInt(minor); return (v < 0n ? -v : v).toString(); } catch { return '0'; }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  appbar: { paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[2], alignItems: 'center' },
  appbarTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  body: { flex: 1, padding: space[5] },
  scroll: { paddingBottom: space[6] },
  notice: { fontFamily: font.body, fontSize: font.size.sm, color: color.successDark, textAlign: 'center', marginHorizontal: space[5], marginTop: space[2] },

  hero: { backgroundColor: color.primary700, paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[6] },
  balLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.white, opacity: 0.7 },
  balRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: 6 },
  balValue: { color: color.white },
  balHidden: { fontFamily: font.display, fontSize: font.size['3xl'], fontWeight: font.weight.bold, color: color.white },
  eye: { fontSize: 20 },
  balErrorRow: { paddingVertical: space[1] },
  balError: { fontFamily: font.body, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.accent300, textDecorationLine: 'underline' },
  statRow: { flexDirection: 'row', gap: space[3], marginTop: space[4], paddingTop: space[3], borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.15)' },
  stat: { flex: 1 },
  statLabel: { fontFamily: font.body, fontSize: 11, color: color.white, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.4 },
  statValRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 2 },
  statPlus: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.white, marginRight: 1 },
  statVal: { color: color.white },

  actions: { flexDirection: 'row', gap: space[2], paddingHorizontal: space[5], marginTop: -28 },
  action: { flex: 1, backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.lg, paddingVertical: space[3], alignItems: 'center', ...shadow.card },
  actionIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  actionGlyph: { fontSize: 20 },
  actionLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink700 },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], marginTop: space[5], marginBottom: space[2] },
  sectionTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  viewAll: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  emptyWrap: { paddingHorizontal: space[5] },
  txns: { paddingHorizontal: space[5], gap: space[2] },
  txn: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.md },
  txnIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  txnGlyph: { fontSize: 16, fontWeight: font.weight.bold },
  txnBody: { flex: 1, minWidth: 0 },
  txnTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  txnTime: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: 2 },
  txnAmt: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  txnSign: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold },
});
