// apps/mobile/src/features/auctions/components/AuctionCard.tsx · one auction in the browse list. Feature composite,
// ui-native tokens only (guide §3). Presentational: status pill + kind + start price (Law 2 MoneyText) + when it
// ends (relative). The public read-model carries no product title, so the headline is the auction kind label; the
// detail screen fetches the listing title (flagged).
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { formatRelative } from '@krishalaya/i18n';
import { Card, MoneyText, StatusPill, color, font, space, type PillTone } from '@krishalaya/ui-native';
import type { Auction } from '@krishalaya/sdk-js';

export function AuctionCard({ auction, langCode, kindLabel, statusLabel, statusTone, startLabel, endsLabel, onPress }: {
  auction: Auction; langCode: string; kindLabel: string; statusLabel: string; statusTone: PillTone; startLabel: string; endsLabel: string; onPress: () => void;
}) {
  return (
    <Card onPress={onPress} accessibilityLabel={kindLabel}>
      <View style={styles.row}>
        <View style={{ flex: 1, gap: space[1] }}>
          <Text style={styles.title} numberOfLines={1}>{kindLabel}</Text>
          <Text style={styles.start}>{startLabel} <MoneyTextInline minor={auction.startPriceMinor} langCode={langCode} /></Text>
          <Text style={styles.ends}>{endsLabel} {safeRelative(auction.endsAt, langCode)}</Text>
        </View>
        <StatusPill label={statusLabel} tone={statusTone} />
      </View>
    </Card>
  );
}

function MoneyTextInline({ minor, langCode }: { minor: string; langCode: string }) {
  return <MoneyText minor={minor} langCode={langCode} size="md" />;
}
function safeRelative(value: string, langCode: string): string {
  try { return formatRelative(value, langCode); } catch { return ''; } // never throw in render (Law 12)
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  title: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  start: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  ends: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
});
