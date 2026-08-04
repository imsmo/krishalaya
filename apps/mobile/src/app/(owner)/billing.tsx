// apps/mobile/src/app/(owner)/billing.tsx · screen 85 (Plan & Billing). Thin screen (guide §3): the tenant's REAL
// current plan (name + price + capability lines from the plan's published limits) + next-billing/auto-renew, a
// "usage this month" panel with progress bars from the REAL {limits,usage} the subscription dashboard returns, the
// real upgrade catalogue (higher-priced + custom tiers), and a billing-history handoff. Money via MoneyText (Law 2).
// Behind `tenant_admin_lite`. Degrade-never-die (loading/empty/error). FLAG: the spec names an `owner_console`
// flag, but the registered owner gate is `tenant_admin_lite` — used here for a working gate + consistency.
//
// §13 (NOT faked): current plan name = plan resolved from the REAL catalogue by subscription.planId; price =
// subscription.priceMinor; capability lines = plan.limits (real caps; "Unlimited" for -1/0) — the mockup's
// marketing bullets ("White-label branding", "Priority support", "API access", "Dedicated account manager",
// "Self-hosted", "SLA support") are NOT on the Plan contract, so we NEVER print them; only the published limits.
// "Next billing" = subscription.currentPeriodEnd; auto-renew = !cancelAtPeriodEnd. Usage bars = real usage/limits
// maps (Farmers/SMS/… appear only if the server returns them). Upgrade cards = real catalogue via upgradePlans;
// "Custom/Contact" = a plan with monthlyPriceMinor 0. Changing/paying a plan moves money SERVER-SIDE (Law 11) and
// needs a payment method → routed to the web console, never done in-app. BILLING HISTORY (the invoice list) has NO
// tenant-facing mobile contract (SaaS invoices live behind billing-ops, Law 11), so we DON'T fabricate rows — we
// hand off to the web console. Every read/action is authorised + re-checked SERVER-SIDE.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { Plan, Subscription } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { Button, Card, EmptyState, MoneyText, ProgressBar, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { billingDashboard } from '../../features/tenant/tenant.api';
import { subscriptionTone, needsToApply, planLimitLines, usageRows, upgradePlans, isCustomPlan } from '../../features/tenant/tenant-admin';
import { openWebConsole } from '../../core/deeplink';
import { WEB_PATHS } from '../../features/tenant/web-console';

function limitLabel(t: (k: string, v?: Record<string, string>) => string, key: string): string {
  return t(`owner.billing.limit.${key}`, { defaultValue: key.replace(/_/g, ' ') });
}

