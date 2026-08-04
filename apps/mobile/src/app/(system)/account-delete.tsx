// apps/mobile/src/app/(system)/account-delete.tsx · screen 177 (DPDP account deletion) — rebuilt to the Phase-1
// design (screens/177-account-delete.html): a red warning hero, a "What happens / You will lose" card, a
// "Before deletion" checklist, a "Why leaving?" reason chooser + optional feedback, a "Pause instead" alternative,
// and Cancel / Confirm Deletion. The server runs retention/anti-fraud holds then erases — the app NEVER deletes
// data locally (Law 11); on success it signs out. Money via MoneyText (Law 2). FLAG_SECURE (balance on screen, §4).
// Behind `system_screens`. Degrade-never-die (skeleton / inline error).
//
// §13 (NOT faked): the design's exact counts — "42 active listings", "187 reviews", "3 open orders" — need a
// per-user totals read-model the mobile contract does NOT expose (listings/orders are keyset PAGES, not totals). So
// those lines render as qualitative categories WITHOUT an invented number; the one number we can source truthfully,
// the wallet balance, comes live from walletBalance() via MoneyText, and the reviews count only shows when the real
// ReviewSummary provides it. The "Pause account" alternative has no mobile endpoint yet → the button honestly shows
// a "coming soon" note rather than pretending to pause. The deletion request is now LIVE (DPDP erasure via the
// identity privacy endpoint): a pending request + its 90-day cooling-off end is surfaced as a banner, re-requesting
// is idempotent, and on failure it degrades to an honest "unavailable" — the app never deletes locally.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Input, MoneyText, SegmentedControl, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useAuth } from '../../core/auth/auth.store';
import { useSecureScreen } from '../../core/security';
import { requestAccountDeletion, openDeletionRequest } from '../../features/system/system.api';
import { DELETE_REASONS, deleteReasonLabelKey, hasWithdrawableBalance, composeDeleteReason, type DeleteReason } from '../../features/system/system';
import { walletBalance } from '../../features/wallet/wallet.api';
import { myBuyerRating } from '../../features/profile/profile.api';

const LOSE_ITEMS = ['listings', 'txnHistory', 'reviews', 'wallet'] as const;
const BEFORE_ITEMS = ['withdraw', 'orders', 'download', 'pending'] as const;

