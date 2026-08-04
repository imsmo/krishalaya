// apps/mobile/src/app/(farmer)/voice-search.tsx · screen 184 "Voice Search". Thin screen (guide §3): a listening-
// first hero (big mic, Listening…/Speak now, language hint, live on-device transcript) plus "Try saying" example
// prompts and a typed fallback. The captured/typed text filters the CACHED approved tips on-device (PURE
// searchResources, ReDoS-safe) so it works offline. Tap a result for the tip. Behind `tips_assistant`. Degrade-never-die.
// §13 notes (honest, never faked):
//  • On-device STT only — no audio leaves the device for transcription (privacy §4). If the recognizer is
//    unavailable the mic no-ops and the farmer types instead (degrade).
//  • The "Try saying" examples are static suggestion chips; tapping one pre-fills the query and searches the tips
//    we actually have. Cross-domain intent routing (orders/workers) has no unified voice-intent contract → a
//    suggestion only, never a fabricated cross-screen action.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import type { LearningResource } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, ScreenScaffold, VoiceButton, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useVoiceDictation } from '../../core/voice';
import { listTips } from '../../features/content/content.api';
import { searchResources, normalizeQuery } from '../../features/content/content';

const EXAMPLES = ['ex1', 'ex2', 'ex3'] as const;

export default function VoiceSearch() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tips_assistant');
  const voice = useVoiceDictation(lang);
  const [all, setAll] = useState<LearningResource[]>([]);
  const [typed, setTyped] = useState('');
  const [searched, setSearched] = useState(false);

  useEffect(() => { if (enabled) listTips().then((r) => setAll(r.items)).catch(() => setAll([])); }, [enabled]);

  const query = voice.transcript || typed;
  const results = searched ? searchResources(all, query) : [];

  const run = useCallback((q?: string) => { setSearched(!!normalizeQuery(q ?? query)); }, [query]);
  const useExample = useCallback((text: string) => { setTyped(text); voice.reset(); setSearched(!!normalizeQuery(text)); }, [voice]);

  if (!enabled) return <ScreenScaffold title={t('content.voiceSearch.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('content.voiceSearch.title')}>
      {/* Listening-first hero */}
      <View style={styles.hero}>
        <VoiceButton label={voice.listening ? t('content.voiceSearch.listening') : t('content.voiceSearch.mic')} listening={voice.listening} onPress={() => (voice.listening ? voice.stop() : voice.start())} />
        <Text style={styles.status}>{voice.listening ? t('content.voiceSearch.listening') : t('content.voiceSearch.speakNow')}</Text>
        <Text style={styles.langHint}>{t('content.voiceSearch.langHint')}</Text>
        {query ? <Text style={styles.transcript} numberOfLines={3}>“{query}”</Text> : null}
        {voice.error ? <Text style={styles.err}>{t('content.voiceSearch.error')}</Text> : null}
      </View>

      {/* Typed fallback + search */}
      <Card>
        <Input label={t('content.search.label')} value={voice.listening ? voice.transcript : typed} onChangeText={setTyped} placeholder={t('content.voiceSearch.placeholder')} returnKeyType="search" onSubmitEditing={() => run()} />
        <View style={{ marginTop: space[2] }}><Button title={t('content.voiceSearch.search')} disabled={!normalizeQuery(query)} onPress={() => run()} /></View>
      </Card>

      {searched ? (
        results.length === 0 ? (
          <View style={{ marginTop: space[3] }}><EmptyState title={t('content.voiceSearch.noResults.title')} message={t('content.voiceSearch.noResults.message', { q: normalizeQuery(query) })} /></View>
        ) : (
          <FlatList
            style={{ marginTop: space[3] }}
            data={results}
            keyExtractor={(r) => r.id}
            renderItem={({ item }) => (
              <Pressable onPress={() => router.push({ pathname: '/(farmer)/tips/[id]', params: { id: item.id } })} accessibilityRole="button">
                <Card style={styles.card}><Text style={styles.title} numberOfLines={2}>{item.title}</Text></Card>
              </Pressable>
            )}
            contentContainerStyle={{ paddingBottom: space[6] }}
          />
        )
      ) : (
        // "Try saying" suggestions when no search has run yet
        <View style={styles.examples}>
          <Text style={styles.examplesTitle}>{t('content.voiceSearch.trySaying')}</Text>
          {EXAMPLES.map((e) => {
            const text = t(`content.voiceSearch.${e}`);
            return (
              <Pressable key={e} onPress={() => useExample(text)} accessibilityRole="button">
                <Card style={styles.exampleCard}><Text style={styles.exampleTxt}>“{text}”</Text></Card>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: space[5], gap: space[2] },
  status: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900, marginTop: space[2] },
  langHint: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  transcript: { fontFamily: font.body, fontSize: font.size.md, color: color.primary700, fontStyle: 'italic', textAlign: 'center', marginTop: space[2] },
  err: { fontFamily: font.body, fontSize: font.size.sm, color: color.danger, marginTop: space[2] },
  card: { marginBottom: space[2] },
  title: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  examples: { marginTop: space[4] },
  examplesTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600, marginBottom: space[2] },
  exampleCard: { marginBottom: space[2], borderRadius: radius.lg },
  exampleTxt: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700 },
});
