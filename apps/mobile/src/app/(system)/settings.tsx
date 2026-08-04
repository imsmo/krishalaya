// apps/mobile/src/app/(system)/settings.tsx · screen 75 (Settings hub) — rebuilt to the Phase-1 design: an identity
// header (avatar + name + KYC badge), grouped sections (Account / Preferences / Security & Privacy / Support), a
// Logout, and a version footer. Thin screen (guide §3): reads the profile + KYC + payout destinations, renders
// ui-native rows that deep-link to the real screens. Behind `system_screens`. Degrade-never-die (skeleton on the
// data rows). FLAG_SECURE (payout/KYC details on screen, §4).
//
// §13 (NOT faked): the name (profile.displayName), the KYC ✓ badge (real verified doc), the Bank/UPI sub-lines
// (real count + masked last-4 / VPA), the Language value (profile.locale), and the app version (config.appVersion)
// are all REAL. The design's masked PHONE ("+91 98765 ●●●●●") + LOCATION ("Anand, Gujarat") are NOT on the profile
// contract (and the phone is deliberately never held client-side, §4) → the header omits them rather than
// fabricating. "★ Verified Seller" has no seller-verified flag → omitted. "App PIN · On" has no app-PIN contract →
// shown as a coming-soon info row, never a fake toggle. The build number ("Build 142") isn't in config → only the
// real version is shown.
//
// DEV-20 (2026-07-24): "App Theme" is now a REAL 3-way preference (system/light/dark, `core/mechanisms/theme.ts` +
// `useThemeMode`), persisted via AsyncStorage and applied to the OS status-bar icon color at boot (`_layout.tsx`).
// HONEST BOUNDARY (unchanged from this batch's own theme.ts header): the mobile canon has not ratified a
// farmer-app dark PALETTE (grep-verified zero `data-theme`/dark rules in `system/screen.css`) — so choosing
// "Dark" here changes the resolved scheme + status-bar icon color, not a screen repaint. "Senior Mode" is a new
// real toggle (`useSeniorMode`, Q48: 1.30x type + 56px taps) — this screen's own `Row` component consumes it
// directly, so every row on THIS screen genuinely scales when it's on (the honest-minimum wiring scope for this
// batch; other screens are not retrofitted, same "ship the mechanism, don't force every markup file" precedent
// DEV-19 used for its own dark/senior CSS overrides).
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { KycDocument, BankAccount } from '@krishalaya/sdk-js';
import { LANGUAGES } from '@krishalaya/i18n';
import { Button, Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, Toggle, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useAuth } from '../../core/auth/auth.store';
import { useSecureScreen } from '../../core/security/screen-guard';
import { config } from '../../core/config';
import { myDocuments, myBankAccounts } from '../../features/profile/profile.api';
import { initials, hasVerifiedKyc, bankCodeFromIfsc } from '../../features/profile/profile';
import { useThemeMode } from '../../core/mechanisms/useThemeMode';
import { useSeniorMode } from '../../core/mechanisms/useSeniorMode';
import type { ThemeMode } from '../../core/mechanisms/theme';

const THEME_CYCLE: ThemeMode[] = ['system', 'light', 'dark'];

