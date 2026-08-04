// apps/mobile/src/features/buyer/components/BuyerListingCard.tsx · one listing in the buyer browse/search/saved
// lists. Feature composite, ui-native tokens only (guide §3). Presentational: title + price (Law 2 MoneyText) +
// qty/unit, an organic pill, a "boosted" marker, and a save (♥) toggle. The public read-model has no media URLs
// yet (flagged), so there's a neutral thumbnail placeholder rather than a fake image.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { ListingCard } from '@krishalaya/sdk-js';
import { Card, MoneyText, StatusPill, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';

export function BuyerListingCard({ card, langCode, saved, onPress, onToggleSave, saveLabel, glyph, priceOverrideMinor, dropLabel }: {
  card: ListingCard; langCode: string; saved: boolean; onPress: () => void; onToggleSave: () => void; saveLabel: string;
  /** Presentational crop glyph (default 🌾) — the title is the real datum; the emoji is iconography only. */
  glyph?: string;
  /** Current (live) price to show instead of the card's stored price — the Saved screen (126) passes the refreshed
   *  price so the row reflects "now", while the card's own priceMinor is the save-time price. */
  priceOverrideMinor?: string;
  /** Ready-formatted "↓ ₹X since saved" badge (money + i18n formatted by the caller). Only when there's a real drop. */
  dropLabel?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <Card onPress={onPress} accessibilityLabel={card.title}>
      <View style={styles.row}>
        <View style={styles.thumb} accessibilityElementsHidden importantForAccessibility="no"><Text style={styles.thumbGlyph}>{glyph ?? '🌾'}</Text></View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>{card.title}</Text>
          <Text style={styles.qty}>{card.quantityAvailable} {card.unitCode}</Text>
          <View style={styles.pills}>
            {card.organicClaim ? <StatusPill label={t('listings.organic')} tone="success" /> : null}
            {card.saleType === 'auction' || card.auctionId ? <StatusPill label={t('buyer.card.auction')} tone="accent" /> : null}
            {card.boosted ? <StatusPill label={t('buyer.promoted')} tone="accent" /> : null}
            {dropLabel ? <StatusPill label={dropLabel} tone="success" /> : null}
          </View>
        </View>
        <View style={styles.right}>
          <MoneyText minor={priceOverrideMinor ?? card.priceMinor} currencyCode={card.currencyCode} langCode={langCode} size="lg" />
          <Pressable onPress={onToggleSave} hitSlop={10} accessibilityRole="button" accessibilityLabel={saveLabel} accessibilityState={{ selected: saved }}>
            <Text style={[styles.heart, saved && styles.heartOn]}>{saved ? '♥' : '♡'}</Text>
          </Pressable>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  thumb: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  thumbGlyph: { fontSize: 26 },
  body: { flex: 1, gap: 2 },
  title: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  qty: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  pills: { flexDirection: 'row', gap: space[2], marginTop: 2 },
  right: { alignItems: 'flex-end', gap: space[2], minWidth: 64 },
  heart: { fontSize: 26, color: color.ink300 },
  heartOn: { color: color.danger },
});
