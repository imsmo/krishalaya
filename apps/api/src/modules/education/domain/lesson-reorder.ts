// modules/education/domain/lesson-reorder.ts · PC-56 TENANT-7b · the reorder act's arithmetic — W411 *"Reorder lesson N
// (keyboard: move up/down controls in the row menu)"*.
//
// 7a's survey found that reorder had NO implementation: a lesson's only position is its UNIQUE (course, module, lesson)
// key, so a move was a delete+insert nothing performed. This file computes the move as a PLAN — which rows take which
// number — and the repository applies the plan inside one transaction on the locked course (through a negative pass,
// because the UNIQUE key would otherwise collide half-way). The plan renumbers the module's lessons to a contiguous
// 1..n as a side effect, so a course whose numbers had gaps (a PC-26 author typed 1, 2, 5) comes out tidy.
//
// A move is judged against the order AS IT STANDS when the act runs, not as the confirm screen saw it (a confirm screen
// is not a token); the Idempotency-Key makes a retried click the same click and not a second move.
export interface OrderedLesson { id: string; lessonNo: number }
export interface MoveStep { id: string; from: number; to: number }
export type MoveDirection = 'up' | 'down';
export type MoveRefusal = 'LESSON_NOT_IN_MODULE' | 'AT_TOP' | 'AT_BOTTOM';

export interface MovePlan { ok: true; steps: MoveStep[]; order: string[] }
export interface MoveRefused { ok: false; refusal: MoveRefusal }

/** The module's lessons in their stored order (by lesson_no), one moved one place. */
export function planMove(current: readonly OrderedLesson[], lessonId: string, direction: MoveDirection): MovePlan | MoveRefused {
  const sorted = [...current].sort((a, b) => a.lessonNo - b.lessonNo || a.id.localeCompare(b.id));
  const idx = sorted.findIndex((l) => l.id === lessonId);
  if (idx < 0) return { ok: false, refusal: 'LESSON_NOT_IN_MODULE' };
  if (direction === 'up' && idx === 0) return { ok: false, refusal: 'AT_TOP' };
  if (direction === 'down' && idx === sorted.length - 1) return { ok: false, refusal: 'AT_BOTTOM' };
  const order = sorted.map((l) => l.id);
  const j = direction === 'up' ? idx - 1 : idx + 1;
  [order[idx], order[j]] = [order[j], order[idx]];
  return { ok: true, steps: renumber(sorted, order), order };
}

/** Every row whose number changes when `order` (ids) becomes 1..n — and only those. */
export function renumber(current: readonly OrderedLesson[], order: readonly string[]): MoveStep[] {
  const byId = new Map(current.map((l) => [l.id, l.lessonNo]));
  const steps: MoveStep[] = [];
  order.forEach((id, i) => {
    const from = byId.get(id);
    if (from === undefined) return;
    if (from !== i + 1) steps.push({ id, from, to: i + 1 });
  });
  return steps;
}

/** The position of a lesson in its module's order, 1-based — what W411 prints before the title. */
export function positionOf(current: readonly OrderedLesson[], lessonId: string): number | null {
  const sorted = [...current].sort((a, b) => a.lessonNo - b.lessonNo || a.id.localeCompare(b.id));
  const idx = sorted.findIndex((l) => l.id === lessonId);
  return idx < 0 ? null : idx + 1;
}
