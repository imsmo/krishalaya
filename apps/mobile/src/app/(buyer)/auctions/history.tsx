// apps/mobile/src/app/(buyer)/auctions/history.tsx · screen 194 "My Auctions" (bidder auction history). Thin screen
// (guide §3): the caller's OWN bids across all auctions (keyset), filtered by All / Won / Lost / Active tabs, each
// card showing the lot, the seller line + outcome date, a status badge, and an outcome detail row (won → final
// bid + lot total; lost → your max bid; active → time left). Tap → the auction. Reuses the tested pure helpers
// (myBidBucket / myBidCounts / bidAmountMinor / timeLeft). FLAG_SECURE (bid amounts). Behind `auctions`.
// §13 gaps (no contract → rendered honestly, never faked):
//  • Seller NAME ("Ramesh Patel · …"): no public seller-profile read-model → a generic seller label.
//  • Lot title + crop emoji: not on MyBid → fetched best-effort from the public listing; degrades to a neutral
//    label + 🔨 glyph, never a guessed crop.
//  • "7 bidders" + the "Won at" winning amount (lost cards): NOT on the MyBid read-model → the bidder count is
//    omitted and "Won at" degrades to "—"; we show only the caller's REAL max bid. Lot total = my per-unit bid ×
//    the listing quantity (bigint, Law 2).
//  • "DIDN'T BID" exists in the design for watch-only auctions; a MyBid row always has a bid, so that state can't
//    arise here — we never fabricate it.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import type { MyBid } from '@krishalaya/sdk-js';
import { Button, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { listMyBids } from '../../../features/auctions/auctions.api';
import { getPublicListing } from '../../../features/buyer/browse.api';
import { myBidBucket, myBidCounts, bidAmountMinor, timeLeft, type MyBidTab } from '../../../features/auctions/auction-status';

type HistTab = 'all' | MyBidTab;
const TABS: HistTab[] = ['all', 'won', 'lost', 'active'];

export function HistoryScreen() {
  useSecureScreen();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('auctions');
  const [rows, setRows] = useState<MyBid[]>([]);
  const [titles, setTitles] = useState<Record<string, { title: string; qty: number; unit: string }>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<HistTab>('all');

  const load = useCallback(async (next?: string) => {
    setLoading(true);
    const page = await listMyBids(next);
    setRows((prev) => (next ? [...prev, ...page.items] : page.items));
    setCursor(page.nextCursor);
    setLoading(false);
    for (const b of page.items) {
      if (titles[b.listingId] === undefined) {
        getPublicListing(b.listingId).then((l) => { if (l) setTitles((m) => ({ ...m, [b.listingId]: { title: l.title, qty: l.quantityAvailable, unit: l.unitCode } })); }).catch(() => {});
      }
    }
  }, [titles]);
  useEffect(() => { if (enabled) load(); }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return <ScreenScaffold title={t('auctionHist.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const counts = myBidCounts(rows);
  const total = rows.length;
  const visible = tab === 'all' ? rows : rows.filter((b) => myBidBucket(b) === tab);
  const tabCount = (tk: HistTab) => (tk === 'all' ? total : counts[tk]);

  return (
    <ScreenScaffold title={t('auctionHist.title')} scroll={false}>
      {/* Filter chips */}
      <View style={styles.tabs}>
        {TABS.map((tk) => {
          const on = tab === tk;
          return (
            <Pressable key={tk} onPress={() => setTab(tk)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{t(`auctionHist.tab.${tk}`)} · {tabCount(tk)}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading && rows.length === 0 ? <View style={{ padding: space[4] }}><SkeletonCard lines={5} /></View> : (
        <FlatList
          data={visible}
          keyExtractor={(b) => b.bidId}
          contentContainerStyle={{ paddingVertical: space[2], gap: space[2] }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState title={t('auctionHist.empty.title')} message={t('auctionHist.empty.message')} />}
          renderItem={({ item }) => {
            const bucket = myBidBucket(item);
            const meta = titles[item.listingId];
            const lotTotal = meta ? bidAmountMinor(item.amountMinor, meta.qty) : null;
            const dateLabel = safeDate(item.endsAt, lang);
            const left = timeLeft(item.endsAt);
            const timeLabel = left.ended ? t('auction.ended') : left.days > 0 ? t('auction.timeLeftD', { d: left.days, h: left.hours }) : t('auction.timeLeftHM', { h: left.hours, m: left.minutes });
            return (
              <Pressable onPress={() => router.push({ pathname: '/(buyer)/auctions/[id]', params: { id: item.auctionId } })} accessibilityRole="button"
                style={[styles.card, bucket === 'won' && styles.cardWon, bucket === 'lost' && styles.cardLost]}>
                <View style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lot} numberOfLines={1}>🔨 {meta ? `${meta.qty} ${meta.unit} · ${meta.title}` : t('auctionHist.lotFallback')}</Text>
                    <Text style={styles.sub}>{t('auctionHist.seller', { name: t('auctionHist.sellerGeneric') })}{dateLabel ? ` · ${t(`auctionHist.${bucket === 'won' ? 'wonOn' : 'closedOn'}`, { date: dateLabel })}` : ''}</Text>
                  </View>
                  {bucket === 'won' ? <StatusPill label={t('auctionHist.won')} tone="success" />
                    : bucket === 'lost' ? <StatusPill label={t('auctionHist.outbid')} tone="warning" />
                    : <StatusPill label={t('auctionHist.active')} tone="info" />}
                </View>

                <View style={styles.detail}>
                  {bucket === 'won' ? (
                    <>
                      <Text style={styles.detailLabel}>{t('auctionHist.finalBid')}</Text>
                      <View style={styles.detailVal}>
                        <MoneyText minor={item.amountMinor} langCode={lang} size="sm" style={{ color: color.successDark }} />
                        {lotTotal ? <Text style={styles.perUnit}>/{meta!.unit} · </Text> : null}
                        {lotTotal ? <MoneyText minor={lotTotal} langCode={lang} size="sm" style={{ color: color.successDark }} /> : null}
                      </View>
                    </>
                  ) : bucket === 'lost' ? (
                    <>
                      <Text style={styles.detailLabel}>{t('auctionHist.yourMaxBid')}</Text>
                      <View style={styles.detailVal}>
                        <MoneyText minor={item.amountMinor} langCode={lang} size="sm" />
                        <Text style={styles.wonAt}> · {t('auctionHist.wonAt')} —</Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={styles.detailLabel}>{t('auctionHist.timeLeft')}</Text>
                      <Text style={styles.activeVal}>⏱ {timeLabel}</Text>
                    </>
                  )}
                </View>
              </Pressable>
            );
          }}
          ListFooterComponent={cursor ? <View style={{ margin: space[4] }}><Button title={t('common.loadMore')} variant="outline" loading={loading} onPress={() => load(cursor)} /></View> : null}
        />
      )}
    </ScreenScaffold>
  );
}

function safeDate(value: string, langCode: string): string { try { return formatDate(value, langCode, { day: 'numeric', month: 'short' }); } catch { return ''; } }

export default HistoryScreen;

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], padding: space[3], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600 },
  chipTxtOn: { color: color.primary700 },
  card: { marginHorizontal: space[4], padding: space[3], backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.md },
  cardWon: { borderLeftWidth: 4, borderLeftColor: color.success },
  cardLost: { borderLeftWidth: 4, borderLeftColor: color.warning },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[2] },
  lot: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  sub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  detail: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[2], paddingTop: space[2], borderTopWidth: 1, borderTopColor: color.ink100 },
  detailLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  detailVal: { flexDirection: 'row', alignItems: 'center' },
  perUnit: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  wonAt: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  activeVal: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.warningDark },
});
