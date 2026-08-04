// apps/mobile/src/features/labour/hire-browse.ts · PURE filter/sort/chip logic for the employer "Find Workers"
// screen (screen 42). No React / no SDK I/O (SDK types are `import type` → erased) → unit-tested. Operates only on
// the PII-minimised worker pool the server returned; the SERVER stays the authority on eligibility + the pool.
import type { WorkerCard, LabourLookups } from '@krishalaya/sdk-js';

export type WorkerSort = 'rating' | 'jobs';

/** The bookable tasks for a worker (booking wizard step 1): the worker's own declared skills when the profile
 * carries them, otherwise the full skill catalogue (§13 — the pool read may omit skillIds, so we fall back to
 * "any task" rather than hiding all options). Returns the catalogue Skill objects. Pure. */
export function bookableSkills(skillIds: readonly string[] | undefined, lookups: LabourLookups | null): LabourLookups['skills'] {
  if (!lookups) return [];
  if (skillIds?.length) {
    const set = new Set(skillIds);
    const own = lookups.skills.filter((s) => set.has(s.id));
    if (own.length) return own;
  }
  return lookups.skills;
}

/** Client-side pool filter: minimum rating (⭐4.5+ chip) and 18+/verified only. Operates on the CONSENT-GATED
 * worker cards (P0-2) — rating is present only for opted-in workers, so the rating filter naturally applies to
 * them. Skill filtering is server-side (the card carries no skill set), so a skillId is a no-op here. Pure. */
export function filterWorkers(items: readonly WorkerCard[], opts: { minRating?: number; verified?: boolean; skillId?: string | null }): WorkerCard[] {
  return (items ?? []).filter((w) => {
    if (opts.verified && !w.ageVerified) return false;
    if (opts.minRating != null && (w.ratingAvg ?? 0) < opts.minRating) return false;
    return true;
  });
}

/** Sort the pool by rating (default) or completed jobs, both descending, nulls last. Returns a NEW array. Pure. */
export function sortWorkers(items: readonly WorkerCard[], sort: WorkerSort): WorkerCard[] {
  const key = (w: WorkerCard) => (sort === 'jobs' ? (w.bookingsCompleted ?? -1) : (w.ratingAvg ?? -1));
  return [...(items ?? [])].sort((a, b) => key(b) - key(a));
}

/** Resolve a worker's skill ids to localized chip labels via lookups, capped at `max` with an overflow count for a
 * "+N" chip. Returns empty when the pool read carries no skillIds (§13). Pure. */
export function skillChips(skillIds: readonly string[] | undefined, lookups: LabourLookups | null, max = 2): { labels: string[]; extra: number } {
  if (!skillIds?.length || !lookups) return { labels: [], extra: 0 };
  const byId = new Map(lookups.skills.map((s) => [s.id, s.name]));
  const names = skillIds.map((id) => byId.get(id)).filter((n): n is string => !!n);
  return { labels: names.slice(0, max), extra: Math.max(0, names.length - max) };
}
