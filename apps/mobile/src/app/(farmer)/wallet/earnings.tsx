// apps/mobile/src/app/(farmer)/wallet/earnings.tsx · screen 58 "My Earnings" (farmer earnings dashboard). Thin
// screen (guide §3): the caller's OWN wallet insights (GET /wallet/earnings, aggregated FLOAT-FREE server-side —
// bigint-minor strings + per-month counts, Law 2) + the reconciled wallet balance, displayed via the PURE
// features/wallet/earnings helpers. Hero (period total + sale count + month-over-month %), Week/Month/Year/Lifetime
// toggle, a trailing-6-month bar chart, a stats grid (total sales / average sale / best month / wallet balance),
// an earnings-by-source breakdown, and Download Report + Withdraw. Behind the `wallet` flag. FLAG_SECURE (money on
// screen, §4). Degrade-never-die: a failed read → a friendly ₹0 view + retry, never a crash.
// §13 gaps (no contract → rendered honestly, never faked): a PER-CROP earnings breakdown (the server aggregates by
// transaction type, not crop) and an earnings-report export endpoint — both shown as coming-soon, never fabricated.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import type { WalletInsights } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security';
import { walletEarnings, walletBalance, exportWalletStatement } from '../../../features/wallet/wallet.api';
import { Share } from 'react-native';
import { currentMonth, momDelta, totalSales, averageSaleMinor, bestMonth, periodTotal, barChart, type EarningsPeriod } from '../../../features/wallet/earnings';

const PERIODS: EarningsPeriod[] = ['week', 'month', 'year', 'lifetime'];
const EMPTY: WalletInsights = { fromIso: '', toIso: '', currencyCode: 'INR', totalMinor: '0', byMonth: [], byType: [] };

