// apps/mobile/src/app/(farmer)/notifications/[id].tsx · screen 172 (Notification detail) — rebuilt to the Phase-1
// design (screens/172-notification-detail.html): an icon+title hero, an optional headline amount, a "Details" card
// (from / order / item / buyer + amount breakdown + time), and a "Quick actions" row (View order / Open wallet /
// Withdraw to bank). Marks the item read on open (idempotent). Money via MoneyText (Law 2). FLAG_SECURE — a payment
// notification puts an amount on screen (§4). Behind the `notifications` flag. Degrade-never-die (skeleton / retry).
//
// §13 (NOT faked): the notification's structured content lives in the server-TEMPLATED `payload` bag — the mobile
// contract only guarantees it exists (Record<string, unknown>), not its keys. So every rich row (headline amount,
// Sale/Platform-fee/Credited breakdown, From/Order/Item/Buyer, Time) is read DEFENSIVELY over an allowlist and only
// rendered when the sender actually included it; otherwise it's omitted (never invented). Open-wallet / Withdraw are
// fixed in-app destinations shown only for money-category events; View-order appears only if the template supplied a
// valid IN-APP deep link (external URLs are refused, §4).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getById, markRead } from '../../../features/notifications/notifications.api';
import { presentNotificationDetail, notifActions, type NotificationDetailView } from '../../../features/notifications/notif-detail';
import { useSecureScreen } from '../../../core/security';

export default function NotificationDetail() {
  useSecureScreen(); // a payment notification shows an amount — FLAG_SECURE (§4)
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('notifications');
  const [view, setView] = useState<NotificationDetailView | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const item = await getById(id);
    setView(item ? presentNotificationDetail(item) : null);
    setLoading(false);
    if (item) void markRead(id); // idempotent; clears the inbox dot
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('notifDetail.title')}><EmptyState title={t('notifications.unavailable')} /></ScreenScaffold>;
  if (loading) return <ScreenScaffold title={t('notifDetail.title')}><SkeletonCard lines={3} /><SkeletonCard lines={4} /></ScreenScaffold>;
  if (!view) return <ScreenScaffold title={t('notifDetail.title')}><EmptyState title={t('notifDetail.unavailable')} actionLabel={t('common.retry')} onAction={load} /></ScreenScaffold>;

  const actions = notifActions(view);
  const timeText = view.timeText || (view.createdAt ? safeDateTime(view.createdAt, lang) : '');
  const hasDetails = view.infoRows.length > 0 || view.moneyRows.length > 0 || !!timeText;

  return (
    <ScreenScaffold title={t('notifDetail.title')} scroll>
      {/* Icon + title hero */}
      <View style={styles.hero}>
        <Text style={styles.icon}>{view.icon}</Text>
        <Text style={styles.title}>{view.title}</Text>
        {view.heroMinor ? <MoneyText minor={view.heroMinor} langCode={lang} size="3xl" tone="positive" style={styles.heroAmt} /> : null}
        {view.body ? <Text style={styles.body}>{view.body}</Text> : null}
      </View>

      {hasDetails ? (
        <>
          <Text style={styles.section}>{t('notifDetail.section.details')}</Text>
          <Card>
            {view.infoRows.map((r, i) => <InfoRow key={r.labelKey} label={t(r.labelKey)} value={r.value} divider={i > 0} />)}
            {view.moneyRows.map((r, i) => (
              <MoneyRow key={r.labelKey} label={t(r.labelKey)} minor={r.minor} negative={r.negative} langCode={lang}
                divider={i > 0 || view.infoRows.length > 0} emphasize={r.labelKey === 'notifDetail.row.credited'} />
            ))}
            {timeText ? <InfoRow label={t('notifDetail.row.time')} value={timeText} divider={hasDetails} /> : null}
          </Card>
        </>
      ) : null}

      {actions.length > 0 ? (
        <>
          <Text style={styles.section}>{t('notifDetail.section.actions')}</Text>
          <View style={styles.actions}>
            {actions.map((a) => (
              <Button key={a.key} title={t(a.labelKey)} variant={a.variant} fullWidth onPress={() => router.push(a.href as never)} />
            ))}
          </View>
        </>
      ) : null}
    </ScreenScaffold>
  );
}

function InfoRow({ label, value, divider }: { label: string; value: string; divider?: boolean }) {
  return (
    <View style={[styles.row, divider && styles.rowDivider]}>
      <Text style={styles.k}>{label}</Text>
      <Text style={styles.v} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function MoneyRow({ label, minor, negative, langCode, divider, emphasize }: { label: string; minor: string; negative: boolean; langCode: string; divider?: boolean; emphasize?: boolean }) {
  return (
    <View style={[styles.row, divider && styles.rowDivider]}>
      <Text style={[styles.k, emphasize && styles.kStrong]}>{label}</Text>
      <View style={styles.moneyVal}>
        {negative ? <Text style={styles.minus}>−</Text> : null}
        <MoneyText minor={minor} langCode={langCode} size={emphasize ? 'lg' : 'md'} tone={negative ? 'negative' : 'default'} />
      </View>
    </View>
  );
}

function safeDateTime(iso: string, langCode: string): string {
  try { return formatDate(iso, langCode, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso.slice(0, 10); }
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space[2], padding: space[5], borderRadius: radius.lg, backgroundColor: color.successLight, marginBottom: space[2] },
  icon: { fontSize: 44 },
  title: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900, textAlign: 'center' },
  heroAmt: { marginTop: 2 },
  body: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600, textAlign: 'center', lineHeight: 22 },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], paddingVertical: space[3] },
  rowDivider: { borderTopWidth: 1, borderTopColor: color.ink100 },
  k: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500 },
  kStrong: { fontWeight: font.weight.bold, color: color.ink800 },
  v: { flex: 1, textAlign: 'right', fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  moneyVal: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  minus: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.danger },
  actions: { gap: space[2] },
});
