// apps/mobile/src/features/messaging/message-view.ts · PURE chat presenters (no React/native; SDK type is
// `import type` → erased) → unit-tested. Classifies a server message into a render model (mine vs theirs, text /
// image / voice) and validates a draft before send. Content is text or a media id (never raw bytes here).
import type { Message } from '@krishalaya/sdk-js';

export type MessageKind = 'text' | 'image' | 'voice' | 'empty';
export interface MessageView { id: string; mine: boolean; kind: MessageKind; body: string | null; mediaId: string | null; flagged: boolean; createdAt?: string; }

/** Map a server message + the viewer's userId → a presentational view. `kind` is derived from which field is set
 * (attachment ⇒ image, voice ⇒ voice, else text). */
export function presentMessage(m: Message, myUserId: string): MessageView {
  const kind: MessageKind = m.attachmentMediaId ? 'image' : m.voiceMediaId ? 'voice' : m.body ? 'text' : 'empty';
  return {
    id: m.id, mine: m.senderUserId === myUserId, kind, body: m.body,
    mediaId: m.attachmentMediaId ?? m.voiceMediaId ?? null, flagged: m.isFlagged, createdAt: m.createdAt,
  };
}

/** A draft is sendable if it has non-blank text OR a pending attachment. Prevents empty/whitespace sends. */
export function canSend(text: string, hasAttachment: boolean): boolean {
  return (text ?? '').trim().length > 0 || hasAttachment;
}

/** UTC calendar-day key ('YYYY-MM-DD') for a message time, or '' when absent/unparseable. Pure — used to place
 * the chat's day-divider system rows. */
export function dayKey(iso?: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  return new Date(t).toISOString().slice(0, 10);
}

/** For a DESCENDING (newest-first, as the inverted FlatList holds) list of views, is index `i` the start of a new
 * day group — i.e. the OLDEST message of its day (so a day divider renders visually above it)? True for the last
 * item overall or when its day differs from the older neighbour (i+1). Pure. */
export function isDayBoundary(views: readonly MessageView[], i: number): boolean {
  if (i < 0 || i >= views.length) return false;
  if (i === views.length - 1) return true;
  return dayKey(views[i].createdAt) !== dayKey(views[i + 1].createdAt);
}

/** Trim + bound a text body to the server's max (4000) before sending. */
export function normalizeBody(text: string): string {
  return (text ?? '').trim().slice(0, 4000);
}

/** R2-02(a): should the thread render the (newest-first, visually bottom-anchored) `inverted` FlatList of message
 * rows, or the plain upright empty-state? An inverted FlatList flips EVERYTHING it renders 180° — including
 * ListEmptyComponent — so a "Say hello 👋" shown via ListEmptyComponent came out upside-down. The robust fix is to
 * never mount the inverted list at all while there are zero messages; this pure predicate is what the screen
 * branches on (kept out of the component so the empty/non-empty decision is unit-testable without React). */
export function hasMessages(views: readonly MessageView[]): boolean {
  return views.length > 0;
}
