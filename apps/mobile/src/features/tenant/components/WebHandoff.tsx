// apps/mobile/src/features/tenant/components/WebHandoff.tsx · the reusable "do this on the web console" card for
// tenant-admin-lite heavy editing (P-18). Built only from ui-native primitives. Opens a validated https console
// URL via core/deeplink (degrade-never-die: if the console isn't configured/openable, it tells the user instead
// of failing). Optionally shows a "flagged: no mobile API yet" note so we never imply a fake in-app action.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Button, Card, ScreenScaffold, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { openWebConsole } from '../../../core/deeplink';

export function WebHandoff({ titleKey, bodyKey, path, noteKey }: { titleKey: string; bodyKey: string; path: string; noteKey?: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try { const ok = await openWebConsole(path); if (!ok) Alert.alert(t(titleKey), t('owner.web.unavailable')); }
    finally { setBusy(false); }
  };
  return (
    <ScreenScaffold title={t(titleKey)} footer={<Button title={t('owner.web.open')} loading={busy} onPress={open} />}>
      <Card>
        <Text style={styles.body}>{t(bodyKey)}</Text>
        {noteKey ? <Text style={styles.note}>{t(noteKey)}</Text> : null}
        <Text style={styles.hint}>{t('owner.web.hint')}</Text>
      </Card>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700 },
  note: { fontFamily: font.body, fontSize: font.size.sm, color: color.warningDark, marginTop: space[3] },
  hint: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400, marginTop: space[3] },
});
