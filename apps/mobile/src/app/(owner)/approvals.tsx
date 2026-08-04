// apps/mobile/src/app/(owner)/approvals.tsx · screen 147 (Pending Approvals). Thin screen (guide §3): the tenant's
// REAL pending role assignments (farmers awaiting approval), KYC-status filter tabs with live counts, per-row
// approve (✓) / reject (✕), and a "Approve Verified (N)" bulk action. Every action is authorized + tenant-scoped
// SERVER-SIDE (NOT god-mode, Law 11); a 403 shows a friendly "not allowed". Behind `tenant_admin_lite`.
// Degrade-never-die (loading/empty/error).
//
// §13 (NOT faked): the queue + count = the REAL pending-assignments list; each row's KYC pill = the assignment's
// real kycStatus; ✓ = approveAssignment, ✕ = rejectAssignment (revoke), bulk = approve every KYC-verified item by
// the SAME per-item authorized action. What the mockup shows that has NO contract, so we DON'T fabricate it: the
// farmer NAME (RoleAssignment carries none → masked ref + ref-initials avatar), LOCATION, the SOURCE split
// ("By Vikas Joshi" / "Self-signup", and the Ambassador·9 / Self-signup·5 tabs — no source field exists, so we tab
// by the KYC status we CAN compute), the AGE ("2d"/"today" — no timestamp on the contract), and the PER-DOCUMENT
// chips (AADHAAR/BANK/LAND, "DUPLICATE?") — the contract carries a single kycStatus, not a per-doc breakdown, so we
// show that one real status and never invent per-document verdicts.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SdkError } from '@krishalaya/sdk-js';
import type { RoleAssignment } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, SegmentedControl, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { assignments, approveAssignment, rejectAssignment } from '../../features/tenant/tenant.api';
import { approvalStatusTone, approvalCounts, filterApprovals, verifiedApprovalIds, type ApprovalTab } from '../../features/tenant/tenant-admin';

