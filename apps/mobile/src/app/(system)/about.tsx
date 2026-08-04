// apps/mobile/src/app/(system)/about.tsx · screen 196 (About Krishalaya). Thin screen (guide §3): a 🌾 hero
// (name + version subtitle + tagline), an App-info card (version, languages), the mission statement, Legal links
// (Terms / Privacy / Licenses), the publisher identity, Connect rows (email / website / WhatsApp), and the footer.
// Config-driven — no backend, so it cannot fail a network call. Behind `system_screens`.
//
// §13 (NOT faked): the Version + language set are REAL (config.appVersion, the i18n registry via languagesSummary).
// The design's "Build 247", "Last updated 22 Aug 2026" and "Download size 18 MB" have NO mobile contract (no build
// number / release-notes / package-size field) so those rows are OMITTED rather than shown with invented values
// (consistent with screen 190). Terms/Privacy open the REAL config URLs (config.termsUrl / privacyUrl) and degrade
// to a "link unavailable" note if a build ships without them; "Licenses (Open Source)" has no screen/URL yet →
// shown as a coming-soon row, never a dead link. The publisher identity, mission, and Connect details are the
// company's own static product chrome (i18n), not per-user data. Version/build-number surfacing is flagged.
import React from 'react';
import { View, Text, StyleSheet, Linking, Alert } from 'react-native';
import { Card, ScreenScaffold, EmptyState, color, font, space, radius } from '@krishalaya/ui-native';
import { LANGUAGES } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { config } from '../../core/config';
import { languagesSummary } from '../../features/system/system';

export default function About() {
  const { t } = useTranslation();
  const enabled = useFlag('system_screens');

  const openUrl = (url: string | undefined, scheme: RegExp) => {
    if (url && scheme.test(url)) Linking.openURL(url).catch(() => Alert.alert(t('system.about.title'), t('common.error.generic')));
    else Alert.alert(t('system.about.title'), t('system.about.noLink'));
  };

  if (!enabled) return <ScreenScaffold title={t('system.about.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('system.about.title')} scroll>
      <View style={styles.hero}>
        <Text style={styles.heroIcon}>🌾</Text>
        <Text style={styles.name}>{t('app.name')}</Text>
        <Text style={styles.version}>{t('system.about.versionLine', { v: config.appVersion })}</Text>
        <Text style={styles.builtBy}>{t('system.about.builtBy')}</Text>
        <Text style={styles.tagline}>{t('system.about.tagline')}</Text>
      </View>

      <Text style={styles.section}>{t('system.about.appInfo')}</Text>
      <Card>
        <Row k={`📱 ${t('system.about.version')}`} v={config.appVersion} />
        <Row k={`🌐 ${t('system.about.languages')}`} v={languagesSummary(LANGUAGES)} />
      </Card>

      <Text style={styles.section}>{t('system.about.mission')}</Text>
      <Card><Text style={styles.mission}>{t('system.about.missionQuote')}</Text></Card>

      <Text style={styles.section}>{t('system.about.legal')}</Text>
      <View style={styles.group}>
        <LinkRow label={`📋 ${t('system.about.terms')}`} onPress={() => openUrl(config.termsUrl, /^https:\/\//i)} />
        <LinkRow label={`🔒 ${t('system.privacy.policy')}`} onPress={() => openUrl(config.privacyUrl, /^https:\/\//i)} />
        <LinkRow label={`📜 ${t('system.about.licenses')}`} onPress={() => Alert.alert(t('system.about.title'), t('system.about.comingSoon'))} />
      </View>
      <Card style={{ marginTop: space[2] }}>
        <Text style={styles.company}>{t('system.about.company')}</Text>
        <Text style={styles.cin}>{t('system.about.cin')}</Text>
      </Card>

      <Text style={styles.section}>{t('system.about.connect')}</Text>
      <View style={styles.group}>
        <LinkRow label={`📧 ${t('system.about.email')}`} onPress={() => openUrl(`mailto:${t('system.about.email')}`, /^mailto:/i)} />
        <LinkRow label={`🌐 ${t('system.about.website')}`} onPress={() => openUrl(`https://${t('system.about.website')}`, /^https:\/\//i)} />
        <LinkRow label={`💬 ${t('system.about.whatsapp')}`} onPress={() => openUrl(`https://wa.me/${t('system.about.whatsappNumber')}`, /^https:\/\//i)} />
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>{t('system.about.madeIn')}</Text>
        <Text style={styles.footerText}>{t('system.about.copyright')}</Text>
      </View>
    </ScreenScaffold>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <View style={styles.row}><Text style={styles.k}>{k}</Text><Text style={styles.v}>{v}</Text></View>;
}
function LinkRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Card onPress={onPress} accessibilityLabel={label}>
      <View style={styles.linkRow}><Text style={styles.link}>{label}</Text><Text style={styles.chev}>›</Text></View>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space[1], padding: space[5], borderRadius: radius.lg, backgroundColor: color.primary50, marginBottom: space[2] },
  heroIcon: { fontSize: 48 },
  name: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900 },
  version: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  builtBy: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[1] },
  tagline: { fontFamily: font.body, fontSize: font.size.md, color: color.primary700, fontWeight: font.weight.semibold, textAlign: 'center', marginTop: space[1] },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space[4], marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[1] },
  k: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500 },
  v: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  mission: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700, lineHeight: 24, fontStyle: 'italic' },
  group: { gap: space[2] },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  chev: { fontFamily: font.body, fontSize: font.size.xl, color: color.ink400 },
  company: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  cin: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2 },
  footer: { alignItems: 'center', gap: space[1], marginTop: space[5], marginBottom: space[4] },
  footerText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400 },
});
