// apps/mobile/src/app/(owner)/broadcast.tsx · screen 157 (Broadcast Message). Thin screen (guide §3): compose a
// title + body and send it to the tenant's farmers via the REAL broadcast endpoint (tenancy.broadcast → comm
// fanout). Carries an Idempotency-Key (Law 3); authorized SERVER-SIDE (comm.manage — NOT god-mode, Law 11).
// Behind `tenant_admin_lite`. Degrade-never-die (inline validation + error alert).
//
// §13 (NOT faked): audience/channel/message labels + the quiet-hours & auto-translate notes are fixed i18n chrome.
// The send contract is { title, body, audienceRoleCode? } and the comm module resolves each recipient's channels
// (app/SMS/voice) + quiet hours + preferred language SERVER-SIDE. So the mockup's audience COUNTS ("1,247 farmers",
// "189 active", "567 wheat", "412 Anand"), the "₹62 estimated cost" + per-message rates ("₹0.05/msg", "₹0.50/call"),
// the advanced segments (active-only / by-crop / by-location / custom), the channel MULTI-SELECT, the action-button
// picker, and Save Draft are NOT on the mobile contract — there's no audience-estimate/segment/draft endpoint and
// send takes no channel/CTA/rate input. So we DON'T fabricate them: audience is the real "All farmers" role, the
// channels are shown as an informational note (delivery follows each farmer's prefs), advanced segments/drafts are
// flagged to the web console, and the send button carries no fabricated count. The REAL recipientCount comes back
// on the TenantBroadcast after send. Char counter is a pure count. Money (rates) never faked (Law 2).
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { sendBroadcast } from '../../features/tenant/tenant.api';
import { validateBroadcast, BROADCAST_TITLE_MAX, BROADCAST_BODY_MAX } from '../../features/tenant/tenant-admin';

const CHANNELS = [{ key: 'push', icon: '📱' }, { key: 'sms', icon: '💬' }, { key: 'voice', icon: '📞' }] as const;

export default function Broadcast() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tenant_admin_lite');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'title' | 'body' | undefined>();

  const onSend = useCallback(async () => {
    const v = validateBroadcast({ title, body });
    if (!v.ok) { setError(v.reason); return; }
    setError(undefined); setBusy(true);
    try {
      const res = await sendBroadcast({ ...v.input!, audienceRoleCode: 'farmer' });
      Alert.alert(t('owner.broadcast.heading'), t('owner.broadcast.sent', { n: String(res.recipientCount ?? 0) }));
      setTitle(''); setBody(''); router.back();
    } catch (e) {
      const msg = e instanceof SdkError && e.isForbidden ? t('owner.notAllowed') : t('owner.broadcast.failed');
      Alert.alert(t('owner.broadcast.heading'), msg);
    } finally { setBusy(false); }
  }, [title, body, t, router]);

  if (!enabled) return <ScreenScaffold title={t('owner.broadcast.heading')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold
      title={t('owner.broadcast.heading')}
      scroll
      footer={<Button title={t('owner.broadcast.send')} loading={busy} disabled={busy} onPress={onSend} />}
    >
      <View style={{ gap: space[4] }}>
        {/* Who to reach — only the real "All farmers" audience; advanced segments live on the web console */}
        <Section label={t('owner.broadcast.audience')}>
          <Card style={styles.audience}>
            <Text style={styles.audienceTitle}>{t('owner.broadcast.audience.all')}</Text>
            <Text style={styles.audienceDesc}>{t('owner.broadcast.audience.allDesc')}</Text>
          </Card>
          <Text style={styles.note}>{t('owner.broadcast.audience.advanced')}</Text>
        </Section>

        {/* Channels — informational; delivery follows each farmer's preferences + quiet hours */}
        <Section label={t('owner.broadcast.channels')}>
          <View style={styles.chRow}>
            {CHANNELS.map((c) => (
              <View key={c.key} style={styles.ch}>
                <Text style={styles.chIcon}>{c.icon}</Text>
                <Text style={styles.chLabel}>{t(`owner.broadcast.channel.${c.key}`)}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.note}>{t('owner.broadcast.channels.note')}</Text>
        </Section>

        {/* Message */}
        <Section label={t('owner.broadcast.message')}>
          <Input label={t('owner.broadcast.titleLabel')} value={title} onChangeText={setTitle} maxLength={BROADCAST_TITLE_MAX} error={error === 'title' ? t('owner.broadcast.titleRequired') : undefined} />
          <View style={{ marginTop: space[3] }}>
            <Input label={t('owner.broadcast.bodyLabel')} value={body} onChangeText={setBody} multiline maxLength={BROADCAST_BODY_MAX} error={error === 'body' ? t('owner.broadcast.bodyRequired', { max: String(BROADCAST_BODY_MAX) }) : undefined} />
          </View>
          <Text style={styles.counter}>{t('owner.broadcast.charCount', { n: String(body.length), max: String(BROADCAST_BODY_MAX) })}</Text>
        </Section>

        <Text style={styles.quiet}>{t('owner.broadcast.quietHours')}</Text>
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
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  audience: { borderWidth: 1.5, borderColor: color.primary600, backgroundColor: color.primary50 },
  audienceTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  audienceDesc: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  chRow: { flexDirection: 'row', gap: space[2] },
  ch: { flex: 1, alignItems: 'center', gap: space[1], paddingVertical: space[3], borderWidth: 1.5, borderColor: color.earth200, borderRadius: radius.md, backgroundColor: color.card },
  chIcon: { fontSize: font.size['2xl'] },
  chLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink700 },
  counter: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[2] },
  quiet: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, textAlign: 'center' },
});
