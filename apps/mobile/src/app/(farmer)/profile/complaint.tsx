// apps/mobile/src/app/(farmer)/profile/complaint.tsx · screen 124 "Report a Problem". Thin screen (guide §3): pick
// an issue type (drives the default severity → the server's SLA clock), optionally tie it to an order (real recent
// orders as chips), describe what happened, then open a support ticket (idempotent — Law 3). The ticket contract is
// only {subject, categoryId, severity} — there is no body/attachment/contact field — so the issue + order ref +
// description are folded into a single subject (composeReportSubject) and the chosen severity drives the SLA. Behind
// `farmer_profile`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • The design's pre-filled story ("Buyer Anand Stores … ₹2,880/qtl … pending since Aug 13") is sample copy → the
//    description starts EMPTY; we never seed fabricated buyer/amount/date text.
//  • "📎 Attach photo / 🎤 Voice note" — the ticket contract carries no media attachment → shown as coming-soon
//    affordances, never a control that silently drops the file.
//  • "How to contact you? · +91 98765 12340 · ramesh@example.com" — there is no contact-preference field on the
//    ticket, and we never fabricate a phone/email → a coming-soon note that support replies in-app, no fake PII.
//  • "Recent: #KV-2026-0247 …" — real recent orders are loaded from the orders API (seller role); if none, the chips
//    simply don't render — never hardcoded order numbers.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import type { OrderListItem } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { sdkErrorMessage } from '../../../core/errors/sdk-error-message';
import { openTicket } from '../../../features/profile/profile.api';
import { listOrders } from '../../../features/orders/orders.api';
import { REPORT_ISSUES, reportIssueSeverity, composeReportSubject, buildTicketDraft, type ReportIssueKey } from '../../../features/profile/profile';

const ISSUE_ICON: Record<ReportIssueKey, string> = {
  payment: '💰', pickup: '📦', quality: '⚖', rejected: '🚫', fraud: '⚠', app: '📱',
};

export default function Complaint() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('farmer_profile');
  const [issue, setIssue] = useState<ReportIssueKey>('payment');
  const [orderRef, setOrderRef] = useState('');
  const [description, setDescription] = useState('');
  const [recent, setRecent] = useState<OrderListItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    try { const r = await listOrders({ role: 'seller', limit: 5 }); setRecent(r.items); } catch { /* degrade: no chips */ }
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('profile.complaint.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const submit = async () => {
    const issueLabel = t(`profile.complaint.issue.${issue}`);
    const subject = composeReportSubject({ issueLabel, orderRef, description });
    const draft = buildTicketDraft({ subject, severity: reportIssueSeverity(issue) });
    if (!draft.ok || !draft.input) { setError(t('profile.complaint.needDetail')); return; }
    setSaving(true); setError(undefined);
    try { await openTicket(draft.input); router.replace('/(farmer)/profile/help'); }
    catch (e: unknown) {
      // KV-MF-02 convention (apps/mobile/src/app/(farmer)/listings/new.tsx): surface the API's own message
      // (e.g. a 404 "Not found" when a feature flag gating the ticket endpoint is off server-side) instead of
      // a generic string, so a real, diagnosable failure never looks identical to "just try again".
      Alert.alert(t('profile.complaint.title'), sdkErrorMessage(e) ?? t('profile.complaint.failed'));
    }
    finally { setSaving(false); }
  };

  return (
    <ScreenScaffold title={t('profile.complaint.title')}>
      <ScrollView contentContainerStyle={{ paddingBottom: space[8] }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Issue type */}
        <Text style={styles.h1}>{t('profile.complaint.whatIssue')}</Text>
        <View style={styles.grid}>
          {REPORT_ISSUES.map(({ key }) => {
            const on = issue === key;
            return (
              <Pressable key={key} onPress={() => setIssue(key)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.cat, on && styles.catOn]}>
                <Text style={styles.catIcon}>{ISSUE_ICON[key]}</Text>
                <Text style={styles.catLabel} numberOfLines={2}>{t(`profile.complaint.issue.${key}`)}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Which order */}
        <Text style={styles.h2}>{t('profile.complaint.whichOrder')}</Text>
        <Input label={t('profile.complaint.orderId')} value={orderRef} onChangeText={setOrderRef} autoCapitalize="characters" maxLength={40} placeholder="KV-2026-..." />
        {recent.length ? (
          <View style={styles.recent}>
            <Text style={styles.recentLabel}>{t('profile.complaint.recent')}</Text>
            <View style={styles.recentChips}>
              {recent.map((o) => (
                <Pressable key={o.id} onPress={() => setOrderRef(o.orderNo)} accessibilityRole="button" style={styles.recentChip}>
                  <Text style={styles.recentTxt}>#{o.orderNo}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* What happened */}
        <Text style={styles.h2}>{t('profile.complaint.whatHappened')}</Text>
        <Input label="" value={description} onChangeText={setDescription} multiline maxLength={1000} error={error} placeholder={t('profile.complaint.placeholder')} />
        <View style={styles.attachRow}>
          <View style={styles.attachChip}><Text style={styles.attachTxt}>📎 {t('profile.complaint.attachPhoto')}</Text></View>
          <View style={styles.attachChip}><Text style={styles.attachTxt}>🎤 {t('profile.complaint.voiceNote')}</Text></View>
        </View>
        <Text style={styles.attachSoon}>{t('profile.complaint.attachSoon')}</Text>

        {/* How to contact you — §13: no contact-pref field */}
        <Text style={styles.h2}>{t('profile.complaint.contactTitle')}</Text>
        <Card><Text style={styles.muted}>{t('profile.complaint.contactSoon')}</Text></Card>

        {/* Response-time info */}
        <View style={styles.info}><Text style={styles.infoTxt}>{t('profile.complaint.responseTime')}</Text></View>

        {/* CTA */}
        <View style={styles.cta}>
          <View style={{ flex: 1 }}><Button title={t('common.cancel')} variant="outline" onPress={() => router.back()} /></View>
          <View style={{ flex: 1.5 }}><Button title={t('profile.complaint.submit')} variant="danger" loading={saving} onPress={submit} /></View>
        </View>
      </ScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  h1: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[3] },
  h2: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  cat: { width: '48%', flexGrow: 1, alignItems: 'center', backgroundColor: color.card, borderWidth: 2, borderColor: color.ink100, borderRadius: radius.md, padding: space[3], minHeight: 84, justifyContent: 'center' },
  catOn: { borderColor: color.danger, backgroundColor: color.dangerLight },
  catIcon: { fontSize: 26, marginBottom: 4 },
  catLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink700, textAlign: 'center' },
  recent: { marginTop: space[2] },
  recentLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginBottom: space[1] },
  recentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  recentChip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.pill, backgroundColor: color.primary50 },
  recentTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.primary700 },
  attachRow: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
  attachChip: { paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.pill, backgroundColor: color.ink100 },
  attachTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink600 },
  attachSoon: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[2] },
  muted: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  info: { marginTop: space[4], padding: space[3], backgroundColor: color.infoLight, borderRadius: radius.md },
  infoTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.infoDark, lineHeight: 18 },
  cta: { flexDirection: 'row', gap: space[2], marginTop: space[5] },
});