export default function AccountDelete() {
  useSecureScreen(); // wallet balance on screen — FLAG_SECURE (§4)
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('system_screens');
  const { state, signOut } = useAuth();

  const [balanceMinor, setBalanceMinor] = useState<string | null>(null);
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const [isPending, setIsPending] = useState(false);            // an open DPDP deletion request already exists
  const [coolingEndsAt, setCoolingEndsAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState<DeleteReason | ''>('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    const [bal, rev, pending] = await Promise.allSettled([
      walletBalance(),
      state.profile?.id ? myBuyerRating(state.profile.id) : Promise.reject(),
      openDeletionRequest(),
    ]);
    setBalanceMinor(bal.status === 'fulfilled' && !bal.value.failed ? bal.value.availableMinor : null);
    setReviewCount(rev.status === 'fulfilled' && rev.value.count > 0 ? rev.value.count : null);
    const open = pending.status === 'fulfilled' ? pending.value : null;
    setIsPending(!!open);
    setCoolingEndsAt(open?.coolingEndsAt ?? null);
    setLoading(false);
  }, [state.profile?.id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('accountDelete.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;
  if (loading) return <ScreenScaffold title={t('accountDelete.title')}><SkeletonCard lines={4} /><SkeletonCard lines={4} /></ScreenScaffold>;

  const withdrawable = hasWithdrawableBalance(balanceMinor);

  const submit = async () => {
    setBusy(true); setNote(undefined);
    const r = await requestAccountDeletion(composeDeleteReason(reason, feedback) || undefined);
    if (r.ok) { await signOut(); router.replace('/(auth)/welcome'); }
    else { setNote(t('accountDelete.unavailable')); setBusy(false); }
  };

  const loseValue = (key: (typeof LOSE_ITEMS)[number]): string | null => {
    if (key === 'reviews' && reviewCount !== null) return t('accountDelete.lose.reviewsN', { n: reviewCount });
    if (key === 'reviews') return t('accountDelete.lose.reviews');
    return t(`accountDelete.lose.${key}`);
  };

  return (
    <ScreenScaffold
      title={t('accountDelete.title')}
      scroll
      footer={
        <View style={styles.footer}>
          <View style={{ flex: 1 }}><Button title={t('common.cancel')} variant="outline" onPress={() => router.back()} /></View>
          <View style={{ flex: 2 }}><Button title={t(isPending ? 'accountDelete.pendingCta' : 'accountDelete.confirm')} variant="danger" loading={busy} disabled={!reason || isPending} onPress={submit} /></View>
        </View>
      }
    >
      {/* Warning hero */}
      <View style={styles.hero}>
        <Text style={styles.heroIcon}>⚠</Text>
        <Text style={styles.heroTitle}>{t('accountDelete.heroTitle')}</Text>
        <Text style={styles.heroSub}>{t('accountDelete.heroSub')}</Text>
      </View>

      {/* Pending deletion request (DPDP cooling-off already running) — surfaced from the live status read. */}
      {isPending ? (
        <Card style={styles.pending}>
          <Text style={styles.pendingTitle}>{t('accountDelete.pendingTitle')}</Text>
          <Text style={styles.pendingBody}>
            {coolingEndsAt ? t('accountDelete.pendingBody', { date: new Date(coolingEndsAt).toLocaleDateString() }) : t('accountDelete.pendingBodyNoDate')}
          </Text>
        </Card>
      ) : null}

      {/* What happens / You will lose */}
      <Text style={styles.section}>{t('accountDelete.whatHappens')}</Text>
      <Card>
        <Text style={styles.cardLabel}>{t('accountDelete.willLose')}</Text>
        {LOSE_ITEMS.map((k) => (
          <View key={k} style={styles.row}>
            <Text style={styles.bullet}>•</Text>
            {k === 'wallet' ? (
              <Text style={styles.rowText}>{t('accountDelete.lose.wallet')} <MoneyText minor={balanceMinor ?? '0'} langCode={lang} size="md" tone="default" /></Text>
            ) : (
              <Text style={styles.rowText}>{loseValue(k)}</Text>
            )}
          </View>
        ))}
      </Card>

      {/* Before deletion checklist */}
      <Card>
        <Text style={styles.cardLabel}>{t('accountDelete.before')}</Text>
        {BEFORE_ITEMS.map((k) => {
          if (k === 'withdraw' && !withdrawable) return null; // no balance → nothing to withdraw (degrade)
          return (
            <View key={k} style={styles.row}>
              <Text style={styles.check}>☐</Text>
              {k === 'withdraw' ? (
                <Text style={styles.rowText}>{t('accountDelete.before.withdraw')} <MoneyText minor={balanceMinor ?? '0'} langCode={lang} size="md" tone="default" /></Text>
              ) : (
                <Text style={styles.rowText}>{t(`accountDelete.before.${k}`)}</Text>
              )}
            </View>
          );
        })}
      </Card>

      {/* Why leaving? */}
      <Text style={styles.section}>{t('accountDelete.whyLeaving')}</Text>
      <SegmentedControl
        layout="stack"
        accessibilityLabel={t('accountDelete.whyLeaving')}
        options={DELETE_REASONS.map((r) => ({ value: r, label: t(deleteReasonLabelKey(r)) }))}
        value={reason}
        onChange={(v) => setReason(v as DeleteReason)}
      />
      <View style={{ marginTop: space[3] }}>
        <Input label={t('accountDelete.feedback')} value={feedback} onChangeText={setFeedback} multiline maxLength={500} />
      </View>

      {/* Alternative: pause */}
      <View style={styles.alt}>
        <Text style={styles.altIcon}>💡</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.altTitle}>{t('accountDelete.altTitle')}</Text>
          <Text style={styles.altBody}>{t('accountDelete.altBody')}</Text>
          <View style={{ marginTop: space[2], alignSelf: 'flex-start' }}>
            <Button title={t('accountDelete.pause')} variant="ghost" size="md" onPress={() => setNote(t('accountDelete.pauseSoon'))} />
          </View>
        </View>
      </View>

      {note ? <Text style={styles.note}>{note}</Text> : null}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space[2], padding: space[5], borderRadius: radius.lg, backgroundColor: color.dangerLight, marginBottom: space[2] },
  heroIcon: { fontSize: 40, color: color.danger },
  heroTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.dangerDark, textAlign: 'center' },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.danger, textAlign: 'center' },
  pending: { backgroundColor: color.infoLight, marginBottom: space[2] },
  pendingTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.infoDark },
  pendingBody: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, marginTop: space[1], lineHeight: 20 },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  cardLabel: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink700, marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], paddingVertical: space[1] },
  bullet: { fontFamily: font.body, fontSize: font.size.md, color: color.danger, lineHeight: 22 },
  check: { fontFamily: font.body, fontSize: font.size.md, color: color.ink400, lineHeight: 22 },
  rowText: { flex: 1, fontFamily: font.body, fontSize: font.size.md, color: color.ink700, lineHeight: 22 },
  alt: { flexDirection: 'row', gap: space[3], marginTop: space[4], padding: space[4], borderRadius: radius.md, backgroundColor: color.infoLight },
  altIcon: { fontSize: font.size.xl },
  altTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.info },
  altBody: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: 2, lineHeight: 20 },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[3], textAlign: 'center' },
  footer: { flexDirection: 'row', gap: space[3] },
});
