// apps/mobile/src/app/(auth)/role.tsx · screen 04 (Choose Role) — rebuilt to match the Phase-1 design
// (Krishalaya_Design_System/screens/04-role.html): a back-button app-bar titled "Choose Your Role", a hero
// ("How will you use Krishalaya?" + helper), five role cards each with a gradient icon tile, the English name
// with its Devanagari vernacular beside it, a one-line description, and a chevron; the selected card gets the
// green border + tint. A pinned "Continue as <role>" CTA carries the pick forward.
// KV-BL-066 (screens 04/433 canon): Continue now actually GRANTS the role server-side — POST
// /v1/onboarding/roles (Idempotency-Key) — before navigating on. Farmer + Buyer are self-serve at this pilot; the
// other cards carry an honest "Invite only" / "Coming soon" chip (mirrored client-side from the API's own
// SELF_SERVE_ALLOWED/INVITE_ONLY, role-switcher.ts) so nothing looks tappable-but-secretly-dead — but every card
// stays tappable and the SERVER remains the sole authority: a 403 (SELFSERVE_ROLE_NOT_ELIGIBLE) is caught and
// shown as an inline banner (design canon: invite banner), never a silent failure or a fake local grant.
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SdkError } from '@krishalaya/sdk-js';
import { ROLES, backendRoleCode, roleEligibility, type AppRole, type RoleDef } from '../../core/auth/role-switcher';
import { Button, Icon, IconBadge, StatusPill, type IconName, color, font, space, radius, shadow } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useAuth } from '../../core/auth/auth.store';
import { grantRole } from '../../features/onboarding/role-select.api';

// The five roles shown on this screen, IN THE DESIGN'S ORDER, each with its glyph + gradient (verbatim from the
// 04-role design's .role-icon.* tones, mapped to theme tokens where they exist; tenant purple is a design
// artwork tone with no token). `role` keys into ROLES for the i18n + navigation contract.
interface RoleCard { role: AppRole; icon: IconName; from: string; to: string; }
const ROLE_CARDS: readonly RoleCard[] = [
  { role: 'farmer', icon: 'sprout', from: color.primary500, to: color.primary600 },
  { role: 'buyer', icon: 'bag', from: color.accent400, to: color.accent600 },
  { role: 'trader', icon: 'truck', from: color.info, to: color.infoDark },
  { role: 'owner', icon: 'building', from: '#6c3483', to: '#50265f' },
  { role: 'ambassador', icon: 'user-check', from: color.danger, to: color.dangerDark },
];

const DEF: Record<AppRole, RoleDef> = Object.fromEntries(ROLES.map((r) => [r.role, r])) as Record<AppRole, RoleDef>;

export default function RoleScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { selectRole, loadProfile } = useAuth();
  const [picked, setPicked] = useState<AppRole>('farmer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const onContinue = async () => {
    if (busy) return;
    setBusy(true); setError(undefined);
    try {
      // Self-serve-grant the role server-side (KV-BL-066) BEFORE navigating on — Law 4: the server is the sole
      // authority on what the account may do, so this is never a purely-local pick.
      await grantRole(backendRoleCode(picked));
      await selectRole(picked);   // local UI state: which dashboard/nav this device shows
      await loadProfile();        // refresh state.profile.roles from the server (now includes the new grant)
      router.replace('/(auth)/profile');
    } catch (e) {
      if (e instanceof SdkError && e.code === 'SELFSERVE_ROLE_NOT_ELIGIBLE') {
        const reason = (e.details as { reason?: string } | undefined)?.reason;
        setError(reason === 'invite_only' ? t('role.error.inviteOnly') : reason === 'not_pilot_ga' ? t('role.error.notPilotGa') : t('role.error.notEligible'));
      } else {
        // S6-prep DEV AID: in dev builds append the real code+message so the founder can share the
        // exact failure (the SDK also console.warns it to the Metro terminal). Production stays generic.
        const detail = __DEV__ && e instanceof SdkError ? `\n[dev] ${e.status} ${e.code}: ${e.message}` : '';
        setError(t('role.error.generic') + detail);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* App bar: back + centred title */}
      <View style={styles.appbar}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={styles.backBtn}>
          <Icon name="arrow-left" size={20} color={color.ink700} />
        </Pressable>
        <Text style={styles.appbarTitle}>{t('role.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <Text style={styles.heading}>{t('role.heading')}</Text>
        <Text style={styles.sub}>{t('role.subtitle')}</Text>

        {/* Role cards */}
        <View style={styles.list}>
          {ROLE_CARDS.map((c) => {
            const def = DEF[c.role];
            const active = c.role === picked;
            const eligibility = roleEligibility(c.role);
            return (
              <Pressable
                key={c.role}
                onPress={() => setPicked(c.role)}
                style={[styles.card, active && styles.cardActive]}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${t(def.i18nKey)} — ${t(def.descKey)}`}
              >
                <IconBadge name={c.icon} from={c.from} to={c.to} />
                <View style={styles.body}>
                  <Text style={styles.name}>
                    {t(def.i18nKey)}
                    <Text style={styles.vern}>  {t(`role.vern.${c.role}`)}</Text>
                  </Text>
                  <Text style={styles.desc}>{t(def.descKey)}</Text>
                  {eligibility !== 'self_serve' ? (
                    <View style={styles.badgeRow}>
                      <StatusPill
                        label={eligibility === 'invite_only' ? t('role.badge.inviteOnly') : t('role.badge.comingSoon')}
                        tone={eligibility === 'invite_only' ? 'info' : 'neutral'}
                      />
                    </View>
                  ) : null}
                </View>
                <Icon name="chevron-right" size={20} color={active ? color.primary600 : color.ink400} />
              </Pressable>
            );
          })}
        </View>

        {/* Invite footnote (design canon 433) — the two roles above with the "Invite only" chip are added by a
            tenant admin/FPO, never self-serve pick; this never blocks the tap, only sets honest expectations. */}
        <Text style={styles.footnote}>{t('role.inviteFootnote')}</Text>
      </ScrollView>

      {error ? (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Text style={styles.errorGlyph}>⚠</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button title={t('role.continueAs', { role: t(DEF[picked].i18nKey) })} size="lg" onPress={onContinue} loading={busy} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },

  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[2] },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },
  appbarTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },

  scroll: { paddingHorizontal: space[5], paddingTop: space[3], paddingBottom: space[4] },
  heading: { fontFamily: font.display, fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: color.ink800, letterSpacing: -0.3 },
  sub: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500, marginTop: space[1] },

  list: { gap: space[3], marginTop: space[5] },
  card: { flexDirection: 'row', alignItems: 'center', gap: space[4], padding: space[4], borderRadius: radius.lg, borderWidth: 2, borderColor: color.earth200, backgroundColor: color.card },
  cardActive: { borderColor: color.primary600, backgroundColor: color.primary50, ...shadow.card },
  body: { flex: 1 },
  name: { fontFamily: font.body, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, lineHeight: 22 },
  vern: { fontFamily: font.vernacular, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary700 },
  desc: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2 },
  badgeRow: { marginTop: space[2] },
  footnote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[4], lineHeight: 18 },

  errorBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], marginHorizontal: space[5], marginBottom: space[2], padding: space[3], borderRadius: radius.md, backgroundColor: color.dangerLight },
  errorGlyph: { fontSize: font.size.md, color: color.dangerDark },
  errorText: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, lineHeight: 19 },

  actions: { paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[4] },
});
