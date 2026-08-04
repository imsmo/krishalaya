// apps/mobile/src/app/(worker)/documents.tsx · screen 139 (My Documents — worker). Thin screen (guide §3): the
// worker's KYC identity docs + banking, joined to the REAL doc-type catalogue. FLAG_SECURE (KYC/bank on screen,
// §4). Behind `worker_app`. Degrade-never-die.
//
// §13 — REAL: the identity checklist (kycDocTypes ⋈ listKyc: name + masked value + status), the linked bank
// (bankLabel + last4) and UPI, and the computed "N of M" completion. HONESTLY degraded (NEVER faked): the doc
// verification flow to ADD/APPLY a document has no worker form yet → the Add/Apply CTAs open an honest "coming
// soon" note (never a dead button or a faked verification); the PAN "> ₹50K" note, photo "matched with Aadhaar"
// and Skill-India cert are fixed program copy (static i18n). Raw doc numbers are NEVER shown — masked only.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { KycDocument, KycDocType, BankAccount } from '@krishalaya/sdk-js';
import { Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius, type PillTone } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useSecureScreen } from '../../core/security/screen-guard';
import { myDocuments, kycDocTypes } from '../../features/kyc/kyc.api';
import { myBankAccounts } from '../../features/profile/profile.api';
import { bankLabel } from '../../features/profile/profile';
import { checklistRows, bankAccount, upiAccount, documentsProgress, type DocRow } from '../../features/labour/worker-documents';

const KYC_TONE: Record<string, PillTone> = { verified: 'success', pending: 'warning', rejected: 'danger', expired: 'danger' };
function docEmoji(code: string): string {
  if (/aadhaar|aadhar/.test(code)) return '🪪';
  if (/pan/.test(code)) return '📇';
  if (/photo|selfie/.test(code)) return '📷';
  return '🗂';
}

export default function WorkerDocuments() {
  useSecureScreen();
  const { t } = useTranslation();
  const enabled = useFlag('worker_app');
  const [docTypes, setDocTypes] = useState<KycDocType[]>([]);
  const [kyc, setKyc] = useState<KycDocument[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    const [dt, k, b] = await Promise.all([kycDocTypes(), myDocuments(), myBankAccounts()]);
    setDocTypes(dt); setKyc(k); setBanks(b);
    if (dt.length === 0) setFailed(true);
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) load(); }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('workerDocs.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const soon = () => Alert.alert(t('workerDocs.addTitle'), t('workerDocs.addSoon'));
  const rows = checklistRows(docTypes, kyc);
  const bank = bankAccount(banks);
  const upi = upiAccount(banks);
  const progress = documentsProgress(docTypes, kyc, banks);

  return (
    <ScreenScaffold title={t('workerDocs.title')} scroll={false}>
      {loading ? (
        <View style={{ gap: space[3] }}><SkeletonCard lines={3} /><SkeletonCard lines={4} /><SkeletonCard lines={3} /></View>
      ) : failed ? (
        <EmptyState title={t('workerDocs.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[8], gap: space[3] }}>
          {/* Progress header */}
          <Card>
            <View style={styles.head}>
              <Text style={styles.headEmoji}>🗂</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.progress}>{t('workerDocs.progress', { done: progress.done, total: progress.total })}</Text>
                <Text style={styles.perk}>{t('workerDocs.perk')}</Text>
              </View>
            </View>
          </Card>

          {/* Identity */}
          <View>
            <Text style={styles.section}>{t('workerDocs.identity')}</Text>
            <Card>
              {rows.map((r, i) => <DocLine key={r.typeId} row={r} last={i === rows.length - 1} onAdd={soon} t={t} />)}
              {rows.length === 0 ? <Text style={styles.note}>{t('workerDocs.noTypes')}</Text> : null}
            </Card>
          </View>

          {/* Banking */}
          <View>
            <Text style={styles.section}>{t('workerDocs.banking')}</Text>
            <Card>
              <Row icon="🏦" title={bank ? t('workerDocs.bankName', { name: bankLabel(bank) }) : t('workerDocs.bank')}
                sub={bank ? t('workerDocs.linked') : t('workerDocs.bankAdd')}
                pill={bank ? { label: t('workerDocs.linkedPill'), tone: 'success' } : undefined}
                action={bank ? undefined : { label: t('common.add'), onPress: soon }} />
              <Row icon="📱" title={upi ? (upi.upiId ?? t('workerDocs.upi')) : t('workerDocs.upi')}
                sub={t('workerDocs.upiSub')} last
                pill={upi ? { label: t('workerDocs.linkedPill'), tone: 'success' } : undefined}
                action={upi ? undefined : { label: t('common.add'), onPress: soon }} />
            </Card>
          </View>

          {/* Skill certificates (optional) — fixed program info */}
          <View>
            <Text style={styles.section}>{t('workerDocs.certs')}</Text>
            <Card>
              <Row icon="🎓" title={t('workerDocs.certName')} sub={t('workerDocs.certSub')} last
                action={{ label: t('workerDocs.apply'), onPress: soon }} />
            </Card>
          </View>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function DocLine({ row, last, onAdd, t }: { row: DocRow; last: boolean; onAdd: () => void; t: (k: string, v?: Record<string, unknown>) => string }) {
  const sub = row.present && row.docNoMasked ? row.docNoMasked : row.present ? t(`workerDocs.status.${row.status ?? 'pending'}`) : t('workerDocs.notAdded');
  return (
    <Row icon={docEmoji(row.code)} title={row.name} sub={sub} last={last}
      pill={row.present && row.status ? { label: t(`workerDocs.status.${row.status}`), tone: KYC_TONE[row.status] ?? 'neutral' } : undefined}
      action={row.present ? undefined : { label: t('common.add'), onPress: onAdd }} />
  );
}

function Row({ icon, title, sub, pill, action, last }: {
  icon: string; title: string; sub: string; last?: boolean;
  pill?: { label: string; tone: PillTone }; action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text>
      </View>
      {pill ? <StatusPill label={pill.label} tone={pill.tone} /> : null}
      {action ? <Pressable onPress={action.onPress} style={styles.addBtn} accessibilityRole="button"><Text style={styles.addTxt}>{action.label}</Text></Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  headEmoji: { fontSize: 32 },
  progress: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900 },
  perk: { fontFamily: font.body, fontSize: font.size.sm, color: color.primary700, marginTop: 2, fontWeight: font.weight.semibold },
  section: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600, marginBottom: space[2] },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: color.ink100 },
  rowIcon: { fontSize: 24, width: 30, textAlign: 'center' },
  rowTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  rowSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  addBtn: { paddingHorizontal: space[4], minHeight: 40, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.primary600 },
  addTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
});
