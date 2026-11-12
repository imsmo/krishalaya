// apps/mobile/src/core/voice/stt.client.ts · thin wrapper over @react-native-voice/voice for ON-DEVICE
// speech-to-text (no audio leaves the device for transcription — privacy + works on flaky 2G). Start with a
// locale, receive partial + final transcripts via callbacks, stop cleanly. Degrade-never-die: if the native
// module / recognizer isn't available, isAvailable() is false and start() no-ops (the screen falls back to
// typing). The result is a TRANSCRIPT only — turning it into structured crop/qty/price needs a backend AI
// endpoint that isn't built yet (see voice-listing.flow), so we never auto-fill money/quantity from speech.
import Voice, { type SpeechResultsEvent, type SpeechErrorEvent } from '@react-native-voice/voice';

export interface SttHandlers {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
}

/** True for the recognizer's "available" answer in either shape it arrives in (1 or true). Pure. */
export function availabilityIsYes(answer: unknown): boolean {
  return answer === 1 || answer === true;
}

export async function isSttAvailable(): Promise<boolean> {
  // TSC-1: the native module answers a BOOLEAN on iOS and Android (Voice.m `@[@true]`, VoiceModule.java `Boolean`) although
  // the package types it 0 | 1. The old line compared the typed number to `true` and, on a boolean answer, asked the
  // recognizer TWICE (each iOS ask is an authorization request). Ask once; accept either shape.
  try { return availabilityIsYes(await Voice.isAvailable()); }
  catch { return false; }
}

/** Begin dictation in `locale` (e.g. 'hi-IN'). Wires listeners then starts the recognizer. */
export async function startStt(locale: string, handlers: SttHandlers): Promise<void> {
  Voice.onSpeechResults = (e: SpeechResultsEvent) => { const t = e.value?.[0]; if (t) handlers.onFinal?.(t); };
  Voice.onSpeechPartialResults = (e: SpeechResultsEvent) => { const t = e.value?.[0]; if (t) handlers.onPartial?.(t); };
  Voice.onSpeechError = (e: SpeechErrorEvent) => handlers.onError?.(e.error?.message ?? 'stt_error');
  try { await Voice.start(locale); }
  catch (e) { handlers.onError?.((e as Error)?.message ?? 'stt_start_failed'); }
}

/** Stop + fully tear down listeners (call on stop and on unmount). Never throws. */
export async function stopStt(): Promise<void> {
  try { await Voice.stop(); } catch { /* ignore */ }
  try { await Voice.destroy(); } catch { /* ignore */ }
  Voice.removeAllListeners();
}
