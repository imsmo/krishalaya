// apps/mobile/src/app/(farmer)/wallet/transactions.tsx · screen 21 (Transaction History) — rebuilt to the Phase-1
// design (Krishalaya_Design_System/screens/21-transactions.html): filter chips (All / Money In / Money Out /
// Escrow / This month), an In / Out / Net summary, and a date-grouped feed. Thin screen (guide §3); FLAG_SECURE
// (§4); behind the `wallet` flag; money via MoneyText/paise (Law 2); degrade-never-die (Law 12).
//
// REAL data: the unified wallet LEDGER (GET /wallet/ledger — signed amounts, server-truth), keyset-paged. The
// design mixes money-in, money-out AND escrow holds, which only the ledger provides (payments-only would miss
// half). Each row's in/out/hold kind, the In/Out/Net totals, and the date grouping are all derived purely from
// the server's signed amount + txnType + createdAt — nothing fabricated.
//
// HONEST GAPS (§13): totals are computed over the rows LOADED so far (keyset-paged), labelled as the shown set —
// not a fabricated period aggregate. "Export" needs a statement-export endpoint that isn't exposed yet → the
// button is present (design parity) but flagged coming-soon, never a fake file.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import type { WalletLedgerEntry } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { Button, EmptyState, SkeletonCard, MoneyText, Icon, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security';
import { walletLedger } from '../../../features/wallet/wallet.api';
import { ledgerKind, type LedgerKind } from '../../../features/wallet/wallet-home';
import { filterLedger, ledgerTotals, groupLedgerByDay, type LedgerFilter } from '../../../features/wallet/txn-history';

const FILTERS: LedgerFilter[] = ['all', 'in', 'out', 'escrow', 'month'];

