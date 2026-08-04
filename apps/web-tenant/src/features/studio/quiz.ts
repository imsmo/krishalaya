// apps/web-tenant/src/features/studio/quiz.ts · PURE quiz authoring (PC-26b). Trainers write a plain-text
// format (works in any textarea, no client JS); this parses it into the CANONICAL quiz JSON the mobile learner
// parser consumes: { questions: [{ q, options: string[≥2], answer: <0-based index>, hint? }] }.
//
// Format (one block per question, blank-line separated):
//   Q: How often should drip lines be flushed?
//   A) Never
//   *B) Every 2–4 weeks     ← the * marks the correct option (exactly one per question)
//   C) Only when clogged
//   H: Flushing prevents emitter clogging.   ← optional hint line
export type QuizQuestion = { q: string; options: string[]; answer: number; hint?: string };
export type QuizResult =
  | { ok: true; value: { questions: QuizQuestion[] } }
  | { ok: false; error: 'empty' | 'question' | 'options' | 'answer' };

const MAX_QUESTIONS = 50;
const OPT_RE = /^(\*?)([A-Za-z])[).]\s*(.+)$/;

export function parseQuizText(raw: string): QuizResult {
  const blocks = raw.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length === 0) return { ok: false, error: 'empty' };
  if (blocks.length > MAX_QUESTIONS) return { ok: false, error: 'question' };
  const questions: QuizQuestion[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const qLine = lines.find((l) => /^Q\s*:/i.test(l));
    if (!qLine) return { ok: false, error: 'question' };
    const q = qLine.replace(/^Q\s*:/i, '').trim();
    if (!q) return { ok: false, error: 'question' };
    const options: string[] = [];
    let answer = -1;
    let hint: string | undefined;
    for (const line of lines) {
      if (line === qLine) continue;
      const h = /^H\s*:/i.exec(line);
      if (h) { const ht = line.replace(/^H\s*:/i, '').trim(); if (ht) hint = ht; continue; }
      const m = OPT_RE.exec(line);
      if (!m) continue; // tolerate stray lines rather than failing the whole quiz
      if (m[1] === '*') {
        if (answer !== -1) return { ok: false, error: 'answer' }; // two correct marks
        answer = options.length;
      }
      options.push(m[3].trim());
    }
    if (options.length < 2) return { ok: false, error: 'options' };
    if (answer === -1) return { ok: false, error: 'answer' };
    const question: QuizQuestion = { q, options, answer };
    if (hint) question.hint = hint;
    questions.push(question);
  }
  return { ok: true, value: { questions } };
}

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
