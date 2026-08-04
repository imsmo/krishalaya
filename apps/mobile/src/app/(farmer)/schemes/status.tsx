// apps/mobile/src/app/(farmer)/schemes/status.tsx · screen 107 "Application Status". Thin screen (guide §3): a
// status banner (icon + label + scheme name + govt ref), a milestone PROGRESS timeline whose step states are
// derived from the server-owned application status (PURE applicationTimeline), the observed DBT credits (bigint
// paise via MoneyText, Law 2), resubmit/appeal when allowed (server re-checks), and a static help/FAQ block.
// Behind `schemes_govt`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • "Estimated approval: 15-20 days" + the per-step intermediate timestamps ("verified 11:44", "assigned 16 Aug")
//    have no contract → we show only the REAL submittedAt / decidedAt / DBT dates; other steps show their state
//    (done/active/pending) with no invented time.
//  • The village-officer card (name / Talati / circle / Call) has no officer-assignment contract → a coming-soon
//    note, never a fabricated officer.
//  • The destination bank ("SBI ••••2247") isn't on the DBT contract → omitted; the credited amount/date are real.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { SchemeApplication, DbtTransfer, Scheme } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getApplication, getScheme, dbtTransfers, resubmitApplication, appealApplication } from '../../../features/schemes/schemes.api';
import { canResubmit, canAppeal, applicationTimeline } from '../../../features/schemes/schemes';

const FAQS = ['officerDelay', 'cancel', 'source'] as const;
function statusIcon(status: string): string {
  if (status === 'approved' || status === 'disbursed') return '✅';
  if (status === 'rejected') return '⛔';
  if (status === 'clarification_needed') return '⚠️';
  return '⏳';
}

