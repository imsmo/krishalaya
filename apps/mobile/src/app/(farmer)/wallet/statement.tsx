// apps/mobile/src/app/(farmer)/wallet/statement.tsx · the wallet LEDGER statement (no dedicated Phase-1 design —
// the unified ledger feed with a SERVER-computed running balance). Thin screen (guide §3): the caller's OWN
// double-entry ledger (GET /wallet/ledger), each entry showing its signed amount + the running balanceAfterMinor
// (server-truth — the client NEVER computes a balance, Law 2/11; it only classifies the sign for colour via the
// pure ledgerKind). Money via MoneyText/paise; keyset "load more"; behind the `wallet` flag; FLAG_SECURE (§4);
// degrade-never-die (Law 12).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
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

export default function Statement() {
  useSecureScreen();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('wallet');
  const [rows, setRows] = useState<WalletLedgerEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
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

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.appbar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back} accessibilityLabel={t('common.back')} accessibilityRole="button"><Icon name="arrow-left" size={20} color={color.ink700} /></Pressable>
        <Text style={styles.appbarTitle}>{t('wallet.statement')}</Text>
        <View style={styles.back} />
      </View>

      {!enabled ? (
        <View style={styles.body}><EmptyState title={t('wallet.unavailable')} /></View>
      ) : loading && rows.length === 0 ? (
        <View style={styles.body}><SkeletonCard lines={6} /></View>
      ) : rows.length === 0 ? (
        <View style={styles.body}><EmptyState title={t('wallet.statementEmpty.title')} message={t('wallet.statementEmpty.message')} actionLabel={failed ? t('common.retry') : undefined} onAction={failed ? () => load() : undefined} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.list}>
            {rows.map((e) => <Row key={e.entryId} entry={e} t={t} lang={lang} />)}
          </View>
          {cursor ? <View style={{ padding: space[5] }}><Button title={t('common.loadMore')} variant="outline" loading={loading} onPress={() => load(cursor)} /></View> : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const DOT: Record<LedgerKind, string> = { in: color.successDark, out: color.dangerDark, hold: color.warningDark };

function Row({ entry, t, lang }: { entry: WalletLedgerEntry; t: (k: string) => string; lang: string }) {
  const kind = ledgerKind(entry);
  const title = entry.description && entry.description.trim().length > 0 ? entry.description : (entry.txnType ?? t(`wallet.txnType.${kind}`));
  const date = (() => { try { return formatDate(entry.createdAt, lang, { dateStyle: 'medium' }); } catch { return ''; } })();
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: DOT[kind] }]} />
      <View style={styles.left}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {date ? <Text style={styles.date}>{date}</Text> : null}
      </View>
      <View style={styles.right}>
        <MoneyText minor={entry.amountMinor} currencyCode={entry.currencyCode} langCode={lang} size="md" tone={kind === 'in' ? 'positive' : kind === 'out' ? 'negative' : 'default'} />
        <Text style={styles.balLabel}>{t('wallet.colBalance')} <MoneyText minor={entry.balanceAfterMinor} currencyCode={entry.currencyCode} langCode={lang} size="xs" tone="muted" /></Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[2] },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },
  appbarTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  body: { flex: 1, padding: space[5] },
  scroll: { paddingBottom: space[6] },
  list: { marginHorizontal: space[5], marginTop: space[3], backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.lg, paddingHorizontal: space[4] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], paddingVertical: space[3], borderTopWidth: 1, borderTopColor: color.ink100 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  left: { flex: 1, gap: 2 },
  right: { alignItems: 'flex-end', gap: 2 },
  title: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  date: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  balLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
});
