// apps/mobile/src/core/voice/stt.client.ts · thin wrapper over the platform speech recognizer for dictation
// (Android SpeechRecognizer / iOS SFSpeechRecognizer — the OS decides whether recognition runs on the device).
// Start with a locale, receive partial + final transcripts via callbacks, stop cleanly. Degrade-never-die: if the
// native module / recognizer isn't available, isAvailable() is false and start() reports an error (the screen falls
// back to typing). The result is a TRANSCRIPT only — turning it into structured crop/qty/price needs a backend AI
// endpoint that isn't built yet (see voice-listing.flow), so we never auto-fill money/quantity from speech.
//
// MOB-SDK-1: was @react-native-voice/voice 3.2.4 (last release May 2022: a legacy bridge module with a `jcenter()`
// Gradle build and no namespace — it does not build on Gradle 9 / React Native 0.88, and the legacy architecture is
// gone since SDK 55). Replaced by expo-speech-recognition, a maintained Expo module released in step with each SDK.
// Only reachable behind the `voice_listing` / `voice_assistant` flags (both OFF at launch); this file's exports are
// unchanged, so no caller changed.
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

export interface SttHandlers {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
}

/** True for the recognizer's "available" answer in either shape it arrives in (1 or true). Pure. */
export function availabilityIsYes(answer: unknown): boolean {
  return answer === 1 || answer === true;
}

/** Ask the recognizer once whether dictation can run here; any failure (no module, no service) → false. */
export async function isSttAvailable(): Promise<boolean> {
  try { return availabilityIsYes(await ExpoSpeechRecognitionModule.isRecognitionAvailable()); }
  catch { return false; }
}

let subscriptions: { remove: () => void }[] = [];

function removeListeners(): void {
  for (const s of subscriptions) { try { s.remove(); } catch { /* ignore */ } }
  subscriptions = [];
}

/** Begin dictation in `locale` (e.g. 'hi-IN'). Asks for the microphone/speech permission just in time, wires the
 * listeners, then starts the recognizer. Never throws — every failure arrives through `onError`. */
export async function startStt(locale: string, handlers: SttHandlers): Promise<void> {
  removeListeners();
  try {
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) { handlers.onError?.('stt_permission_denied'); return; }
    subscriptions = [
      ExpoSpeechRecognitionModule.addListener('result', (e) => {
        const t = e.results?.[0]?.transcript;
        if (!t) return;
        if (e.isFinal) handlers.onFinal?.(t); else handlers.onPartial?.(t);
      }),
      ExpoSpeechRecognitionModule.addListener('error', (e) => handlers.onError?.(e.message || e.error || 'stt_error')),
    ];
    ExpoSpeechRecognitionModule.start({ lang: locale, interimResults: true, continuous: false });
  } catch (e) {
    removeListeners();
    handlers.onError?.((e as Error)?.message ?? 'stt_start_failed');
  }
}

/** Stop + fully tear down listeners (call on stop and on unmount). Never throws. */
export async function stopStt(): Promise<void> {
  try { ExpoSpeechRecognitionModule.stop(); } catch { /* ignore */ }
  removeListeners();
}
