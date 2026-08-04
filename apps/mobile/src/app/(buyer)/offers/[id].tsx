// apps/mobile/src/app/(buyer)/offers/[id].tsx · offer detail + negotiation. Thin screen (guide §3): show the
// current price on the table + status, and (while negotiable) accept / counter / reject. Accept converts to an
// order SERVER-SIDE → we route to the new order. The server authorizes who may act (a 403/409 is shown, never
// bypassed). Behind `offers_chat`. Money is bigint paise (Law 2). Degrade-never-die.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ListingOffer } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getOffer, acceptOffer, counterOffer, rejectOffer } from '../../../features/offers/offers.api';
import { offerStatusTone, isNegotiable, currentOfferPriceMinor, rupeesToOfferMinor } from '../../../features/offers/offer-status';

export default function OfferDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('offers_chat');
  const [offer, setOffer] = useState<ListingOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [counterRupees, setCounterRupees] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    const o = await getOffer(id); setOffer(o); setFailed(!o); setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('offer.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const run = async (action: string, fn: () => Promise<ListingOffer>) => {
    setBusy(action); setError(undefined);
    try {
      const next = await fn();
      if (action === 'accept' && next.convertedOrderId) {
        router.replace({ pathname: '/(buyer)/orders/[id]', params: { id: next.convertedOrderId, notice: t('offer.accepted') } });
        return;
      }
      setOffer(next);
    } catch (e) {
      setError(e instanceof SdkError && e.isForbidden ? t('offer.notYourTurn') : e instanceof SdkError && e.isConflict ? t('orders.action.conflict') : t('offer.failed'));
    } finally { setBusy(null); }
  };

  const onCounter = () => {
    const minor = rupeesToOfferMinor(counterRupees);
    if (!minor || !id) { setError(t('offer.invalid')); return; }
    run('counter', () => counterOffer(id, minor));
  };

  return (
    <ScreenScaffold title={t('offer.title')}>
      {loading ? <SkeletonCard lines={4} /> : !offer || failed ? (
        <EmptyState title={t('offer.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <>
          <Card>
            <View style={styles.head}>
              <StatusPill label={t(`offer.status.${offer.status}`)} tone={offerStatusTone(offer.status)} />
              <MoneyText minor={currentOfferPriceMinor(offer)} langCode={lang} size="xl" />
            </View>
            <Text style={styles.meta}>{t('offer.quantityLabel', { q: offer.quantity })}</Text>
            <Text style={styles.meta}>{t('offer.round', { n: offer.round })}</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </Card>

          {isNegotiable(offer.status) ? (
            <>
              <View style={styles.actions}>
                <View style={{ flex: 1 }}><Button title={t('offer.accept')} loading={busy === 'accept'} disabled={busy !== null} onPress={() => id && run('accept', () => acceptOffer(id))} /></View>
                <View style={{ flex: 1 }}><Button title={t('offer.reject')} variant="outline" loading={busy === 'reject'} disabled={busy !== null} onPress={() => id && run('reject', () => rejectOffer(id))} /></View>
              </View>
              <Text style={styles.section}>{t('offer.counterTitle')}</Text>
              <Input label={t('offer.pricePerUnit')} value={counterRupees} onChangeText={setCounterRupees} keyboardType="number-pad" maxLength={13} />
              <Button title={t('offer.counter')} variant="outline" loading={busy === 'counter'} disabled={busy !== null || !counterRupees.trim()} onPress={onCounter} />
            </>
          ) : null}
        </>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[3] },
  meta: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600, marginTop: space[1] },
  error: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[2] },
  actions: { flexDirection: 'row', gap: space[3], marginTop: space[4] },
  section: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink700, marginTop: space[4], marginBottom: space[2] },
});
