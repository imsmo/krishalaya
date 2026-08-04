// apps/mobile/src/app/(ambassador)/farmers.tsx · screen 87 (My Farmers). Thin screen (guide §3): the ambassador's
// referrals (the farmers they've brought on) with a status count header, filter chips, and a per-farmer list.
// Behind `ambassador_app`. Degrade-never-die.
//
// §13 — the referral contract is PII-minimised: it exposes ONLY { code, status, createdAt } per farmer, NOT the
// name / ⭐rating / village / acres / last-activity / listings-count / earnings shown in the design. So (never
// faked): each row anonymises to a code-initial + the server status + the join date; the filter chips bucket by
// the REAL states we have (All / Onboarded / Pending) rather than a fabricated "Active 30d / Inactive" split; and
// the "Top earners" ranking has no per-farmer earnings contract → it is omitted rather than invented.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { Referral } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { listReferrals } from '../../features/ambassador/ambassador.api';
import { referralStatusTone } from '../../features/ambassador/referral-flow';
import { FARMER_TABS, filterReferralsByTab, farmerTabCounts, personInitials, type FarmerTab } from '../../features/ambassador/ambassador-home';

export default function Farmers() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('ambassador_app');
  const [items, setItems] = useState<Referral[]>([]);
  const [tab, setTab] = useState<FarmerTab>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => { const r = await listReferrals(); setItems(r.items); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('amb.tabs.farmers')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const counts = farmerTabCounts(items);
  const rows = filterReferralsByTab(items, tab);

  const header = (
    <View style={styles.chips}>
      {FARMER_TABS.map((k) => {
        const on = tab === k;
        return (
          <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]}>
            <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{t(`amb.farmers.tab.${k}`)} · {counts[k]}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <ScreenScaffold title={t('amb.farmers.title', { n: counts.all })} scroll={false} footer={<Button title={t('amb.onboard.cta')} onPress={() => router.push('/(ambassador)/onboard-start')} />}>
      {loading ? <SkeletonCard lines={6} /> : items.length === 0 ? (
        <EmptyState title={t('amb.farmers.empty.title')} message={t('amb.farmers.empty.message')} actionLabel={t('amb.onboard.cta')} onAction={() => router.push('/(ambassador)/onboard-start')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={header}
          ListEmptyComponent={<Card><Text style={styles.meta}>{t('amb.farmers.tabEmpty')}</Text></Card>}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.cardRow}>
                <View style={styles.avatar}><Text style={styles.avatarTxt}>{personInitials(item.code)}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{t('amb.home.referralAnon', { code: item.code })}</Text>
                  {item.createdAt ? <Text style={styles.meta}>{t('amb.farmers.joined', { date: safeDate(item.createdAt, lang) })}</Text> : null}
                </View>
                <StatusPill label={t(`amb.referral.status.${item.status}`, { defaultValue: item.status })} tone={referralStatusTone(item.status)} />
              </View>
            </Card>
          )}
          contentContainerStyle={{ paddingBottom: space[6] }}
        />
      )}
    </ScreenScaffold>
  );
}

function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return iso; } }

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[3] },
  chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  chipTxtOn: { color: color.primary700 },
  card: { marginBottom: space[2] },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.earth700 },
  name: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  meta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2 },
});
