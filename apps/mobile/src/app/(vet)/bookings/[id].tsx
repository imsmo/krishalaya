// apps/mobile/src/app/(vet)/bookings/[id].tsx · case detail (PC-50 W10-3; PRESCRIPTION PAD added PC-55 B5).
// Shows ONLY the legal vet actions for the current status (vetActionsFor mirrors the state machine; `completed` is
// the FARMER's confirm-and-pay and is NEVER offered here).
//
// THE PAD REPLACES THE OLD COMING-NOTE (PC-54 W54-4 built `vet-prescriptions`). What it is careful about:
//   • SCHEDULE H IS PER LINE. One prescription routinely mixes a Schedule-H antibiotic with an ordinary
//     supplement, so each line carries its own flag — never one toggle for the whole pad. This app does NOT decide
//     which drugs are Schedule H; no such list ships here, and inventing one would be dangerous. The veterinarian
//     marks the line, because they are the person licensed to know.
//   • EVERY LINE NEEDS A DRUG AND A DOSE. "Give the white tablet" is not a prescription, and a drug without a dose
//     is the ambiguity that hurts an animal — or a person drinking its milk. A row the vet never touched is simply
//     dropped; a HALF-filled row is refused and named by number, never silently discarded.
//   • ONE PRESCRIPTION PER BOOKING, VET-OF-RECORD ONLY (both server-enforced). If one already exists the pad is
//     replaced by the written document, so nothing here looks like an edit that would 409 — a signed prescription is
//     not a draft.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Pressable, TextInput, Switch } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import type { VetBooking } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { getVetBooking, progressBooking, getPrescription, writePrescription } from '../../../features/vet/vet.api';
import { vetActionsFor, type VetAction } from '../../../features/vet/vet';
import { bookingTone } from '../../../features/livestock/livestock';
import { buildPrescription, canWritePrescription, scheduleHCount, RX_MAX_LINES } from '../../../features/livestock/health';

type Line = { drugName: string; dosage: string; durationDays: string; isScheduleH: boolean };
const blankLine = (): Line => ({ drugName: '', dosage: '', durationDays: '', isScheduleH: false });
const today = () => new Date().toISOString().slice(0, 10);