export default function Billing() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tenant_admin_lite');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [usage, setUsage] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await billingDashboard();
    setPlans(d.plans); setSub(d.subscription); setLimits(d.limits); setUsage(d.usage); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  const openWeb = useCallback(async (path: string) => {
    setBusy(true);
    try { const ok = await openWebConsole(path); if (!ok) Alert.alert(t('owner.billing.title'), t('owner.web.unavailable')); }
    finally { setBusy(false); }
  }, [t]);

  if (!enabled) return <ScreenScaffold title={t('owner.billing.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const currentPlan = sub ? plans.find((p) => p.id === sub.planId) ?? null : null;
  const currentLimitLines = planLimitLines(currentPlan);
  const usageList = usageRows(limits, usage);
  const upgrades = upgradePlans(plans, sub?.planId, sub?.priceMinor);

  return (
    <ScreenScaffold title={t('owner.billing.title')} scroll>
      {loading ? <SkeletonCard lines={6} /> : (
        <View style={{ gap: space[4] }}>
          {/* Current plan */}
          <Text style={styles.section}>{t('owner.billing.currentPlan')}</Text>
          {needsToApply(sub) ? (
            <Card>
              <EmptyState title={t('owner.billing.none.title')} message={t('owner.billing.none.message')} />
              <Button title={t('owner.apply.cta')} onPress={() => router.push('/(owner)/apply')} />
            </Card>
          ) : (
            <Card style={{ gap: space[2] }}>
              <View style={styles.rowBetween}>
                <Text style={styles.planName}>{currentPlan?.defaultName ?? t('common.dash')}</Text>
                <StatusPill label={t(`owner.subStatus.${sub!.status}`, { defaultValue: sub!.status })} tone={subscriptionTone(sub!.status)} />
              </View>
              <View style={styles.priceRow}>
                <MoneyText minor={sub!.priceMinor} currencyCode={sub!.currencyCode} langCode={lang} size="lg" />
                <Text style={styles.per}>{t(`owner.billing.per.${sub!.billingCycle}`, { defaultValue: t('owner.billing.perMonth') })}</Text>
              </View>
              {currentLimitLines.map((l) => (
                <Text key={l.key} style={styles.feature}>
                  ✓ {limitLabel(t, l.key)}: {l.unlimited ? t('owner.billing.unlimited') : l.value}
                </Text>
              ))}
              {sub!.currentPeriodEnd ? (
                <Text style={styles.nextBilling}>
                  {t('owner.billing.nextBilling', { date: safeDate(sub!.currentPeriodEnd, lang) })}
                  {sub!.cancelAtPeriodEnd ? '' : ` · ${t('owner.billing.autoRenew')}`}
                </Text>
              ) : null}
            </Card>
          )}

          {/* Usage this month */}
          {usageList.length ? (
            <>
              <Text style={styles.section}>{t('owner.billing.usageTitle')}</Text>
              <Card style={{ gap: space[3] }}>
                {usageList.map((u) => (
                  <View key={u.key} style={{ gap: space[1] }}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.usageLabel}>{limitLabel(t, u.key)}</Text>
                      <Text style={styles.usageVal}>{String(u.used)} / {u.limit == null ? t('owner.billing.unlimited') : String(u.limit)}</Text>
                    </View>
                    {u.pct != null ? <ProgressBar value={u.pct} /> : null}
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {/* Upgrade options */}
          {upgrades.length ? (
            <>
              <Text style={styles.section}>{t('owner.billing.upgradeTitle')}</Text>
              {upgrades.map((p) => {
                const custom = isCustomPlan(p);
                return (
                  <Card key={p.id} style={{ gap: space[2] }}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.planName}>{p.defaultName}</Text>
                      {custom ? (
                        <Text style={styles.customPrice}>{t('owner.billing.custom')}</Text>
                      ) : (
                        <View style={styles.priceRow}>
                          <MoneyText minor={p.monthlyPriceMinor} currencyCode={p.currencyCode} langCode={lang} size="md" />
                          <Text style={styles.per}>{t('owner.billing.perMonth')}</Text>
                        </View>
                      )}
                    </View>
                    {planLimitLines(p).map((l) => (
                      <Text key={l.key} style={styles.feature}>✓ {limitLabel(t, l.key)}: {l.unlimited ? t('owner.billing.unlimited') : l.value}</Text>
                    ))}
                    <Button
                      title={custom ? t('owner.billing.contact') : t('owner.billing.upgrade')}
                      variant="outline"
                      loading={busy}
                      onPress={() => openWeb(WEB_PATHS.billing)}
                    />
                  </Card>
                );
              })}
            </>
          ) : null}

          {/* Billing history — invoices live on the web console (no tenant-facing mobile contract; §13) */}
          <Text style={styles.section}>{t('owner.billing.historyTitle')}</Text>
          <Card>
            <Text style={styles.historyNote}>{t('owner.billing.historyOnWeb')}</Text>
            <Button title={t('owner.billing.manage')} variant="outline" loading={busy} onPress={() => openWeb(WEB_PATHS.billing)} />
          </Card>
        </View>
      )}
    </ScreenScaffold>
  );
}

function safeDate(value: string, langCode: string): string { try { return formatDate(value, langCode); } catch { return value; } }

const styles = StyleSheet.create({
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planName: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, flexShrink: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: space[1] },
  per: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  customPrice: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.primary700 },
  feature: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  nextBilling: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  usageLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  usageVal: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  historyNote: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginBottom: space[3] },
});
