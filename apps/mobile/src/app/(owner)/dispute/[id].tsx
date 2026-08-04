// apps/mobile/src/app/(owner)/dispute/[id].tsx · screen 156 (Dispute Detail + moderation actions). Thin screen
// (guide §3): the dispute header (ref, category, urgency, filed/SLA), the parties, the complaint, the evidence
// conversation thread, the proposed resolution, and the moderator actions allowed for the status (review →
// escalate/resolve) via the PURE disputeActions. Resolve picks a type (+ a partial-refund amount ₹→paise via
// BigInt, Law 2) built by PURE buildResolution. Every action needs dispute.resolve — authorized SERVER-SIDE;
// refunds/reversals move money SERVER-SIDE (the app never does — Law 11). Behind `tenant_admin_lite`. Degrade.
//
// §13 (NOT faked): ref, status, description, reasonId, createdAt, slaDueAt, orderId, raisedBy/againstUser,
// resolutionType/resolutionAmountMinor are REAL Dispute fields; the conversation is the REAL messages thread
// (author id → role via disputeMessageRole). The mockup's party NAMES + rich stats ("Mehta Trading Co.",
// "Vadodara · GST verified · 187 orders", "⭐4.9"), the "₹14,400 in escrow" line, the buyer/seller "To seller
// ₹12,200" split, the separate "Seller response" block, per-message attachment thumbnails and "Both parties
// agreed · No rating impact" are NOT on the contract — parties are user IDs (no display-name/stats read), there's
// no in-escrow amount and no per-party settlement split on the dispute. So we degrade: masked party refs with
// COMPLAINANT/RESPONDENT role (which we DO know), the proposed refund via MoneyText only when the server set it,
// and we omit escrow/split/attachments. "Urgent" is DERIVED from real slaDueAt. Money is bigint minor (Law 2).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { Dispute, DisputeMessage } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { Button, Card, Input, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getDispute, disputeMessages, reviewDispute, escalateDispute, resolveDispute } from '../../../features/tenant/tenant.api';
import { disputeStatusTone, disputeActions, RESOLUTION_OPTIONS, buildResolution, isDisputeUrgent, daysAgo, disputeMessageRole } from '../../../features/tenant/tenant-admin';

const DT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };
const D_ONLY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

