// apps/mobile/src/app/(owner)/custom-report.tsx · screen 153 (Build Custom Report). Thin screen (guide §3): the
// report-builder form — report type, date-range presets, filter entries, metrics-to-include, export format — as
// LOCAL UI selections, then Preview / Generate hand off to the web console, which actually builds + renders the
// report. Behind `tenant_admin_lite`. Degrade-never-die.
//
// §13 (NOT faked): the form controls (report types, range presets, metric names, export formats) are fixed UI
// chrome via i18n — NOT data. The mobile app has NO report-generation / preview contract, and the per-tenant filter
// pickers (region list, crop categories, farmer segments, value bands) have no mobile read-model — so the filter
// rows show generic "All …" defaults, never the mockup's fabricated sub-values ("All Gujarat · 3 districts",
// "Active 30d"), and Preview/Generate/filter-config all open the web console (bounded + audited there). The user's
// local selections carry no fabricated data. When a mobile report contract ships, this renders + generates in-app.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { SegmentedControl, EmptyState, ScreenScaffold, Button, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { openWebConsole } from '../../core/deeplink';
import { WEB_PATHS } from '../../features/tenant/web-console';

const REPORT_TYPES = ['gmv', 'retention', 'funnel', 'heatmap', 'commission', 'custom'] as const;
const RANGES = ['7d', '30d', '60d', 'ytd'] as const;
const FILTERS = [
  { key: 'region', icon: '📍' },
  { key: 'crop', icon: '🌾' },
  { key: 'segment', icon: '👥' },
  { key: 'orderValue', icon: '💰' },
] as const;
const METRICS = ['gmv', 'orders', 'aov', 'conversion', 'cancellation'] as const;
const FORMATS = [
  { key: 'csv', icon: '📊' },
  { key: 'pdf', icon: '📑' },
  { key: 'excel', icon: '📈' },
] as const;

export default function CustomReport() {
  const { t } = useTranslation();
  const enabled = useFlag('tenant_admin_lite');
  const [type, setType] = useState<string>('gmv');
  const [range, setRange] = useState<string>('30d');
  const [metrics, setMetrics] = useState<string[]>(['gmv', 'orders']);
  const [format, setFormat] = useState<string>('csv');
  const [busy, setBusy] = useState(false);

  const toggleMetric = useCallback((m: string) => {
    setMetrics((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }, []);

  const openWeb = useCallback(async () => {
    setBusy(true);
    try { const ok = await openWebConsole(WEB_PATHS.customReport); if (!ok) Alert.alert(t('owner.customReport.title'), t('owner.web.unavailable')); }
    finally { setBusy(false); }
  }, [t]);

  if (!enabled) return <ScreenScaffold title={t('owner.customReport.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold
      title={t('owner.customReport.heading')}
      scroll
      footer={
        <View style={styles.footer}>
          <Button title={t('owner.customReport.preview')} variant="outline" fullWidth={false} loading={busy} onPress={openWeb} />
          <View style={{ flex: 1 }}><Button title={t('owner.customReport.generate')} loading={busy} onPress={openWeb} /></View>
        </View>
      }
    >
      <View style={{ gap: space[4] }}>
        {/* Report type */}
        <Section label={t('owner.customReport.reportType')}>
          <SegmentedControl
            layout="stack"
            options={REPORT_TYPES.map((k) => ({ value: k, label: t(`owner.customReport.type.${k}`) }))}
            value={type}
            onChange={setType}
            accessibilityLabel={t('owner.customReport.reportType')}
          />
        </Section>

        {/* Date range */}
        <Section label={t('owner.customReport.dateRange')}>
          <SegmentedControl
            options={RANGES.map((k) => ({ value: k, label: t(`owner.customReport.range.${k}`) }))}
            value={range}
            onChange={setRange}
            accessibilityLabel={t('owner.customReport.dateRange')}
          />
          <Text style={styles.note}>{t('owner.customReport.range.customNote')}</Text>
        </Section>

        {/* Filter by — configured on the web console */}
        <Section label={t('owner.customReport.filterBy')}>
          <View style={{ gap: space[2] }}>
            {FILTERS.map((f) => (
              <Pressable key={f.key} disabled={busy} onPress={openWeb} accessibilityRole="button" accessibilityLabel={t(`owner.customReport.filter.${f.key}`)}>
                <View style={styles.filterRow}>
                  <Text style={styles.filterIcon}>{f.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.filterLabel}>{t(`owner.customReport.filter.${f.key}`)}</Text>
                    <Text style={styles.filterVal}>{t('owner.customReport.filter.allValue')}</Text>
                  </View>
                  <Text style={styles.chev}>›</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </Section>

        {/* Metrics to include */}
        <Section label={t('owner.customReport.metrics')}>
          <View style={styles.pills}>
            {METRICS.map((m) => {
              const on = metrics.includes(m);
              return (
                <Pressable key={m} onPress={() => toggleMetric(m)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[styles.pill, on && styles.pillOn]}>
                  <Text style={[styles.pillText, on && styles.pillTextOn]}>{on ? '✓ ' : ''}{t(`owner.customReport.metric.${m}`)}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        {/* Export format */}
        <Section label={t('owner.customReport.exportFormat')}>
          <View style={styles.pills}>
            {FORMATS.map((f) => {
              const on = format === f.key;
              return (
                <Pressable key={f.key} onPress={() => setFormat(f.key)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[styles.pill, on && styles.pillOn]}>
                  <Text style={[styles.pillText, on && styles.pillTextOn]}>{f.icon} {t(`owner.customReport.format.${f.key}`)}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Text style={styles.webNote}>{t('owner.customReport.webNote')}</Text>
      </View>
    </ScreenScaffold>
  );
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
  footer: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 56, paddingHorizontal: space[3], borderWidth: 1.5, borderColor: color.earth200, borderRadius: radius.md, backgroundColor: color.card },
  filterIcon: { fontSize: font.size.lg },
  filterLabel: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  filterVal: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  chev: { fontFamily: font.body, fontSize: font.size.xl, color: color.ink400 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  pill: { minHeight: 44, paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.earth200, backgroundColor: color.card, alignItems: 'center', justifyContent: 'center' },
  pillOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  pillText: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  pillTextOn: { color: color.primary700 },
  webNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center' },
});
