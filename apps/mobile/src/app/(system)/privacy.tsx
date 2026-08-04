// apps/mobile/src/app/(system)/privacy.tsx · screen 178 (Privacy Settings) — rebuilt to the Phase-1 design
// (screens/178-privacy-settings.html): Profile-visibility toggles, Data-&-analytics toggles, a DPDP "Data rights"
// action list (download / delete-specific / withdraw-consent), and the DPDP-compliance footer + privacy-policy
// link. Thin screen (guide §3). Each toggle is a real DPDP consent purpose: the granted STATE is loaded from the
// server (privacy.listConsents) and each flip is persisted append-only (privacy.setConsent, idempotent — Law 3),
// optimistic with revert on failure. Behind `system_screens`. Degrade-never-die.
//
// §13 (NOT faked): consent is opt-IN — a purpose absent from the server list reads as OFF (the safe DPDP default),
// never a fabricated "on". "Download my data" opens the real export screen; "Delete specific data" (granular
// erasure) and "Withdraw consent" as a bulk action have NO dedicated mobile endpoint yet, so they degrade to an
// honest note (withdraw points the user at the toggles above, which ARE per-purpose consent withdrawal) rather than
// pretending to act. The privacy-policy link opens config.privacyUrl only when it's a real https URL.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Linking, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Card, Toggle, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { config } from '../../core/config';
import { getConsents, setConsent } from '../../features/system/system.api';
import { CONSENT_TOGGLES, consentLabelKey, consentHintKey, consentGranted } from '../../features/system/system';

const DATA_RIGHTS = [
  { key: 'download', icon: '📥', route: '/(system)/data-download' as const },
  { key: 'deleteSpecific', icon: '🗑', route: null },
  { key: 'withdraw', icon: '✋', route: null },
] as const;

export default function Privacy() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('system_screens');
  const [granted, setGranted] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    const list = await getConsents();
    const map: Record<string, boolean> = {};
    for (const tg of CONSENT_TOGGLES) map[tg.code] = consentGranted(list, tg.code);
    setGranted(map);
    setLoading(false);
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('privacySettings.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;
  if (loading) return <ScreenScaffold title={t('privacySettings.title')}><SkeletonCard lines={4} /><SkeletonCard lines={4} /></ScreenScaffold>;

  const onToggle = async (code: string, value: boolean) => {
    const prev = granted[code];
    setGranted((g) => ({ ...g, [code]: value })); // optimistic
    const r = await setConsent(code, value);
    if (!r.ok) { setGranted((g) => ({ ...g, [code]: prev })); setNote(t('privacySettings.saveFailed')); }
    else setNote(undefined);
  };

  const openPolicy = () => {
    const url = config.privacyUrl;
    if (url && /^https:\/\//i.test(url)) Linking.openURL(url).catch(() => setNote(t('common.error.generic')));
    else setNote(t('privacySettings.noPolicy'));
  };

  const onRight = (key: string, route: string | null) => {
    if (route) router.push(route as never);
    else if (key === 'withdraw') setNote(t('privacySettings.withdrawHint'));
    else setNote(t('privacySettings.soon'));
  };

  const group = (g: 'profile' | 'data') => CONSENT_TOGGLES.filter((x) => x.group === g);

  return (
    <ScreenScaffold title={t('privacySettings.title')} scroll>
      <Text style={styles.section}>{t('privacySettings.section.profile')}</Text>
      <Card>
        {group('profile').map((tg) => (
          <Toggle key={tg.code} label={t(consentLabelKey(tg.code))} hint={t(consentHintKey(tg.code))} value={!!granted[tg.code]} onValueChange={(v) => onToggle(tg.code, v)} />
        ))}
      </Card>

      <Text style={styles.section}>{t('privacySettings.section.data')}</Text>
      <Card>
        {group('data').map((tg) => (
          <Toggle key={tg.code} label={t(consentLabelKey(tg.code))} hint={t(consentHintKey(tg.code))} value={!!granted[tg.code]} onValueChange={(v) => onToggle(tg.code, v)} />
        ))}
      </Card>

      <Text style={styles.section}>{t('privacySettings.section.rights')}</Text>
      <View style={{ gap: space[2] }}>
        {DATA_RIGHTS.map((r) => (
          <Card key={r.key} onPress={() => onRight(r.key, r.route)} accessibilityLabel={t(`privacySettings.rights.${r.key}.title`)}>
            <View style={styles.rightRow}>
              <Text style={styles.rightIcon}>{r.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.rightTitle}>{t(`privacySettings.rights.${r.key}.title`)}</Text>
                <Text style={styles.rightSub}>{t(`privacySettings.rights.${r.key}.sub`)}</Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </View>
          </Card>
        ))}
      </View>

      {note ? <Text style={styles.note}>{note}</Text> : null}

      <View style={styles.footer}>
        <Text style={styles.footerText}>{`🔒  ${t('privacySettings.compliance')}`}</Text>
        <Text style={styles.policyLink} onPress={openPolicy} accessibilityRole="link">{t('privacySettings.readPolicy')}</Text>
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  rightRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  rightIcon: { fontSize: font.size.xl },
  rightTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  rightSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2 },
  chev: { fontFamily: font.body, fontSize: font.size.xl, color: color.ink400 },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[3], textAlign: 'center' },
  footer: { marginTop: space[5], padding: space[4], borderRadius: radius.md, backgroundColor: color.earth100, alignItems: 'center', gap: space[1] },
  footerText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, textAlign: 'center' },
  policyLink: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
});
