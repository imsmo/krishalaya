// apps/mobile/src/app/(owner)/approve/[id].tsx · screen 148 (Review Farmer). Thin screen (guide §3): review a
// PENDING role assignment and approve (✓) or reject (✕). REAL member profile via getUser + the assignment's real
// kycStatus; approve = approveAssignment, reject = rejectAssignment (revoke). Every action is authorized +
// tenant-scoped SERVER-SIDE (NOT god-mode, Law 11); a 403 → friendly "not allowed". FLAG_SECURE (KYC screen).
// Behind `tenant_admin_lite`. Degrade-never-die (loading/empty/error).
//
// §13 (NOT faked): name = getUser(userId).displayName (real, tenant-scoped read); role = the assignment roleCode;
// KYC = the assignment's single real kycStatus. The mockup's rich dossier has NO mobile-authorized contract, so we
// DO NOT fabricate ANY of it: the per-document PASS breakdown (Aadhaar XXXX-4521/UIDAI, bank SBI ••9281, land 7/12
// 3.5ac, duplicate check) — the app is authorised only for the single overall kycStatus, and never handles raw
// Aadhaar/bank (DPDP) → full document review is handed off to the web console; PHONE/VILLAGE/FARM-SIZE/CROPS —
// not on UserProfile (PII-minimal) → omitted; ONBOARDER + rating — no contract → omitted; the "AI insights /
// Recommended: APPROVE / 94% approval rate / Est GMV ₹85K–1.2L" panel — pure fabrication with no read-model → the
// app NEVER invents a recommendation or a rupee figure, so it is dropped entirely.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { SdkError } from '@krishalaya/sdk-js';
import type { UserProfile } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { getUser, approveAssignment, rejectAssignment } from '../../../features/tenant/tenant.api';
import { approvalStatusTone } from '../../../features/tenant/tenant-admin';
import { openWebConsole } from '../../../core/deeplink';
import { WEB_PATHS } from '../../../features/tenant/web-console';

function refOf(id: string): string { return (id ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || '—'; }
function initialsOf(name: string | null, id: string): string {
  const n = (name ?? '').trim();
  if (n) { const parts = n.split(/\s+/); return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase(); }
  return refOf(id).slice(0, 2);
}

export default function ReviewFarmer() {
  const { id, userId, roleCode, kycStatus } = useLocalSearchParams<{ id: string; userId?: string; roleCode?: string; kycStatus?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tenant_admin_lite');
  useSecureScreen(); // FLAG_SECURE — KYC review
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true); setError(false);
    const p = await getUser(userId);
    if (!p) setError(true);
    setProfile(p); setLoading(false);
  }, [userId]);
  useFocusEffect(useCallback(() => { if (enabled) load(); }, [enabled, load]));

  const act = useCallback(async (kind: 'approve' | 'reject') => {
    if (!id) return;
    setBusy(true);
    try {
      if (kind === 'approve') await approveAssignment(id); else await rejectAssignment(id);
      router.replace({ pathname: '/(owner)/approvals', params: { notice: t(kind === 'approve' ? 'owner.approve.done' : 'owner.approvals.reject.done') } });
    } catch (e) {
      const msg = e instanceof SdkError && e.isForbidden ? t('owner.notAllowed') : e instanceof SdkError && e.isConflict ? t('owner.approve.illegal') : t('owner.approve.failed');
      Alert.alert(t('owner.approve.reviewTitle'), msg);
    } finally { setBusy(false); }
  }, [id, router, t]);

  const confirmReject = useCallback(() => {
    Alert.alert(t('owner.approvals.reject.title'), t('owner.approvals.reject.confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('owner.approvals.reject.cta'), style: 'destructive', onPress: () => act('reject') },
    ]);
  }, [act, t]);

  if (!enabled) return <ScreenScaffold title={t('owner.approve.reviewTitle')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const ref = refOf(userId ?? '');

  return (
    <ScreenScaffold
      title={t('owner.approve.reviewTitle')}
      footer={
        <View style={styles.footer}>
          <Button title={t('owner.approvals.reject.cta')} variant="outline" fullWidth={false} loading={busy} disabled={busy} onPress={confirmReject} />
          <View style={{ flex: 1 }}><Button title={t('owner.approve.approveFarmer')} loading={busy} disabled={busy} onPress={() => act('approve')} /></View>
        </View>
      }
    >
      {loading ? <SkeletonCard lines={6} /> : error ? (
        <View>
          <EmptyState title={t('common.somethingWrong')} message={t('common.retryHint')} />
          <Button title={t('common.retry')} variant="outline" onPress={load} />
        </View>
      ) : (
        <View style={{ gap: space[4] }}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initialsOf(profile?.displayName ?? null, userId ?? '')}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{profile?.displayName ?? t('owner.farmer.ref', { id: ref })}</Text>
              <Text style={styles.sub}>{roleCode ? t(`role.${roleCode}`, { defaultValue: roleCode }) : t('owner.farmer.ref', { id: ref })}</Text>
            </View>
          </View>

          {/* Verification — the single real KYC status; full per-document review on the web console (§13) */}
          <Text style={styles.section}>{t('owner.approve.verification')}</Text>
          <Card style={{ gap: space[2] }}>
            <View style={styles.vRow}>
              <Text style={styles.vLabel}>{t('owner.approve.kycLabel')}</Text>
              {kycStatus ? <StatusPill label={t(`kyc.status.${kycStatus}`, { defaultValue: kycStatus })} tone={approvalStatusTone(kycStatus)} /> : <Text style={styles.dash}>{t('common.dash')}</Text>}
            </View>
            <Text style={styles.note}>{t('owner.approve.fullReviewNote')}</Text>
            <Button title={t('owner.approve.openConsole')} variant="outline" loading={busy} onPress={async () => { const ok = await openWebConsole(WEB_PATHS.compliance); if (!ok) Alert.alert(t('owner.approve.reviewTitle'), t('owner.web.unavailable')); }} />
          </Card>

          {/* Details — only what the profile contract really carries (PII-minimal) */}
          <Text style={styles.section}>{t('owner.approve.details')}</Text>
          <Card>
            {roleCode ? <Row k={t('owner.approve.role')} v={t(`role.${roleCode}`, { defaultValue: roleCode })} /> : null}
            {profile?.locale ? <Row k={t('owner.approve.language')} v={profile.locale} /> : null}
            <Row k={t('owner.farmer.ref.label')} v={ref} />
          </Card>

          <Text style={styles.lite}>{t('owner.approve.degradeNote')}</Text>
        </View>
      )}
    </ScreenScaffold>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <View style={styles.row}><Text style={styles.k}>{k}</Text><Text style={styles.v}>{v}</Text></View>;
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.primary700 },
  name: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  sub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[1] },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  vRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  vLabel: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700 },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  dash: { fontFamily: font.body, fontSize: font.size.md, color: color.ink400 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.ink100 },
  k: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500 },
  v: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  lite: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center' },
});