export default function DisputeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const enabled = useFlag('tenant_admin_lite');
  const [d, setD] = useState<Dispute | null>(null);
  const [msgs, setMsgs] = useState<DisputeMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resType, setResType] = useState('');
  const [rupees, setRupees] = useState('');
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [disp, thread] = await Promise.all([getDispute(id), disputeMessages(id)]);
    setD(disp); setMsgs(thread); setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('owner.dispute.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(undefined);
    try { await fn(); await load(); }
    catch (e) {
      const msg = e instanceof SdkError && e.isForbidden ? t('owner.notAllowed') : e instanceof SdkError && (e.status === 409 || e.status === 422) ? t('owner.dispute.illegal') : t('owner.dispute.failed');
      Alert.alert(t('owner.dispute.title'), msg);
    } finally { setBusy(false); }
  };

  const onResolve = () => {
    if (!id) return;
    const r = buildResolution(resType, rupees);
    if (!r.ok) { setError(t(r.reason === 'amount' ? 'owner.dispute.amountInvalid' : 'owner.dispute.pickType')); return; }
    run(() => resolveDispute(id, r.body!));
  };

  const actions = d ? disputeActions(d.status) : [];
  const filedDays = d ? daysAgo(d.createdAt) : null;

  return (
    <ScreenScaffold title={t('owner.dispute.title')} scroll>
      {loading ? <View style={{ gap: space[3] }}><SkeletonCard lines={4} /><SkeletonCard lines={3} /></View> : !d ? (
        <EmptyState title={t('owner.dispute.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <View style={{ gap: space[3] }}>
          {/* Header */}
          <Card>
            <View style={styles.row}>
              <Text style={styles.no}>{t('owner.dispute.ref', { id: d.id.slice(0, 8).toUpperCase() })}</Text>
              <View style={styles.pills}>
                {isDisputeUrgent(d.slaDueAt, d.status) ? <StatusPill label={t('owner.disputes.urgent')} tone="danger" /> : null}
                <StatusPill label={t(`owner.disputeStatus.${d.status}`, { defaultValue: d.status })} tone={disputeStatusTone(d.status)} />
              </View>
            </View>
            <Text style={styles.category}>{t(`owner.disputeReason.${d.reasonId ?? 'none'}`, { defaultValue: t('owner.disputes.genericCategory') })}</Text>
            {d.slaDueAt || d.createdAt ? (
              <Text style={styles.meta}>
                {d.slaDueAt ? t('owner.dispute.dueOn', { date: formatDate(d.slaDueAt, lang, D_ONLY) }) : ''}
                {d.slaDueAt && filedDays !== null ? ' · ' : ''}
                {filedDays !== null ? t('owner.dispute.filedOn', { date: formatDate(d.createdAt!, lang, D_ONLY) }) : ''}
              </Text>
            ) : null}
          </Card>

          {/* Parties */}
          <View>
            <Text style={styles.section}>{t('owner.dispute.parties')}</Text>
            <PartyRow role="complainant" idRef={d.raisedBy} t={t} />
            {d.againstUser ? <PartyRow role="respondent" idRef={d.againstUser} t={t} /> : null}
          </View>

          {/* The complaint */}
          {d.description ? (
            <Card>
              <Text style={styles.section}>{t('owner.dispute.complaint')}</Text>
              <Text style={styles.quote}>“{d.description}”</Text>
            </Card>
          ) : null}

          {/* Conversation */}
          {msgs.length > 0 ? (
            <View>
              <Text style={styles.section}>{t('owner.dispute.conversation')}</Text>
              <View style={{ gap: space[2] }}>
                {msgs.map((m) => (
                  <Card key={m.id}>
                    <Text style={styles.msgHead}>
                      {t(`owner.dispute.role.${disputeMessageRole(m.authorUserId, d)}`)}{m.createdAt ? ` · ${formatDate(m.createdAt, lang, DT)}` : ''}
                    </Text>
                    <Text style={styles.msgBody}>{m.body}</Text>
                  </Card>
                ))}
              </View>
            </View>
          ) : null}

          {/* Proposed / applied resolution (server-set) */}
          {d.resolutionType ? (
            <Card>
              <Text style={styles.section}>{t('owner.dispute.proposedResolution')}</Text>
              <View style={styles.row}>
                <Text style={styles.k}>{t(`owner.resolution.${d.resolutionType}`, { defaultValue: d.resolutionType })}</Text>
                {d.resolutionAmountMinor ? <MoneyText minor={d.resolutionAmountMinor} langCode={lang} size="md" /> : null}
              </View>
            </Card>
          ) : null}

          {/* Moderator actions */}
          {actions.includes('review') ? <Button title={t('owner.dispute.review')} loading={busy} disabled={busy} onPress={() => run(() => reviewDispute(id!))} /> : null}
          {actions.includes('escalate') ? <Button title={t('owner.dispute.escalate')} variant="outline" loading={busy} disabled={busy} onPress={() => run(() => escalateDispute(id!))} /> : null}

          {actions.includes('resolve') ? (
            <Card>
              <Text style={styles.section}>{t('owner.dispute.resolveTitle')}</Text>
              <View style={styles.chips}>
                {RESOLUTION_OPTIONS.map((o) => {
                  const on = resType === o;
                  return (
                    <Pressable key={o} onPress={() => setResType(o)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(`owner.resolution.${o}`)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {resType === 'refund_partial' ? <View style={{ marginTop: space[3] }}><Input label={t('owner.dispute.amount')} value={rupees} onChangeText={setRupees} keyboardType="number-pad" maxLength={9} error={error} /></View> : (error ? <Text style={styles.err}>{error}</Text> : null)}
              <View style={{ marginTop: space[3] }}><Button title={t('owner.dispute.approveResolution')} loading={busy} disabled={busy || !resType} onPress={onResolve} /></View>
            </Card>
          ) : null}

          {actions.length === 0 ? <Text style={styles.note}>{t('owner.dispute.terminal')}</Text> : null}
        </View>
      )}
    </ScreenScaffold>
  );
}

function PartyRow({ role, idRef, t }: { role: 'complainant' | 'respondent'; idRef: string; t: (k: string, v?: Record<string, string>) => string }) {
  return (
    <Card style={{ marginBottom: space[2] }}>
      <View style={styles.row}>
        <Text style={styles.partyRef}>{t('owner.dispute.userRef', { id: (idRef ?? '').slice(0, 8).toUpperCase() })}</Text>
        <StatusPill label={t(`owner.dispute.role.${role}`)} tone={role === 'complainant' ? 'accent' : 'neutral'} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  pills: { flexDirection: 'row', gap: space[1], flexShrink: 0 },
  no: { flex: 1, fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  category: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600, marginTop: space[2] },
  meta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginBottom: space[2] },
  quote: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700, fontStyle: 'italic' },
  partyRef: { flex: 1, fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  msgHead: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink500 },
  msgBody: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, marginTop: space[1] },
  k: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { paddingHorizontal: space[4], minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  chipTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
  err: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[2] },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400 },
});
