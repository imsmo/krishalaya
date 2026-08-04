// apps/mobile/src/app/(buyer)/addresses.tsx · screen 134 (My Addresses — the delivery address book). Thin screen
// (guide §3): list the buyer's saved addresses (primary first), add / edit / make-primary / remove — all REAL,
// server-authoritative (addresses.api → SDK). Contact name/phone are PII shown only to the owner; validation is
// client-side for UX (the server re-validates, zod .strict). Behind `buyer_checkout`. Degrade-never-die.
//
// §13 (no contract → rendered honestly, never faked): the design's address TYPE tag (WAREHOUSE/RESTAURANT) is an
// opaque labelId with no cheap resolution → only the real PRIMARY (isDefault) tag is shown; "Landmark" and the
// business-hours line ("Mon-Sat 9 AM - 6 PM") aren't fields on the Address contract → omitted; the "📍 Map"
// affordance shows only when the address carries real lat/lng (hasMapPin) — never a guessed pin.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert, Linking } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Address } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { listAddresses, createAddress, updateAddress, setPrimaryAddress, deleteAddress } from '../../features/addresses/addresses.api';
import { sortAddresses, hasMapPin } from '../../features/addresses/addresses';
import { formatAddress } from '../../features/cart/cart-math';

export default function Addresses() {
  const { t } = useTranslation();
  const enabled = useFlag('buyer_checkout');
  const [items, setItems] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ id: string | null; name: string; line1: string; pincode: string; phone: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => { setItems(sortAddresses(await listAddresses())); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('address.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const openAdd = () => { setError(undefined); setForm({ id: null, name: '', line1: '', pincode: '', phone: '' }); };
  const openEdit = (a: Address) => { setError(undefined); setForm({ id: a.id, name: a.contactName ?? '', line1: a.line1, pincode: a.pincode ?? '', phone: a.contactPhone ?? '' }); };

  const onSave = async () => {
    if (!form || form.line1.trim().length < 3) { setError(t('address.line1Required')); return; }
    setBusy(true); setError(undefined);
    const patch = { line1: form.line1.trim(), pincode: form.pincode.trim() || undefined, contactName: form.name.trim() || undefined, contactPhone: form.phone.trim() || undefined };
    try {
      if (form.id) await updateAddress(form.id, patch);
      else await createAddress({ ...patch, isDefault: items.length === 0 });
      setForm(null); await load();
    } catch { setError(t('address.saveFailed')); }
    finally { setBusy(false); }
  };
  const onMakePrimary = async (id: string) => { try { await setPrimaryAddress(id); } catch { /* degrade */ } await load(); };
  const onDelete = (id: string) => Alert.alert(t('address.delete'), t('address.confirmRemove'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('address.delete'), style: 'destructive', onPress: async () => { try { await deleteAddress(id); } catch { /* degrade */ } await load(); } },
  ]);
  const onMap = (a: Address) => { if (hasMapPin(a)) void Linking.openURL(`geo:${a.lat},${a.lng}`).catch(() => {}); };

  if (form) {
    return (
      <ScreenScaffold title={form.id ? t('address.editTitle') : t('address.add')} footer={<Button title={t('address.save')} onPress={onSave} loading={busy} disabled={form.line1.trim().length < 3} />}>
        <Card>
          <Input label={t('address.contactName')} value={form.name} onChangeText={(name) => setForm((f) => f && { ...f, name })} maxLength={120} />
          <Input label={t('address.line1')} value={form.line1} onChangeText={(line1) => setForm((f) => f && { ...f, line1 })} autoFocus error={error} />
          <Input label={t('address.pincode')} value={form.pincode} onChangeText={(pincode) => setForm((f) => f && { ...f, pincode })} keyboardType="number-pad" maxLength={10} />
          <Input label={t('address.contactPhone')} value={form.phone} onChangeText={(phone) => setForm((f) => f && { ...f, phone })} keyboardType="phone-pad" maxLength={20} />
          <Pressable onPress={() => { setForm(null); setError(undefined); }} style={{ marginTop: space[3] }} accessibilityRole="button"><Text style={styles.cancel}>{t('common.cancel')}</Text></Pressable>
        </Card>
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold title={t('address.title')} scroll={false} footer={<Button title={t('address.add')} onPress={openAdd} />}>
      {loading ? <SkeletonCard lines={4} /> : (
        <FlatList
          data={items}
          keyExtractor={(a) => a.id}
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          ListEmptyComponent={<EmptyState title={t('address.empty.title')} message={t('address.empty.message')} />}
          renderItem={({ item }) => (
            <Card>
              {item.isDefault ? <StatusPill label={t('address.primary')} tone="success" /> : null}
              {item.contactName ? <Text style={styles.name}>{item.contactName}</Text> : null}
              <Text style={styles.addr}>{formatAddress(item)}</Text>
              {item.contactPhone ? <Text style={styles.phone}>📞 {item.contactPhone}</Text> : null}
              <View style={styles.actions}>
                <Pressable onPress={() => openEdit(item)} hitSlop={8} accessibilityRole="button"><Text style={styles.action}>{t('address.edit')}</Text></Pressable>
                {hasMapPin(item) ? <Pressable onPress={() => onMap(item)} hitSlop={8} accessibilityRole="button"><Text style={styles.action}>{t('address.map')}</Text></Pressable> : null}
                {!item.isDefault ? <Pressable onPress={() => onMakePrimary(item.id)} hitSlop={8} accessibilityRole="button"><Text style={styles.action}>{t('address.makePrimary')}</Text></Pressable> : null}
                {!item.isDefault ? <Pressable onPress={() => onDelete(item.id)} hitSlop={8} accessibilityRole="button"><Text style={styles.remove}>{t('address.removeAction')}</Text></Pressable> : null}
              </View>
            </Card>
          )}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[2] },
  addr: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[1], lineHeight: font.size.sm * 1.5 },
  phone: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4], marginTop: space[3] },
  action: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  remove: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.danger },
  cancel: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500, textAlign: 'center' },
});