export default function Earnings() {
  useSecureScreen();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('wallet');
  const [view, setView] = useState<WalletInsights>(EMPTY);
  const [balanceMinor, setBalanceMinor] = useState('0');
  const [period, setPeriod] = useState<EarningsPeriod>('month');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [ins, bal] = await Promise.all([walletEarnings({ byCrop: true }), walletBalance()]);
    setView(ins); setBalanceMinor(bal.availableMinor); setFailed(ins.fromIso === ''); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // P0-3 statement export: fetch the CSV ledger, write it to a file, and hand it to the OS share sheet. Honest
  // failure note (never a fake success). CSV opens in any spreadsheet app the farmer has.
  const onDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const out = await exportWalletStatement({ format: 'csv' });
      if (!out) { Alert.alert(t('earnings.report.title'), t('earnings.report.failed')); return; }
      try { await Share.share({ url: out.uri, title: out.filename, message: t('earnings.report.shareMsg') }); }
      catch { Alert.alert(t('earnings.report.title'), t('earnings.report.saved', { name: out.filename })); }
    } finally { setDownloading(false); }
  }, [t]);

  const period$ = useMemo(() => periodTotal(view.byMonth, period), [view, period]);
  const mom = useMemo(() => momDelta(view.byMonth), [view]);
  const bars = useMemo(() => barChart(view.byMonth, 6), [view]);
  const best = useMemo(() => bestMonth(view.byMonth), [view]);
  const windowSales = totalSales(view.byMonth);
  const cur = currentMonth(view.byMonth);
  const cc = view.currencyCode || 'INR';

  if (!enabled) return <ScreenScaffold title={t('earnings.title')}><EmptyState title={t('wallet.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold
      title={t('earnings.title')}
      footer={
        <View style={styles.footer}>
          <Button title={t('earnings.download')} variant="outline" loading={downloading} disabled={downloading} onPress={onDownload} />
          <View style={{ flex: 1 }}>
            <Button title={`${t('earnings.withdraw')} ${moneyInline(balanceMinor, cc, lang)}`} onPress={() => router.push('/(farmer)/wallet/withdraw')} disabled={balanceMinor === '0'} />
          </View>
        </View>
      }
    >
      {loading ? <SkeletonCard lines={10} /> : (
        <>
          {/* Hero */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>{t(`earnings.hero.${period}`)}</Text>
            <MoneyText minor={period$.amountMinor} currencyCode={cc} langCode={lang} size="3xl" style={{ color: color.white }} />
            <Text style={styles.heroSub}>
              {t('earnings.fromSales', { n: period$.count })}{cur ? ` · ${monthLong(cur.key, lang)}` : ''}
            </Text>
            {period === 'month' && mom ? (
              <Text style={styles.heroDelta}>
                {mom.pct >= 0 ? '↑' : '↓'} {moneyInline(mom.deltaMinor.replace('-', ''), cc, lang)} {t('earnings.vsLast', { pct: (mom.pct >= 0 ? '+' : '') + mom.pct })}
              </Text>
            ) : period$.approximate ? <Text style={styles.heroDelta}>{t('earnings.approxNote')}</Text> : null}
          </View>

          {/* Period toggle */}
          <View style={styles.tabs}>
            {PERIODS.map((p) => (
              <Pressable key={p} onPress={() => setPeriod(p)} style={[styles.tab, period === p && styles.tabOn]} accessibilityRole="button" accessibilityState={{ selected: period === p }}>
                <Text style={[styles.tabTxt, period === p && styles.tabTxtOn]}>{t(`earnings.period.${p}`)}</Text>
              </Pressable>
            ))}
          </View>

          {/* Bar chart (trailing 6 months) */}
          {bars.length ? (
            <Card style={{ marginTop: space[4] }}>
              <View style={styles.chart}>
                {bars.map((b) => (
                  <View key={b.key} style={styles.barCol}>
                    <Text style={styles.barVal}>{moneyShort(b.amountMinor)}</Text>
                    <View style={styles.barTrack}><View style={[styles.barFill, { height: `${Math.max(b.heightPct, 4)}%` }]} /></View>
                    <Text style={styles.barKey}>{monthShort(b.key, lang)}</Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          {/* Stats grid */}
          <View style={styles.grid}>
            <Stat label={t('earnings.totalSales')} value={String(windowSales)} />
            <Stat label={t('earnings.avgSale')}><MoneyText minor={averageSaleMinor(period$.amountMinor, period$.count)} currencyCode={cc} langCode={lang} size="lg" /></Stat>
            <Stat label={t('earnings.bestMonth')}>{best ? <Text style={styles.statTxt}>{moneyShort(best.amountMinor)} {monthShort(best.key, lang)}</Text> : <Text style={styles.statTxt}>—</Text>}</Stat>
            <Stat label={t('earnings.walletBalance')}><MoneyText minor={balanceMinor} currencyCode={cc} langCode={lang} size="lg" /></Stat>
          </View>

          {/* Earnings by source (real byType) */}
          <Card style={{ marginTop: space[4] }}>
            <Text style={styles.section}>{t('earnings.bySource')}</Text>
            {view.byType.length ? view.byType.map((b) => (
              <View key={b.key} style={styles.srcRow}>
                <Text style={styles.srcKey} numberOfLines={1}>{b.key}</Text>
                <MoneyText minor={b.amountMinor} currencyCode={cc} langCode={lang} size="md" />
              </View>
            )) : <Text style={styles.muted}>{t('earnings.bySourceEmpty')}</Text>}
          </Card>

          {/* Earnings by crop (P0-3, real byCrop — attributed to each order's product title). Only render when present. */}
          {view.byCrop && view.byCrop.length ? (
            <Card style={{ marginTop: space[3] }}>
              <Text style={styles.section}>{t('earnings.byCrop')}</Text>
              {view.byCrop.map((b) => (
                <View key={b.key} style={styles.srcRow}>
                  <Text style={styles.srcKey} numberOfLines={1}>{b.key}</Text>
                  <MoneyText minor={b.amountMinor} currencyCode={cc} langCode={lang} size="md" />
                </View>
              ))}
            </Card>
          ) : null}

          {failed ? <View style={{ marginTop: space[3] }}><Button title={t('common.retry')} variant="outline" onPress={load} /></View> : null}
        </>
      )}
    </ScreenScaffold>
  );
}

function Stat({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <View style={styles.stat}>
      {children ?? <Text style={styles.statTxt}>{value}</Text>}
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function monthLong(key: string, lang: string): string {
  try { return formatDate(`${key}-01T00:00:00Z`, lang, { month: 'short', year: 'numeric' }); } catch { return key; }
}
function monthShort(key: string, lang: string): string {
  try { return formatDate(`${key}-01T00:00:00Z`, lang, { month: 'short' }); } catch { return key; }
}
// Compact INR for bar labels / best-month ("₹52k"). Real paise → rupees; never a fabricated figure.
function moneyShort(minor: string): string {
  try {
    const r = Number(BigInt(minor)) / 100;
    return r >= 1000 ? `₹${Math.round(r / 1000)}k` : `₹${Math.round(r)}`;
  } catch { return '—'; }
}
function moneyInline(minor: string, cc: string, lang: string): string {
  try {
    const r = Number(BigInt(minor)) / 100;
    return new Intl.NumberFormat(lang === 'en' ? 'en-IN' : lang === 'gu' ? 'gu-IN' : 'hi-IN', { style: 'currency', currency: cc, maximumFractionDigits: 0 }).format(r);
  } catch { return '—'; }
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  hero: { backgroundColor: color.primary600, borderRadius: radius.lg, padding: space[5], alignItems: 'center', gap: space[1] },
  heroLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.primary100, textTransform: 'capitalize' },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.primary100, marginTop: space[1] },
  heroDelta: { fontFamily: font.body, fontSize: font.size.sm, color: color.white, fontWeight: font.weight.semibold, marginTop: space[1] },

  tabs: { flexDirection: 'row', gap: space[2], marginTop: space[4] },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space[2], borderRadius: radius.pill, backgroundColor: color.earth100 },
  tabOn: { backgroundColor: color.primary600 },
  tabTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, fontWeight: font.weight.semibold },
  tabTxtOn: { color: color.white },

  chart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 160, gap: space[2] },
  barCol: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end', gap: 4 },
  barVal: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  barTrack: { width: '70%', flex: 1, justifyContent: 'flex-end', backgroundColor: color.page, borderRadius: radius.sm },
  barFill: { width: '100%', backgroundColor: color.primary500, borderRadius: radius.sm },
  barKey: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], marginTop: space[4] },
  stat: { width: '47%', flexGrow: 1, backgroundColor: color.card, borderRadius: radius.lg, padding: space[3], gap: 2 },
  statTxt: { fontFamily: font.display, fontSize: font.size.lg, color: color.ink900, fontWeight: font.weight.bold },
  statLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },

  section: { fontFamily: font.display, fontSize: font.size.lg, color: color.ink900, fontWeight: font.weight.bold, marginBottom: space[2] },
  srcRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.ink100 },
  srcKey: { flex: 1, fontFamily: font.body, fontSize: font.size.md, color: color.ink700, textTransform: 'capitalize' },
  muted: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[2] },
});
