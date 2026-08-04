// apps/mobile/src/app/(owner)/bulk-actions.tsx · screen 149 (Bulk Actions). Thin screen (guide §3): the pending
// approval queue as the working set, an Operations list. ONE operation runs in-app — "Approve all selected" =
// approve every KYC-verified pending assignment by the same per-item authorized action (no god-mode bulk mutation,
// Law 11). The rest (reminder SMS, tutorial broadcast, CSV export, tag/segment, reject-all-with-reason+SMS) are
// heavy campaign/bulk operations with NO mobile contract → web-console handoff. Behind `tenant_admin_lite`.
// Degrade-never-die (loading/empty/error).
//
// §13 (NOT faked): the header count + "Approve all" count = the REAL pending queue / KYC-verified subset. The
// mockup's fabricated counts ("24 newly approved") are DROPPED — no contract supplies a "newly approved in period"
// number, so the tutorial row shows a generic subtitle, never an invented 24. The SMS/CSV/tag/reject-with-reason
// operations have no mobile API (bulk SMS + reason capture + CSV render live server/web-side) → handed off, never
// stubbed. Every action is authorised + tenant-scoped SERVER-SIDE; a 403 → friendly "not allowed".
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { RoleAssignment } from '@krishalaya/sdk-js';
import { Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { assignments, approveAssignment } from '../../features/tenant/tenant.api';
import { approvalCounts, verifiedApprovalIds } from '../../features/tenant/tenant-admin';
import { openWebConsole } from '../../core/deeplink';
import { WEB_PATHS } from '../../features/tenant/web-console';

type Op = { key: string; icon: string; kind: 'approveVerified' | 'web'; path?: string };
const OPERATIONS: Op[] = [
  { key: 'approve', icon: '✓', kind: 'approveVerified' },
  { key: 'reminder', icon: '📧', kind: 'web', path: WEB_PATHS.broadcast },
  { key: 'tutorial', icon: '🚀', kind: 'web', path: WEB_PATHS.broadcast },
  { key: 'csv', icon: '📊', kind: 'web', path: WEB_PATHS.export },
  { key: 'tag', icon: '📝', kind: 'web', path: WEB_PATHS.bulkActions },
  { key: 'reject', icon: '🚫', kind: 'web', path: WEB_PATHS.bulkActions },
];

export default function BulkActions() {
  const { t } = useTranslation();
  const enabled = useFlag('tenant_admin_lite');
  const [items, setItems] = useState<RoleAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try { setItems(await assignments({ pendingOnly: true })); } catch { setError(true); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) load(); }, [enabled, load]));

  const counts = useMemo(() => approvalCounts(items), [items]);

  const openWeb = useCallback(async (path: string) => {
    setBusy(true);
    try { const ok = await openWebConsole(path); if (!ok) Alert.alert(t('owner.bulk.title'), t('owner.web.unavailable')); }
    finally { setBusy(false); }
  }, [t]);

  const bulkApprove = useCallback(() => {
    const ids = verifiedApprovalIds(items);
    if (!ids.length) { Alert.alert(t('owner.bulk.title'), t('owner.bulk.op.approve.none')); return; }
    Alert.alert(t('owner.approvals.bulk.title'), t('owner.approvals.bulk.confirm', { count: String(ids.length) }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('owner.approvals.bulk.cta', { count: String(ids.length) }), onPress: async () => {
        setBusy(true);
        let failed = 0;
        for (const id of ids) { try { await approveAssignment(id); } catch { failed += 1; } } // each its own authorized action
        setBusy(false);
        if (failed) Alert.alert(t('owner.bulk.title'), t('owner.approvals.bulk.partial', { count: String(failed) }));
        await load();
      } },
    ]);
  }, [items, load, t]);

  if (!enabled) return <ScreenScaffold title={t('owner.bulk.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const subFor = (op: Op): string => {
    if (op.key === 'approve') return t('owner.bulk.op.approve.sub', { count: String(counts.verified) });
    return t(`owner.bulk.op.${op.key}.sub`);
  };

  return (
    <ScreenScaffold title={t('owner.bulk.title')} scroll>
      {loading ? <SkeletonCard lines={6} /> : error ? (
        <View>
          <EmptyState title={t('common.somethingWrong')} message={t('common.retryHint')} />
          <Pressable onPress={load} accessibilityRole="button" style={styles.retry}><Text style={styles.retryText}>{t('common.retry')}</Text></Pressable>
        </View>
      ) : counts.all === 0 ? (
        <EmptyState title={t('owner.approvals.empty.title')} message={t('owner.approvals.empty.message')} />
      ) : (
        <View style={{ gap: space[4] }}>
          <Text style={styles.subtitle}>{t('owner.bulk.subtitle', { count: String(counts.all) })}</Text>
          <Text style={styles.section}>{t('owner.bulk.operations')}</Text>
          <View style={{ gap: space[2] }}>
            {OPERATIONS.map((op) => (
              <Pressable
                key={op.key}
                disabled={busy}
                onPress={() => (op.kind === 'approveVerified' ? bulkApprove() : openWeb(op.path!))}
                accessibilityRole="button"
                accessibilityLabel={t(`owner.bulk.op.${op.key}.title`)}
              >
                <Card style={styles.row}>
                  <View style={[styles.iconWrap, op.key === 'reject' && styles.iconDanger, op.key === 'approve' && styles.iconApprove]}>
                    <Text style={styles.icon}>{op.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{t(`owner.bulk.op.${op.key}.title`)}</Text>
                    <Text style={styles.rowSub}>{subFor(op)}</Text>
                  </View>
                  <Text style={styles.chev}>›</Text>
                </Card>
              </Pressable>
            ))}
          </View>
          <Text style={styles.note}>{t('owner.bulk.webNote')}</Text>
        </View>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  iconWrap: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  iconApprove: { backgroundColor: color.primary50 },
  iconDanger: { backgroundColor: color.dangerLight },
  icon: { fontSize: font.size.lg },
  rowTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  rowSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  chev: { fontFamily: font.body, fontSize: font.size.xl, color: color.ink400 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center' },
  retry: { alignItems: 'center', paddingVertical: space[3], marginTop: space[2] },
  retryText: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary600 },
});
