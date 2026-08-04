// apps/mobile/src/app/(farmer)/notifications/settings.tsx · screen 171 (notification settings). Real per event×channel
// opt-in/out toggles (server contract: NotificationPreference {eventCode, channel, isEnabled}) grouped into display
// categories, plus real quiet hours. Thin screen over features/notifications. A mandatory event can't be disabled
// (server throws → we revert the toggle). Quiet hours validated HH:MM client-side (server re-validates). Behind the
// `notifications` flag. Degrade-never-die.
//
// §13 (NOT faked): the mock shows per-event schedule descriptors ("6 AM daily · SMS", "Critical only", "Weekly
// digest"), fixed friendly section names, and a single master "All notifications" switch. The mobile contract carries
// only per event×channel booleans + a quiet-hours window — no per-event schedule/frequency, no master switch. So we
// render the REAL toggles grouped by a keyword-derived category, show the enabled channel mix per event, and label
// events by humanizing the server code. No schedule/frequency descriptor and no master switch are shown (would be
// fabricated). Event titles are the server code humanized, not invented copy.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { NotificationPreference } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, Input, ScreenScaffold, SkeletonCard, Toggle, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getPreferences, setPreferences, getQuietHours, setQuietHours } from '../../../features/notifications/notifications.api';
import { hhmmToMinutes } from '../../../core/push/quiet-hours';
import { setQuietWindow } from '../../../core/push/push';
import { groupByEvent, eventCategory, eventIcon, channelIcon, enabledChannels, humanizeCode, type NotifCategory } from '../../../features/notifications/notif-prefs';

const CATEGORY_ORDER: NotifCategory[] = ['money', 'mandi', 'other'];
const KNOWN_CHANNELS = ['push', 'sms', 'email'];

export default function NotificationSettings() {
  const { t } = useTranslation();
  const enabled = useFlag('notifications');
  const [prefs, setPrefs] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [timeErr, setTimeErr] = useState<string | undefined>();
  const [savedMsg, setSavedMsg] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true); setErrored(false);
    try {
      const [p, q] = await Promise.all([getPreferences(), getQuietHours()]);
      setPrefs(p);
      if (q) { setFrom(q.starts); setTo(q.ends); }
    } catch { setErrored(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const channelLabel = (c: string) => (KNOWN_CHANNELS.includes(c) ? t(`notifPrefs.channel.${c}`) : humanizeCode(c));

  const onToggle = async (eventCode: string, channel: string, value: boolean) => {
    const prev = prefs;
    const next = prefs.map((p) => (p.eventCode === eventCode && p.channel === channel ? { ...p, isEnabled: value } : p));
    const changed = next.find((p) => p.eventCode === eventCode && p.channel === channel)!;
    setPrefs(next); // optimistic
    try { await setPreferences([changed]); }
    catch { setPrefs(prev); } // mandatory event / failure → revert (degrade)
  };

  const onSaveQuiet = async () => {
    if (hhmmToMinutes(from) === null || hhmmToMinutes(to) === null) { setTimeErr(t('prefs.invalidTime')); return; }
    setTimeErr(undefined); setSavedMsg(undefined);
    try {
      const q = await setQuietHours({ starts: from, ends: to, timezone: 'Asia/Kolkata' });
      setQuietWindow({ starts: q.starts, ends: q.ends }); // honor locally for foreground display
      setSavedMsg(t('prefs.saved'));
    } catch { setTimeErr(t('common.error.generic')); }
  };

  if (!enabled) return <ScreenScaffold title={t('notifications.settings')}><EmptyState title={t('notifications.unavailable')} /></ScreenScaffold>;

  const groups = groupByEvent(prefs);

  return (
    <ScreenScaffold title={t('notifications.settings')} scroll>
      {loading ? <SkeletonCard lines={5} /> : errored ? (
        <EmptyState title={t('common.error.generic')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <>
          {groups.length === 0 ? <Card><Text style={styles.empty}>{t('prefs.empty')}</Text></Card> : CATEGORY_ORDER.map((cat) => {
            const catGroups = groups.filter((g) => eventCategory(g.eventCode) === cat);
            if (catGroups.length === 0) return null;
            return (
              <View key={cat}>
                <Text style={styles.section}>{t(`notifPrefs.category.${cat}`)}</Text>
                {catGroups.map((g) => {
                  const on = enabledChannels(g.channels).map(channelLabel);
                  return (
                    <Card key={g.eventCode}>
                      <View style={styles.eventHead}>
                        <Text style={styles.eventIcon}>{eventIcon(g.eventCode)}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.eventTitle}>{humanizeCode(g.eventCode)}</Text>
                          <Text style={styles.eventSummary}>{on.length ? on.join(' · ') : t('notifPrefs.allOff')}</Text>
                        </View>
                      </View>
                      {g.channels.map((p) => (
                        <Toggle
                          key={`${p.eventCode}:${p.channel}`}
                          label={`${channelIcon(p.channel)}  ${channelLabel(p.channel)}`}
                          value={p.isEnabled}
                          onValueChange={(v) => onToggle(p.eventCode, p.channel, v)}
                        />
                      ))}
                    </Card>
                  );
                })}
              </View>
            );
          })}

          <Text style={styles.section}>{t('notifPrefs.channels.title')}</Text>
          <Card>
            <Text style={styles.chan}>{`📱  ${t('notifPrefs.channels.push')}`}</Text>
            <Text style={styles.chan}>{`💬  ${t('notifPrefs.channels.sms')}`}</Text>
            <Text style={styles.chan}>{`📧  ${t('notifPrefs.channels.email')}`}</Text>
          </Card>

          <Text style={styles.section}>{t('prefs.quietHours')}</Text>
          <Text style={styles.hint}>{t('prefs.quietHint')}</Text>
          <View style={{ flexDirection: 'row', gap: space[3], marginTop: space[2] }}>
            <View style={{ flex: 1 }}><Input label={t('prefs.quietFrom')} value={from} onChangeText={setFrom} placeholder="22:00" maxLength={5} /></View>
            <View style={{ flex: 1 }}><Input label={t('prefs.quietTo')} value={to} onChangeText={setTo} placeholder="06:00" maxLength={5} error={timeErr} /></View>
          </View>
          <View style={styles.critical}><Text style={styles.criticalText}>{t('notifPrefs.criticalNote')}</Text></View>
          <View style={{ marginTop: space[4] }}><Button title={t('prefs.save')} onPress={onSaveQuiet} fullWidth={false} /></View>
          {savedMsg ? <Text style={styles.saved}>{savedMsg}</Text> : null}
        </>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  section: { fontFamily: font.body, fontSize: font.size.lg, fontWeight: font.weight.semibold, color: color.ink700, marginTop: space[5], marginBottom: space[2] },
  hint: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  empty: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500 },
  eventHead: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[2] },
  eventIcon: { fontSize: font.size.xl },
  eventTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink900 },
  eventSummary: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2 },
  chan: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700, paddingVertical: space[1] },
  critical: { marginTop: space[3], padding: space[3], borderRadius: radius.md, backgroundColor: color.infoLight },
  criticalText: { fontFamily: font.body, fontSize: font.size.sm, color: color.info },
  saved: { fontFamily: font.body, fontSize: font.size.md, color: color.successDark, marginTop: space[3] },
});
