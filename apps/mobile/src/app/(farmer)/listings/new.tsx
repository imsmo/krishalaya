// apps/mobile/src/app/(farmer)/listings/new.tsx · screen 10 (Create Listing) — rebuilt to the Phase-1 design
// (Krishalaya_Design_System/screens/10-create-listing.html): a Photo / Voice / Manual mode toggle, and the
// "⚡ AI Voice Listing" panel — a tap-to-record mic ("Listening… / सुन रहा हूं"), an example hint, हिंदी / English /
// ગુજરાતી language chips, a Live Transcript, and an "✨ AI Detected" card (Crop / Quantity / Price·qtl / Quality)
// with Re-record + Preview →. Photo mode = up to 6 compressed uploads; Manual mode = the typed form. All three
// converge on the SAME real create: pick a catalogue product (real productId/unit — never fabricated), enter
// quantity + ₹/unit (→ paise via BigInt, Law 2), submit → draft → preview (11). Offline → idempotent queue (Law 3).
//
// The transcript is REAL on-device STT (core/voice). The AI-Detected card's crop/qty/price/quality are
// farmer-CONFIRMED: the structured voice→listing extractor lives in ai-services (POST /v1/voice-extraction) but
// is not yet exposed via apps/api/SDK to the client, so we never auto-fabricate those values (flagged gap, §13).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import type { ProductCard } from '@krishalaya/sdk-js';
import { Button, Input, SegmentedControl, AddMediaTile, UploadTile, EmptyState, Icon, MoneyText, color, font, space, radius, shadow, type UploadStatus } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { searchProducts } from '../../../features/catalogue/catalogue.api';
import { createListing, getListing } from '../../../features/listings/listings.api';
import { captureFromCamera, pickFromGallery, uploadPickedImage, type PickedImage } from '../../../core/media';
import { useVoiceDictation } from '../../../core/voice';
import { CREATE_MODES, STT_LANGS, QUALITY_GRADES, buildCreateDraft, rupeesToPaise, parseQty, resolveModeParam, shouldShowVoiceComingSoon, shouldShowPriceSummary, type CreateMode, type QualityGrade } from '../../../features/listings/create-listing';
import { LANGUAGES } from '@krishalaya/i18n';

interface Photo { key: string; uri: string; status: UploadStatus; progress: number; mediaId?: string }
const MAX_PHOTOS = 6;
const nativeName = (code: string) => LANGUAGES.find((l) => l.code === code)?.nameNative ?? code;

