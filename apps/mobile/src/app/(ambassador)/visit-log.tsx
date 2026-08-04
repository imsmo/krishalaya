// apps/mobile/src/app/(ambassador)/visit-log.tsx · screen 164 (Visit Log). Thin screen (guide §3): the caller-
// ambassador's OWN logged field visits (keyset), grouped by day, with a this-month summary and a Log-New-Visit
// form (real geo-stamped POST). Behind `ambassador_app`. Degrade-never-die. Location is read once on demand (JIT
// permission), never continuously polled or logged.
//
// §13 (NOT faked): AmbassadorVisit has {purpose, notes, lat, lng, regionId (opaque id), visitedAt} — NO farmer
// NAME, NO village NAME, NO planned/scheduled state, NO per-visit commission, NO distance-travelled aggregate. So
// each row shows the REAL time + purpose + notes; the header shows a real this-month count + distinct-region count
// (no "142 km"); there is no fabricated "Anil Kumar · BORSAD · +₹25" planned row. Everything listed is a real,
// server-recorded visit the ambassador made.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { AmbassadorVisit } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { Button, Card, EmptyState, Input, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { listVisits, logVisit } from '../../features/ambassador/ambassador.api';
import { groupVisitsByDay, visitsThisMonth, distinctRegionsThisMonth, VisitDay } from '../../features/ambassador/visits';
import { getCurrentFix } from '../../core/location';

const SECTIONS: VisitDay[] = ['today', 'yesterday', 'earlier'];

export default function VisitLog() {
  const { t, lang } = useTranslation();
  const enabled = useFlag('ambassador_app');
  const [visits, setVisits] = useState<AmbassadorVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');
  const [fix, setFix] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    try { setVisits((await listVisits()).items); } catch { setFailed(true); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) load(); }, [enabled, load]));

  const now = useMemo(() => new Date(), []);
  const groups = useMemo(() => groupVisitsByDay(visits, now), [visits, now]);
  const monthCount = visitsThisMonth(visits, now);
  const villages = distinctRegionsThisMonth(visits, now);

  const captureFix = useCallback(async () => {
    const r = await getCurrentFix();
    if (r.ok && r.fix) setFix({ lat: r.fix.lat, lng: r.fix.lng });
    else Alert.alert(t('amb.visit.title'), t(`worker.clockIn.gps.${r.reason ?? 'error'}`));
  }, [t]);

  const save = useCallback(async () => {
    if (!purpose.trim()) return;
    setSaving(true);
    try {
      await logVisit({ purpose: purpose.trim(), notes: notes.trim() || undefined, lat: fix?.lat, lng: fix?.lng });
      setPurpose(''); setNotes(''); setFix(null); setFormOpen(false);
      await load();
    } catch { Alert.alert(t('amb.visit.title'), t('common.somethingWrong')); }
    finally { setSaving(false); }
  }, [purpose, notes, fix, load, t]);

  if (!enabled) return <ScreenScaffold title={t('amb.visit.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const header = (
    <View style={{ gap: space[3] }}>
      <View style={styles.summary}>
        <Text style={styles.summaryBig}>{t('amb.visit.countThisMonth', { n: String(monthCount) })}</Text>
        <Text style={styles.summarySub}>{t('amb.visit.villages', { n: String(villages) })}</Text>
      </View>
      {formOpen ? (
        <Card style={{ gap: space[3] }}>
          <Text style={styles.formTitle}>{t('amb.visit.newTitle')}</Text>
          <Input label={t('amb.visit.purpose')} value={purpose} onChangeText={setPurpose} placeholder={t('amb.visit.purposePh')} maxLength={120} />
          <Input label={t('amb.visit.notes')} value={notes} onChangeText={setNotes} placeholder={t('amb.visit.notesPh')} maxLength={280} multiline />
          <Button title={fix ? t('amb.visit.located') : t('amb.visit.addLocation')} variant="outline" onPress={captureFix} />
          <Button title={t('amb.visit.save')} onPress={save} loading={saving} disabled={!purpose.trim()} />
        </Card>
      ) : null}
    </View>
  );

  return (
    <ScreenScaffold title={t('amb.visit.title')} footer={<Button title={formOpen ? t('common.cancel') : t('amb.visit.logNew')} variant={formOpen ? 'outline' : 'primary'} onPress={() => setFormOpen((v) => !v)} />}>
      {loading ? <SkeletonCard lines={6} /> : failed ? (
        <EmptyState title={t('common.somethingWrong')} actionLabel={t('common.retry')} onAction={load} />
      ) : visits.length === 0 ? (
        <>
          {header}
          <EmptyState title={t('amb.visit.empty.title')} message={t('amb.visit.empty.message')} />
        </>
      ) : (
        <FlatList
          data={SECTIONS.filter((s) => groups[s].length > 0)}
          keyExtractor={(s) => s}
          ListHeaderComponent={header}
          renderItem={({ item: day }) => (
            <View style={{ marginTop: space[3] }}>
              <Text style={styles.section}>{t(`amb.visit.day.${day}`)}</Text>
              <Card style={{ gap: space[1] }}>
                {groups[day].map((v, i) => (
                  <View key={v.id} style={[styles.row, i > 0 && styles.divide]}>
                    <Text style={styles.time}>{v.visitedAt ? formatDate(v.visitedAt, lang, day === 'earlier' ? { dateStyle: 'medium' } : { timeStyle: 'short' }) : t('common.dash')}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.purpose}>{v.purpose || t('amb.visit.visit')}</Text>
                      {v.notes ? <Text style={styles.notes}>{v.notes}</Text> : null}
                    </View>
                  </View>
                ))}
              </Card>
            </View>
          )}
          contentContainerStyle={{ paddingBottom: space[4] }}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  summary: { backgroundColor: color.primary50, borderRadius: radius.lg, padding: space[4], alignItems: 'center', gap: space[1] },
  summaryBig: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.primary800 },
  summarySub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  formTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700, marginBottom: space[2] },
  row: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', paddingVertical: space[2] },
  divide: { borderTopWidth: 1, borderTopColor: color.ink100 },
  time: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink500, minWidth: 64 },
  purpose: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink900 },
  notes: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, marginTop: 2, lineHeight: font.size.xs * 1.5 },
});
