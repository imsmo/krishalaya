// apps/mobile/src/app/(ambassador)/commissions.tsx · screen 92 (My Commissions). Thin screen (guide §3): the
// ambassador's commission ledger — a hero month-total, the withdrawable/paid split, the program rules ("How you
// earn"), and the recent ledger — with a Withdraw CTA. Behind `ambassador_training`. Money is bigint minor via
// MoneyText (Law 2); the app NEVER moves money (payout is server-side, Law 11). Degrade-never-die.
//
// §13 (NOT faked): the earning contract carries NO farmer name / bank detail, so each ledger row is labelled by
// its event CATEGORY (+ date + signed amount + paid/unpaid), never "Onboarded Anil Kumar · SBI ••••2247". The
// "How you earn" rules are fixed program copy WITHOUT a fabricated ₹ figure (no commission-plan-amount contract).
// The only real paid/unpaid signal is `payoutId`, so the second tile is PAID-to-date, not a fabricated "pending 7d"
// window (no settlement-holdback contract). Totals/counts/trend are all derived live from the ledger.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { AmbassadorEarning } from '@krishalaya/sdk-js';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { Button, Card, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useSecureScreen } from '../../core/security/screen-guard';
import { myEarnings } from '../../features/ambassador/ambassador.api';
import {
  commissionCategory, isPayout, monthCreditsMinor, monthCountByCategory,
  withdrawableMinor, paidMinor, momDeltaPct, EARNING_RULES,
} from '../../features/ambassador/commissions-summary';

export default function Commissions() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('ambassador_training');
  useSecureScreen(); // money screen → FLAG_SECURE
  const [items, setItems] = useState<AmbassadorEarning[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);

  const load = useCallback(async () => { const r = await myEarnings(); setItems(r.items); setCursor(r.nextCursor); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  const more = useCallback(async () => {
    if (!cursor || paging) return;
    setPaging(true);
    try { const r = await myEarnings(undefined, cursor); setItems((prev) => [...prev, ...r.items]); setCursor(r.nextCursor); }
    finally { setPaging(false); }
  }, [cursor, paging]);

  const now = useMemo(() => new Date(), []);
  const monthMinor = monthCreditsMinor(items, now);
  const onboarded = monthCountByCategory(items, 'onboarding', now);
  const firstSales = monthCountByCategory(items, 'first_sale', now);
  const delta = momDeltaPct(items, now);
  const withdrawable = withdrawableMinor(items);
  const paid = paidMinor(items);
  const canWithdraw = (() => { try { return BigInt(withdrawable) > 0n; } catch { return false; } })();
  const monthLabel = formatDate(now, lang, { month: 'short', year: 'numeric' });

  if (!enabled) return <ScreenScaffold title={t('amb.commissions.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const footer = (
    <Button
      title={t('amb.commissions.withdrawTo', { amount: formatMoneyMinor(withdrawable, 'INR', lang) })}
      onPress={() => router.push('/(ambassador)/withdraw')}
      disabled={!canWithdraw}
    />
  );

  const header = (
    <View style={{ gap: space[3] }}>
      {/* Hero — total commissions this month */}
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>{t('amb.commissions.monthTotal', { month: monthLabel })}</Text>
        <View style={styles.heroAmount}><MoneyText minor={monthMinor} langCode={lang} size="2xl" tone="positive" /></View>
        <Text style={styles.heroSub}>
          {t('amb.commissions.heroCounts', { onboarded: String(onboarded), sales: String(firstSales) })}
          {delta != null ? `  ·  ${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}% ${t('amb.commissions.vsPrev')}` : ''}
        </Text>
      </View>

      {/* Withdrawable / paid split (the only real signal is payoutId) */}
      <View style={styles.tiles}>
        <Card style={styles.tile}>
          <MoneyText minor={withdrawable} langCode={lang} size="lg" tone="positive" />
          <Text style={styles.tileLabel}>{t('amb.commissions.withdrawable')}</Text>
        </Card>
        <Card style={styles.tile}>
          <MoneyText minor={paid} langCode={lang} size="lg" tone="muted" />
          <Text style={styles.tileLabel}>{t('amb.commissions.paidToDate')}</Text>
        </Card>
      </View>

      {/* How you earn — fixed program rules, §13 no fabricated ₹ amounts */}
      <Text style={styles.section}>{t('amb.commissions.howTitle')}</Text>
      <Card style={{ gap: space[3] }}>
        {EARNING_RULES.map((r, i) => (
          <View key={r.key} style={[styles.ruleRow, i > 0 && styles.divide]}>
            <Text style={styles.ruleIcon}>{r.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.ruleTitle}>{t(`amb.commissions.rule.${r.key}.title`)}</Text>
              <Text style={styles.ruleDesc}>{t(`amb.commissions.rule.${r.key}.desc`)}</Text>
            </View>
          </View>
        ))}
        <Text style={styles.ruleNote}>{t('amb.commissions.rulesNote')}</Text>
      </Card>

      <Text style={styles.section}>{t('amb.commissions.recent')}</Text>
    </View>
  );

  return (
    <ScreenScaffold title={t('amb.commissions.title')} footer={footer}>
      {loading ? <SkeletonCard lines={6} /> : (
        <FlatList
          data={items}
          keyExtractor={(e) => e.id}
          ListHeaderComponent={header}
          renderItem={({ item }) => <LedgerRow item={item} lang={lang} t={t} />}
          ListEmptyComponent={<EmptyState title={t('amb.earnings.empty.title')} message={t('amb.earnings.empty.message')} />}
          onEndReached={more}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            <>
              {paging ? <SkeletonCard lines={1} /> : null}
              <Text style={styles.payoutNote}>{t('amb.earnings.payoutNote')}</Text>
            </>
          }
          contentContainerStyle={{ paddingBottom: space[4], gap: space[2] }}
        />
      )}
    </ScreenScaffold>
  );
}

function LedgerRow({ item, lang, t }: { item: AmbassadorEarning; lang: string; t: (k: string, v?: Record<string, string | number>) => string }) {
  const cat = commissionCategory(item.eventCode);
  const payout = isPayout(item);
  return (
    <Card style={styles.rowCard}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{t(`amb.commissions.event.${cat}`)}</Text>
        <Text style={styles.rowDate}>{item.createdAt ? formatDate(item.createdAt, lang, { dateStyle: 'medium' }) : t('common.dash')}</Text>
      </View>
      <View style={styles.rowRight}>
        <MoneyText minor={item.amountMinor} langCode={lang} size="md" tone={payout ? 'negative' : 'positive'} />
        {!payout ? (
          <StatusPill label={t(item.payoutId ? 'amb.earnings.paid' : 'amb.earnings.unpaid')} tone={item.payoutId ? 'success' : 'warning'} />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', padding: space[4], borderRadius: radius.lg, backgroundColor: color.primary50 },
  heroLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  heroAmount: { marginVertical: space[2] },
  heroSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, textAlign: 'center' },
  tiles: { flexDirection: 'row', gap: space[3] },
  tile: { flex: 1, alignItems: 'center', gap: space[1] },
  tileLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[2] },
  ruleRow: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  divide: { borderTopWidth: 1, borderTopColor: color.ink100, paddingTop: space[3] },
  ruleIcon: { fontSize: 22 },
  ruleTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink900 },
  ruleDesc: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, marginTop: 2, lineHeight: font.size.xs * 1.5 },
  ruleNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontStyle: 'italic' },
  rowCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  rowTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  rowDate: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', gap: space[1] },
  payoutNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, textAlign: 'center', marginTop: space[3], lineHeight: font.size.xs * 1.5 },
});
