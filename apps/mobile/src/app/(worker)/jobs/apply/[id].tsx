// apps/mobile/src/app/(worker)/jobs/apply/[id].tsx · screen 140 (Apply for Job — worker). Thin screen (guide §3):
// confirm the open booking, add an optional note, and self-apply via labour.applyToJob (→ applyToBooking, idempotent
// Law 3). The SERVER re-checks eligibility (18+/window/pool) — a 409 = already applied, 403 = not allowed → precise
// message. Behind `worker_app`. Money bigint paise via MoneyText (Law 2). Degrade-never-die.
//
// §13 — REAL: task (skill via lookups), start date, daily wage (paise), and the worker's own ⭐rating + jobs-done
// that are auto-shared. HONESTLY degraded (NEVER faked — no field on the booking/apply contract): the employer
// NAME → anonymised (worker view is PII-minimised); the exact TIME-WINDOW ("7 AM–3 PM"), DURATION hours, LOCATION
// name + DISTANCE ("Anand · 5 km"), and PERKS ("+ lunch / chai") → "—"; the note has no apply field yet → captured
// locally + flagged (not sent). The escrow lock copy is fixed program info (static i18n).
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SdkError, type LabourBooking, type LabourLookups, type WorkerProfile } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../../core/i18n/useTranslation';
import { useFlag } from '../../../../core/flags/useFlag';
import { getJob, labourLookups, getMyWorker, workerRating, applyToJob } from '../../../../features/labour/labour.api';
import { skillLabel, taskEmoji } from '../../../../features/labour/worker-home';
import { normalizeApplyNote, canApply } from '../../../../features/labour/apply-job';

export default function ApplyForJob() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('worker_app');
  const [job, setJob] = useState<LabourBooking | null>(null);
  const [lookups, setLookups] = useState<LabourLookups | null>(null);
  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [rating, setRating] = useState<{ averageStars: number; count: number } | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const w = await getMyWorker();
    const [j, lk, r] = await Promise.all([getJob(id), labourLookups(), w ? workerRating(w.userId) : Promise.resolve(null)]);
    setJob(j); setLookups(lk); setWorker(w); setRating(r); setLoading(false);
  }, [id]);
  useCallbackEffect(enabled, load);

  if (!enabled) return <ScreenScaffold title={t('workerApply.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const apply = async () => {
    if (!id) return;
    setBusy(true);
    try {
      // note is captured for a future contract; not sent yet (§13) — the apply itself is idempotent.
      normalizeApplyNote(note);
      await applyToJob(id);
      router.replace({ pathname: '/(worker)/jobs', params: { notice: t('worker.jobDetail.applied') } });
    } catch (e) {
      const msg = e instanceof SdkError && e.isConflict ? t('worker.jobDetail.alreadyApplied')
        : e instanceof SdkError && e.isForbidden ? t('worker.cannotAccept') : t('common.error.generic');
      Alert.alert(t('worker.jobDetail.applyFailed'), msg);
    } finally { setBusy(false); }
  };

  const skill = job ? skillLabel(job, lookups) : null;
  const eligible = canApply(job?.status);
  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('common.cancel')} variant="outline" disabled={busy} onPress={() => router.back()} />
      <View style={{ flex: 1 }}><Button title={t('workerApply.apply')} onPress={apply} loading={busy} disabled={busy || !job || !eligible} fullWidth /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('workerApply.title')} scroll={false} footer={footer}>
      {loading ? <SkeletonCard lines={10} /> : !job ? (
        <EmptyState title={t('worker.jobDetail.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[4], gap: space[3] }}>
          {/* Job summary */}
          <Card>
            <Text style={styles.jobTitle}>{taskEmoji(skill)} {skill ?? t('worker.home.genericTask')} · {t('workerApply.employerAnon', { id: job.employerUserId.slice(0, 6).toUpperCase() })}</Text>
            <Text style={styles.jobMeta}>{safeDate(job.startDate, lang)}</Text>
            <MoneyText minor={job.wageOfferedMinor} currencyCode={job.currencyCode} langCode={lang} size="lg" tone="positive" />
          </Card>

          {/* Optional note (captured locally; no apply field yet → flagged) */}
          <Card>
            <Text style={styles.section}>{t('workerApply.note')}</Text>
            <Input value={note} onChangeText={setNote} placeholder={t('workerApply.notePlaceholder')} multiline maxLength={300} />
            <Text style={styles.share}>
              {rating?.averageStars != null
                ? t('workerApply.shareRated', { stars: rating.averageStars.toFixed(1), n: worker?.bookingsCompleted ?? 0 })
                : t('workerApply.sharePlain')}
            </Text>
          </Card>

          {/* Confirm details — real where the contract has it, "—" where it doesn't (never faked) */}
          <Card>
            <Text style={styles.section}>{t('workerApply.confirm')}</Text>
            <Row k={t('workerApply.dateTime')} v={safeDate(job.startDate, lang)} />
            <Row k={t('workerApply.duration')} v={t('common.dash')} />
            <Row k={t('workerApply.location')} v={t('common.dash')} />
            <Row k={t('workerApply.provided')} v={t('common.dash')} />
            <View style={styles.row}>
              <Text style={styles.k}>{t('workerApply.wage')}</Text>
              <MoneyText minor={job.wageOfferedMinor} currencyCode={job.currencyCode} langCode={lang} size="md" />
            </View>
          </Card>

          {/* Escrow lock — fixed program info */}
          <View style={styles.escrow}>
            <Text style={styles.escrowIcon}>🔒</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.escrowTitle}>{t('workerApply.escrowTitle')}</Text>
              <Text style={styles.escrowBody}>{t('workerApply.escrowBody')}</Text>
            </View>
          </View>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

// small local hook to keep the effect tidy (focus not required — this is a pushed confirm screen)
function useCallbackEffect(enabled: boolean, load: () => void) {
  React.useEffect(() => { if (enabled) load(); }, [enabled, load]);
}

function Row({ k, v }: { k: string; v: string }) {
  return <View style={styles.row}><Text style={styles.k}>{k}</Text><Text style={styles.v} numberOfLines={1}>{v}</Text></View>;
}
function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return iso; } }

const styles = StyleSheet.create({
  jobTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  jobMeta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2, marginBottom: space[2] },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink700, marginBottom: space[2] },
  share: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.ink100, gap: space[3] },
  k: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500 },
  v: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, flexShrink: 1, textAlign: 'right' },
  escrow: { flexDirection: 'row', gap: space[3], backgroundColor: color.primary50, borderRadius: radius.lg, padding: space[3] },
  escrowIcon: { fontSize: 22 },
  escrowTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.primary800 },
  escrowBody: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, marginTop: 2, lineHeight: font.size.xs * 1.5 },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
