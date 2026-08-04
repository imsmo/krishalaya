// apps/mobile/src/app/(worker)/dispute/[id].tsx · screen 143 (Report Wage Dispute — worker). Thin screen (guide §3):
// pick a dispute reason + describe it, then file it as a high-priority SUPPORT TICKET (support.openTicket,
// idempotent Law 3) — there is no labour-specific dispute endpoint yet. `id` may be an assignment id (resolved via
// getOffer → booking) or a booking id. Behind `worker_app`. Money via MoneyText (Law 2). Degrade-never-die.
//
// §13 — REAL: task (skill via lookups), work date, and the AGREED wage (booking). HONESTLY degraded (NEVER faked):
// the ticket carries only {subject, severity} — the detailed DESCRIPTION and photo/voice ATTACHMENTS have no field,
// so they are captured + flagged (not sent); the "RECEIVED" amount is the worker's claim, not a system value, so it
// is shown as "—" (never a fabricated ₹300); the employer NAME is anonymised.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SdkError, type LabourBooking, type LabourLookups } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getOffer, getJob, labourLookups } from '../../../features/labour/labour.api';
import { openTicket } from '../../../features/profile/profile.api';
import { skillLabel, taskEmoji } from '../../../features/labour/worker-home';
import { DISPUTE_REASONS, DISPUTE_SEVERITY, normalizeDisputeText, canSubmitDispute, type DisputeReasonKey } from '../../../features/labour/wage-dispute';

export default function WageDispute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_app');
  const [booking, setBooking] = useState<LabourBooking | null>(null);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [reason, setReason] = useState<DisputeReasonKey | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const lk = await labourLookups(); setLookups(lk);
    // id may be an assignment id (→ booking) or a booking id directly.
    const off = await getOffer(id);
    const b = off ? await getJob(off.bookingId) : await getJob(id);
    setBooking(b); setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('wageDispute.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const skill = booking ? skillLabel(booking, lookups) : null;
  const ccy = booking?.currencyCode ?? 'INR';

  const report = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      // description + attachments captured for a future contract; not sent (§13). We file a high-priority ticket.
      normalizeDisputeText(text);
      const reasonLabel = t(`wageDispute.reason.${reason}.title`);
      const subject = t('wageDispute.ticketSubject', { reason: reasonLabel, ref: booking?.bookingNo ?? '' });
      await openTicket({ subject, severity: DISPUTE_SEVERITY });
      Alert.alert(t('wageDispute.filedTitle'), t('wageDispute.filedBody'), [{ text: t('common.ok'), onPress: () => router.back() }]);
    } catch (e) {
      const msg = e instanceof SdkError && e.isForbidden ? t('hire.action.notAllowed') : t('common.error.generic');
      Alert.alert(t('wageDispute.failed'), msg);
    } finally { setBusy(false); }
  };

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('common.cancel')} variant="outline" disabled={busy} onPress={() => router.back()} />
      <View style={{ flex: 1 }}><Button title={t('wageDispute.report')} variant="danger" onPress={report} loading={busy} disabled={busy || !canSubmitDispute(reason, text)} fullWidth /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('wageDispute.title')} scroll={false} footer={footer}>
      {loading ? <SkeletonCard lines={9} /> : !booking ? (
        <EmptyState title={t('worker.jobDetail.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[3] }}>
          {/* Job summary + agreed/received wage */}
          <Card>
            <Text style={styles.jobTitle}>{taskEmoji(skill)} {skill ?? t('worker.home.genericTask')} · {t('jobOffer.employerAnon', { id: booking.employerUserId.slice(0, 6).toUpperCase() })}</Text>
            <Text style={styles.jobMeta}>{safeDate(booking.startDate, lang)}</Text>
            <View style={styles.wageRow}>
              <View style={styles.wageCell}>
                <Text style={styles.wageLbl}>{t('wageDispute.agreed')}</Text>
                <MoneyText minor={booking.wageOfferedMinor} currencyCode={ccy} langCode={lang} size="lg" />
              </View>
              <View style={styles.wageCell}>
                <Text style={styles.wageLbl}>{t('wageDispute.received')}</Text>
                <Text style={styles.received}>{t('common.dash')}</Text>
              </View>
            </View>
          </Card>

          {/* Reasons */}
          <View>
            <Text style={styles.section}>{t('wageDispute.what')}</Text>
            {DISPUTE_REASONS.map((r) => {
              const on = reason === r.key;
              return (
                <Pressable key={r.key} onPress={() => setReason(r.key)} style={[styles.reason, on && styles.reasonOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                  <Text style={styles.reasonIcon}>{r.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.reasonTitle, on && styles.reasonTitleOn]}>{t(`wageDispute.reason.${r.key}.title`)}</Text>
                    <Text style={styles.reasonSub}>{t(`wageDispute.reason.${r.key}.sub`)}</Text>
                  </View>
                  {on ? <Text style={styles.tick}>✓</Text> : null}
                </Pressable>
              );
            })}
          </View>

          {/* Description + attachments (captured, not sent → flagged) */}
          <Card>
            <Text style={styles.section}>{t('wageDispute.tell')}</Text>
            <Input value={text} onChangeText={setText} placeholder={t('wageDispute.tellPlaceholder')} multiline maxLength={1000} />
            <View style={styles.attachRow}>
              <Pressable onPress={() => Alert.alert(t('wageDispute.attach'), t('wageDispute.attachSoon'))} style={styles.attach} accessibilityRole="button"><Text style={styles.attachTxt}>📷 {t('wageDispute.photo')}</Text></Pressable>
              <Pressable onPress={() => Alert.alert(t('wageDispute.attach'), t('wageDispute.attachSoon'))} style={styles.attach} accessibilityRole="button"><Text style={styles.attachTxt}>🎤 {t('wageDispute.voice')}</Text></Pressable>
            </View>
          </Card>

          {/* Protection note — fixed program info */}
          <View style={styles.protect}>
            <Text style={styles.protectIcon}>🛡</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.protectTitle}>{t('wageDispute.protectTitle')}</Text>
              <Text style={styles.protectBody}>{t('wageDispute.protectBody')}</Text>
            </View>
          </View>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return iso; } }

const styles = StyleSheet.create({
  jobTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  jobMeta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2, marginBottom: space[2] },
  wageRow: { flexDirection: 'row', gap: space[3], marginTop: space[2], paddingTop: space[3], borderTopWidth: 1, borderTopColor: color.ink100 },
  wageCell: { flex: 1 },
  wageLbl: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginBottom: 2 },
  received: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink400 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink700, marginBottom: space[2] },
  reason: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card, marginBottom: space[2] },
  reasonOn: { borderColor: color.danger, backgroundColor: color.dangerLight },
  reasonIcon: { fontSize: 22, width: 30, textAlign: 'center' },
  reasonTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  reasonTitleOn: { color: color.dangerDark },
  reasonSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  tick: { fontSize: 18, color: color.dangerDark, fontWeight: '700' },
  attachRow: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
  attach: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1.5, borderColor: color.ink200 },
  attachTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700 },
  protect: { flexDirection: 'row', gap: space[3], backgroundColor: color.successLight, borderRadius: radius.lg, padding: space[3] },
  protectIcon: { fontSize: 22 },
  protectTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.successDark },
  protectBody: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, marginTop: 2, lineHeight: font.size.xs * 1.5 },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
