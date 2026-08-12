// apps/web-admin/src/features/support/emergency.ts · W058 pure console logic (PC-56 ADMIN-SWEEP-b3).
//
// Reflect, never grant. The one rule this file owns outright: a step's STATUS chip never upgrades — a
// provider_pending row prints as "nothing was sent", whatever the step's name promises.

export const EMERGENCY_CATEGORIES = ['women_safety', 'emergency_vet', 'safety'] as const;

/** Category chips carry their weight: women_safety is the most protected row on the console. */
export function categoryClass(code: string): string {
  if (code === 'women_safety') return 'kv-status kv-status--err';
  if (code === 'emergency_vet') return 'kv-status kv-status--warn';
  return 'kv-status';
}

/** A step chip: recorded = a documented human act; provider_pending = the protocol says page, nothing can page. */
export function stepClass(status: string): string {
  return status === 'provider_pending' ? 'kv-status kv-status--warn' : 'kv-status kv-status--ok';
}

/** Which steps need the who/what textarea (mirrors the domain: would_page steps compose their own truth). */
export function stepNeedsDetail(kind: string): boolean {
  return kind !== 'would_page';
}

export type Built<T> = { ok: true; value: T } | { ok: false; error: string };

export const STEP_DETAIL_MIN = 20;   // one floor with the server and 0134's CHECK

export function buildStep(v: { stepCode: string; kind: string; detail: string; vetProfileId?: string }): Built<{ stepCode: string; detail?: string; vetProfileId?: string }> {
  if (!v.stepCode.trim()) return { ok: false, error: 'step' };
  if (stepNeedsDetail(v.kind) && v.detail.trim().length < STEP_DETAIL_MIN) return { ok: false, error: 'detail' };
  return {
    ok: true,
    value: {
      stepCode: v.stepCode.trim(),
      ...(stepNeedsDetail(v.kind) ? { detail: v.detail.trim() } : {}),
      ...(v.vetProfileId?.trim() ? { vetProfileId: v.vetProfileId.trim() } : {}),
    },
  };
}
