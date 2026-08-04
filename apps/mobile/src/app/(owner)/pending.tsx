// apps/mobile/src/app/(owner)/pending.tsx · screen 07 (Application Under Review). Thin screen (guide §3): reflects
// the tenant's REAL current subscription while activation is pending (server-owned status). Joins the plan
// catalogue to name the selected plan. Money via MoneyText (Law 2). Behind `tenant_admin_lite`. Degrade-never-die.
//
// §13 (NOT faked): status, Application ID (subscription id), Plan Selected (plan name via catalogue + real
// priceMinor), and Submitted On (createdAt) are all real. "Expected Response" is DERIVED from the real submit time
// + the published 24-hour review SLA (expectedResponseAt), not a fabricated date. Business Name DEGRADES to "—":
// the subscription contract carries no business-name field (the mockup's "Anand FPO Pvt Ltd" is not invented). The
// "Application ID" is the real subscription id, not the mockup's formatted "KV-TNT-2026-0142". "Contact Support"
// has no dedicated owner-support endpoint yet, so it shows guidance rather than a fabricated contact.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { Subscription, Plan } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { Button, Card, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { currentSubscription, plans } from '../../features/tenant/tenant.api';
import { subscriptionTone, needsToApply, expectedResponseAt } from '../../features/tenant/tenant-admin';

const NEXT_STEPS = ['verify', 'csmCall', 'goLive', 'onboarding'] as const;
const DT: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };

export default function Pending() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tenant_admin_lite');
  const [sub, setSub] = useState<Subscription | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [s, ps] = await Promise.all([currentSubscription(), plans()]);
    setSub(s);
    setPlan(s ? ps.find((p) => p.id === s.planId) ?? null : null);
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('owner.pending.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const expected = sub ? expectedResponseAt(sub.createdAt) : null;
  const contactSupport = () => Alert.alert(t('owner.pending.supportTitle'), t('owner.pending.supportBody'));

  return (
    <ScreenScaffold
      title={t('owner.pending.title')}
      scroll
      footer={sub && !needsToApply(sub) ? (
        <View style={styles.ctaRow}>
          <Button title={t('owner.pending.contactSupport')} variant="outline" onPress={contactSupport} />
          <View style={{ flex: 1.3 }}><Button title={t('owner.pending.gotIt')} onPress={() => router.replace('/(owner)/home')} /></View>
        </View>
      ) : undefined}
    >
      {loading ? <SkeletonCard lines={6} /> : needsToApply(sub) ? (
        <EmptyState title={t('owner.pending.none.title')} message={t('owner.pending.none.message')} actionLabel={t('owner.apply.cta')} onAction={() => router.replace('/(owner)/apply')} />
      ) : (
        <View style={{ gap: space[3] }}>
          {/* Status hero */}
          <View style={styles.hero}>
            <StatusPill label={t(`owner.subStatus.${sub!.status}`)} tone={subscriptionTone(sub!.status)} />
            <Text style={styles.heroTitle}>{t('owner.pending.heading')}</Text>
            <Text style={styles.heroBody}>{t('owner.pending.body')}</Text>
          </View>

          {/* Application details */}
          <Card style={{ gap: space[2] }}>
            <Row label={t('owner.pending.appId')} value={sub!.id} mono />
            <Row label={t('owner.pending.businessName')} value={t('common.dash')} />
            <View style={styles.row}>
              <Text style={styles.k}>{t('owner.pending.planSelected')}</Text>
              <View style={styles.planVal}>
                {plan ? <Text style={styles.v}>{plan.defaultName} · </Text> : null}
                <MoneyText minor={sub!.priceMinor} currencyCode={sub!.currencyCode} langCode={lang} size="sm" />
                <Text style={styles.perMo}>{t('owner.pending.perMo')}</Text>
              </View>
            </View>
            <Row label={t('owner.pending.submittedOn')} value={sub!.createdAt ? formatDate(sub!.createdAt, lang, DT) : t('common.dash')} />
            <Row label={t('owner.pending.expectedResponse')} value={expected ? formatDate(expected, lang, DT) : t('common.dash')} />
          </Card>

          {/* What happens next */}
          <Text style={styles.section}>{t('owner.pending.nextTitle')}</Text>
          <Card style={{ gap: space[3] }}>
            {NEXT_STEPS.map((k) => (
              <View key={k} style={styles.nextRow}>
                <Text style={styles.nextIcon}>{'✓'}</Text>
                <Text style={styles.nextText}>{t(`owner.pending.next.${k}`)}</Text>
              </View>
            ))}
          </Card>
        </View>
      )}
    </ScreenScaffold>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{label}</Text>
      <Text style={[styles.v, mono && styles.mono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { padding: space[4], borderRadius: radius.lg, backgroundColor: color.primary50, alignItems: 'center', gap: space[2] },
  heroTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, textAlign: 'center' },
  heroBody: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, textAlign: 'center', lineHeight: font.size.sm * 1.5 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  k: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  v: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800, flexShrink: 1, textAlign: 'right' },
  mono: { fontFamily: font.mono ?? font.body },
  planVal: { flexDirection: 'row', alignItems: 'center' },
  perMo: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[1] },
  nextRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  nextIcon: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.primary600 },
  nextText: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, lineHeight: font.size.sm * 1.45 },
  ctaRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