export default function CreateListing() {
  const router = useRouter();
  const { t, lang } = useTranslation();
  const { repostFrom, mode: modeParam } = useLocalSearchParams<{ repostFrom?: string; mode?: string }>();

  // design 10 is the Voice mode by default; Home hero (and any other deep-link) can preselect a mode (KV-MF-05).
  const [mode, setMode] = useState<CreateMode>(() => resolveModeParam(modeParam));
  const [sttLang, setSttLang] = useState<string>(STT_LANGS.includes(lang) ? lang : 'hi');
  const voice = useVoiceDictation(sttLang);
  // Voice STT is not yet exposed via apps/api (see file header + create-listing.ts §13) — kill-switched by
  // the `voice_listing` client flag. Tab stays visible; we swap its content for an honest coming-soon card.
  const voiceListingEnabled = useFlag('voice_listing');
  const voiceComingSoon = shouldShowVoiceComingSoon(mode, voiceListingEnabled);

  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProductCard[]>([]);
  const [picking, setPicking] = useState(false);
  const [product, setProduct] = useState<ProductCard | null>(null);
  const [qty, setQty] = useState('');
  const [rupees, setRupees] = useState('');
  const [quality, setQuality] = useState<QualityGrade | null>(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Repost (116): prefill qty + ₹ from the source listing; product is re-picked (public card carries no productId).
  useEffect(() => {
    if (!repostFrom) return;
    (async () => {
      const { listing } = await getListing(repostFrom);
      if (listing) {
        setQty(String(listing.quantityAvailable ?? ''));
        try { setRupees((BigInt(listing.priceMinor) / 100n).toString()); } catch { /* ignore */ }
        setQ(listing.title ?? ''); setPicking(true);
      }
    })();
  }, [repostFrom]);

  // Voice transcript feeds the free-text description (real STT). Auto-extraction of qty/price is flagged (§13).
  useEffect(() => { if (voice.transcript) setDescription(voice.transcript); }, [voice.transcript]);

  // Catalogue search (debounced) — gives the REAL productId/categoryId/unit; never fabricated.
  useEffect(() => {
    if (!picking || q.trim().length < 2) { setResults([]); return; }
    let live = true;
    const id = setTimeout(async () => { const items = await searchProducts(q, 8); if (live) setResults(items); }, 300);
    return () => { live = false; clearTimeout(id); };
  }, [q, picking]);

  const priceMinor = useMemo(() => rupeesToPaise(rupees), [rupees]);
  const uploadingAny = photos.some((p) => p.status === 'uploading');
  const mediaIds = photos.filter((p) => p.mediaId).map((p) => p.mediaId!) as string[];
  const qtyValid = parseQty(qty) != null;
  const canSubmit = !!product && !!priceMinor && qtyValid && !busy && !uploadingAny;
  // S6 device-test fix: the button used to disable SILENTLY (founder couldn't tell that the crop
  // must be TAPPED from the suggestions, not just typed). Surface the first unmet requirement.
  const disabledReason = !product ? t('createListing.hint.pickCrop')
    : !priceMinor ? t('createListing.hint.price')
    : !qtyValid ? t('createListing.hint.qty')
    : uploadingAny ? t('createListing.hint.uploading')
    : null;

  const addPhoto = async (pick: () => Promise<PickedImage | null>) => {
    if (photos.length >= MAX_PHOTOS) return;
    const picked = await pick();
    if (!picked) return;
    const key = `${Date.now()}:${photos.length}`;
    setPhotos((prev) => [...prev, { key, uri: picked.uri, status: 'uploading', progress: 0 }]);
    try {
      const res = await uploadPickedImage(picked, { onProgress: (f) => setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, progress: f } : p))) });
      setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, status: res.queued ? 'queued' : 'done', mediaId: res.mediaId ?? undefined } : p)));
    } catch { setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, status: 'failed' } : p))); }
  };
  const pickSource = () => Alert.alert(t('createListing.photoSource'), undefined, [
    { text: t('createListing.camera'), onPress: () => addPhoto(captureFromCamera) },
    { text: t('createListing.gallery'), onPress: () => addPhoto(pickFromGallery) },
    { text: t('common.cancel'), style: 'cancel' },
  ]);

  const reRecord = () => { voice.stop(); setDescription(''); };

  const onSubmit = async () => {
    const draft = buildCreateDraft({
      productId: product?.id ?? null, categoryId: product?.categoryId ?? null, title: product?.name ?? null,
      defaultUnit: product?.defaultUnit ?? null, qty, rupees, description, quality, mediaIds,
    });
    if (!draft.ok) { setError(t(`createListing.invalid.${draft.reason}`)); return; }
    setBusy(true); setError(undefined);
    try {
      const { id, queued } = await createListing(draft.payload!);
      if (queued || !id) Alert.alert(t('createListing.queued'), undefined, [{ text: t('common.ok'), onPress: () => router.replace('/(farmer)/listings') }]);
      // Pass the real productId forward (the public listing read-model doesn't expose it) so the Preview screen
      // can fetch the live Fair-Price band for this crop. Never fabricated — it's the catalogue id the farmer picked.
      else router.replace({ pathname: '/(farmer)/listings/preview', params: { id, productId: product!.id } });
    } catch (e: unknown) {
      // Surface the REAL reason (the API's own localized message, e.g. a 422 field error) instead of a generic
      // string — KV-MF-02: a swallowed real failure left the farmer thinking a save was just "queued for later".
      const msg = e instanceof Error && e.message ? e.message : undefined;
      setError(msg ?? t('createListing.error'));
    }
    finally { setBusy(false); }
  };

  // Shared crop picker (used by every mode — the AI-Detected "Crop" + the Photo/Manual product field).
  const CropField = (
    <View>
      {product && !picking ? (
        <Pressable style={styles.cropPicked} onPress={() => { setPicking(true); setQ(product.name); }} accessibilityRole="button" accessibilityLabel={product.name}>
          <Text style={styles.cropPickedName}>🌾 {product.name}</Text>
          <Text style={styles.cropChange}>{t('createListing.change')}</Text>
        </Pressable>
      ) : (
        <>
          <Input value={q} onChangeText={(v) => { setQ(v); setPicking(true); }} placeholder={t('createListing.cropPlaceholder')} />
          {results.length > 0 ? (
            <View style={styles.results}>
              {results.map((item) => (
                <Pressable key={item.id} style={styles.result} onPress={() => { setProduct(item); setQ(item.name); setPicking(false); setResults([]); }} accessibilityRole="button" accessibilityLabel={item.name}>
                  <Text style={styles.resultName}>{item.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* App bar */}
      <View style={styles.appbar}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={styles.backBtn}>
          <Icon name="arrow-left" size={20} color={color.ink700} />
        </Pressable>
        <Text style={styles.appbarTitle}>{t('createListing.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      {/* Mode toggle: Photo / Voice / Manual */}
      <View style={styles.modeRow}>
        <SegmentedControl
          layout="row"
          value={mode}
          onChange={(v) => setMode(v as CreateMode)}
          accessibilityLabel={t('createListing.mode')}
          options={CREATE_MODES.map((m) => ({ value: m, label: t(`createListing.mode.${m}`) }))}
        />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {mode === 'voice' && voiceComingSoon ? (
          // Voice STT is honestly gated (KV-MF-05/MF-13): no dead mic, no never-filling transcript — just a
          // truthful "coming soon" card + a way out to Manual. Tab itself stays visible/selectable.
          <View style={styles.voiceSoonWrap} testID="voice-coming-soon">
            <EmptyState
              icon={<Icon name="mic" size={32} color={color.ink400} />}
              title={t('createListing.voiceSoon.title')}
              message={t('createListing.voiceSoon.message')}
              actionLabel={t('createListing.voiceSoon.cta')}
              onAction={() => setMode('manual')}
            />
          </View>
        ) : mode === 'voice' ? (
          <>
            {/* AI Voice Listing panel */}
            <View style={styles.voicePanel}>
              <View style={styles.voiceGlow} />
              <Text style={styles.voiceTag}>⚡ {t('createListing.aiVoice')}</Text>
              <Pressable onPress={() => (voice.listening ? voice.stop() : voice.start())} style={[styles.mic, voice.listening && styles.micOn]} accessibilityRole="button" accessibilityLabel={voice.listening ? t('createListing.listening') : t('createListing.speak')}>
                <Icon name="mic" size={34} color={color.white} />
              </Pressable>
              <Text style={styles.voiceStatus}>
                {voice.listening ? <>{t('createListing.listening')} <Text style={styles.voiceVern}>सुन रहा हूं</Text></> : t('createListing.tapToSpeak')}
              </Text>
              <Text style={styles.voiceHint}>{t('createListing.voiceExample')}</Text>
              {voice.error ? <Text style={styles.voiceErr}>{t('createListing.voiceFailed')}</Text> : null}

              {/* Language chips */}
              <View style={styles.langChips}>
                {STT_LANGS.map((code) => {
                  const on = code === sttLang;
                  return (
                    <Pressable key={code} onPress={() => setSttLang(code)} style={[styles.langChip, on && styles.langChipOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                      <Text style={[styles.langChipTxt, on && styles.langChipTxtOn]}>{nativeName(code)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Live transcript */}
            <Text style={styles.sectionLabel}>{t('createListing.liveTranscript')}</Text>
            <View style={styles.transcript}>
              <Text style={voice.transcript ? styles.transcriptTxt : styles.transcriptEmpty}>
                {voice.transcript || t('createListing.transcriptEmpty')}
              </Text>
            </View>

            {/* AI Detected (farmer-confirmed; auto-fill flagged) */}
            <View style={styles.detected}>
              <Text style={styles.detectedHead}>✨ {t('createListing.aiDetected')}</Text>
              <Text style={styles.detectedNote}>{t('createListing.confirmNote')}</Text>

              <Text style={styles.fieldLabel}>{t('createListing.crop')}</Text>
              {CropField}

              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('createListing.quantity')}</Text>
                  <Input value={qty} onChangeText={(v) => setQty(v.replace(/[^0-9]/g, ''))} placeholder={product?.defaultUnit ?? t('createListing.qtyPlaceholder')} keyboardType="number-pad" maxLength={7} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('createListing.pricePerUnit')}</Text>
                  <Input value={rupees} onChangeText={(v) => setRupees(v.replace(/[^0-9]/g, ''))} placeholder="₹" keyboardType="number-pad" maxLength={13} />
                </View>
              </View>

              <Text style={styles.fieldLabel}>{t('createListing.quality')}</Text>
              <View style={styles.qualityRow}>
                {QUALITY_GRADES.map((g) => {
                  const on = g === quality;
                  return (
                    <Pressable key={g} onPress={() => setQuality(on ? null : g)} style={[styles.qChip, on && styles.qChipOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                      <Text style={[styles.qChipTxt, on && styles.qChipTxtOn]}>{t(`createListing.grade.${g}`)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </>
        ) : mode === 'photo' ? (
          <>
            <Text style={styles.fieldLabel}>{t('createListing.crop')}</Text>
            {CropField}
            <Text style={[styles.sectionLabel, { marginTop: space[4] }]}>{t('createListing.photos')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
              {photos.map((p) => (
                <UploadTile key={p.key} uri={p.uri} status={p.status} progress={p.progress}
                  queuedLabel={t('common.offline')} retryLabel={t('common.retry')} removeLabel={t('common.cancel')}
                  onRemove={() => setPhotos((prev) => prev.filter((x) => x.key !== p.key))}
                  onRetry={() => setPhotos((prev) => prev.filter((x) => x.key !== p.key))} />
              ))}
              {photos.length < MAX_PHOTOS ? <AddMediaTile label={t('createListing.addPhoto')} onPress={pickSource} /> : null}
            </ScrollView>
            <View style={styles.twoCol}>
              <View style={{ flex: 1 }}><Text style={styles.fieldLabel}>{t('createListing.quantity')}</Text>
                <Input value={qty} onChangeText={(v) => setQty(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={7} /></View>
              <View style={{ flex: 1 }}><Text style={styles.fieldLabel}>{t('createListing.pricePerUnit')}</Text>
                <Input value={rupees} onChangeText={(v) => setRupees(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={13} /></View>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.fieldLabel}>{t('createListing.crop')}</Text>
            {CropField}
            <Text style={styles.fieldLabel}>{t('createListing.quantity')}</Text>
            <Input value={qty} onChangeText={(v) => setQty(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={7} />
            <Text style={styles.fieldLabel}>{t('createListing.pricePerUnit')}</Text>
            <Input value={rupees} onChangeText={(v) => setRupees(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={13} />
            <Text style={styles.fieldLabel}>{t('createListing.descLabel')}</Text>
            <Input value={description} onChangeText={setDescription} multiline maxLength={500} />
          </>
        )}

        {shouldShowPriceSummary(priceMinor, !!product) ? (
          <View style={styles.previewMoney}>
            <Text style={styles.previewMoneyLabel}>{t('createListing.pricePerUnit')}:</Text>
            <MoneyText minor={priceMinor} langCode={lang} size="md" />
          </View>
        ) : null}
        {error ? <Text style={styles.formError}>{error}</Text> : null}
      </ScrollView>

      {/* Footer: Re-record (voice) + Preview → — hidden entirely in the voice coming-soon state (KV-MF-05/MF-13):
          there are no fields on screen to preview, and Re-record has nothing real to re-record. The EmptyState's
          own action button is the only CTA there (switch to Manual). */}
      {!voiceComingSoon ? (
        <View style={styles.footer}>
          {mode === 'voice' ? (
            <View style={{ flex: 1 }}>
              <Button title={t('createListing.reRecord')} variant="outline" size="lg" onPress={reRecord} />
            </View>
          ) : null}
          <View style={mode === 'voice' ? { flex: 1 } : { flex: 1 }}>
            <Button title={t('createListing.preview')} size="lg" onPress={onSubmit} loading={busy} disabled={!canSubmit} />
            {!canSubmit && disabledReason ? (
              <Text style={styles.disabledHint} accessibilityLiveRegion="polite">{disabledReason}</Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  disabledHint: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1], textAlign: 'center' },
  safe: { flex: 1, backgroundColor: color.page },
  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[2] },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },
  appbarTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  modeRow: { paddingHorizontal: space[5], paddingBottom: space[2] },
  scroll: { paddingHorizontal: space[5], paddingBottom: space[6], gap: space[2] },

  // Voice panel
  voiceSoonWrap: { borderRadius: radius.xl, backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, marginTop: space[2] },
  voicePanel: { borderRadius: radius.xl, padding: space[5], backgroundColor: color.primary700, overflow: 'hidden', alignItems: 'center', ...shadow.card },
  voiceGlow: { position: 'absolute', top: -50, right: -50, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(243,156,18,0.18)' },
  voiceTag: { color: color.accent200, fontFamily: font.body, fontSize: 11, fontWeight: font.weight.bold, letterSpacing: 0.5, alignSelf: 'center', backgroundColor: 'rgba(243,156,18,0.22)', borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 12, overflow: 'hidden' },
  mic: { width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center', marginTop: space[4] },
  micOn: { backgroundColor: color.accent500, borderColor: color.accent300 },
  voiceStatus: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.white, marginTop: space[3] },
  voiceVern: { fontFamily: font.vernacular, color: 'rgba(255,255,255,0.85)' },
  voiceHint: { fontFamily: font.body, fontSize: font.size.sm, color: 'rgba(255,255,255,0.7)', marginTop: 2, textAlign: 'center' },
  voiceErr: { fontFamily: font.body, fontSize: font.size.sm, color: color.accent200, marginTop: space[2] },
  langChips: { flexDirection: 'row', gap: space[2], marginTop: space[4] },
  langChip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  langChipOn: { backgroundColor: color.white, borderColor: color.white },
  langChipTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.white },
  langChipTxtOn: { color: color.primary700 },

  sectionLabel: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600, marginTop: space[4], marginBottom: space[1] },
  transcript: { minHeight: 64, padding: space[4], borderRadius: radius.md, backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },
  transcriptTxt: { fontFamily: font.vernacular, fontSize: font.size.md, color: color.ink800, lineHeight: 24 },
  transcriptEmpty: { fontFamily: font.body, fontSize: font.size.md, color: color.ink400 },

  detected: { marginTop: space[4], padding: space[4], borderRadius: radius.lg, backgroundColor: color.accent50, borderWidth: 1, borderColor: color.accent200, gap: space[1] },
  detectedHead: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.accent700 },
  detectedNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginBottom: space[2] },

  fieldLabel: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700, marginTop: space[3], marginBottom: space[1] },
  twoCol: { flexDirection: 'row', gap: space[3] },

  cropPicked: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space[4], borderRadius: radius.md, backgroundColor: color.primary50, borderWidth: 1.5, borderColor: color.primary600 },
  cropPickedName: { fontFamily: font.body, fontSize: font.size.lg, fontWeight: font.weight.semibold, color: color.primary800 },
  cropChange: { fontFamily: font.body, fontSize: font.size.sm, color: color.primary700 },
  results: { borderWidth: 1, borderColor: color.earth200, borderRadius: radius.md, marginTop: space[1], backgroundColor: color.card },
  result: { paddingVertical: space[3], paddingHorizontal: space[3], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  resultName: { fontFamily: font.body, fontSize: font.size.md, color: color.ink800 },

  qualityRow: { flexDirection: 'row', gap: space[2], marginTop: space[1] },
  qChip: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1.5, borderColor: color.earth200, backgroundColor: color.card },
  qChipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  qChipTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  qChipTxtOn: { color: color.primary700 },

  previewMoney: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[4] },
  previewMoneyLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  formError: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[3], textAlign: 'center' },

  footer: { flexDirection: 'row', gap: space[3], paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[4], borderTopWidth: 1, borderTopColor: color.ink100, backgroundColor: color.card },
});
