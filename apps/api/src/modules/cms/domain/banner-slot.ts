// modules/cms/domain/banner-slot.ts · PC-56 TENANT-8d · the order of banners inside one placement, and the reorder act.
//
// A placement (`home_hero`) can hold several banners at once; `slot_order` (0178) is their order there — 1 is first. The
// reorder act rides the banners-mutate chain (W2514–W2516: the canon's own act there is *Retry*, a page load —
// PARITY-DECOR — and the list-level act the slot needs has no other home; 8c's FAQ reorder took the same shape). A move
// is a PLAN — which banners take which number — computed against the slot AS IT STANDS when the act runs (the placement
// locked: advisory lock + FOR UPDATE), renumbering the slot 1..n so pre-0178 ties come out in a stable order (by id).
// Archived banners hold no place. NO READER EXISTS to serve the order to a member — the console says so by name.
import { reasonIssue } from './banner-rules';

export interface SlotEntry { id: string; slotOrder: number }
export interface SlotStep { id: string; from: number; to: number }
export type SlotDirection = 'up' | 'down';

export const SLOT_MOVE_REFUSALS = ['NOT_IN_SLOT', 'AT_TOP', 'AT_BOTTOM'] as const;
export type SlotMoveRefusal = (typeof SLOT_MOVE_REFUSALS)[number];
export type SlotPlan = { ok: true; steps: SlotStep[]; order: string[] } | { ok: false; refusal: SlotMoveRefusal };

/** The slot in stored order: place, then id (a tie reads by id). */
export function orderedSlot(entries: readonly SlotEntry[]): SlotEntry[] {
  return [...entries].sort((a, b) => a.slotOrder - b.slotOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Every banner whose number changes when `order` becomes 1..n — and only those. */
export function renumberSlot(current: readonly SlotEntry[], order: readonly string[]): SlotStep[] {
  const by = new Map(current.map((e) => [e.id, e.slotOrder]));
  const steps: SlotStep[] = [];
  order.forEach((id, i) => {
    const from = by.get(id);
    if (from !== undefined && from !== i + 1) steps.push({ id, from, to: i + 1 });
  });
  return steps;
}

export function planSlotMove(entries: readonly SlotEntry[], id: string, direction: SlotDirection): SlotPlan {
  const sorted = orderedSlot(entries);
  const idx = sorted.findIndex((e) => e.id === id);
  if (idx < 0) return { ok: false, refusal: 'NOT_IN_SLOT' };
  if (direction === 'up' && idx === 0) return { ok: false, refusal: 'AT_TOP' };
  if (direction === 'down' && idx === sorted.length - 1) return { ok: false, refusal: 'AT_BOTTOM' };
  const order = sorted.map((e) => e.id);
  const j = direction === 'up' ? idx - 1 : idx + 1;
  [order[idx], order[j]] = [order[j], order[idx]];
  return { ok: true, steps: renumberSlot(sorted, order), order };
}

/** The place a banner takes when it joins a slot: after the last (never a count — a slot can have gaps). */
export function nextSlotPlace(entries: readonly SlotEntry[]): number {
  return entries.reduce((m, e) => (e.slotOrder > m ? e.slotOrder : m), 0) + 1;
}

/** 1-based position, as W173 prints it; null when absent. */
export function slotPosition(entries: readonly SlotEntry[], id: string): number | null {
  const i = orderedSlot(entries).findIndex((e) => e.id === id);
  return i < 0 ? null : i + 1;
}

export const SLOT_ACT_REFUSALS = ['NO_PERMISSION', 'BANNER_ARCHIVED', ...SLOT_MOVE_REFUSALS, 'REASON_REQUIRED', 'REASON_TOO_LONG'] as const;
export type SlotActRefusal = (typeof SLOT_ACT_REFUSALS)[number];
export interface SlotMoveVerdict { allowed: boolean; refusals: SlotActRefusal[]; plan: SlotPlan | null }

/** Every reason the move would be refused (the confirm screen prints them all). */
export function slotMoveVerdict(i: {
  canManage: boolean; archived: boolean; entries: readonly SlotEntry[]; id: string; direction: SlotDirection; reason: string | null | undefined;
}): SlotMoveVerdict {
  const refusals: SlotActRefusal[] = [];
  if (!i.canManage) refusals.push('NO_PERMISSION');
  let plan: SlotPlan | null = null;
  if (i.archived) refusals.push('BANNER_ARCHIVED');
  else {
    plan = planSlotMove(i.entries, i.id, i.direction);
    if (!plan.ok) refusals.push(plan.refusal);
  }
  const r = reasonIssue(i.reason);
  if (r !== null) refusals.push(r);
  return { allowed: refusals.length === 0, refusals, plan };
}
