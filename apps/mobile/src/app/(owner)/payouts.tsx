// apps/mobile/src/app/(owner)/payouts.tsx · screen 80 (Farmer Payouts). Thin screen (guide §3): a read-only monitor
// of payouts (money-OUT) + a web-console handoff for running a payout batch. Amounts are bigint paise via MoneyText
// (Law 2); the app NEVER moves money (Law 11) — this only reflects server state. Behind `tenant_admin_lite`. Keyset;
// degrade-never-die.
//
// §13 (NOT faked): the list is the tenant's REAL payouts (amount + status + date) from `payouts.list`. The mockup's
// payout-RUN builder — the "₹2,84,650 · 47 farmers · 89 transactions" pending headline, per-farmer rows with names +
// UPI handles (ramesh@okaxis…) + order counts, the select-to-pay checkboxes, the Subtotal / Platform-fee / Total
// breakdown, and "Pay Now via UPI" / Schedule — has NO mobile contract and would MOVE MONEY, which the app must never
// do (Law 11): payouts are batched, fee-split and executed server-side (RazorpayX) and reconciled by jobs. The
// PayoutSummary contract carries no beneficiary name/UPI/bank or order-count either (PII/financial minimisation). So
// we hand the whole run off to the web admin console rather than fabricate a total, invent farmer UPI IDs, or render
// a Pay button that can't (and mustn't) execute here. No fabricated ₹2,84,650 / names / UPI / fee figures.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { PayoutSummary } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { Button, Card, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { tenantPayouts } from '../../features/tenant/tenant.api';
import { statusTone } from '../../features/wallet/txn';
import { openWebConsole } from '../../core/deeplink';

const DT: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };

export default function Payouts() {
  const { t, lang } = useTranslation();
  const enabled = useFlag('tenant_admin_lite');
  const [items, setItems] = useState<PayoutSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => { const r = await tenantPayouts(); setItems(r.items); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('owner.tabs.payouts')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const runPayouts = async () => { if (!(await openWebConsole('/payouts'))) Alert.alert(t('owner.tabs.payouts'), t('owner.farmer.consoleUnavailable')); };

  const header = (
    <View style={{ gap: space[3], marginBottom: space[2] }}>
      <Card style={{ gap: space[2] }}>
        <Text style={styles.section}>{t('owner.payouts.runTitle')}</Text>
        <Text style={styles.body}>{t('owner.payouts.runBody')}</Text>
        <Button title={t('owner.payouts.runCta')} variant="outline" fullWidth={false} onPress={runPayouts} />
      </Card>
      <Text style={styles.section}>{t('owner.payouts.historyTitle')}</Text>
    </View>
  );

  return (
    <ScreenScaffold title={t('owner.tabs.payouts')}>
      {loading ? <SkeletonCard lines={6} /> : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState title={t('owner.payouts.empty.title')} message={t('owner.payouts.empty.message')} actionLabel={t('common.retry')} onAction={load} />}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.row}>
                <MoneyText minor={item.amountMinor} currencyCode={item.currencyCode} langCode={lang} size="md" />
                <StatusPill label={t(`owner.payoutStatus.${item.status}`, { defaultValue: item.status })} tone={statusTone(item.status)} />
              </View>
              {item.createdAt ? <Text style={styles.date}>{formatDate(item.createdAt, lang, DT)}</Text> : null}
            </Card>
          )}
          contentContainerStyle={{ paddingBottom: space[6] }}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  body: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, lineHeight: font.size.sm * 1.5 },
  card: { marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
});
