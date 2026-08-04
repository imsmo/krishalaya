// apps/mobile/src/app/(owner)/team.tsx · screen 83 (Team & Users). Thin screen (guide §3): the REAL tenant roster
// grouped by role (from rbac.assignments), each row PII-minimised. Editing roles/permissions + invitations is heavy
// and lives on the web admin console (Law 11 lite boundary). Behind `tenant_admin_lite`. Degrade-never-die.
//
// §13 (NOT faked): group headings (role name + real count) and each member's role + KYC/active status come from the
// live `rbac.assignments` roster. The mockup's rich rows — member NAMES (Anita Singh, Vikas Joshi…), EMAILS
// (@anandfpo.com), the "OWNER · YOU / Founder · Full access" descriptors, ⭐ ratings + "247 farmers" ambassador
// stats, the support sub-roles + "Hindi/Gujarati" languages, and "+2 invitations pending" — have NO mobile contract
// (the roster is PII-minimised: only userId + role + kycStatus + active). So rows degrade to a masked ref + status,
// and role/permission editing + invitations hand off to the web console. No invented names, emails, ratings, or
// pending-invite counts.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { RoleAssignment } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { assignments } from '../../features/tenant/tenant.api';
import { approvalStatusTone, groupAssignmentsByRole, type RoleGroup } from '../../features/tenant/tenant-admin';
import { openWebConsole } from '../../core/deeplink';

type Row = { kind: 'header'; roleCode: string; count: number } | { kind: 'member'; a: RoleAssignment };

function flatten(groups: RoleGroup[]): Row[] {
  const rows: Row[] = [];
  for (const g of groups) {
    rows.push({ kind: 'header', roleCode: g.roleCode, count: g.items.length });
    for (const a of g.items) rows.push({ kind: 'member', a });
  }
  return rows;
}

export default function Team() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tenant_admin_lite');
  const [roster, setRoster] = useState<RoleAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => { setRoster(await assignments()); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('owner.team.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const manage = async () => { if (!(await openWebConsole('/settings/team'))) Alert.alert(t('owner.team.title'), t('owner.web.unavailable')); };
  const rows = flatten(groupAssignmentsByRole(roster));

  const header = (
    <View style={{ gap: space[3], marginBottom: space[2] }}>
      <Card style={{ gap: space[2] }}>
        <Text style={styles.body}>{t('owner.team.rosterNote')}</Text>
        <View style={styles.linkRow}>
          <Button title={t('owner.tabs.approvals')} variant="outline" fullWidth={false} onPress={() => router.push('/(owner)/approvals')} />
          <Button title={t('owner.team.manageWeb')} variant="outline" fullWidth={false} onPress={manage} />
        </View>
      </Card>
    </View>
  );

  return (
    <ScreenScaffold title={t('owner.team.title')}>
      {loading ? <SkeletonCard lines={6} /> : (
        <FlatList
          data={rows}
          keyExtractor={(r, i) => (r.kind === 'header' ? `h-${r.roleCode}` : `m-${r.a.id}`) + i}
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState title={t('owner.team.empty.title')} message={t('owner.team.empty.message')} actionLabel={t('common.retry')} onAction={load} />}
          renderItem={({ item }) => item.kind === 'header' ? (
            <Text style={styles.section}>{t(`role.${item.roleCode}`, { defaultValue: item.roleCode })} ({item.count})</Text>
          ) : (
            <Card style={styles.card}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{item.a.userId.slice(0, 2).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ref}>{t('owner.farmer.ref', { id: item.a.userId.slice(0, 8).toUpperCase() })}</Text>
                <Text style={styles.role}>{t(`role.${item.a.roleCode}`, { defaultValue: item.a.roleCode })}</Text>
              </View>
              <View style={styles.pills}>
                <StatusPill label={t(`kyc.status.${item.a.kycStatus}`, { defaultValue: item.a.kycStatus })} tone={approvalStatusTone(item.a.kycStatus)} />
                <StatusPill label={t(item.a.isActive ? 'owner.team.active' : 'owner.team.inactive')} tone={item.a.isActive ? 'success' : 'neutral'} />
              </View>
            </Card>
          )}
          contentContainerStyle={{ paddingBottom: space[6] }}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, lineHeight: font.size.sm * 1.5 },
  linkRow: { flexDirection: 'row', gap: space[3], flexWrap: 'wrap' },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginTop: space[3], marginBottom: space[2] },
  card: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[2] },
  avatar: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font.display, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.primary600 },
  ref: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  role: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[1] },
  pills: { alignItems: 'flex-end', gap: space[1] },
});
