// apps/mobile/src/app/(owner)/add-farmer.tsx · screen 78 (Add a Farmer). Thin screen (guide §3): a method picker +
// the admin-add form. Phone is validated client-side via PURE validateAddFarmer (server re-validates + normalizes);
// the create is REAL + idempotent (Law 3) and authorised SERVER-SIDE against the admin's OWN permission (tenant-
// scoped, NOT god-mode — Law 11). Behind `tenant_admin_lite`. Degrade-never-die.
//
// §13 (NOT faked): "Manual entry" and "SMS invite" both call the real `users.create` (the server issues the self-
// completion signup SMS) — they differ only in how much the admin types now. "Bulk upload" (CSV/Excel) has no
// mobile contract → it hands off to the web console (validated relative path). "QR onboard / Scan Aadhaar" is an
// eKYC capture flow NOT exposed to the mobile lite console (Law 11 / DPDP — we never collect raw Aadhaar in-app),
// so it is shown as unavailable, not a fake scanner. The form persists only what the contract accepts (full name +
// mobile); Village / Primary crops / Aadhaar are NOT submitted (no create-field for them and raw Aadhaar is never
// collected) — they're shown as steps the farmer completes during self-completion, never fabricated inputs. The
// onboarder line uses the signed-in admin's OWN name (real); the mockup's exact "₹50" commission and "7 days"
// window aren't exposed to the app, so the note stays generic rather than inventing a figure.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useAuth } from '../../core/auth/auth.store';
import { addFarmer } from '../../features/tenant/tenant.api';
import { validateAddFarmer } from '../../features/tenant/tenant-admin';
import { openWebConsole } from '../../core/deeplink';
import { WEB_PATHS } from '../../features/tenant/web-console';

type Method = 'manual' | 'sms' | 'bulk' | 'qr';
const METHODS: { key: Method; icon: string }[] = [
  { key: 'manual', icon: '📝' },
  { key: 'sms', icon: '📲' },
  { key: 'bulk', icon: '📂' },
  { key: 'qr', icon: '📷' },
];
const LATER_STEPS = ['village', 'crops', 'aadhaar'] as const;

export default function AddFarmer() {
  const { t } = useTranslation();
  const router = useRouter();
  const { state } = useAuth();
  const enabled = useFlag('tenant_admin_lite');
  const [method, setMethod] = useState<Method>('manual');
  const [phone, setPhone] = useState('');
  const [fullName, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!enabled) return <ScreenScaffold title={t('owner.addFarmer.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const isForm = method === 'manual' || method === 'sms';
  const onboarder = state.profile?.displayName?.trim() || t('owner.addFarmer.you');

  const submit = async () => {
    const v = validateAddFarmer({ phone, fullName });
    if (!v.ok) { setError(t('owner.addFarmer.phoneInvalid')); return; }
    setBusy(true); setError(undefined);
    try { await addFarmer(v.input); router.replace({ pathname: '/(owner)/farmers', params: { notice: t('owner.addFarmer.added') } }); }
    catch (e) {
      const msg = e instanceof SdkError && e.isConflict ? t('owner.addFarmer.exists') : e instanceof SdkError && e.isForbidden ? t('owner.notAllowed') : t('owner.addFarmer.failed');
      Alert.alert(t('owner.addFarmer.title'), msg);
    } finally { setBusy(false); }
  };
  const openBulk = async () => { if (!(await openWebConsole(WEB_PATHS.bulkActions))) Alert.alert(t('owner.addFarmer.title'), t('owner.farmer.consoleUnavailable')); };

  const footer = isForm
    ? <View style={styles.ctaRow}>
        <Button title={t('common.cancel')} variant="outline" onPress={() => router.back()} />
        <View style={{ flex: 1.4 }}><Button title={t('owner.addFarmer.submit')} onPress={submit} loading={busy} /></View>
      </View>
    : method === 'bulk'
      ? <View style={styles.ctaRow}>
          <Button title={t('common.cancel')} variant="outline" onPress={() => router.back()} />
          <View style={{ flex: 1.4 }}><Button title={t('owner.addFarmer.openConsole')} onPress={openBulk} /></View>
        </View>
      : <Button title={t('common.back')} variant="outline" onPress={() => router.back()} />;

  return (
    <ScreenScaffold title={t('owner.addFarmer.title')} scroll footer={footer}>
      <View style={{ gap: space[4] }}>
        {/* Method picker */}
        <View>
          <Text style={styles.section}>{t('owner.addFarmer.methodTitle')}</Text>
          <Text style={styles.hint}>{t('owner.addFarmer.methodHint')}</Text>
          <View style={styles.grid}>
            {METHODS.map((m) => {
              const active = m.key === method;
              return (
                <Pressable key={m.key} style={[styles.tile, active && styles.tileActive]} onPress={() => setMethod(m.key)} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                  <Text style={styles.tileIcon}>{m.icon}</Text>
                  <Text style={styles.tileTitle}>{t(`owner.addFarmer.method.${m.key}.title`)}</Text>
                  <Text style={styles.tileSub}>{t(`owner.addFarmer.method.${m.key}.sub`)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Body per method */}
        {isForm ? (
          <>
            <Card>
              <Text style={styles.section}>{t('owner.addFarmer.detailsTitle')}</Text>
              <View style={{ marginTop: space[3], gap: space[1] }}>
                <Input label={t('owner.addFarmer.name')} value={fullName} onChangeText={setName} maxLength={200} />
                <Input label={t('owner.addFarmer.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} placeholder="+9198XXXXXXXX" error={error} />
              </View>
              <Text style={styles.laterLabel}>{t('owner.addFarmer.laterTitle')}</Text>
              {LATER_STEPS.map((s) => (
                <View key={s} style={styles.laterRow}><Text style={styles.laterIcon}>{'•'}</Text><Text style={styles.laterText}>{t(`owner.addFarmer.later.${s}`)}</Text></View>
              ))}
            </Card>
            <Text style={styles.note}>{t('owner.addFarmer.onboarderNote', { name: onboarder })}</Text>
          </>
        ) : method === 'bulk' ? (
          <Card style={{ gap: space[2] }}>
            <Text style={styles.section}>{t('owner.addFarmer.method.bulk.title')}</Text>
            <Text style={styles.body}>{t('owner.addFarmer.bulkBody')}</Text>
          </Card>
        ) : (
          <Card style={{ gap: space[2] }}>
            <Text style={styles.section}>{t('owner.addFarmer.method.qr.title')}</Text>
            <Text style={styles.body}>{t('owner.addFarmer.qrBody')}</Text>
          </Card>
        )}
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  hint: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: space[1], marginBottom: space[3] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  tile: { flexBasis: '47%', flexGrow: 1, gap: space[1], padding: space[3], borderRadius: radius.lg, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.white },
  tileActive: { borderColor: color.primary600, backgroundColor: color.primary50 },
  tileIcon: { fontSize: font.size.xl },
  tileTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  tileSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  body: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, lineHeight: font.size.sm * 1.5 },
  laterLabel: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600, marginTop: space[3] },
  laterRow: { flexDirection: 'row', gap: space[2], marginTop: space[1] },
  laterIcon: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400 },
  laterText: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, lineHeight: font.size.xs * 1.5 },
  ctaRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
