// apps/mobile/src/app/(owner)/export.tsx · screen 154 (Export Reports / Reports Archive). Thin screen (guide §3):
// the tenant's SAVED SCHEDULES + RECENTLY GENERATED report files, read live from the tenant reports read-model,
// plus a "+ Build Custom Report" entry (→ screen 153). Behind `tenant_admin_lite`. Degrade-never-die (loading
// skeleton / designed empty + web handoff / inline retry).
//
// §13 (NOT faked): the schedule rows (title, cadence, recipient email) and generated-file rows (title, byte size,
// format, generated date / auto-filed) are DATA from `reportsArchive()` → SDK → API — NEVER the mockup literals
// ("anita@anandfpo.com", "2.4 MB", "Generated Aug 1", "847 KB", "NABARD quarterly compliance"…). The mobile app
// has no reports read-model yet, so that call degrades to empty and the screen shows a designed "managed on the
// web console" notice — it never invents a schedule or a downloadable file. The "SCHEDULED" pill, section titles,
// units and buttons are fixed UI chrome via i18n. Downloads are signed, long-running server operations → opened on
// the web console (the app never streams a report file). File bytes are a SIZE, not money (no MoneyText here).
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { formatDate } from '@krishalaya/i18n';
import { Button, Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { reportsArchive, type ScheduledReport, type GeneratedReport } from '../../features/tenant/tenant.api';
import { formatBytes, reportKindIcon } from '../../features/tenant/tenant-admin';
import { openWebConsole } from '../../core/deeplink';
import { WEB_PATHS } from '../../features/tenant/web-console';

const DT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

export default function ExportReports() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tenant_admin_lite');
  const [scheduled, setScheduled] = useState<ScheduledReport[]>([]);
  const [generated, setGenerated] = useState<GeneratedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const a = await reportsArchive();
    setScheduled(a.scheduled); setGenerated(a.generated); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  const openWeb = useCallback(async (path: string) => {
    setBusy(true);
    try { const ok = await openWebConsole(path); if (!ok) Alert.alert(t('owner.exportReports.title'), t('owner.web.unavailable')); }
    finally { setBusy(false); }
  }, [t]);

  if (!enabled) return <ScreenScaffold title={t('owner.exportReports.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const empty = scheduled.length === 0 && generated.length === 0;

  return (
    <ScreenScaffold
      title={t('owner.exportReports.title')}
      subtitle={t('owner.exportReports.subtitle')}
      scroll
      footer={<Button title={t('owner.exportReports.build')} onPress={() => router.push('/(owner)/custom-report')} />}
    >
      {loading ? (
        <View style={{ gap: space[3] }}><SkeletonCard /><SkeletonCard /><SkeletonCard /></View>
      ) : (
        <View style={{ gap: space[4] }}>
          {/* Scheduled */}
          <Section label={t('owner.exportReports.scheduled')}>
            {scheduled.length === 0 ? (
              <Text style={styles.note}>{t('owner.exportReports.noScheduled')}</Text>
            ) : (
              scheduled.map((s) => (
                <Card key={s.id}>
                  <View style={styles.row}>
                    <Text style={styles.icon}>{reportKindIcon(s.kind)}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.title}>{s.title}</Text>
                      {s.cadence || s.recipient ? (
                        <Text style={styles.sub}>{[s.cadence, s.recipient].filter(Boolean).join(' · ')}</Text>
                      ) : null}
                    </View>
                    <StatusPill tone="info" label={t('owner.exportReports.pill.scheduled')} />
                  </View>
                </Card>
              ))
            )}
          </Section>

          {/* Recent generated */}
          <Section label={t('owner.exportReports.generated')}>
            {generated.length === 0 ? (
              <Text style={styles.note}>{t('owner.exportReports.noGenerated')}</Text>
            ) : (
              generated.map((g) => (
                <Card key={g.id}>
                  <View style={styles.row}>
                    <Text style={styles.icon}>📄</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.title}>{g.title}</Text>
                      <Text style={styles.sub}>{genMeta(t, lang, g)}</Text>
                    </View>
                    <Button title={t('owner.exportReports.download')} size="md" variant="outline" fullWidth={false} loading={busy} onPress={() => openWeb(WEB_PATHS.export)} />
                  </View>
                </Card>
              ))
            )}
          </Section>

          {/* Honest degradation notice + web-console handoff (archive/downloads live on web) */}
          {empty ? (
            <EmptyState
              title={t('owner.exportReports.empty.title')}
              message={t('owner.exportReports.empty.body')}
              actionLabel={t('owner.exportReports.manageWeb')}
              onAction={() => openWeb(WEB_PATHS.export)}
            />
          ) : (
            <Pressable onPress={() => openWeb(WEB_PATHS.export)} accessibilityRole="button" accessibilityLabel={t('owner.exportReports.manageWeb')}>
              <Text style={styles.webLink}>{t('owner.exportReports.manageWeb')} ›</Text>
            </Pressable>
          )}
        </View>
      )}
    </ScreenScaffold>
  );
}

function genMeta(t: (k: string, v?: Record<string, string>) => string, lang: string, g: GeneratedReport): string {
  const parts: string[] = [];
  if (typeof g.sizeBytes === 'number') parts.push(formatBytes(g.sizeBytes));
  if (g.format) parts.push(g.format);
  if (g.autoFiled) parts.push(t('owner.exportReports.autoFiled'));
  else if (g.generatedAt) parts.push(formatDate(g.generatedAt, lang, DT));
  return parts.join(' · ');
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space[2] }}>
      <Text style={styles.section}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  icon: { fontSize: font.size['2xl'] },
  title: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  sub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400, paddingVertical: space[2] },
  webLink: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700, textAlign: 'center', paddingVertical: space[2] },
});
