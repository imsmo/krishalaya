// apps/web-tenant/src/features/studio/quiz.ts · PURE live-scheduling helpers (PC-26b).
//
// PC-56 TENANT-7b: `parseQuizText` (PC-26b's plain-text quiz format — `Q:` / `*A)` / `H:` blocks) is GONE. W413 draws a
// question as options with a MANDATORY explanation each and a certificate threshold; a text block cannot carry an
// explanation per option legibly, and the quiz is authored one question at a time through the API-reviewed chain at
// `/courses/[id]/lessons/[lessonId]/quiz` (features/courses/lessons.ts). What remains here is the live class's helpers,
// which TENANT-7c will rebuild as its own chains.
/** Live scheduling validation (PC-26b): channel required; title 1–250; datetime-local → future ISO. */
export type LiveResult =
  | { ok: true; value: { channelId: string; title: string; scheduledAt: string } }
  | { ok: false; error: 'channel' | 'title' | 'when' };

export function buildLive(raw: { channelId: string; title: string; scheduledAtLocal: string }, now: Date = new Date()): LiveResult {
  const channelId = raw.channelId.trim();
  if (!channelId) return { ok: false, error: 'channel' };
  const title = raw.title.trim();
  if (!title || title.length > 250) return { ok: false, error: 'title' };
  const d = new Date(raw.scheduledAtLocal);
  if (Number.isNaN(d.getTime()) || d.getTime() <= now.getTime()) return { ok: false, error: 'when' };
  return { ok: true, value: { channelId, title, scheduledAt: d.toISOString() } };
}

export const LIVE_ACTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  scheduled: ['start', 'cancel'],
  live: ['end'],
  ended: [],
  cancelled: [],
});
export function liveActions(status: string | undefined | null): readonly string[] {
  return LIVE_ACTIONS[status ?? ''] ?? [];
}
