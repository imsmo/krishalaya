// apps/mobile/src/features/labour/worker-skills.ts · PURE skill-picker logic for the worker "My Skills" screen
// (screen 37). No React / no SDK I/O (SDK types are `import type` → erased) → unit-tested. Groups the labour skill
// catalogue by tier into the design's categories, resolves an emoji + a marketing badge per skill, and toggles the
// worker's self-declared skill-id set. The SERVER owns the catalogue + the statutory wage floors; these only shape
// the fixed master data for display and manage the local selection saved via updateWorker({ skillIds }).
import type { LabourLookups } from '@krishalaya/sdk-js';

export type Skill = LabourLookups['skills'][number];
export type SkillCategory = 'crop' | 'irrigation' | 'specialised';
export const CATEGORY_ORDER: readonly SkillCategory[] = ['crop', 'irrigation', 'specialised'];

/** Map a skill tier to a design category (tier 1 = crop work, 2 = irrigation/setup, 3+ = specialised). Pure. */
export function skillCategory(tier: number): SkillCategory {
  if (tier <= 1) return 'crop';
  if (tier === 2) return 'irrigation';
  return 'specialised';
}

export interface SkillRow { skill: Skill; active: boolean }
export interface SkillGroup { key: SkillCategory; items: SkillRow[]; activeCount: number }

/** Group the catalogue into ordered categories, flagging each skill's active state from the worker's skillIds.
 * Empty categories are dropped. Pure. */
export function groupByCategory(skills: readonly Skill[], activeIds: ReadonlySet<string>): SkillGroup[] {
  return CATEGORY_ORDER
    .map((key) => {
      const items = (skills ?? []).filter((s) => skillCategory(s.tier) === key).map((skill) => ({ skill, active: activeIds.has(skill.id) }));
      return { key, items, activeCount: items.filter((i) => i.active).length };
    })
    .filter((g) => g.items.length > 0);
}

/** Toggle one skill id in the selection (returns a NEW set). Pure. */
export function toggleSkill(activeIds: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(activeIds);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** An emoji for a skill, chosen from its code/name; generic 🧰 fallback so an unanticipated skill still renders. Pure. */
export function skillEmoji(skill: Pick<Skill, 'code' | 'name'>): string {
  const s = `${skill.code} ${skill.name}`.toLowerCase();
  if (/harvest/.test(s)) return '🌾';
  if (/sow|transplant|plant|seed/.test(s)) return '🌱';
  if (/weed/.test(s)) return '🌿';
  if (/drip/.test(s)) return '🪴';
  if (/flood/.test(s)) return '🚿';
  if (/irrig|water/.test(s)) return '💧';
  if (/tractor|machine|operator/.test(s)) return '🚜';
  if (/animal|cattle|livestock|dairy/.test(s)) return '🐄';
  return '🧰';
}

export type SkillBadge = 'certification' | 'skilled' | null;
/** A marketing badge for a skill, derived from real catalogue fields (hazardous / tier) — never fabricated:
 * hazardous or high-tier (≥4) work "requires certification"; tier ≥2 is a "skilled rate"; tier 1 has none. Pure. */
export function skillBadge(skill: Pick<Skill, 'tier' | 'hazardous'>): SkillBadge {
  if (skill.hazardous || skill.tier >= 4) return 'certification';
  if (skill.tier >= 2) return 'skilled';
  return null;
}

/** Whether the worker's skill selection differs from what's saved (drives the Save button's enabled state). Pure. */
export function skillsDirty(saved: readonly string[], selected: ReadonlySet<string>): boolean {
  if ((saved?.length ?? 0) !== selected.size) return true;
  for (const id of saved ?? []) if (!selected.has(id)) return true;
  return false;
}
