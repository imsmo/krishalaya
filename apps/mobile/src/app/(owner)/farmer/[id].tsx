// apps/mobile/src/app/(owner)/farmer/[id].tsx · screen 77 (Farmer Detail). Thin screen (guide §3): a tenant
// member's PII-minimised profile. `getUser` returns a server-masked, tenant-scoped view (404 for a non-member —
// anti-IDOR); the KYC badge + role come from the member's real role assignment. Behind `tenant_admin_lite`.
// Degrade-never-die. "View Full Profile" hands off to the web console (validated relative path — no open-redirect).
//
// §13 (NOT faked): the profile header (name, masked member ref, role, KYC status) is REAL. The design's rich body —
// ⭐ rating, "3 YRS", listings/lifetime/orders counts, phone, masked Aadhaar, village, farm size, crops, bank, the
// "Last 30 days" activity, and the whole Subscription block (plan/next-billing/commission/fees) — has NO contract
// the mobile tenant-admin app is authorised to read: another member's PII, activity and financials are deliberately
// NOT exposed to a lite mobile console (Law 11 / DPDP). Rather than print fabricated numbers or a wall of "—", each
// of those regions is present as a section that honestly hands off to the web console. The mockup's "FPO-A-247" id
// is not invented — we show the real (masked) member id; "Ramesh Patel"/"Anand"/"SBI ••••2247" etc. are never faked.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { UserProfile, RoleAssignment } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getUser, assignments } from '../../../features/tenant/tenant.api';
import { approvalStatusTone } from '../../../features/tenant/tenant-admin';
import { openWebConsole } from '../../../core/deeplink';

const SECTIONS = ['personal', 'activity', 'subscription'] as const;

export default function FarmerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tenant_admin_lite');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [assignment, setAssignment] = useState<RoleAssignment | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [u, roster] = await Promise.all([getUser(id), assignments()]);
    setUser(u);
    setAssignment(roster.find((a) => a.userId === id) ?? null);
    setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('owner.farmer.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const openFullProfile = async () => {
    const ok = id ? await openWebConsole(`/members/${id}`) : false;
    if (!ok) Alert.alert(t('owner.farmer.consoleTitle'), t('owner.farmer.consoleUnavailable'));
  };
  const onMessage = () => Alert.alert(t('owner.farmer.messageTitle'), t('owner.farmer.messageBody'));

  const name = user?.displayName?.trim() || (id ? t('owner.farmer.ref', { id: id.slice(0, 8).toUpperCase() }) : t('owner.farmer.title'));
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <ScreenScaffold
      title={t('owner.farmer.title')}
      scroll
      footer={user ? (
        <View style={styles.ctaRow}>
          <Button title={t('owner.farmer.message')} variant="outline" onPress={onMessage} />
          <View style={{ flex: 1.4 }}><Button title={t('owner.farmer.viewFull')} onPress={openFullProfile} /></View>
        </View>
      ) : undefined}
    >
      {loading ? <SkeletonCard lines={8} /> : !user ? (
        <EmptyState title={t('owner.farmer.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <View style={{ gap: space[3] }}>
          {/* Profile header */}
          <Card style={styles.header}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
            <Text style={styles.name}>{name}</Text>
            {id ? <Text style={styles.ref}>{t('owner.farmer.idRef', { id: id.slice(0, 8).toUpperCase() })}</Text> : null}
            <View style={styles.badges}>
              {assignment ? <StatusPill label={t(`kyc.status.${assignment.kycStatus}`, { defaultValue: assignment.kycStatus })} tone={approvalStatusTone(assignment.kycStatus)} /> : null}
              {assignment ? <StatusPill label={t(`role.${assignment.roleCode}`, { defaultValue: assignment.roleCode })} tone="neutral" /> : null}
            </View>
          </Card>

          {/* Detail regions — real contract absent; hand off to the web console (never fabricated) */}
          {SECTIONS.map((s) => (
            <Card key={s} style={{ gap: space[1] }}>
              <Text style={styles.section}>{t(`owner.farmer.section.${s}`)}</Text>
              <Text style={styles.webOnly}>{t('owner.farmer.sectionWebOnly')}</Text>
            </Card>
          ))}

          <Text style={styles.foot}>{t('owner.farmer.webOnlyNote')}</Text>
        </View>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: space[2] },
  avatar: { width: 64, height: 64, borderRadius: radius.pill, backgroundColor: color.primary600, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.white },
  name: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  ref: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  badges: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap', justifyContent: 'center', marginTop: space[1] },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  webOnly: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  foot: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center', lineHeight: font.size.xs * 1.5, marginTop: space[1] },
  ctaRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