export default function Transactions() {
  useSecureScreen();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('wallet');
  const [rows, setRows] = useState<WalletLedgerEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (next?: string) => {
    setLoading(true);
    const page = await walletLedger(next);
    setRows((prev) => (next ? [...prev, ...page.items] : page.items));
    setCursor(page.nextCursor);
    setFailed(!next && page.items.length === 0 && page.nextCursor === null);
    setLoading(false);
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const filtered = useMemo(() => filterLedger(rows, filter), [rows, filter]);
  const totals = useMemo(() => ledgerTotals(filtered), [filtered]);
  const groups = useMemo(() => groupLedgerByDay(filtered), [filtered]);

  const onExport = () => Alert.alert(t('txn.export'), t('wallet.comingSoon')); // §13: no export endpoint yet

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.appbar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back} accessibilityLabel={t('common.back')} accessibilityRole="button"><Icon name="arrow-left" size={20} color={color.ink700} /></Pressable>
        <Text style={styles.appbarTitle}>{t('txn.title')}</Text>
        <Pressable onPress={onExport} hitSlop={8} accessibilityRole="button"><Text style={styles.export}>{t('txn.export')}</Text></Pressable>
      </View>

      {!enabled ? (
        <View style={styles.body}><EmptyState title={t('wallet.unavailable')} /></View>
      ) : (
        <>
          {/* Filter chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {FILTERS.map((f) => {
              const active = filter === f;
              return (
                <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                  <Text style={[styles.chipTxt, active && styles.chipTxtOn]}>{t(`txn.filter.${f}`)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* In / Out / Net summary (over the shown set) */}
          <View style={styles.summary}>
            <SumBox label={t('txn.totalIn')} minor={totals.inMinor} lang={lang} tone="positive" sign="+ " />
            <SumBox label={t('txn.totalOut')} minor={totals.outMinor} lang={lang} tone="negative" sign="− " />
            <SumBox label={t('txn.net')} minor={totals.netMinor} lang={lang} tone="default" />
          </View>

          {loading && rows.length === 0 ? (
            <View style={styles.body}><SkeletonCard lines={4} /><View style={{ height: space[3] }} /><SkeletonCard lines={4} /></View>
          ) : filtered.length === 0 ? (
            <View style={styles.body}>
              <EmptyState title={t('wallet.txnEmpty.title')} message={t('wallet.txnEmpty.message')} actionLabel={failed ? t('common.retry') : undefined} onAction={failed ? () => load() : undefined} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              {groups.map((g) => (
                <View key={g.key}>
                  <Text style={styles.dayLabel}>{dayLabel(t, g.label, g.iso, lang)}</Text>
                  <View style={styles.list}>
                    {g.items.map((e) => <TxItem key={e.entryId} entry={e} t={t} lang={lang} />)}
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

function SumBox({ label, minor, lang, tone, sign }: { label: string; minor: string; lang: string; tone: 'positive' | 'negative' | 'default'; sign?: string }) {
  return (
    <View style={styles.sumBox}>
      <Text style={styles.sumLabel}>{label}</Text>
      <View style={styles.sumValRow}>
        {sign ? <Text style={[styles.sumSign, tone === 'positive' ? { color: color.successDark } : tone === 'negative' ? { color: color.dangerDark } : null]}>{sign.trim()}</Text> : null}
        <MoneyText minor={minor} langCode={lang} size="sm" tone={tone} />
      </View>
    </View>
  );
}

const KIND_BG: Record<LedgerKind, string> = { in: color.successLight, out: color.dangerLight, hold: color.warningLight };
const KIND_FG: Record<LedgerKind, string> = { in: color.successDark, out: color.dangerDark, hold: color.warningDark };
const KIND_GLYPH: Record<LedgerKind, string> = { in: '↓', out: '↑', hold: '🔒' };

function TxItem({ entry, t, lang }: { entry: WalletLedgerEntry; t: (k: string) => string; lang: string }) {
  const kind = ledgerKind(entry);
  const title = entry.description && entry.description.trim().length > 0 ? entry.description : t(`wallet.txnType.${kind}`);
  const time = (() => { try { return formatDate(entry.createdAt, lang, { timeStyle: 'short' }); } catch { return ''; } })();
  const ref = entry.txnId ? `#${entry.txnId.replace(/-/g, '').slice(0, 10).toUpperCase()}` : '';
  const sign = kind === 'in' ? '+ ' : kind === 'hold' ? '' : '− ';
  return (
    <View style={styles.item}>
      <View style={[styles.itemIcon, { backgroundColor: KIND_BG[kind] }]}><Text style={[styles.itemGlyph, { color: KIND_FG[kind] }]}>{KIND_GLYPH[kind]}</Text></View>
      <View style={styles.itemBody}>
        <Text style={styles.itemTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.itemId}>{[ref, time].filter(Boolean).join(' · ')}</Text>
      </View>
      <View style={styles.itemAmt}>
        {sign ? <Text style={[styles.itemSign, { color: KIND_FG[kind] }]}>{sign.trim()}</Text> : null}
        <MoneyText minor={absMinor(entry.amountMinor)} currencyCode={entry.currencyCode} langCode={lang} size="sm" tone={kind === 'in' ? 'positive' : kind === 'out' ? 'negative' : 'default'} />
      </View>
    </View>
  );
}

function dayLabel(t: (k: string) => string, label: 'today' | 'yesterday' | 'date', iso: string, lang: string): string {
  const date = (() => { try { return formatDate(iso, lang, { dateStyle: 'medium' }); } catch { return iso; } })();
  if (label === 'today') return `${t('txn.dayToday')} · ${date}`;
  if (label === 'yesterday') return `${t('txn.dayYesterday')} · ${date}`;
  return date;
}
function absMinor(minor: string): string { try { const v = BigInt(minor); return (v < 0n ? -v : v).toString(); } catch { return '0'; } }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[2] },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },
  appbarTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  export: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  body: { flex: 1, padding: space[5] },
  scroll: { paddingBottom: space[6] },

  filters: { gap: space[2], paddingHorizontal: space[5], paddingVertical: space[3] },
  chip: { paddingVertical: 6, paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.earth200, backgroundColor: color.card },
  chipOn: { backgroundColor: color.primary50, borderColor: color.primary600 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600 },
  chipTxtOn: { color: color.primary700 },

  summary: { flexDirection: 'row', gap: space[2], paddingHorizontal: space[5], paddingBottom: space[2] },
  sumBox: { flex: 1, backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.md, padding: space[3] },
  sumLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  sumValRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 2 },
  sumSign: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, marginRight: 1 },

  dayLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink500, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: space[5], paddingTop: space[3], paddingBottom: space[2] },
  list: { gap: space[2], paddingHorizontal: space[5] },
  item: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.md },
  itemIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  itemGlyph: { fontSize: 15, fontWeight: font.weight.bold },
  itemBody: { flex: 1, minWidth: 0 },
  itemTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  itemId: { fontFamily: font.body, fontSize: 10, color: color.ink400, marginTop: 2 },
  itemAmt: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  itemSign: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold },
});
