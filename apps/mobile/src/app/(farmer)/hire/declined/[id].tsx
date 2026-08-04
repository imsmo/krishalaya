// apps/mobile/src/app/(farmer)/hire/declined/[id].tsx · screen 49 (Booking Declined — farmer). Thin screen (guide
// §3): the status a farmer sees when a worker declines (a notification deep-link target). Reassures the money is
// safe, then surfaces REAL similar workers to re-book. Behind `labour_hire`. Degrade-never-die.
//
// §13 — REAL: the booking wage (MoneyText), the similar-workers pool (browseWorkers), and re-book navigation.
// HONESTLY degraded (no field → NEVER faked): the worker's NAME → anon; the decline QUOTE ("Sorry, I have a
// booking…") — no decline-reason field → omitted; the decline TIME → the assignment's relative time when present,
// else omitted; and the refund total ("₹412") isn't a computed labour figure — for a to-be-paid-on-completion
// booking nothing was charged, so we show the wage + a "your money is safe, no charge" note, never a fake refund.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { LabourBooking, LabourAssignment, WorkerProfile, LabourLookups } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatRelative } from '@krishalaya/i18n';
import { useTranslation } from '../../../../core/i18n/useTranslation';
import { useFlag } from '../../../../core/flags/useFlag';
import { getBooking, bookingAssignments, browseWorkers, labourLookups } from '../../../../features/labour/hire.api';
import { regionName } from '../../../../features/labour/worker-profile';
import { skillChips } from '../../../../features/labour/hire-browse';

export default function BookingDeclined() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('labour_hire');
  const [booking, setBooking] = useState<LabourBooking | null>(null);
  const [assignments, setAssignments] = useState<LabourAssignment[]>([]);
  const [similar, setSimilar] = useState<WorkerProfile[]>([]);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    const [b, a, pool, lk] = await Promise.all([getBooking(id), bookingAssignments(id), browseWorkers({}), labourLookups()]);
    setBooking(b); setAssignments(a); setSimilar(pool.items); setLookups(lk); setFailed(!b); setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('hireDeclined.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const declined = assignments.find((a) => a.status === 'rejected' || a.status === 'expired') ?? assignments[0] ?? null;
  const declinedWorkerId = declined?.workerId;
  const worker = declinedWorkerId ? t('bookWorker.workerAnon', { id: declinedWorkerId.slice(0, 6).toUpperCase() }) : t('bookTask.aWorker');
  const ccy = booking?.currencyCode ?? 'INR';
  const others = similar.filter((w) => w.id !== declinedWorkerId).slice(0, 3);

  return (
    <ScreenScaffold title={t('hireDeclined.title')}>
      {loading ? <SkeletonCard lines={10} /> : !booking || failed ? (
        <EmptyState title={t('hireAccepted.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[3] }}>
          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.badge}><Text style={styles.badgeTxt}>{t('hireDeclined.declined')}</Text></View>
            <Text style={styles.h1}>{t('hireDeclined.heading', { name: worker })}</Text>
            <Text style={styles.reassure}>{t('hireDeclined.moneySafe')}</Text>
          </View>

          {/* Worker + decline time */}
          <Card>
            <View style={styles.workerRow}>
              <View style={styles.avatar}><Text style={{ fontSize: 18 }}>👤</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.workerName}>{worker}</Text>
                {declined?.createdAt ? <Text style={styles.workerMeta}>{t('hireDeclined.declinedAt', { when: safeRel(declined.createdAt, lang) })}</Text> : null}
              </View>
            </View>
          </Card>

          {/* Money safe */}
          <Card>
            <Text style={styles.h3}>{t('hireDeclined.noCharge')}</Text>
            <View style={styles.moneyRow}>
              <Text style={styles.moneyLabel}>{t('hireDeclined.wage')}</Text>
              <MoneyText minor={booking.wageOfferedMinor} currencyCode={ccy} langCode={lang} size="md" />
            </View>
            <Text style={styles.note}>{t('hireDeclined.noChargeNote')}</Text>
          </Card>

          {/* Similar workers */}
          <Text style={styles.section}>{t('hireDeclined.similar')}</Text>
          {others.length === 0 ? (
            <EmptyState title={t('hireDeclined.noneTitle')} message={t('hireDeclined.noneMsg')} />
          ) : others.map((w) => {
            const chips = skillChips(w.skillIds, lookups, 1);
            const region = regionName(lookups?.regions ?? [], w.villageRegionId);
            return (
              <Pressable key={w.id} onPress={() => router.push({ pathname: '/(farmer)/hire/worker/[id]', params: { id: w.id } })} style={styles.wCard} accessibilityRole="button">
                <View style={styles.wAvatar}><Text style={{ fontSize: 16 }}>👤</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.wName} numberOfLines={1}>{t('bookWorker.workerAnon', { id: w.id.slice(0, 6).toUpperCase() })}{w.ratingAvg != null ? ` · ⭐ ${w.ratingAvg.toFixed(1)}` : ''}</Text>
                  <Text style={styles.wMeta} numberOfLines={1}>{[chips.labels[0], region, t('hire.browse.jobsCount', { n: w.bookingsCompleted ?? 0 })].filter(Boolean).join(' · ')}</Text>
                </View>
                {w.minWageExpectationMinor ? <MoneyText minor={w.minWageExpectationMinor} currencyCode="INR" langCode={lang} size="sm" tone="positive" /> : null}
              </Pressable>
            );
          })}

          <View style={{ gap: space[3], marginTop: space[2] }}>
            <Button title={t('hireDeclined.seeAll')} onPress={() => router.replace('/(farmer)/hire/workers')} />
            <Button title={t('hireDeclined.pickDate')} variant="outline" onPress={() => router.replace({ pathname: '/(farmer)/hire/book/when', params: { ...(booking.taskSkillId ? { taskSkillId: booking.taskSkillId } : {}) } })} />
          </View>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function safeRel(iso: string, langCode: string): string { try { return formatRelative(iso, langCode); } catch { return ''; } }

const styles = StyleSheet.create({
  hero: { alignItems: 'center', padding: space[4], borderRadius: radius.lg, backgroundColor: color.earth100 },
  badge: { paddingHorizontal: space[3], paddingVertical: 4, borderRadius: radius.pill, backgroundColor: color.ink200 },
  badgeTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink700, letterSpacing: 0.5 },
  h1: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[3], textAlign: 'center' },
  reassure: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[2], textAlign: 'center', lineHeight: font.size.sm * 1.5 },
  workerRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, alignItems: 'center', justifyContent: 'center' },
  workerName: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  workerMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  moneyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moneyLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.successDark, marginTop: space[2], lineHeight: font.size.xs * 1.5 },
  section: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[2] },
  wCard: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.lg, padding: space[3] },
  wAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  wName: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  wMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
});
