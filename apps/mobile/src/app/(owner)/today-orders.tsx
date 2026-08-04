// apps/mobile/src/app/(owner)/today-orders.tsx · screen 547 (Today's Orders). Thin screen (guide §3): the
// tenant-owner's real today-window order summary + an honest placement for the per-order worklist (see §13).
// Money via MoneyText (Law 2). Behind `tenant_admin_lite`. Degrade-never-die. DEV-45 Step 3 (DELTA-067's canon,
// authored this session — `screens/547-tenant-today-orders.html`, read in full as the redline per BRAND-039).
//
// §13 (NOT faked): "{orders} orders · ₹{gmv} total" = a REAL tenant-wide window read via
// `todayTenantOrderSummary()` (wraps `tenancy.analytics`, the same real endpoint `(owner)/home.tsx` already uses
// for its "Today's GMV" KPI, over the same start-of-day window) — real numbers, never invented.
// DROPPED, confirmed genuine backend gap (not a build shortcut): the canon's per-order ROW list (order #, product,
// farmer name, buyer name, individual Accept/Reject · Mark Packed · Mark Ready · Confirm Pickup buttons) and its
// "All · N / Need action · N / Done · N" chip bar. Read `apps/api/src/modules/orders/controllers/v1/
// orders.controller.ts` + `read-models/order-timeline.read-model.ts` + `repositories/order.repository.ts` in
// full: `GET orders` (`OrderTimelineReadModel.list` → `OrderRepository.listFor`) is hardcoded to
// `buyer_user_id=$2`/`seller_user_id=$2` where `$2 = ctx.userId` — the CALLING user's OWN buyer/seller identity
// only. Canon 547's rows span many different farmers-as-sellers and buyers, none of which is the tenant-owner's
// own account — there is no tenant-wide/moderator-scoped order-list read-model anywhere in the API today (unlike
// `GET orders/stats` and `GET orders/:id`, which ARE moderator-aware). Inventing a client-side call against a
// backend shape that doesn't exist would violate contract §7 ("no silent invention of a schema shape... backend
// didn't ratify") and the batch's own "api untouched" gate. So: real aggregate numbers render above; the row list
// itself renders an honest "not yet wired" panel with a live link to the real, already-built Order Analytics
// screen (151) instead of fabricated cards — recorded as a residual (DELTA-069 candidate, see dev45_report.md).
// Per-order accept/pack/ready mutations (`confirmOrder`/`packOrder`/`readyOrder`) already exist in
// `features/orders/orders.api.ts` and remain valid — they simply have no real per-tenant order id to bind to from
// this screen until the missing read-model ships; nothing here disables an EXISTING working action, it just can't
// wire one that has no data source yet.
// Canon's Offline/Denied reference states (§6 "reference — contract §6" cards) are not separately rendered here,
// consistent with every other (owner)/* sibling (approvals.tsx/order-analytics.tsx/home.tsx): offline shows the
// app-wide connectivity banner, and a role-scoped 403 would surface as a friendly not-allowed alert exactly like
// approvals.tsx's own `owner.notAllowed` pattern — there is no live per-order action to 403 on yet (see above).
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatDate } from '@krishalaya/i18n';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { todayTenantOrderSummary, type TodayOrderSummary } from '../../features/orders/orders.api';
import { openWebConsole } from '../../core/deeplink';
import { WEB_PATHS } from '../../features/tenant/web-console';

const DATE_FMT: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };

export default function TodayOrders() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tenant_admin_lite');
  const [summary, setSummary] = useState<TodayOrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    const s = await todayTenantOrderSummary();
    if (!s) setError(true);
    setSummary(s); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) load(); }, [enabled, load]));

  if (!enabled) {
    return (
      <ScreenScaffold title={t('owner.todayOrders.title')}>
        <EmptyState title={t('owner.todayOrders.flaggedOff.title')} message={t('owner.todayOrders.flaggedOff.message')} testID="today-orders-flagged-off" />
      </ScreenScaffold>
    );
  }

  const today = formatDate(new Date().toISOString(), lang, DATE_FMT);

  const openExport = useCallback(async () => {
    setExporting(true);
    try { const ok = await openWebConsole(WEB_PATHS.export); if (!ok) Alert.alert(t('owner.todayOrders.title'), t('owner.web.unavailable')); }
    finally { setExporting(false); }
  }, [t]);

  return (
    <ScreenScaffold
      title={t('owner.todayOrders.title')}
      scroll
      footer={!loading && !error && summary ? (
        <Pressable disabled={exporting} onPress={openExport} accessibilityRole="button" style={styles.export}>
          <Text style={styles.exportText}>{t('owner.todayOrders.export')} ↗</Text>
        </Pressable>
      ) : undefined}
    >
      {loading ? (
        <SkeletonCard lines={5} testID="today-orders-skeleton" />
      ) : error || !summary ? (
        <EmptyState
          title={t('common.somethingWrong')}
          message={t('owner.todayOrders.error.message')}
          actionLabel={t('common.retry')}
          onAction={load}
          testID="today-orders-error"
        />
      ) : (
        <View style={{ gap: space[4] }}>
          {/* Real date bar + real aggregate summary (Law 2/3, no invented per-status breakdown) */}
          <Card style={styles.dateCard}>
            <Text style={styles.dateLabel}>{t('owner.todayOrders.dateLabel', { date: today })}</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryText}>{t('owner.todayOrders.summary.orders', { count: String(summary.orders) })}</Text>
              <Text style={styles.summaryDot}>·</Text>
              <MoneyText minor={summary.gmvMinor} currencyCode={summary.currencyCode} langCode={lang} size="md" />
            </View>
          </Card>

          {summary.orders === 0 ? (
            <EmptyState title={t('owner.todayOrders.empty.title')} message={t('owner.todayOrders.empty.message')} testID="today-orders-empty" />
          ) : (
            <Card style={styles.pendingCard}>
              <Text style={styles.pendingTitle}>{t('owner.todayOrders.pending.title')}</Text>
              <Text style={styles.pendingBody}>{t('owner.todayOrders.pending.body')}</Text>
              <Pressable onPress={() => router.push('/(owner)/order-analytics')} accessibilityRole="button" style={styles.pendingLink}>
                <Text style={styles.pendingLinkText}>{t('owner.todayOrders.pending.cta')} ↗</Text>
              </Pressable>
            </Card>
          )}
        </View>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  dateCard: { gap: space[2] },
  dateLabel: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  summaryText: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  summaryDot: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  pendingCard: { gap: space[2], borderStyle: 'dashed', borderColor: color.ink100 },
  pendingTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  pendingBody: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, lineHeight: 20 },
  pendingLink: { alignSelf: 'flex-start', marginTop: space[1] },
  pendingLinkText: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary600 },
  export: { alignItems: 'center', paddingVertical: space[3], borderRadius: radius.md, backgroundColor: color.primary600 },
  exportText: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.white },
});
