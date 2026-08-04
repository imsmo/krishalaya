// apps/mobile/src/core/release/ForcedUpdateGate.tsx · the FORCED-UPDATE FLOOR enforcement (guide §8). Wraps the
// app: when the `release_gate` flag is on AND the current build is below the minimum supported version, it BLOCKS
// the whole app with an update-required screen + a store link — a known-bad/insecure client can't keep operating.
// Otherwise it renders the app untouched. Reuses the system.update.* i18n (P-23) + the store URLs from config.
// Fail-open: if no min is configured (dev) or the flag is off, the app renders normally (degrade-never-die).
import React from 'react';
import { View, Text, StyleSheet, Linking, Platform, Alert } from 'react-native';
import { Button, ScreenScaffold, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../i18n/useTranslation';
import { useFlag } from '../flags/useFlag';
import { config } from '../config';
import { decideUpdate, effectiveMin } from './update-gate';

export function ForcedUpdateGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const gateOn = useFlag('release_gate');
  const decision = decideUpdate(config.appVersion, effectiveMin(config.minSupportedVersion));

  if (!gateOn || decision !== 'forced') return <>{children}</>;

  const storeUrl = Platform.OS === 'ios' ? config.iosStoreUrl : config.androidStoreUrl;
  const openStore = () => {
    if (storeUrl && /^https:\/\//i.test(storeUrl)) Linking.openURL(storeUrl).catch(() => Alert.alert(t('system.update.title'), t('common.error.generic')));
    else Alert.alert(t('system.update.title'), t('system.update.noStore'));
  };

  return (
    <ScreenScaffold title={t('system.update.title')}>
      <View style={styles.wrap}>
        <Text style={styles.h}>{t('system.update.requiredHeading')}</Text>
        <Text style={styles.body}>{t('system.update.requiredBody')}</Text>
        <Text style={styles.ver}>{t('system.update.version', { v: config.appVersion })}</Text>
        <View style={{ marginTop: space[4] }}><Button title={t('system.update.cta')} onPress={openStore} /></View>
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: space[6] },
  h: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900 },
  body: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700, marginTop: space[2], lineHeight: 22 },
  ver: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400, marginTop: space[3] },
});
