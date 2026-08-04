// apps/mobile/src/app/(worker)/offers/decline/[id].tsx · screen 142 (Decline Job — worker). Thin screen (guide §3):
// pick a decline reason + optional message, then reject the assignment via labour.respondOffer(id,'reject'). The
// SERVER is the authority (a late/again reject → 409). Behind `worker_app`. Money via MoneyText (Law 2).
// Degrade-never-die.
//
// §13 — REAL: task (skill via lookups), work date, and the wage. The decline REASON + free-text MESSAGE have no
// field on the respondAssignment contract, so they are captured + flagged (not sent) — never faked into a payload;
// the reject itself is real. The employer NAME is anonymised (worker view is PII-minimised); the message is not
// prefilled with a fabricated bio.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SdkError, type LabourAssignment, type LabourBooking, type LabourLookups } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../../core/i18n/useTranslation';
import { useFlag } from '../../../../core/flags/useFlag';
import { getOffer, getJob, respondOffer, labourLookups } from '../../../../features/labour/labour.api';
import { skillLabel, taskEmoji } from '../../../../features/labour/worker-home';
import { DECLINE_REASONS, normalizeDeclineMessage, canSendDecline, type DeclineReasonKey } from '../../../../features/labour/decline-job';

export default function DeclineJob() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_app');
  const [offer, setOffer] = useState<LabourAssignment | null>(null);
  const [booking, setBooking] = useState<LabourBooking | null>(null);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [reason, setReason] = useState<DeclineReasonKey | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const a = await getOffer(id); setOffer(a);
    const [lk, b] = await Promise.all([labourLookups(), a ? getJob(a.bookingId) : Promise.resolve(null)]);
    setLookups(lk); setBooking(b); setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('declineJob.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const send = async () => {
    if (!id) return;
    setBusy(true);
    try {
      // reason + message captured for a future contract; not sent yet (§13). The reject is idempotent server-side.
      normalizeDeclineMessage(message);
      await respondOffer(id, 'reject');
      router.replace({ pathname: '/(worker)/offers', params: { notice: t('worker.declined') } });
    } catch (e) {
      const msg = e instanceof SdkError && e.isConflict ? t('worker.windowExpired') : t('common.error.generic');
      Alert.alert(t('worker.respondFailed'), msg);
    } finally { setBusy(false); }
  };

  const skill = booking ? skillLabel(booking, lookups) : null;
  const ccy = booking?.currencyCode ?? 'INR';
  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('common.back')} variant="outline" disabled={busy} onPress={() => router.back()} />
      <View style={{ flex: 1 }}><Button title={t('declineJob.send')} variant="danger" onPress={send} loading={busy} disabled={busy || !canSendDecline(reason)} fullWidth /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('declineJob.title')} scroll={false} footer={footer}>
      {loading ? <SkeletonCard lines={8} /> : !offer ? (
        <EmptyState title={t('worker.offerUnavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[3] }}>
          {/* Job summary */}
          <Card>
            <Text style={styles.jobTitle}>{taskEmoji(skill)} {skill ?? t('worker.home.genericTask')} · {booking ? t('jobOffer.employerAnon', { id: booking.employerUserId.slice(0, 6).toUpperCase() }) : '—'}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.jobMeta}>{booking?.startDate ? safeDate(booking.startDate, lang) : '—'} · </Text>
              <MoneyText minor={offer.wageMinor ?? booking?.wageOfferedMinor ?? '0'} currencyCode={ccy} langCode={lang} size="sm" />
            </View>
          </Card>

          <Text style={styles.note}>{t('declineJob.noPenalty')}</Text>

          {/* Reasons */}
          <View>
            <Text style={styles.section}>{t('declineJob.why')}</Text>
            {DECLINE_REASONS.map((r) => {
              const on = reason === r.key;
              return (
                <Pressable key={r.key} onPress={() => setReason(r.key)} style={[styles.reason, on && styles.reasonOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                  <Text style={styles.reasonIcon}>{r.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.reasonTitle, on && styles.reasonTitleOn]}>{t(`declineJob.reason.${r.key}.title`)}</Text>
                    <Text style={styles.reasonSub}>{t(`declineJob.reason.${r.key}.sub`)}</Text>
                  </View>
                  {on ? <Text style={styles.tick}>✓</Text> : null}
                </Pressable>
              );
            })}
          </View>

          {/* Optional message */}
          <Card>
            <Text style={styles.section}>{t('declineJob.message')}</Text>
            <Input value={message} onChangeText={setMessage} placeholder={t('declineJob.messagePlaceholder')} multiline maxLength={300} />
          </Card>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return iso; } }

const styles = StyleSheet.create({
  jobTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: space[1] },
  jobMeta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, lineHeight: font.size.sm * 1.5 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink700, marginBottom: space[2] },
  reason: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card, marginBottom: space[2] },
  reasonOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  reasonIcon: { fontSize: 22, width: 30, textAlign: 'center' },
  reasonTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  reasonTitleOn: { color: color.primary800 },
  reasonSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  tick: { fontSize: 18, color: color.primary700, fontWeight: '700' },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
