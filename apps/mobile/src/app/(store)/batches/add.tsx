// apps/mobile/src/app/(store)/batches/add.tsx · goods-inward (PC-50 W10-4). Product picked from the REAL
// catalogue search (uuid, never free-typed); MRP typed in rupees → minor by string math (Law 2); expiry may
// not precede mfg; Idempotency-Keyed create (a stock receipt must never double-book — Law 3).
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import type { ProductCard } from '@krishalaya/sdk-js';
import { Button, Card, Input, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { searchProducts, receiveBatch } from '../../../features/store-owner/store.api';
import { buildBatchDraft } from '../../../features/store-owner/store';

export default function AddBatch() {
  const { t } = useTranslation();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [productId, setProductId] = useState('');
  const [form, setForm] = useState({ batchNo: '', qtyReceived: '', unitCode: '', mrpRupees: '', mfgDate: '', expiryDate: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { const h = setTimeout(() => { searchProducts(q).then(setProducts); }, 300); return () => clearTimeout(h); }, [q]);

  const submit = async () => {
    const draft = buildBatchDraft({ productId, ...form });
    if (!draft.ok) { setError(t(`store.add.err.${draft.error}`)); return; }
    setError(null); setBusy(true);
    try { await receiveBatch(draft.value); router.replace('/(store)/batches'); }
    catch { Alert.alert(t('store.add.title'), t('store.add.failed')); }
    finally { setBusy(false); }
  };

  const set = (k: keyof typeof form) => (v: string) => setForm((p) => ({ ...p, [k]: v }));
  return (
    <ScreenScaffold title={t('store.add.title')}>
      <ScrollView>
        <Card>
          <Input label={t('store.add.search')} value={q} onChangeText={setQ} />
          <View style={styles.wrap}>
            {products.map((p) => (
              <Pressable key={p.id} style={[styles.chip, productId === p.id && styles.chipOn]} onPress={() => setProductId(p.id)}>
                <Text style={styles.chipText}>{p.name}</Text>
              </Pressable>
            ))}
          </View>
          <Input label={t('store.add.batchNo')} value={form.batchNo} onChangeText={set('batchNo')} />
          <Input label={t('store.add.qty')} value={form.qtyReceived} keyboardType="decimal-pad" onChangeText={set('qtyReceived')} />
          <Input label={t('store.add.unit')} value={form.unitCode} onChangeText={set('unitCode')} />
          <Input label={t('store.add.mrp')} value={form.mrpRupees} keyboardType="decimal-pad" onChangeText={set('mrpRupees')} />
          <Input label={t('store.add.mfg')} value={form.mfgDate} placeholder="YYYY-MM-DD" onChangeText={set('mfgDate')} />
          <Input label={t('store.add.expiry')} value={form.expiryDate} placeholder="YYYY-MM-DD" onChangeText={set('expiryDate')} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title={t('store.add.submit')} onPress={submit} disabled={busy || !productId} />
        </Card>
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1], marginTop: space[2] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: radius.pill, borderWidth: 1, borderColor: color.ink100 },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontSize: font.size.xs, color: color.ink800 },
  error: { color: color.danger, fontSize: font.size.xs, marginTop: space[2] },
});
