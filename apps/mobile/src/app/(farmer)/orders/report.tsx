// apps/mobile/src/app/(farmer)/orders/report.tsx · screen 135 (report a problem with an order). Thin screen
// (guide §3): a free-text note → reportOrder, which opens a dispute case server-side (the server decides severity,
// escrow holds, and routing — the client only files it). Idempotent. Behind `orders_fulfilment`. Degrade-never-die.
import React, { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Input, EmptyState, ScreenScaffold, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { reportOrder } from '../../../features/orders/orders.api';

export default function ReportOrder() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('orders_fulfilment');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!enabled) return <ScreenScaffold title={t('report.title')}><EmptyState title={t('orders.unavailable')} /></ScreenScaffold>;

  const onSubmit = async () => {
    if (!orderId || note.trim().length < 5) { setError(t('report.tooShort')); return; }
    setBusy(true); setError(undefined);
    try {
      await reportOrder(orderId, note.trim());
      router.replace({ pathname: '/(farmer)/orders', params: { notice: t('report.filed') } });
    } catch (e) {
      setError(e instanceof SdkError && e.isConflict ? t('report.already') : t('report.failed'));
    } finally { setBusy(false); }
  };

  return (
    <ScreenScaffold
      title={t('report.title')}
      footer={<Button title={t('report.submit')} onPress={onSubmit} loading={busy} disabled={note.trim().length < 5} />}
    >
      <Text style={styles.help}>{t('report.help')}</Text>
      <Input label={t('report.noteLabel')} value={note} onChangeText={setNote} multiline maxLength={2000} autoFocus error={error} />
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  help: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600, marginBottom: space[3] },
});