export default function VetCase() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const [booking, setBooking] = useState<VetBooking | null | undefined>(undefined);
  const [rx, setRx] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [validUntil, setValidUntil] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setBooking(await getVetBooking(id));
    setRx(await getPrescription(id));
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = (action: VetAction) => {
    Alert.alert(t('vetpro.case.title'), t(`vetpro.action.${action}.confirm`), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), onPress: async () => {
        setBusy(true);
        try { await progressBooking(id!, action); load(); } catch { Alert.alert(t('vetpro.case.title'), t('vetpro.case.actionFailed')); } finally { setBusy(false); }
      } },
    ]);
  };

  const setLine = (i: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, ix) => (ix === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => (prev.length >= RX_MAX_LINES ? prev : [...prev, blankLine()]));
  const removeLine = (i: number) => setLines((prev) => (prev.length === 1 ? [blankLine()] : prev.filter((_, ix) => ix !== i)));

  const sign = async () => {
    const built = buildPrescription({ validUntil, lines }, today());
    if (!built.ok) {
      const where = built.line ? ` (${t('rx.error.lineN', { n: String(built.line) })})` : '';
      Alert.alert(t('rx.title'), `${t(`rx.error.${built.error}`)}${where}`);
      return;
    }
    const hCount = scheduleHCount(built.value.items);
    Alert.alert(
      t('rx.confirm.title'),
      hCount > 0 ? t('rx.confirm.bodyScheduleH', { n: String(built.value.items.length), h: String(hCount) }) : t('rx.confirm.body', { n: String(built.value.items.length) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('rx.confirm.sign'), onPress: async () => {
          setBusy(true);
          try {
            await writePrescription(id!, built.value);
            setLines([blankLine()]); setValidUntil('');
            await load();
            Alert.alert(t('rx.title'), t('rx.saved'));
          } catch {
            // A 409 means somebody already wrote it; either way the pad must not appear to have overwritten a
            // signed document, so we re-read and let the written prescription speak for itself.
            await load();
            Alert.alert(t('rx.title'), t('rx.error.save'));
          } finally { setBusy(false); }
        } },
      ],
    );
  };

  if (booking === undefined) return <ScreenScaffold title={t('vetpro.case.title')}><SkeletonCard lines={6} /></ScreenScaffold>;
  if (booking === null) return <ScreenScaffold title={t('vetpro.case.title')}><EmptyState title={t('vetpro.case.notFound')} /></ScreenScaffold>;

  const actions = vetActionsFor(booking.status);
  const rxItems = (rx?.items as Array<Record<string, unknown>> | undefined) ?? [];
  const padOpen = canWritePrescription(booking.status, rx);

  return (
    <ScreenScaffold title={t('vetpro.case.title')}>
      <ScrollView>
        <Card>
          <View style={styles.between}>
            <StatusPill label={t(`pashu.status.${booking.status}`) || booking.status} tone={bookingTone(booking.status)} />
            <MoneyText minor={booking.feeMinor} langCode={lang} />
          </View>
          <Text style={styles.muted}>{t(`pashu.urgency.${booking.urgency}`)} · {t(`pashu.mode.${booking.mode}`)}</Text>
          {booking.scheduledAt ? <Text style={styles.muted}>{t('pashu.booking.scheduled')} {new Date(booking.scheduledAt).toLocaleString()}</Text> : null}
        </Card>
        {actions.map((a) => <Button key={a} title={t(`vetpro.action.${a}`)} disabled={busy} onPress={() => act(a)} />)}
        {booking.status === 'prescribed' ? <Text style={styles.muted}>{t('vetpro.case.awaitingFarmer')}</Text> : null}

        {/* the WRITTEN prescription, once it exists — a signed document, not an editable form */}
        {rx ? (
          <Card>
            <Text style={styles.section}>{t('rx.written.title')}</Text>
            {rx.validUntil ? <Text style={styles.muted}>{t('rx.validUntil')}: {String(rx.validUntil)}</Text> : null}
            {rxItems.map((it, i) => (
              <View key={String(it.id ?? i)} style={styles.rxRow}>
                <Text style={styles.factValue}>{String(it.drugName ?? '')}</Text>
                <Text style={styles.muted}>
                  {String(it.dosage ?? '')}
                  {it.durationDays ? ` · ${t('rx.forDays', { n: String(it.durationDays) })}` : ''}
                </Text>
                {it.isScheduleH ? <Text style={styles.scheduleH}>{t('rx.scheduleH')}</Text> : null}
              </View>
            ))}
            {scheduleHCount(rxItems as Array<{ isScheduleH?: boolean }>) > 0 ? <Text style={styles.muted}>{t('rx.scheduleHNote')}</Text> : null}
            <Text style={styles.muted}>{t('rx.written.locked')}</Text>
          </Card>
        ) : null}

        {/* the PAD — only while the case is with the vet and nothing is written yet */}
        {padOpen ? (
          <Card>
            <Text style={styles.section}>{t('rx.title')}</Text>
            <Text style={styles.muted}>{t('rx.hint')}</Text>

            {lines.map((l, i) => (
              <View key={i} style={styles.lineBox}>
                <View style={styles.between}>
                  <Text style={styles.label}>{t('rx.line', { n: String(i + 1) })}</Text>
                  <Pressable onPress={() => removeLine(i)} accessibilityRole="button" accessibilityLabel={t('rx.removeLine')}>
                    <Text style={styles.remove}>×</Text>
                  </Pressable>
                </View>
                <TextInput value={l.drugName} onChangeText={(v) => setLine(i, { drugName: v })} style={styles.input} maxLength={200} placeholder={t('rx.drugName')} accessibilityLabel={`${t('rx.drugName')} ${i + 1}`} />
                <TextInput value={l.dosage} onChangeText={(v) => setLine(i, { dosage: v })} style={styles.input} maxLength={200} placeholder={t('rx.dosage')} accessibilityLabel={`${t('rx.dosage')} ${i + 1}`} />
                <TextInput value={l.durationDays} onChangeText={(v) => setLine(i, { durationDays: v })} style={styles.input} keyboardType="number-pad" maxLength={3} placeholder={t('rx.durationDays')} accessibilityLabel={`${t('rx.durationDays')} ${i + 1}`} />
                <View style={styles.between}>
                  <Text style={styles.label}>{t('rx.scheduleHToggle')}</Text>
                  <Switch value={l.isScheduleH} onValueChange={(v) => setLine(i, { isScheduleH: v })} accessibilityLabel={`${t('rx.scheduleHToggle')} ${i + 1}`} />
                </View>
              </View>
            ))}

            <Button title={t('rx.addLine')} variant="outline" onPress={addLine} disabled={lines.length >= RX_MAX_LINES} />
            <Text style={styles.label}>{t('rx.validUntil')}</Text>
            <TextInput value={validUntil} onChangeText={setValidUntil} style={styles.input} placeholder="YYYY-MM-DD" accessibilityLabel={t('rx.validUntil')} />
            <Text style={styles.muted}>{t('rx.validUntilHint')}</Text>
            <Button title={t('rx.sign')} disabled={busy} onPress={sign} />
            <Text style={styles.muted}>{t('rx.onceNote')}</Text>
          </Card>
        ) : null}

        {!rx && !padOpen && (booking.status === 'requested' || booking.status === 'accepted' || booking.status === 'en_route') ? (
          <Text style={styles.muted}>{t('rx.notYet')}</Text>
        ) : null}
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  section: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  label: { fontSize: font.size.xs, color: color.ink500, marginTop: space[2] },
  factValue: { fontSize: font.size.md, color: color.ink800 },
  input: { borderWidth: 1, borderColor: color.ink200, borderRadius: 8, padding: space[2], marginTop: space[1], fontSize: font.size.sm, color: color.ink800, minHeight: 44 },
  lineBox: { borderWidth: 1, borderColor: color.ink100, borderRadius: 12, padding: space[2], marginTop: space[2] },
  remove: { fontSize: font.size.lg, color: color.ink500, paddingHorizontal: space[2] },
  rxRow: { marginTop: space[2] },
  scheduleH: { fontSize: font.size.xs, color: color.danger, fontWeight: font.weight.semibold, marginTop: space[1] },
});