export default function SchemeStatus() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('schemes_govt');
  const [app, setApp] = useState<SchemeApplication | null>(null);
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [dbt, setDbt] = useState<DbtTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    setLoading(true);
    const [a, d] = await Promise.all([getApplication(id), dbtTransfers(id)]);
    setApp(a); setDbt(d);
    setScheme(a ? await getScheme(a.schemeId) : null);
    setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('schemes.status.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const act = async (fn: (id: string) => Promise<unknown>) => {
    if (!app) return;
    setBusy(true);
    try { await fn(app.id); await load(); }
    catch { Alert.alert(t('schemes.status.title'), t('common.error.generic')); }
    finally { setBusy(false); }
  };

  const firstDbt = dbt[0];

  return (
    <ScreenScaffold title={t('schemes.status.title')}>
      {loading ? <SkeletonCard lines={6} /> : !app ? (
        <EmptyState title={t('schemes.status.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <>
          {/* Status banner */}
          <View style={styles.banner}>
            <Text style={styles.bannerIcon}>{statusIcon(app.status)}</Text>
            <Text style={styles.bannerStatus}>{t(`schemes.statusLabel.${app.status}`, { defaultValue: app.status })}</Text>
            {scheme ? <Text style={styles.bannerScheme}>{scheme.name}</Text> : null}
            <Text style={styles.bannerRef}>{t('schemes.status.ref')} · {app.govtAppRef ?? app.id}</Text>
            <Text style={styles.bannerEta}>{t('schemes.status.etaSoon')}</Text>
          </View>

          {/* Progress timeline (real timestamps where known; states derived from status) */}
          <Card style={styles.section}>
            <Text style={styles.h}>{t('schemes.status.progressTitle')}</Text>
            {applicationTimeline(app.status).map((s, i, arr) => {
              const time = s.key === 'submitted' && app.submittedAt ? safeDate(app.submittedAt, lang)
                : s.key === 'stateApproval' && app.decidedAt ? safeDate(app.decidedAt, lang)
                : s.key === 'payment' && firstDbt?.creditedOn ? safeDate(firstDbt.creditedOn, lang)
                : null;
              return (
                <View key={s.key} style={styles.tlRow}>
                  <View style={styles.tlGutter}>
                    <View style={[styles.dot, s.state === 'done' ? styles.dotDone : s.state === 'active' ? styles.dotActive : styles.dotPending]}>
                      <Text style={styles.dotTxt}>{s.state === 'done' ? '✓' : i + 1}</Text>
                    </View>
                    {i < arr.length - 1 ? <View style={styles.tlLine} /> : null}
                  </View>
                  <View style={styles.tlBody}>
                    <Text style={styles.tlTitle}>{t(`schemes.status.step.${s.key}`)}</Text>
                    <Text style={[styles.tlState, s.state === 'active' && styles.tlStateActive]}>{t(`schemes.status.stepState.${s.state}`)}{time ? ` · ${time}` : ''}</Text>
                    {s.key === 'payment' && firstDbt ? <View style={styles.payAmt}><MoneyText minor={firstDbt.amountMinor} langCode={lang} size="sm" /></View> : null}
                  </View>
                </View>
              );
            })}
            {app.status === 'rejected' && app.rejectionReason ? <Text style={styles.reason}>{app.rejectionReason}</Text> : null}
          </Card>

          {/* DBT credits (real) */}
          {dbt.length > 0 ? (
            <Card style={styles.section}>
              <Text style={styles.h}>{t('schemes.status.dbt')}</Text>
              {dbt.map((d) => (
                <View key={d.id} style={styles.row}>
                  <Text style={styles.k}>{d.creditedOn ? safeDate(d.creditedOn, lang) : (d.pfmsRef ?? d.id.slice(0, 8))}</Text>
                  <MoneyText minor={d.amountMinor} langCode={lang} size="md" />
                </View>
              ))}
            </Card>
          ) : null}

          {/* Village officer — §13: no officer-assignment contract */}
          <Card style={styles.section}>
            <Text style={styles.h}>{t('schemes.status.officerTitle')}</Text>
            <Text style={styles.note}>{t('schemes.status.officerSoon')}</Text>
          </Card>

          {/* Help & FAQs → assistant */}
          <Card style={styles.section}>
            <Text style={styles.h}>{t('schemes.status.faqTitle')}</Text>
            {FAQS.map((f) => (
              <Pressable key={f} onPress={() => router.push('/(farmer)/assistant')} accessibilityRole="button" style={styles.faqRow}>
                <Text style={styles.faqQ}>{t(`schemes.status.faq.${f}`)}</Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </Card>

          <View style={styles.actions}>
            <Button title={t('schemes.docs.view')} variant="outline" onPress={() => router.push({ pathname: '/(farmer)/schemes/docs', params: { id: app.id } })} />
            {canResubmit(app.status) ? <Button title={t('schemes.status.resubmit')} loading={busy} onPress={() => act(resubmitApplication)} /> : null}
            {canAppeal(app.status) ? <Button title={t('schemes.status.appeal')} variant="outline" loading={busy} onPress={() => act(appealApplication)} /> : null}
          </View>
        </>
      )}
    </ScreenScaffold>
  );
}

function safeDate(value: string, langCode: string): string { try { return formatDate(value, langCode); } catch { return value; } }

const styles = StyleSheet.create({
  banner: { backgroundColor: color.primary50, borderRadius: radius.lg, padding: space[4], alignItems: 'center' },
  bannerIcon: { fontSize: 34 },
  bannerStatus: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900, marginTop: space[1] },
  bannerScheme: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, marginTop: space[1], textAlign: 'center' },
  bannerRef: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  bannerEta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[1] },

  section: { marginTop: space[3] },
  h: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink900, marginBottom: space[2] },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400 },

  tlRow: { flexDirection: 'row', gap: space[3] },
  tlGutter: { alignItems: 'center', width: 28 },
  dot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: color.primary600 },
  dotActive: { backgroundColor: color.warning },
  dotPending: { backgroundColor: color.ink200 },
  dotTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.white },
  tlLine: { flex: 1, width: 2, backgroundColor: color.ink100, marginVertical: 2 },
  tlBody: { flex: 1, paddingBottom: space[3] },
  tlTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  tlState: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  tlStateActive: { color: color.warning, fontWeight: font.weight.semibold },
  payAmt: { marginTop: space[1] },
  reason: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[2] },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[1] },
  k: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500, flex: 1 },

  faqRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, borderTopWidth: 1, borderTopColor: color.ink100 },
  faqQ: { flex: 1, fontFamily: font.body, fontSize: font.size.md, color: color.ink700 },
  chevron: { fontFamily: font.body, fontSize: font.size.lg, color: color.ink400 },

  actions: { marginTop: space[4], gap: space[3] },
});
