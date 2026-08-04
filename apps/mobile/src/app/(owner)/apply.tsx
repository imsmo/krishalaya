// apps/mobile/src/app/(owner)/apply.tsx · screen 06 (Tenant Application — Plan Selection). Thin screen (guide §3):
// the public plan catalogue (real, price-sorted) presented as the plan-selection step; the applicant selects a
// plan and Continue creates the subscription via the REAL idempotent apply (a paid plan is charged SERVER-SIDE,
// Law 11). Money via MoneyText (Law 2). Behind `tenant_admin_lite`. Degrade-never-die.
//
// §13 (NOT faked): plan name / price / farmer-cap all come from the real Plan catalogue (defaultName,
// monthlyPriceMinor, limits.farmers). DROPPED from the mockup (no contract on Plan): the per-plan feature prose
// ("Everything in Starter + …"), the "RECOMMENDED" badge (no recommended flag), and the "Custom / contact sales"
// Enterprise treatment (no isCustom field — the public catalogue simply lists whatever paid plans it returns).
// The "First 6 months free for design partners" promo is DROPPED (no promo contract); the true "upgrade/downgrade
// anytime" note is kept (changePlan exists). "Step 2 of 5" is the design's fixed wizard chrome — the surrounding
// application steps aren't built yet, so Continue applies the selected plan directly.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import type { Plan } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { plans, applyForPlan } from '../../features/tenant/tenant.api';
import { planFarmerLimit, sortPlansByPrice } from '../../features/tenant/tenant-admin';

export default function Apply() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tenant_admin_lite');
  const [items, setItems] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    try { const p = sortPlansByPrice(await plans()); setItems(p); setSelected((s) => s ?? p[0]?.id ?? null); }
    catch { setFailed(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('owner.apply.title2')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const onContinue = async () => {
    if (!selected) return;
    setBusy(true);
    try { await applyForPlan(selected, 'monthly'); router.replace('/(owner)/pending'); }
    catch (e) {
      const msg = e instanceof SdkError && e.isConflict ? t('owner.apply.already') : e instanceof SdkError && e.isForbidden ? t('owner.notAllowed') : t('owner.apply.failed');
      Alert.alert(t('owner.apply.title2'), msg);
    } finally { setBusy(false); }
  };

  return (
    <ScreenScaffold
      title={t('owner.apply.title2')}
      scroll
      footer={items.length ? (
        <View style={styles.ctaRow}>
          <Button title={t('common.back')} variant="outline" onPress={() => router.back()} disabled={busy} />
          <View style={{ flex: 1.5 }}><Button title={t('owner.apply.continue')} onPress={onContinue} loading={busy} disabled={!selected || busy} /></View>
        </View>
      ) : undefined}
    >
      {loading ? <SkeletonCard lines={6} /> : failed ? (
        <EmptyState title={t('common.somethingWrong')} actionLabel={t('common.retry')} onAction={load} />
      ) : items.length === 0 ? (
        <EmptyState title={t('owner.apply.empty.title')} message={t('owner.apply.empty.message')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <View style={{ gap: space[3] }}>
          <Text style={styles.step}>{t('owner.apply.step', { n: '2', total: '5' })}</Text>
          <Text style={styles.heading}>{t('owner.apply.planSelection')}</Text>
          <Text style={styles.subtitle}>{t('owner.apply.subtitle')}</Text>
          <Text style={styles.note}>{t('owner.apply.changeNote')}</Text>

          {items.map((p) => {
            const on = selected === p.id;
            const cap = planFarmerLimit(p);
            return (
              <Pressable key={p.id} onPress={() => setSelected(p.id)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[styles.plan, on && styles.planOn]}>
                <View style={styles.planTop}>
                  <Text style={[styles.name, on && styles.nameOn]}>{p.defaultName}</Text>
                  {on ? <Text style={styles.tick}>✓</Text> : null}
                </View>
                <Text style={styles.cap}>{cap != null ? t('owner.apply.upTo', { n: String(cap) }) : t('owner.apply.highVolume')}</Text>
                <View style={styles.priceRow}>
                  <MoneyText minor={p.monthlyPriceMinor} currencyCode={p.currencyCode} langCode={lang} size="lg" />
                  <Text style={styles.per}>{t('owner.apply.perMonth')}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  step: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.primary700, textTransform: 'uppercase', letterSpacing: 0.8 },
  heading: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800 },
  subtitle: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600 },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  plan: { padding: space[4], borderRadius: radius.lg, borderWidth: 2, borderColor: color.ink200, backgroundColor: color.card, gap: space[1] },
  planOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  planTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  nameOn: { color: color.primary800 },
  tick: { fontFamily: font.body, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.primary600 },
  cap: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: space[2], marginTop: space[1] },
  per: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  ctaRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
