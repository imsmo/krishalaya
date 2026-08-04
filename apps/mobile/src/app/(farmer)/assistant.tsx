// apps/mobile/src/app/(farmer)/assistant.tsx · screen 125 "AI Assistant" chat. Thin screen (guide §3): an assistant
// header (avatar · name · online + languages), a personalised welcome bubble, the timestamped transcript with the
// SERVER's source citations rendered verbatim, quick-action shortcuts to real data screens, and a typed/voice
// composer. The app NEVER fabricates an answer — if the assistant endpoint isn't live/reachable, askAssistant
// returns unavailable and we show an honest system message. Send is idempotent (Law 3, in the data layer).
// Behind `tips_assistant`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • The design's rich answer blocks (Quick-check / Treatment / step-by-step / nearest agri store) are the MODEL's
//    own text + the server's `citations` — we render exactly what the server returns (reply text + citation chips),
//    never a hardcoded chemical/dosage/store. No farmer-facing AI endpoint is live yet, so answers appear once it lands.
//  • Quick-action chips are navigation shortcuts into the REAL data screens (mandi / weather / schemes / wallet),
//    not canned answers.
//
// R2-03 (founder screenshot: composer cramped at top, "Tap to speak" half cut-off, huge dead space below):
//  (a) LAYOUT — the screen used to be a plain `<ScreenScaffold>` (default `scroll=true`, so its Body is a
//      ScrollView) with the composer as an ordinary trailing child. A ScrollView's contentContainerStyle sizes to
//      its NATURAL content height (flex:1 on a child inside it does nothing), so with only a short welcome bubble
//      the whole header+transcript+composer block rendered squeezed at the top, leaving the rest of the physical
//      screen blank, and the composer never got pinned to the bottom. Fixed by mirroring the chat-thread pattern
//      (features/messaging/screens/ChatThreadScreen.tsx): `scroll={false}` (Body is a plain flex:1 View) + the
//      composer passed as ScreenScaffold's `footer` (pinned, safe-area-aware, never clipped) + the transcript
//      FlatList given `style={styles.fill}` so it's the one flexible element that actually expands to fill the
//      remaining space.
//  (b) VOICE AT PILOT — "Tap to speak" here calls the SAME on-device STT as MF-05's listing mic
//      (core/voice/useVoiceDictation), which is real, but per R2-03 the mic affordance is additionally gated
//      behind its own `voice_assistant` flag (default OFF, mirrors `voice_listing`) so ops can kill just the mic
//      without touching the (separately verified) text path — see shouldShowAssistantMic() in features/content/
//      content.ts. The assistant's TEXT Q&A itself is NOT a dead input at pilot: `askAssistant` calls a fully
//      built, governed backend pipeline (apps/api `assistant` module, P1-13 — sanitize/injection-guard → cost/rate
//      caps → resilience-wrapped s2s call to ai-services → logged) that ALREADY degrades honestly turn-by-turn to
//      `content.assistant.unavailable` when the server-side `ai_assistant` flag or model key isn't configured —
//      never silently broken, never a fabricated answer. So while the mic is flag-gated, the text input stays live.
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { formatDate } from '@krishalaya/i18n';
import { Button, EmptyState, Input, ScreenScaffold, VoiceButton, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { useAuth } from '../../core/auth/auth.store';
import { useVoiceDictation } from '../../core/voice';
import { askAssistant } from '../../features/content/content.api';
import { buildAssistantDraft, appendTurn, shouldShowAssistantMic, type ChatTurn } from '../../features/content/content';
import { newId } from '../../core/util/ids';

const QUICK_ACTIONS = [
  { key: 'mandi', icon: '📊', route: '/(farmer)/mandi' },
  { key: 'weather', icon: '🌧', route: '/(farmer)/weather' },
  { key: 'schemes', icon: '📋', route: '/(farmer)/schemes' },
  { key: 'txns', icon: '💰', route: '/(farmer)/wallet/transactions' },
] as const;

function timeLabel(at: number, lang: string): string {
  try { return formatDate(at, lang, { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

export default function Assistant() {
  const { t, lang } = useTranslation();
  const { state } = useAuth();
  const router = useRouter();
  const enabled = useFlag('tips_assistant');
  const voice = useVoiceDictation(lang);
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const name = state.profile?.displayName ?? t('home.defaultName');

  const send = useCallback(async (raw: string) => {
    if (sending.current) return;
    const draft = buildAssistantDraft({ text: raw, lang, sessionId });
    if (!draft.ok || !draft.input) return;
    sending.current = true; setBusy(true);
    const userTurn: ChatTurn = { id: newId(), role: 'user', text: draft.input.message, at: Date.now() };
    setTurns((prev) => appendTurn(prev, userTurn));
    setText(''); voice.reset();
    const res = await askAssistant(draft.input);
    const replyText = res.ok && res.reply ? res.reply.reply : t('content.assistant.unavailable');
    if (res.ok && res.reply?.sessionId) setSessionId(res.reply.sessionId);
    setTurns((prev) => appendTurn(prev, { id: newId(), role: 'assistant', text: replyText, at: Date.now(), citations: res.ok ? res.reply?.citations : undefined }));
    sending.current = false; setBusy(false);
  }, [lang, sessionId, voice, t]);

  // R2-03(b): the mic is flag-gated (default OFF); the text composer + Send are NOT — askAssistant already
  // degrades honestly per-turn (see file header), so there is no dead input to hide behind a flag.
  const voiceAssistantEnabled = useFlag('voice_assistant');
  const micEnabled = shouldShowAssistantMic(voiceAssistantEnabled);

  if (!enabled) return <ScreenScaffold title={t('content.assistant.title')}><EmptyState title={t('content.assistant.unavailable')} /></ScreenScaffold>;

  const composed = (voice.transcript || text).trim();

  // R2-03(a): the composer is the ScreenScaffold `footer` (pinned + safe-area-aware, same padding/top-border/
  // card-background treatment as every other screen's footer) — same flat pattern as ChatThreadScreen's own
  // `footer` (no extra nested Card, so it never gets a doubled-border "box within a box" look).
  const composer = (
    <View style={styles.composer}>
      <Input
        label={t('content.assistant.inputLabel')}
        value={voice.listening ? voice.transcript : text}
        onChangeText={setText}
        placeholder={t('content.assistant.placeholder')}
        multiline
      />
      <View style={styles.composerRow}>
        {micEnabled ? (
          <VoiceButton label={t('content.voiceSearch.mic')} listening={voice.listening} onPress={() => (voice.listening ? voice.stop() : voice.start())} />
        ) : null}
        <View style={styles.sendBtn}><Button title={t('content.assistant.send')} loading={busy} disabled={!composed} onPress={() => send(composed)} /></View>
      </View>
      {micEnabled && voice.error ? <Text style={styles.err}>{t('content.voiceSearch.error')}</Text> : null}
    </View>
  );

  return (
    <ScreenScaffold title={t('content.assistant.title')} scroll={false} footer={composer}>
      <View style={styles.fill}>
        {/* Assistant header */}
        <View style={styles.header}>
          <Text style={styles.avatar}>🤖</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.botName}>{t('content.assistant.botName')}</Text>
            <Text style={styles.online}>● {t('content.assistant.online')} · {t('content.assistant.languages')}</Text>
          </View>
        </View>

        <FlatList
          style={styles.fill}
          data={turns}
          keyExtractor={(m) => m.id}
          ListHeaderComponent={
            // Welcome bubble — static intro (personalised with the real display name; degrades to a generic name)
            <View style={[styles.bubbleRow, styles.left]}>
              <View style={[styles.bubble, styles.aiBubble]}>
                <Text style={styles.aiText}>{t('content.assistant.welcome', { name })}</Text>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.bubbleRow, item.role === 'user' ? styles.right : styles.left]}>
              <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.aiBubble]}>
                <Text style={item.role === 'user' ? styles.userText : styles.aiText}>{item.text}</Text>
                {item.citations && item.citations.length ? (
                  <View style={styles.citations}>
                    {item.citations.map((c, i) => (
                      <Pressable key={`${item.id}-c${i}`} disabled={!c.url} onPress={() => c.url && Linking.openURL(c.url).catch(() => {})} accessibilityRole="link">
                        <Text style={styles.citation} numberOfLines={1}>📖 {c.title}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Text style={[styles.time, item.role === 'user' ? styles.timeUser : styles.timeAi]}>{timeLabel(item.at, lang)}</Text>
              </View>
            </View>
          )}
          contentContainerStyle={{ paddingHorizontal: space[5], paddingVertical: space[3] }}
        />

        {/* Quick-action shortcuts into real data screens */}
        <FlatList
          horizontal showsHorizontalScrollIndicator={false} style={styles.quickRow}
          data={QUICK_ACTIONS}
          keyExtractor={(a) => a.key}
          contentContainerStyle={styles.quickRowContent}
          renderItem={({ item: a }) => (
            <Pressable onPress={() => router.push(a.route)} accessibilityRole="button" style={styles.quickChip}>
              <Text style={styles.quickTxt}>{a.icon} {t(`content.assistant.quick.${a.key}`)}</Text>
            </Pressable>
          )}
        />
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[5], paddingTop: space[3], paddingBottom: space[2], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  avatar: { fontSize: 32 },
  botName: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink900 },
  online: { fontFamily: font.body, fontSize: font.size.xs, color: color.success, marginTop: 2 },

  bubbleRow: { flexDirection: 'row', marginBottom: space[2] },
  left: { justifyContent: 'flex-start' },
  right: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '85%', paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.lg },
  userBubble: { backgroundColor: color.primary600 },
  aiBubble: { backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100 },
  userText: { fontFamily: font.body, fontSize: font.size.md, color: color.white },
  aiText: { fontFamily: font.body, fontSize: font.size.md, color: color.ink800, lineHeight: 22 },
  citations: { marginTop: space[2], gap: 2 },
  citation: { fontFamily: font.body, fontSize: font.size.xs, color: color.primary700 },
  time: { fontFamily: font.body, fontSize: 10, marginTop: space[1] },
  timeUser: { color: color.primary100, textAlign: 'right' },
  timeAi: { color: color.ink400 },

  quickRow: { flexGrow: 0, marginBottom: space[2] },
  quickRowContent: { paddingHorizontal: space[5] },
  quickChip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[3], marginRight: space[2], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  quickTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },

  composer: {},
  composerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[2], gap: space[3] },
  sendBtn: { flex: 1 },
  err: { fontFamily: font.body, fontSize: font.size.sm, color: color.danger, marginTop: space[2] },
});