const TABS: ApprovalTab[] = ['all', 'verified', 'pending'];
function refOf(id: string): string { return (id ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || '—'; }
function initialsOf(id: string): string { const r = refOf(id); return r === '—' ? '–' : r.slice(0, 2); }

export default function Approvals() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tenant_admin_lite');
  const [items, setItems] = useState<RoleAssignment[]>([]);
  const [tab, setTab] = useState<ApprovalTab>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try { setItems(await assignments({ pendingOnly: true })); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) load(); }, [enabled, load]));

  const counts = useMemo(() => approvalCounts(items), [items]);
  const shown = useMemo(() => filterApprovals(items, tab), [items, tab]);
  const tabOpts = useMemo(() => TABS.map((v) => ({ value: v, label: `${t(`owner.approvals.tab.${v}`)} · ${counts[v]}` })), [t, counts]);

  const act = useCallback(async (id: string, kind: 'approve' | 'reject') => {
    setBusyId(id);
    try {
      if (kind === 'approve') await approveAssignment(id); else await rejectAssignment(id);
      await load();
    } catch (e) {
      const msg = e instanceof SdkError && e.isForbidden ? t('owner.notAllowed') : e instanceof SdkError && e.isConflict ? t('owner.approve.illegal') : t('owner.approve.failed');
      Alert.alert(t('owner.tabs.approvals'), msg);
    } finally { setBusyId(null); }
  }, [load, t]);

  const confirmReject = useCallback((id: string) => {
    Alert.alert(t('owner.approvals.reject.title'), t('owner.approvals.reject.confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('owner.approvals.reject.cta'), style: 'destructive', onPress: () => act(id, 'reject') },
    ]);
  }, [act, t]);

  const bulkApprove = useCallback(() => {
    const ids = verifiedApprovalIds(items);
    if (!ids.length) return;
    Alert.alert(t('owner.approvals.bulk.title'), t('owner.approvals.bulk.confirm', { count: String(ids.length) }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('owner.approvals.bulk.cta', { count: String(ids.length) }), onPress: async () => {
        setBulkBusy(true);
        let failed = 0;
        for (const id of ids) { try { await approveAssignment(id); } catch { failed += 1; } } // each is its own authorized action
        setBulkBusy(false);
        if (failed) Alert.alert(t('owner.tabs.approvals'), t('owner.approvals.bulk.partial', { count: String(failed) }));
        await load();
      } },
    ]);
  }, [items, load, t]);

  if (!enabled) return <ScreenScaffold title={t('owner.tabs.approvals')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const verifiedN = counts.verified;

  return (
    <ScreenScaffold
      title={t('owner.approvals.count', { count: String(counts.all) })}
      footer={verifiedN > 0 ? <Button title={t('owner.approvals.bulk.cta', { count: String(verifiedN) })} loading={bulkBusy} disabled={bulkBusy} onPress={bulkApprove} /> : undefined}
    >
      <View style={styles.tabs}>
        <SegmentedControl options={tabOpts} value={tab} onChange={(v) => setTab(v as ApprovalTab)} accessibilityLabel={t('owner.approvals.count', { count: String(counts.all) })} />
      </View>

      {loading ? <SkeletonCard lines={6} /> : error ? (
        <View>
          <EmptyState title={t('common.somethingWrong')} message={t('common.retryHint')} />
          <Pressable onPress={load} accessibilityRole="button" style={styles.retry}><Text style={styles.retryText}>{t('common.retry')}</Text></Pressable>
        </View>
      ) : shown.length === 0 ? (
        <EmptyState title={t('owner.approvals.empty.title')} message={t('owner.approvals.empty.message')} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(a) => a.id}
          renderItem={({ item }) => {
            const rowBusy = busyId === item.id || bulkBusy;
            return (
              <Card style={styles.card}>
                <Pressable
                  onPress={() => router.push({ pathname: '/(owner)/approve/[id]', params: { id: item.id, userId: item.userId, roleCode: item.roleCode, kycStatus: item.kycStatus } })}
                  accessibilityRole="button"
                  style={styles.top}
                >
                  <View style={styles.avatar}><Text style={styles.avatarText}>{initialsOf(item.userId)}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.role}>{t(`role.${item.roleCode}`, { defaultValue: item.roleCode })}</Text>
                    <Text style={styles.ref}>{t('owner.farmer.ref', { id: refOf(item.userId) })}</Text>
                  </View>
                  <StatusPill label={t(`kyc.status.${item.kycStatus}`, { defaultValue: item.kycStatus })} tone={approvalStatusTone(item.kycStatus)} />
                </Pressable>
                <View style={styles.actions}>
                  <Pressable disabled={rowBusy} onPress={() => confirmReject(item.id)} accessibilityRole="button" accessibilityLabel={t('owner.approvals.reject.cta')} style={[styles.actBtn, styles.reject]}>
                    <Text style={styles.rejectText}>✕ {t('owner.approvals.reject.cta')}</Text>
                  </Pressable>
                  <Pressable disabled={rowBusy} onPress={() => act(item.id, 'approve')} accessibilityRole="button" accessibilityLabel={t('owner.approvals.approve.cta')} style={[styles.actBtn, styles.approve]}>
                    <Text style={styles.approveText}>✓ {t('owner.approvals.approve.cta')}</Text>
                  </Pressable>
                </View>
              </Card>
            );
          }}
          contentContainerStyle={{ paddingBottom: space[6] }}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  tabs: { marginBottom: space[3] },
  card: { marginBottom: space[2], gap: space[3] },
  top: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font.display, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.primary700 },
  role: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  ref: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  actions: { flexDirection: 'row', gap: space[2] },
  actBtn: { flex: 1, minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  reject: { borderColor: color.danger, backgroundColor: color.card },
  approve: { borderColor: color.primary600, backgroundColor: color.primary50 },
  rejectText: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.dangerDark },
  approveText: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary700 },
  retry: { alignItems: 'center', paddingVertical: space[3], marginTop: space[2] },
  retryText: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary600 },
});
