// apps/mobile/src/app/(owner)/branding.tsx · screen 82 (App Branding). Thin screen (guide §3): the branding editor's
// section structure (preview / logo / brand colors / display info), each handing off to the web admin console.
// Branding editing is heavy config — logo MEDIA upload, colour pickers with live preview, WCAG auto-validation, and
// Save & Publish — none of which have a mobile contract, so it lives on the web console (Law 11 lite boundary).
// Behind `tenant_admin_lite`. core/deeplink degrades if the console isn't openable.
//
// §13 (NOT faked): the section + field TITLES (Logo / Primary brand / Accent / App display name / Tagline / Custom
// domain) and the WCAG-contrast guidance are fixed UI chrome (i18n). The mockup's actual brand VALUES are DROPPED
// rather than invented: the live preview ("A · Anand FPO · Your Trusted Partner · Sell my crop"), the logo file
// ("anand-fpo-logo.svg"), and the colour swatches ("#1E6F3F", "#F39C12") are per-tenant config keyed under
// tenant-settings whose exact keys aren't a stable mobile contract — showing a guessed/hardcoded name or hex would
// be fabrication. So each row opens the real branding editor; nothing is faked.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ScrollView } from 'react-native';
import { Card, EmptyState, ScreenScaffold, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { openWebConsole } from '../../core/deeplink';
import { WEB_PATHS } from '../../features/tenant/web-console';

const SECTIONS: { key: string; items: { key: string; icon: string }[]; noteKey?: string }[] = [
  { key: 'logo', items: [{ key: 'logo', icon: '🖼️' }] },
  { key: 'colors', items: [{ key: 'primary', icon: '🎨' }, { key: 'accent', icon: '🎨' }], noteKey: 'owner.branding.wcagNote' },
  { key: 'display', items: [{ key: 'name', icon: '🏷️' }, { key: 'tagline', icon: '💬' }, { key: 'domain', icon: '🌐' }] },
];

export default function Branding() {
  const { t } = useTranslation();
  const enabled = useFlag('tenant_admin_lite');
  const [busy, setBusy] = useState(false);

  if (!enabled) return <ScreenScaffold title={t('owner.branding.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const open = async () => {
    setBusy(true);
    try { if (!(await openWebConsole(WEB_PATHS.branding))) Alert.alert(t('owner.branding.title'), t('owner.web.unavailable')); }
    finally { setBusy(false); }
  };

  return (
    <ScreenScaffold title={t('owner.branding.title')} scroll={false}>
      <ScrollView contentContainerStyle={{ gap: space[4], paddingBottom: space[6] }} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>{t('owner.branding.webNote')}</Text>
        {SECTIONS.map((s) => (
          <View key={s.key} style={{ gap: space[2] }}>
            <Text style={styles.section}>{t(`owner.branding.${s.key}.title`)}</Text>
            {s.items.map((it) => (
              <Pressable key={it.key} onPress={open} disabled={busy} accessibilityRole="button" accessibilityLabel={t(`owner.branding.field.${it.key}`)}>
                <Card style={styles.row}>
                  <Text style={styles.icon}>{it.icon}</Text>
                  <Text style={styles.itemTitle}>{t(`owner.branding.field.${it.key}`)}</Text>
                  <Text style={styles.chev}>{'›'}</Text>
                </Card>
              </Pressable>
            ))}
            {s.noteKey ? <Text style={styles.note}>{t(s.noteKey)}</Text> : null}
          </View>
        ))}
        <Text style={styles.hint}>{t('owner.web.hint')}</Text>
      </ScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  intro: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, lineHeight: font.size.sm * 1.5 },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink700 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  icon: { fontSize: font.size.lg },
  itemTitle: { flex: 1, fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  chev: { fontFamily: font.body, fontSize: font.size.xl, color: color.ink400 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.warningDark, lineHeight: font.size.xs * 1.5 },
  hint: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, textAlign: 'center' },
});
