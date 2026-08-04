// apps/mobile/src/app/(farmer)/schemes/docs.tsx · screen 108 (application documents). Thin screen (guide §3): the
// documents attached to a submitted application (read off the application's formData — there's no separate doc
// endpoint). FLAG_SECURE while shown (identity documents). Behind `schemes_govt`. Degrade-never-die.
// NOTE: doc-type names aren't exposed (UUIDs) → shown as "Document N"; the file opens via a presigned media URL.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Alert, Linking } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button, Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { getApplication, schemeDocUrl } from '../../../features/schemes/schemes.api';
import { readApplicationDocuments } from '../../../features/schemes/schemes';

export default function SchemeDocs() {
  useSecureScreen();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const enabled = useFlag('schemes_govt');
  const [docs, setDocs] = useState<Array<{ docTypeId: string; mediaId: string }>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) { setLoading(false); return; }
    setLoading(true);
    const app = await getApplication(id);
    setDocs(app ? readApplicationDocuments(app.formData) : []);
    setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('schemes.docs.viewTitle')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const open = async (mediaId: string) => {
    const url = await schemeDocUrl(mediaId);
    if (url && /^https:\/\//i.test(url)) Linking.openURL(url).catch(() => Alert.alert(t('schemes.docs.viewTitle'), t('common.error.generic')));
    else Alert.alert(t('schemes.docs.viewTitle'), t('schemes.docs.openFailed'));
  };

  return (
    <ScreenScaffold title={t('schemes.docs.viewTitle')}>
      {loading ? <SkeletonCard lines={4} /> : docs.length === 0 ? (
        <EmptyState title={t('schemes.docs.empty.title')} message={t('schemes.docs.empty.message')} />
      ) : (
        <FlatList
          data={docs}
          keyExtractor={(d) => d.docTypeId}
          renderItem={({ item, index }) => (
            <Card style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.label}>{t('schemes.docs.item', { n: index + 1 })}</Text>
                <Button title={t('schemes.docs.open')} variant="outline" onPress={() => open(item.mediaId)} />
              </View>
            </Card>
          )}
          contentContainerStyle={{ paddingBottom: space[6] }}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  label: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, flex: 1 },
});
