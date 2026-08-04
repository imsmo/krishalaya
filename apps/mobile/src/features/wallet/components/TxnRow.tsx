// apps/mobile/src/features/wallet/components/TxnRow.tsx · one row in the transactions / payout-history lists.
// A feature-specific COMPOSITE built only from ui-native primitives + tokens (guide §3). Presentational: it
// renders a pre-computed TxnView (see features/wallet/txn.ts) — money via MoneyText (Law 2, signed by moneyTone),
// status via StatusPill, date via the locale formatter. The status label text is provided already-localized.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { formatDate } from '@krishalaya/i18n';
import { Card, MoneyText, StatusPill, color, font, space } from '@krishalaya/ui-native';
import type { TxnView } from '../txn';

export function TxnRow({ txn, title, statusLabel, langCode, onPress }: {
  txn: TxnView; title: string; statusLabel: string; langCode: string; onPress?: () => void;
}) {
  const sign = txn.moneyTone === 'positive' ? '+ ' : txn.moneyTone === 'negative' ? '− ' : '';
  return (
    <Card onPress={onPress} accessibilityLabel={title}>
      <View style={styles.row}>
        <View style={styles.left}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <StatusPill label={statusLabel} tone={txn.tone} />
        </View>
        <View style={styles.right}>
          <View style={styles.amount}>
            {sign ? <Text style={[styles.sign, sign.trim() === '+' ? styles.pos : styles.neg]}>{sign.trim()}</Text> : null}
            <MoneyText minor={txn.amountMinor} langCode={langCode} size="lg" tone={txn.moneyTone === 'positive' ? 'positive' : txn.moneyTone === 'negative' ? 'negative' : 'default'} />
          </View>
          {txn.createdAt ? <Text style={styles.date}>{safeDate(txn.createdAt, langCode)}</Text> : null}
        </View>
      </View>
    </Card>
  );
}

function safeDate(value: string, langCode: string): string {
  try { return formatDate(value, langCode); } catch { return ''; } // never throw in render (Law 12)
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  left: { flex: 1, gap: space[2], alignItems: 'flex-start' },
  right: { alignItems: 'flex-end', gap: space[1] },
  amount: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  sign: { fontFamily: font.body, fontSize: font.size.lg, fontWeight: font.weight.bold },
  pos: { color: color.successDark },
  neg: { color: color.dangerDark },
  title: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  date: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
});
