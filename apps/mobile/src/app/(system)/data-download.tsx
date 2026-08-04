// apps/mobile/src/app/(system)/data-download.tsx · screen 179 (DPDP data export) — rebuilt to the Phase-1 design
// (screens/179-data-download.html): a 📦 hero, a "What's included" category list, a Format chooser (CSV+JSON /
// PDF report), the "Ready in 4-24 hours · email link · 7 days · password protected" note, and Request Download.
// Thin screen (guide §3): the server compiles the export and emails/links it — the app NEVER builds the file
// itself (Law 11). Behind `system_screens`. Degrade-never-die.
//
// §13 (NOT faked): the design annotates two categories with live counts — "187 orders", "42 active · all past".
// The mobile contract has no per-user totals read-model (orders/listings are keyset pages, not counts), so those
// rows render as qualitative descriptions WITHOUT an invented number. The export endpoint itself is ASSUMED (not
// live) → an honest "unavailable" message on failure; the chosen Format is forwarded (assumed field).
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button, Card, SegmentedControl, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { requestDataExport } from '../../features/system/system.api';
import { EXPORT_FORMATS, exportFormatLabelKey, type ExportFormat } from '../../features/system/system';

const INCLUDED = [
  { key: 'profile', icon: '👤' },
  { key: 'orders', icon: '📦' },
  { key: 'listings', icon: '📋' },
  { key: 'chats', icon: '💬' },
  { key: 'wallet', icon: '💰' },
  { key: 'photos', icon: '📷' },
  { key: 'voice', icon: '🎤' },
  { key: 'location', icon: '📍' },
] as const;

export default function DataDownload() {
  const { t } = useTranslation();
  const enabled = useFlag('system_screens');
  const [format, setFormat] = useState<ExportFormat>('data');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'idle' | 'ok' | 'unavailable'>('idle');

  if (!enabled) return <ScreenScaffold title={t('dataDownload.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const request = async () => {
    setBusy(true);
    const r = await requestDataExport(format);
    setResult(r.ok ? 'ok' : 'unavailable');
    setBusy(false);
  };

  return (
    <ScreenScaffold
      title={t('dataDownload.title')}
      scroll
      footer={<Button title={t('dataDownload.request')} loading={busy} disabled={result === 'ok'} onPress={request} />}
    >
      {/* Hero */}
      <View style={styles.hero}>
        <Text style={styles.heroIcon}>📦</Text>
        <Text style={styles.heroTitle}>{t('dataDownload.heroTitle')}</Text>
        <Text style={styles.heroSub}>{t('dataDownload.heroSub')}</Text>
      </View>

      {/* What's included */}
      <Text style={styles.section}>{t('dataDownload.included')}</Text>
      <Card>
        {INCLUDED.map((it, i) => (
          <View key={it.key} style={[styles.row, i > 0 && styles.rowDivider]}>
            <Text style={styles.rowIcon}>{it.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t(`dataDownload.item.${it.key}.title`)}</Text>
              <Text style={styles.rowSub}>{t(`dataDownload.item.${it.key}.sub`)}</Text>
            </View>
          </View>
        ))}
      </Card>

      {/* Format */}
      <Text style={styles.section}>{t('dataDownload.format')}</Text>
      <SegmentedControl
        accessibilityLabel={t('dataDownload.format')}
        options={EXPORT_FORMATS.map((f) => ({ value: f, label: t(exportFormatLabelKey(f)) }))}
        value={format}
        onChange={(v) => setFormat(v as ExportFormat)}
      />

      {/* Ready-in note */}
      <View style={styles.note}>
        <Text style={styles.noteText}>{t('dataDownload.readyNote')}</Text>
      </View>

      {result === 'ok' ? <Text style={styles.ok}>{t('dataDownload.submitted')}</Text>
        : result === 'unavailable' ? <Text style={styles.warn}>{t('dataDownload.unavailable')}</Text> : null}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space[2], padding: space[5], borderRadius: radius.lg, backgroundColor: color.primary50, marginBottom: space[2] },
  heroIcon: { fontSize: 44 },
  heroTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, textAlign: 'center' },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, textAlign: 'center' },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  rowDivider: { borderTopWidth: 1, borderTopColor: color.ink100 },
  rowIcon: { fontSize: font.size.xl },
  rowTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  rowSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2 },
  note: { marginTop: space[3], padding: space[3], borderRadius: radius.md, backgroundColor: color.infoLight },
  noteText: { fontFamily: font.body, fontSize: font.size.sm, color: color.info, lineHeight: 20 },
  ok: { fontFamily: font.body, fontSize: font.size.sm, color: color.successDark, marginTop: space[3], textAlign: 'center' },
  warn: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[3], textAlign: 'center' },
});