export default function Settings() {
  useSecureScreen();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('system_screens');
  const notifOn = useFlag('notifications');
  const { state, signOut } = useAuth();
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode();
  const { enabled: seniorOn, setEnabled: setSeniorOn } = useSeniorMode();
  const [docs, setDocs] = useState<KycDocument[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, b] = await Promise.all([myDocuments(), myBankAccounts()]);
    setDocs(d); setBanks(b); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) load(); else setLoading(false); }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('settings.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const onSignOut = async () => { await signOut(); router.replace('/(auth)/welcome'); };

  const themeLabel = ({ system: t('settings.themeSystem'), light: t('settings.themeLight'), dark: t('settings.themeDark') } as Record<ThemeMode, string>)[themeMode];
  const cycleTheme = () => setThemeMode(THEME_CYCLE[(THEME_CYCLE.indexOf(themeMode) + 1) % THEME_CYCLE.length]);

  const name = state.profile?.displayName ?? t('home.defaultName');
  const kycVerified = hasVerifiedKyc(docs);
  const langLabel = LANGUAGES.find((l) => l.code === (state.profile?.locale ?? state.language))?.nameNative ?? '';

  const bankAccts = banks.filter((a) => a.accountKind === 'bank');
  const primaryBank = bankAccts.find((a) => a.isPrimary) ?? bankAccts[0];
  const bankSub = bankAccts.length === 0 ? t('settings.bankNone')
    : t('settings.bankSub', { n: bankAccts.length, code: primaryBank ? (bankCodeFromIfsc(primaryBank.ifsc) ?? '') : '', last4: primaryBank?.accountLast4 ?? '' });
  const upis = banks.filter((a) => a.accountKind === 'upi');
  const primaryUpi = upis.find((a) => a.isPrimary) ?? upis[0];
  const upiSub = primaryUpi?.upiId ? t('settings.upiSub', { vpa: primaryUpi.upiId }) : t('settings.upiNone');

  return (
    <ScreenScaffold title={t('settings.title')} scroll>
      {/* Identity header */}
      <View style={styles.header}>
        <View style={styles.avatar}><Text style={styles.avatarTxt}>{initials(name)}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{name}</Text>
          <View style={styles.badges}>
            {kycVerified ? <StatusPill label={t('settings.kycBadge')} tone="success" /> : null}
          </View>
        </View>
      </View>

      {loading ? <SkeletonCard lines={6} /> : (
        <>
          {/* Account */}
          <Text style={styles.section}>{t('settings.account')}</Text>
          <Card>
            <Row title={t('settings.editProfile')} sub={t('settings.editProfileSub')} onPress={() => router.push('/(farmer)/profile/edit')} />
            <Row title={t('settings.bankAccounts')} sub={bankSub} onPress={() => router.push('/(farmer)/profile/bank')} divide />
            <Row title={t('settings.upiIds')} sub={upiSub} onPress={() => router.push('/(farmer)/wallet/upi')} divide />
          </Card>

          {/* Preferences */}
          <Text style={styles.section}>{t('settings.preferences')}</Text>
          <Card>
            <Row title={t('settings.language')} value={langLabel} onPress={() => router.push('/(system)/language')} />
            {notifOn ? <Row title={t('settings.notifications')} sub={t('settings.notificationsSub')} onPress={() => router.push('/(farmer)/notifications/settings')} divide /> : null}
            {/* DEV-20: real 3-way preference, tap cycles system → light → dark. See file header's honest boundary
                on why "Dark" changes the resolved scheme/status-bar icon, not a screen repaint yet. */}
            <Row title={t('settings.theme')} value={themeLabel} onPress={cycleTheme} divide />
            {/* DEV-20 (Q48): real senior-mode toggle — this screen's own Row honors it (scaled type + 56px taps). */}
            <View style={[styles.divide, { paddingHorizontal: 0 }]}>
              <Toggle label={t('settings.seniorMode')} hint={t('settings.seniorModeSub')} value={seniorOn} onValueChange={setSeniorOn} />
            </View>
          </Card>

          {/* Security & Privacy */}
          <Text style={styles.section}>{t('settings.security')}</Text>
          <Card>
            {/* §13: no app-PIN contract → coming-soon info row, not a fake toggle. */}
            <Row title={t('settings.appPin')} sub={t('settings.appPinSoon')} />
            <Row title={t('settings.privacy')} sub={t('settings.privacySub')} onPress={() => router.push('/(system)/privacy')} divide />
            <Row title={t('settings.permissions')} sub={t('settings.permissionsSub')} onPress={() => router.push('/(system)/permissions')} divide />
          </Card>

          {/* Support */}
          <Text style={styles.section}>{t('settings.support')}</Text>
          <Card>
            <Row title={t('settings.helpFaq')} onPress={() => router.push('/(farmer)/profile/help')} />
            <Row title={t('settings.contactSupport')} sub={t('settings.contactSupportSub')} onPress={() => router.push('/(farmer)/profile/help')} divide />
            <Row title={t('settings.about')} onPress={() => router.push('/(system)/about')} divide />
          </Card>

          <View style={{ marginTop: space[5] }}>
            <Button title={t('common.signOut')} variant="outline" onPress={onSignOut} />
          </View>
          <Text style={styles.version}>{t('settings.versionLine', { version: config.appVersion })}</Text>
        </>
      )}
    </ScreenScaffold>
  );
}

// DEV-20: Row reads senior mode itself (no prop drilling needed) — this makes EVERY row on this screen honor
// Q48's 1.30x type-scale + 56px tap floor the instant the toggle above is on, real and screen-wide, not just the
// one row that owns the toggle.
function Row({ title, sub, value, onPress, divide }: { title: string; sub?: string; value?: string; onPress?: () => void; divide?: boolean }) {
  const { enabled: seniorOn, fontSize, tapMin } = useSeniorMode();
  const body = (
    <View style={[styles.row, divide && styles.divide, seniorOn && { minHeight: tapMin }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, seniorOn && { fontSize: fontSize.md }]}>{title}</Text>
        {sub ? <Text style={[styles.rowSub, seniorOn && { fontSize: fontSize.xs }]}>{sub}</Text> : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress ? <Text style={styles.chev}>›</Text> : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>{body}</Pressable> : body;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3], marginTop: space[2] },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: color.primary600, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.white },
  name: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900 },
  badges: { flexDirection: 'row', gap: space[2], marginTop: space[1] },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3], minHeight: 48 },
  divide: { borderTopWidth: 1, borderTopColor: color.ink100 },
  rowTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  rowSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  rowValue: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  chev: { fontFamily: font.body, fontSize: font.size.lg, color: color.ink400 },
  version: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center', marginTop: space[4] },
});
